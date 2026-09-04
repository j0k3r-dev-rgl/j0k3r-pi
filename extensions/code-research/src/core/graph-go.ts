import { createHash } from 'node:crypto';
import type { GraphEdge, GraphNode, SubprojectGraphShard } from '../types.js';
import { createEdgeId, createSubprojectNodeId, createSymbolNodeId } from './graph-schema.js';
import { toProjectRelativePath } from './source-policy.js';
import { compareCanonicalPathStrings } from './shared.js';
import { createLogicalSymbolKey, createSnapshotSymbolId, ensureFileNode, pointOccurrenceRange, sanitizePersistedSignature } from './graph-language-shared.js';
import { buildGoProjectIndex, extractCalls as extractGoCalls, findGoImplementations, resolveGoCall, type GoProjectIndex } from '../languages/go/workspace-graph.js';
import { extractGoSymbolRecords } from '../languages/go/symbol-extractor.js';
import { packagePathToName } from '../languages/go/shared.js';

export function buildGoGraph(
  projectRoot: string,
  subprojectId: string,
  index: GoProjectIndex,
  nodes: GraphNode[],
  edges: GraphEdge[],
  pendingFileStats: Array<Promise<void>>,
  generation: number
): SubprojectGraphShard['goSymbolCoverage'] {
  const fileNodeIds = new Map<string, string>();
  const fileNodes = new Map<string, Extract<GraphNode, { kind: 'file' }>>();
  const symbolIds = new Map<string, string>();
  const subprojectNodeId = createSubprojectNodeId(subprojectId);
  const completeFiles: string[] = [];
  const skippedFiles: Array<{ file: string; reason: 'parse_error' | 'input_unreadable' | 'unsupported_source' }> = [];
  const fileProofs: Record<string, { sourceHash: string; symbolCount: number }> = {};

  for (const file of index.files) {
    const relFile = toProjectRelativePath(projectRoot, file.file);
    const fileNodeId = ensureFileNode(nodes, edges, fileNodeIds, fileNodes, pendingFileStats, subprojectNodeId, subprojectId, relFile, 'go', file.file);
    const records = extractGoSymbolRecords({ filePath: file.file, source: file.source, rootNode: file.rootNode });
    completeFiles.push(relFile);
    fileProofs[relFile] = { sourceHash: records[0]?.sourceHash ?? createHash('sha256').update(file.source).digest('hex'), symbolCount: records.length };
    for (const record of records) {
      const symbolId = createSymbolNodeId(subprojectId, relFile, record.owner, record.name, record.declarationRange.startLine, record.declarationRange.startColumn);
      symbolIds.set(record.symbolId, symbolId);
      nodes.push({
        id: symbolId,
        kind: 'symbol',
        language: 'go',
        symbolKind: record.coarseKind,
        name: record.name,
        file: relFile,
        range: record.declarationRange,
        codeRange: record.codeRange,
        owner: record.owner,
        ownerKind: record.owner ? (record.declarationKind === 'interface' ? 'interface' : 'class') : 'module',
        exported: Boolean(record.exportedName) || /^[A-Z]/.test(record.name),
        signature: sanitizePersistedSignature(record.signature),
        declarationKind: record.declarationKind,
        symbolId: record.symbolId,
        logicalSymbolKey: createLogicalSymbolKey('go', subprojectId, relFile, record.owner, record.qualifiedName, record.declarationKind, record.signature),
        snapshotSymbolId: createSnapshotSymbolId(record.symbolId, record.sourceHash, record.declarationRange),
        qualifiedName: record.qualifiedName,
        relationshipId: record.relationshipId,
        sourceName: record.sourceName,
        exportedName: record.exportedName,
        anonymous: record.anonymous,
        dynamicName: record.dynamicName,
        modifiers: record.modifiers,
        isDefinition: record.isDefinition,
        isImplementation: record.isImplementation,
        sourceHash: record.sourceHash,
      });
      edges.push({ id: createEdgeId('contains', fileNodeId, symbolId), kind: 'contains', from: fileNodeId, to: symbolId });
    }
  }

  for (const file of index.files) {
    const fromRel = toProjectRelativePath(projectRoot, file.file);
    const fromFileNodeId = ensureFileNode(nodes, edges, fileNodeIds, fileNodes, pendingFileStats, subprojectNodeId, subprojectId, fromRel, 'go', file.file);
    for (const [alias, importPath] of file.imports) {
      const targetFile = index.files.find((candidate) => candidate.packageName === packagePathToName(importPath) && candidate.file !== file.file)?.file;
      if (!targetFile) continue;
      const targetRel = toProjectRelativePath(projectRoot, targetFile);
      const targetFileNodeId = ensureFileNode(nodes, edges, fileNodeIds, fileNodes, pendingFileStats, subprojectNodeId, subprojectId, targetRel, 'go', targetFile);
      edges.push({ id: createEdgeId('imports', fromFileNodeId, targetFileNodeId, alias), kind: 'imports', from: fromFileNodeId, to: targetFileNodeId, importSource: importPath });
    }
  }

  for (const callable of index.callables) {
    const fromId = symbolIds.get(callable.symbolId);
    if (!fromId) continue;
    for (const call of extractGoCalls(callable.node)) {
      const resolved = resolveGoCall(index, callable, call);
      const toId = resolved.callable ? symbolIds.get(resolved.callable.symbolId) : undefined;
      edges.push({
        id: createEdgeId('calls', fromId, toId ?? `external:go:${call.symbol}`, `${call.line}:${call.column}`),
        kind: 'calls',
        from: fromId,
        to: toId ?? `external:go:${call.symbol}`,
        occurrenceRange: pointOccurrenceRange(call.line, call.column),
        targetStatus: toId ? 'resolved' : 'external',
        resolution: toId ? 'exact' : 'heuristic',
        callsite: { line: call.line, column: call.column, receiverName: call.receiver, receiverType: resolved.receiverType },
        external: !toId,
        externalName: !toId ? call.symbol : undefined,
        externalKind: call.receiver ? 'method' : 'function',
        externalSource: !toId ? resolved.source : undefined,
        reason: !toId ? resolved.reason : undefined,
      });
    }
  }

  for (const typeInfo of index.types.filter((candidate) => candidate.kind === 'interface')) {
    const implementations = findGoImplementations(index, typeInfo);
    const targetId = symbolIds.get(typeInfo.record.symbolId);
    if (!targetId) continue;
    for (const implementation of implementations) {
      const fromId = symbolIds.get(implementation.record.symbolId);
      if (!fromId) continue;
      edges.push({ id: createEdgeId('implements', fromId, targetId), kind: 'implements', from: fromId, to: targetId, targetStatus: 'resolved', resolution: 'heuristic' });
    }
  }

  return {
    modelVersion: 1,
    grammar: { package: 'tree-sitter-go', version: '0.23.3' },
    generation,
    completeFiles: completeFiles.sort(compareCanonicalPathStrings),
    skippedFiles,
    fileProofs: Object.fromEntries(Object.entries(fileProofs).sort(([a], [b]) => compareCanonicalPathStrings(a, b))),
  };
}

