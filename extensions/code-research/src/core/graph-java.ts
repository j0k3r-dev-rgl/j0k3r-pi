import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { GraphEdge, GraphNode, SubprojectGraphShard } from '../types.js';
import { buildProjectIndex, type IndexedMethod, type ProjectIndex } from './project-index.js';
import { createBaseArtifact, createEdgeId, createSubprojectNodeId, createSymbolNodeId, createWorkspaceNodeId, validateSubprojectGraphShard } from './graph-schema.js';
import { detectGraphLanguage, toProjectRelativePath } from './source-policy.js';
import { compareCanonicalPathStrings } from './shared.js';
import {
  collectFileScopedNodeIds,
  createLogicalSymbolKey,
  createSnapshotSymbolId,
  ensureFileNode,
  escapeRegExp,
  pointOccurrenceRange,
  publicTopologyFingerprints,
  sameStringSet,
  sanitizePersistedSignature,
} from './graph-language-shared.js';
import { extractSignature as extractJavaSignature } from '../languages/java/shared.js';
import { resolveJavaCallsForGraph, type ResolvedJavaGraphCall } from '../languages/java/function-call-tree.js';

export async function createFastJavaFileIncrementalShard(
  projectRoot: string,
  subprojectRoot: string,
  subprojectId: string,
  subprojectRelativeRoot: string,
  markers: string[],
  previous: SubprojectGraphShard,
  changedFiles: string[],
  generation: number,
  excludedNestedRoots: string[] = []
): Promise<SubprojectGraphShard | undefined> {
  if (!previous.javaSymbolCoverage || previous.typescriptSymbolCoverage || previous.goSymbolCoverage) return undefined;
  if (changedFiles.length === 0 || changedFiles.length > 8) return undefined;
  const changed = new Set(changedFiles);
  const previousFilePaths = new Set(previous.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file').map((node) => node.path));
  for (const file of changed) {
    if (!previousFilePaths.has(file)) return undefined;
    if (detectGraphLanguage(file) !== 'java') return undefined;
  }

  const changedAbsoluteFiles = new Set<string>();
  for (const file of changed) changedAbsoluteFiles.add(join(projectRoot, file));
  const index = await buildProjectIndex(subprojectRoot, {
    excludeDirectories: excludedNestedRoots,
    onlyFiles: [...changedAbsoluteFiles],
    seed: createJavaSeedIndexFromPreviousShard(projectRoot, previous, changed),
  });
  for (const absolute of changedAbsoluteFiles) {
    if (!index.files.some((candidate) => candidate.file === absolute)) return undefined;
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const pendingFileStats: Array<Promise<void>> = [];
  const workspaceNodeId = createWorkspaceNodeId(projectRoot);
  const subprojectNodeId = createSubprojectNodeId(subprojectId);
  nodes.push({ id: workspaceNodeId, kind: 'workspace', name: 'workspace', root: '.' });
  nodes.push({ id: subprojectNodeId, kind: 'subproject', name: subprojectRelativeRoot, root: subprojectRelativeRoot, markers, languages: ['java'] });
  edges.push({ id: createEdgeId('contains', workspaceNodeId, subprojectNodeId), kind: 'contains', from: workspaceNodeId, to: subprojectNodeId });
  const patchCoverage = buildJavaGraph(projectRoot, subprojectId, index, nodes, edges, pendingFileStats, generation, { onlyFiles: changedAbsoluteFiles, seedSymbolIds: createPreviousSymbolIdMap(previous) });
  if (!patchCoverage) return undefined;
  await Promise.all(pendingFileStats);

  const patchShard = { ...previous, nodes, edges };
  const previousAffected = collectFileScopedNodeIds(previous, changed);
  const patchAffected = collectFileScopedNodeIds(patchShard, changed);
  if (!sameStringSet(previousAffected, patchAffected)) return undefined;
  const previousPublic = publicTopologyFingerprints(previous, changed);
  const patchPublic = publicTopologyFingerprints(patchShard, changed);
  if (!sameStringSet(previousPublic, patchPublic)) return undefined;

  const nextNodes = [
    ...previous.nodes.filter((node) => !previousAffected.has(node.id)),
    ...nodes.filter((node) => patchAffected.has(node.id)),
  ];
  const nextEdgesById = new Map<string, GraphEdge>();
  for (const edge of previous.edges) {
    if (previousAffected.has(edge.from)) continue;
    nextEdgesById.set(edge.id, edge);
  }
  for (const edge of edges) {
    if (patchAffected.has(edge.from) || patchAffected.has(edge.to)) nextEdgesById.set(edge.id, edge);
  }

  const previousCoverage = previous.javaSymbolCoverage;
  const completeFiles = new Set(previousCoverage.completeFiles);
  for (const file of changed) completeFiles.delete(file);
  for (const file of patchCoverage.completeFiles) completeFiles.add(file);
  const skippedFiles = previousCoverage.skippedFiles.filter((entry) => !changed.has(entry.file));
  skippedFiles.push(...patchCoverage.skippedFiles);
  const fileProofs = { ...previousCoverage.fileProofs };
  for (const file of changed) delete fileProofs[file];
  Object.assign(fileProofs, patchCoverage.fileProofs);
  const sortedCompleteFiles = [...completeFiles].sort(compareCanonicalPathStrings);

  const candidate = createBaseArtifact({
    subprojectId,
    generation,
    nodes: nextNodes,
    edges: [...nextEdgesById.values()],
    javaSymbolCoverage: {
      ...previousCoverage,
      generation,
      completeFiles: sortedCompleteFiles,
      skippedFiles: skippedFiles.sort((a, b) => compareCanonicalPathStrings(a.file, b.file) || a.reason.localeCompare(b.reason)),
      fileProofs: Object.fromEntries(Object.entries(fileProofs).sort(([a], [b]) => compareCanonicalPathStrings(a, b))),
      sourceSnapshotId: createHash('sha256')
        .update(sortedCompleteFiles.map((file) => `${file}:${fileProofs[file].sourceHash}`).join('|'))
        .digest('hex'),
    },
  });
  return validateSubprojectGraphShard(candidate) ? candidate : undefined;
}

function createPreviousSymbolIdMap(shard: SubprojectGraphShard): Map<string, string> {
  const result = new Map<string, string>();
  for (const node of shard.nodes) {
    if (node.kind === 'symbol' && node.symbolId) result.set(node.symbolId, node.id);
  }
  return result;
}

function createJavaSeedIndexFromPreviousShard(projectRoot: string, shard: SubprojectGraphShard, changed: Set<string>): ProjectIndex {
  const index: ProjectIndex = { methods: [], fields: [], classes: [], imports: new Map(), files: [], typeReferences: [] };
  for (const node of shard.nodes) {
    if (node.kind !== 'symbol' || !node.symbolId || changed.has(node.file)) continue;
    const packageName = javaPackageNameFromQualifiedName(node.qualifiedName, node.name);
    const owner = node.owner ?? javaOwnerNameFromQualifiedName(node.qualifiedName, node.name);
    if (node.declarationKind === 'class' || node.declarationKind === 'interface' || node.declarationKind === 'enum' || node.declarationKind === 'record' || node.declarationKind === 'annotation') {
      index.classes.push({
        file: join(projectRoot, node.file),
        package: packageName,
        className: node.name,
        fullName: node.qualifiedName ?? node.name,
        kind: node.declarationKind,
        ownerChain: node.owner ? node.owner.split('.') : [],
        symbolId: node.symbolId,
        implements: [],
        extends: [],
        permits: [],
        line: node.range.startLine,
        column: node.range.startColumn,
      });
      continue;
    }
    if (node.declarationKind === 'method' || node.declarationKind === 'constructor' || node.declarationKind === 'compact_constructor' || node.declarationKind === 'annotation_element') {
      index.methods.push({
        file: join(projectRoot, node.file),
        package: packageName,
        className: owner.split('.').pop() ?? owner,
        qualifiedClassName: owner,
        symbol: node.name,
        qualifiedName: node.qualifiedName ?? node.name,
        ownerChain: node.owner ? node.owner.split('.') : [],
        declarationKind: node.declarationKind,
        normalizedParameterTypes: [],
        arity: 0,
        varargs: false,
        symbolId: node.symbolId,
        relationshipId: node.relationshipId,
        line: node.range.startLine,
        column: node.range.startColumn,
        node: undefined,
      });
      continue;
    }
    if (node.declarationKind === 'field') {
      index.fields.push({
        file: join(projectRoot, node.file),
        package: packageName,
        className: owner.split('.').pop() ?? owner,
        qualifiedClassName: owner,
        fieldName: node.name,
        qualifiedName: node.qualifiedName ?? node.name,
        typeName: '',
        symbolId: node.symbolId,
        line: node.range.startLine,
        column: node.range.startColumn,
        typeLine: node.range.startLine,
        typeColumn: node.range.startColumn,
        typeEndLine: node.range.startLine,
        typeEndColumn: node.range.startColumn,
      });
    }
  }
  return index;
}

function javaOwnerNameFromQualifiedName(qualifiedName: string | undefined, name: string): string {
  if (!qualifiedName || !qualifiedName.endsWith(`.${name}`)) return '';
  return qualifiedName.slice(0, -name.length - 1);
}

function javaPackageNameFromQualifiedName(qualifiedName: string | undefined, name: string): string {
  const owner = javaOwnerNameFromQualifiedName(qualifiedName, name);
  const parts = owner.split('.').filter(Boolean);
  return parts.slice(0, -1).join('.');
}

export function buildJavaGraph(
  projectRoot: string,
  subprojectId: string,
  index: Awaited<ReturnType<typeof buildProjectIndex>>,
  nodes: GraphNode[],
  edges: GraphEdge[],
  pendingFileStats: Array<Promise<void>>,
  generation: number,
  options: { onlyFiles?: Set<string>; seedSymbolIds?: Map<string, string> } = {}
): SubprojectGraphShard['javaSymbolCoverage'] {
  const graphFiles = options.onlyFiles ? index.files.filter((file) => options.onlyFiles!.has(file.file)) : index.files;
  const fileNodeIds = new Map<string, string>();
  const fileNodes = new Map<string, Extract<GraphNode, { kind: 'file' }>>();
  const symbolIds = new Map<string, string>(options.seedSymbolIds);
  const classLookup = createJavaClassLookup(index);
  const sourceLookup = createJavaSourceLookup(index);
  const subprojectNodeId = createSubprojectNodeId(subprojectId);
  const completeFiles: string[] = [];
  const skippedFiles: Array<{ file: string; reason: 'parse_error' | 'input_unreadable' | 'unsupported_source' }> = [];
  const fileProofs: Record<string, { sourceHash: string; symbolCount: number; relationshipScopeCount: number; observedFamilies: any[]; unsupportedForms: any[] }> = {};

  for (const file of graphFiles) {
    const relFile = toProjectRelativePath(projectRoot, file.file);
    const fileNodeId = ensureFileNode(nodes, edges, fileNodeIds, fileNodes, pendingFileStats, subprojectNodeId, subprojectId, relFile, 'java', file.file);
    completeFiles.push(relFile);
    fileProofs[relFile] = {
      sourceHash: file.extraction.sourceHash,
      symbolCount: file.extraction.records.length,
      relationshipScopeCount: file.extraction.relationshipScopes.length,
      observedFamilies: [...file.extraction.observedFamilies].sort(),
      unsupportedForms: [...file.extraction.unsupportedForms].sort(),
    };
    for (const record of file.extraction.records) {
      const symbolId = createSymbolNodeId(subprojectId, relFile, record.owner, record.name, record.declarationRange.startLine, record.declarationRange.startColumn);
      symbolIds.set(record.symbolId, symbolId);
      nodes.push({
        id: symbolId,
        kind: 'symbol',
        language: 'java',
        symbolKind: record.coarseKind,
        name: record.name,
        file: relFile,
        range: record.declarationRange,
        codeRange: record.codeRange,
        owner: record.owner,
        ownerKind: record.owner ? (classLookup.byName.get(record.owner)?.kind === 'interface' ? 'interface' : 'class') : 'unknown',
        exported: true,
        signature: sanitizePersistedSignature(record.signature),
        declarationKind: record.declarationKind,
        symbolId: record.symbolId,
        logicalSymbolKey: createLogicalSymbolKey('java', subprojectId, relFile, record.owner, record.qualifiedName, record.declarationKind, record.signature),
        snapshotSymbolId: createSnapshotSymbolId(record.symbolId, record.sourceHash, record.declarationRange),
        qualifiedName: record.qualifiedName,
        relationshipId: record.relationshipId,
        sourceName: record.sourceName,
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

  for (const classRecord of index.classes) {
    if (options.onlyFiles && !options.onlyFiles.has(classRecord.file)) continue;
    const fromId = symbolIds.get(classRecord.symbolId);
    if (!fromId) continue;
    for (const implemented of classRecord.implements ?? []) {
      const target = classLookup.byName.get(implemented);
      const to = target ? symbolIds.get(target.symbolId) ?? `external:java:${implemented}` : `external:java:${implemented}`;
      const relationshipMetadata = getJavaTypeRelationshipMetadataForGraph(sourceLookup, classRecord.file, classRecord.line, 'implements', target?.className ?? implemented.split('.').pop() ?? implemented);
      edges.push({ id: createEdgeId('implements', fromId, to), kind: 'implements', from: fromId, to, occurrenceRange: relationshipMetadata?.range, calledAs: relationshipMetadata?.calledAs, targetStatus: to.startsWith('external:') ? 'external' : 'resolved', resolution: to.startsWith('external:') ? 'heuristic' : 'exact' });
    }
    for (const extended of classRecord.extends ?? []) {
      const target = classLookup.byName.get(extended);
      const to = target ? symbolIds.get(target.symbolId) ?? `external:java:${extended}` : `external:java:${extended}`;
      const relationshipMetadata = getJavaTypeRelationshipMetadataForGraph(sourceLookup, classRecord.file, classRecord.line, 'extends', target?.className ?? extended.split('.').pop() ?? extended);
      edges.push({ id: createEdgeId('extends', fromId, to), kind: 'extends', from: fromId, to, occurrenceRange: relationshipMetadata?.range, calledAs: relationshipMetadata?.calledAs, targetStatus: to.startsWith('external:') ? 'external' : 'resolved', resolution: to.startsWith('external:') ? 'heuristic' : 'exact' });
    }
    for (const permitted of classRecord.permits ?? []) {
      const target = classLookup.byName.get(permitted);
      const to = target ? symbolIds.get(target.symbolId) ?? `external:java:${permitted}` : `external:java:${permitted}`;
      edges.push({ id: createEdgeId('permits', fromId, to), kind: 'permits', from: fromId, to, targetStatus: to.startsWith('external:') ? 'external' : 'resolved', resolution: to.startsWith('external:') ? 'heuristic' : 'exact' });
    }
  }

  for (const typeReference of index.typeReferences) {
    if (options.onlyFiles && !options.onlyFiles.has(typeReference.file)) continue;
    const targetId = symbolIds.get(typeReference.targetSymbolId);
    if (!targetId) continue;
    const relFile = toProjectRelativePath(projectRoot, typeReference.file);
    const fileNodeId = fileNodeIds.get(relFile);
    const fromId = typeReference.contextSymbolId ? symbolIds.get(typeReference.contextSymbolId) : fileNodeId;
    if (!fromId) continue;
    const edgeKind = typeReference.referenceKind === 'import' ? 'imports' : 'reads';
    edges.push({
      id: createEdgeId(edgeKind, fromId, targetId, `${typeReference.referenceKind}:${typeReference.line}:${typeReference.column}`),
      kind: edgeKind,
      from: fromId,
      to: targetId,
      occurrenceRange: { startLine: typeReference.line, startColumn: typeReference.column, endLine: typeReference.endLine, endColumn: typeReference.endColumn },
      callsite: edgeKind === 'reads' ? { line: typeReference.line, column: typeReference.column } : undefined,
      calledAs: typeReference.calledAs,
      importSource: typeReference.importSource,
      targetStatus: 'resolved',
      resolution: 'exact',
      reason: `java_${typeReference.referenceKind}`,
    });
  }

  for (const method of index.methods) {
    if (options.onlyFiles && !options.onlyFiles.has(method.file)) continue;
    const fromId = symbolIds.get(method.symbolId);
    if (!fromId) continue;
    for (const { call, resolved, targetMethod } of collectJavaGraphCalls(method, index)) {
      const resolvedTargetId = targetMethod ? symbolIds.get(targetMethod.symbolId) : undefined;
      const toId = resolvedTargetId ?? `external:java:${call.methodName}`;
      edges.push({
        id: createEdgeId('calls', fromId, toId, `${call.line}:${call.column}`),
        kind: 'calls',
        from: fromId,
        to: toId,
        occurrenceRange: pointOccurrenceRange(call.line, call.column),
        targetStatus: resolvedTargetId ? 'resolved' : 'external',
        resolution: resolvedTargetId ? 'exact' : 'heuristic',
        callsite: { line: call.line, column: call.column, receiverName: call.object, receiverType: resolved?.receiverType },
        external: !resolvedTargetId,
        externalName: !resolvedTargetId ? call.methodName : undefined,
        externalKind: 'method',
        externalSource: !resolvedTargetId ? resolved?.source ?? 'unknown' : undefined,
        externalOwner: !resolvedTargetId ? resolved?.className : undefined,
        externalOwnerKind: !resolvedTargetId ? resolved?.ownerKind : undefined,
        targetRelationshipId: !resolvedTargetId ? resolved?.targetRelationshipId : undefined,
        reason: resolved?.reason,
      });
    }
  }

  const sortedCompleteFiles = [...completeFiles].sort(compareCanonicalPathStrings);
  const sourceSnapshotId = createHash('sha256')
    .update(sortedCompleteFiles.map((file) => `${file}:${fileProofs[file].sourceHash}`).join('|'))
    .digest('hex');
  return {
    modelVersion: 1,
    grammar: { package: 'tree-sitter-java', version: '0.23.5' },
    generation,
    sourceSnapshotId,
    completeFiles: sortedCompleteFiles,
    skippedFiles,
    fileProofs,
  };
}

interface JavaClassLookup {
  byName: Map<string, ProjectIndex['classes'][number]>;
}

interface JavaSourceLookup {
  linesByFile: Map<string, string[]>;
}

function createJavaClassLookup(index: ProjectIndex): JavaClassLookup {
  const byName = new Map<string, ProjectIndex['classes'][number]>();
  for (const klass of index.classes) {
    byName.set(klass.fullName, klass);
    byName.set(klass.className, klass);
  }
  return { byName };
}

function createJavaSourceLookup(index: ProjectIndex): JavaSourceLookup {
  const linesByFile = new Map<string, string[]>();
  for (const file of index.files) linesByFile.set(file.file, file.source.split('\n'));
  return { linesByFile };
}

function getJavaTypeRelationshipMetadataForGraph(
  sourceLookup: JavaSourceLookup,
  file: string,
  line: number,
  relationship: 'extends' | 'implements',
  targetName: string
): { range: { startLine: number; startColumn: number; endLine: number; endColumn: number }; calledAs: string } | undefined {
  const lineText = sourceLookup.linesByFile.get(file)?.[line - 1];
  if (!lineText) return undefined;
  const match = lineText.match(new RegExp(`\\b${relationship}\\s+[^\\{]*?\\b${escapeRegExp(targetName)}(?:\\b|\\s*<)`));
  if (!match || match.index === undefined) return undefined;
  return {
    range: { startLine: line, startColumn: match.index, endLine: line, endColumn: match.index + match[0].length },
    calledAs: match[0].trim().replace(/\s+</g, '<'),
  };
}

function collectJavaGraphCalls(method: IndexedMethod, index: ProjectIndex): ResolvedJavaGraphCall[] {
  const collected: ResolvedJavaGraphCall[] = [];
  const visit = (calls: ResolvedJavaGraphCall[]) => {
    for (const resolvedCall of calls) {
      collected.push(resolvedCall);
      for (const callback of resolvedCall.call.callbacks ?? []) {
        visit(resolveJavaCallsForGraph(method, index, callback.calls));
      }
    }
  };
  visit(resolveJavaCallsForGraph(method, index));
  return collected;
}

