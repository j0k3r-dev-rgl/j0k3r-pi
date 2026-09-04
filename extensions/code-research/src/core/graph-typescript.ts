import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { CallSource, GraphEdge, GraphNode, OwnerKind, SourceRange, SubprojectGraphShard } from '../types.js';
import {
  createBaseArtifact,
  createEdgeId,
  createSubprojectNodeId,
  createSymbolNodeId,
  createWorkspaceNodeId,
  TYPESCRIPT_COMPILER_MODEL_VERSION,
  TYPESCRIPT_GRAMMAR_VERSION,
  TYPESCRIPT_SYMBOL_COVERAGE_MODEL_VERSION,
  validateSubprojectGraphShard,
} from './graph-schema.js';
import { detectGraphLanguage, toProjectRelativePath } from './source-policy.js';
import { compareCanonicalPathStrings } from './shared.js';
import {
  collectFileScopedNodeIds,
  createLogicalSymbolKey,
  createSnapshotSymbolId,
  ensureFileNode,
  pointOccurrenceRange,
  publicTopologyFingerprints,
  sameStringSet,
} from './graph-language-shared.js';
import {
  buildTypeScriptProjectIndex,
  extractCalls as extractTypeScriptDirectCalls,
  resolveCall as resolveTypeScriptDirectCall,
  resolveExportedCallable,
  type IndexedCallable as TsIndexedCallable,
  type IndexedClass as TsIndexedClass,
  type IndexedFile as TsIndexedFile,
  type ImportBinding as TsImportBinding,
  type TypeScriptProjectIndex,
} from '../languages/typescript/function-call-tree.js';
import { extractSignature as extractTypeScriptSignature, resolveTypeScriptImportCandidates } from '../languages/typescript/shared.js';
import { extractTypeScriptSymbols } from '../languages/typescript/symbol-extractor.js';

export async function createFastTypeScriptFileIncrementalShard(
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
  if (!previous.typescriptSymbolCoverage || previous.javaSymbolCoverage || previous.goSymbolCoverage) return undefined;
  if (changedFiles.length === 0 || changedFiles.length > 8) return undefined;
  const changed = new Set(changedFiles);
  const previousFilePaths = new Set(previous.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file').map((node) => node.path));
  for (const file of changed) {
    if (!previousFilePaths.has(file)) return undefined;
    const language = detectGraphLanguage(file);
    if (language !== 'ts' && language !== 'js') return undefined;
  }

  const changedAbsoluteFiles = new Set<string>();
  for (const file of changed) changedAbsoluteFiles.add(join(projectRoot, file));
  const index = await buildTypeScriptProjectIndex(subprojectRoot, {
    excludeDirectories: excludedNestedRoots,
    onlyFiles: [...changedAbsoluteFiles],
    seed: createTypeScriptSeedIndexFromPreviousShard(projectRoot, subprojectRoot, previous, changed),
  });
  for (const absolute of changedAbsoluteFiles) {
    if (!index.files.has(absolute)) return undefined;
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const pendingFileStats: Array<Promise<void>> = [];
  const workspaceNodeId = createWorkspaceNodeId(projectRoot);
  const subprojectNodeId = createSubprojectNodeId(subprojectId);
  nodes.push({ id: workspaceNodeId, kind: 'workspace', name: 'workspace', root: '.' });
  nodes.push({ id: subprojectNodeId, kind: 'subproject', name: subprojectRelativeRoot, root: subprojectRelativeRoot, markers, languages: ['ts'] });
  edges.push({ id: createEdgeId('contains', workspaceNodeId, subprojectNodeId), kind: 'contains', from: workspaceNodeId, to: subprojectNodeId });
  const patchCoverage = buildTypeScriptGraph(projectRoot, subprojectId, index, nodes, edges, pendingFileStats, generation, { onlyFiles: changedAbsoluteFiles });
  await Promise.all(pendingFileStats);

  const previousAffected = collectFileScopedNodeIds(previous, changed);
  const patchAffected = collectFileScopedNodeIds({ ...previous, nodes, edges }, changed);
  if (!sameStringSet(previousAffected, patchAffected)) return undefined;
  const previousPublic = publicTopologyFingerprints(previous, changed);
  const patchPublic = publicTopologyFingerprints({ ...previous, nodes, edges }, changed);
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

  const previousCoverage = previous.typescriptSymbolCoverage;
  const completeFiles = new Set(previousCoverage.completeFiles);
  for (const file of changed) completeFiles.delete(file);
  for (const file of patchCoverage.completeFiles) completeFiles.add(file);
  const skippedFiles = previousCoverage.skippedFiles.filter((entry) => !changed.has(entry.file));
  skippedFiles.push(...patchCoverage.skippedFiles);
  const fileProofs = { ...previousCoverage.fileProofs };
  for (const file of changed) delete fileProofs[file];
  Object.assign(fileProofs, patchCoverage.fileProofs);

  const candidate = createBaseArtifact({
    subprojectId,
    generation,
    nodes: nextNodes,
    edges: [...nextEdgesById.values()],
    typescriptSymbolCoverage: {
      ...previousCoverage,
      generation,
      completeFiles: [...completeFiles].sort(compareCanonicalPathStrings),
      skippedFiles: skippedFiles.sort((a, b) => compareCanonicalPathStrings(a.file, b.file) || a.reason.localeCompare(b.reason)),
      fileProofs: Object.fromEntries(Object.entries(fileProofs).sort(([a], [b]) => compareCanonicalPathStrings(a, b))),
    },
  });
  return validateSubprojectGraphShard(candidate) ? candidate : undefined;
}

function createTypeScriptSeedIndexFromPreviousShard(projectRoot: string, subprojectRoot: string, shard: SubprojectGraphShard, changed: Set<string>): TypeScriptProjectIndex {
  const files = new Map<string, TsIndexedFile>();
  for (const node of shard.nodes) {
    if (node.kind !== 'file' || changed.has(node.path)) continue;
    const file = join(projectRoot, node.path);
    files.set(file, {
      file,
      language: node.language === 'js' ? 'js' : 'ts',
      rootNode: { children: [] },
      source: '',
      imports: new Map(),
      reExports: [],
    });
  }

  const callables: TsIndexedCallable[] = [];
  const classes: TsIndexedClass[] = [];
  for (const node of shard.nodes) {
    if (node.kind !== 'symbol' || changed.has(node.file)) continue;
    const file = join(projectRoot, node.file);
    if (isCallableGraphDeclaration(node.declarationKind ?? '')) {
      callables.push({
        file,
        language: node.language === 'js' ? 'js' : 'ts',
        symbol: node.name,
        kind: node.owner ? 'method' : 'function',
        ownerName: node.owner,
        ownerKind: node.ownerKind ?? 'unknown',
        line: node.range.startLine,
        column: node.range.startColumn,
        node: undefined,
        exportedName: node.exportedName ?? (node.exported ? node.name : undefined),
      });
    }
    if ((node.declarationKind === 'class' || node.declarationKind === 'interface') && !node.owner) {
      classes.push({
        file,
        language: node.language === 'js' ? 'js' : 'ts',
        className: node.name,
        line: node.range.startLine,
        column: node.range.startColumn,
        node: { type: node.declarationKind === 'interface' ? 'interface_declaration' : 'class_declaration' },
        exportedName: node.exportedName ?? (node.exported ? node.name : undefined),
      });
    }
  }

  return {
    projectRoot: subprojectRoot,
    projectConfig: { projectRoot: subprojectRoot, baseUrl: subprojectRoot, pathAliases: [] },
    callables,
    classes,
    files,
  };
}

export function buildTypeScriptGraph(
  projectRoot: string,
  subprojectId: string,
  index: TypeScriptProjectIndex,
  nodes: GraphNode[],
  edges: GraphEdge[],
  pendingFileStats: Array<Promise<void>>,
  generation: number,
  options: { onlyFiles?: Set<string> } = {}
) {
  const graphFiles = options.onlyFiles ? [...index.files.values()].filter((file) => options.onlyFiles!.has(file.file)) : [...index.files.values()];
  const fileNodeIds = new Map<string, string>();
  const fileNodes = new Map<string, Extract<GraphNode, { kind: 'file' }>>();
  const callableSymbolIds = new Map<string, string>();
  const typeScriptClassSymbolIds = new Map<string, string>();
  const typeScriptMemberSymbolIds = new Map<string, string>();
  const typeScriptObjectPropertySymbolIdsByName = new Map<string, string[]>();
  const typeScriptTypeAliasSymbolIds = new Map<string, string>();
  const typeScriptValueSymbolIds = new Map<string, string>();
  const subprojectNodeId = createSubprojectNodeId(subprojectId);
  const completeFiles: string[] = [];
  const skippedFiles: Array<{ file: string; reason: 'parse_error' | 'input_unreadable' | 'unsupported_language' | 'unsupported_source' }> = [];
  const fileProofs: Record<string, { sourceHash: string; symbolCount: number }> = {};

  for (const file of graphFiles) {
    const relFile = toProjectRelativePath(projectRoot, file.file);
    const fileNodeId = ensureFileNode(nodes, edges, fileNodeIds, fileNodes, pendingFileStats, subprojectNodeId, subprojectId, relFile, file.language, file.file);
    let records;
    try {
      records = extractTypeScriptSymbols(relFile, file.source);
    } catch {
      skippedFiles.push({ file: relFile, reason: 'parse_error' });
      continue;
    }
    completeFiles.push(relFile);
    fileProofs[relFile] = {
      sourceHash: records[0]?.sourceHash ?? createHash('sha256').update(file.source).digest('hex'),
      symbolCount: records.length,
    };

    for (const record of records) {
      const symbolId = createSymbolNodeId(subprojectId, relFile, record.owner, record.name, record.declarationRange.startLine, record.declarationRange.startColumn);
      if (record.owner) {
        typeScriptMemberSymbolIds.set(typeScriptMemberSymbolKey(record.owner, record.name), symbolId);
        if (record.declarationKind === 'object_property') {
          const current = typeScriptObjectPropertySymbolIdsByName.get(record.name) ?? [];
          current.push(symbolId);
          typeScriptObjectPropertySymbolIdsByName.set(record.name, current);
        }
      }
      if (isCallableGraphDeclaration(record.declarationKind)) {
        const callableKey = typeScriptCallableSymbolKey(file.file, record.owner, record.name);
        if (!callableSymbolIds.has(callableKey) || record.isImplementation) callableSymbolIds.set(callableKey, symbolId);
      }
      if ((record.declarationKind === 'class' || record.declarationKind === 'interface') && !record.owner) {
        typeScriptClassSymbolIds.set(typeScriptExportedSymbolKey(file.file, record.name), symbolId);
      }
      if (record.declarationKind === 'type_alias' && !record.owner) {
        typeScriptTypeAliasSymbolIds.set(typeScriptExportedSymbolKey(file.file, record.name), symbolId);
      }
      if (!record.owner && record.coarseKind === 'variable' && record.declarationKind !== 'type_alias') {
        typeScriptValueSymbolIds.set(typeScriptExportedSymbolKey(file.file, record.exportedName ?? record.name), symbolId);
      }
      nodes.push({
        id: symbolId,
        kind: 'symbol',
        language: file.language,
        symbolKind: record.coarseKind,
        name: record.name,
        file: relFile,
        range: record.declarationRange,
        codeRange: record.codeRange,
        owner: record.owner,
        ownerKind: record.owner ? (record.declarationKind === 'namespace' || record.declarationKind === 'module' ? 'namespace' : record.declarationKind === 'interface_method' || record.declarationKind === 'property' || record.declarationKind === 'call_signature' || record.declarationKind === 'construct_signature' || record.declarationKind === 'index_signature' ? 'interface' : 'class') : 'unknown',
        exported: Boolean(record.exportedName),
        signature: sanitizePersistedSignature(record.signature),
        declarationKind: record.declarationKind,
        symbolId: record.symbolId,
        logicalSymbolKey: createLogicalSymbolKey(file.language, subprojectId, relFile, record.owner, record.qualifiedName, record.declarationKind, record.signature),
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

    for (const binding of file.imports.values()) {
      const candidates = resolveTypeScriptImportCandidates(file.file, binding.source, index.projectConfig);
      const target = candidates.find((candidate) => index.files.has(candidate));
      if (!target) continue;
      const targetRel = toProjectRelativePath(projectRoot, target);
      const targetFileNodeId = ensureFileNode(nodes, edges, fileNodeIds, fileNodes, pendingFileStats, subprojectNodeId, subprojectId, targetRel, detectGraphLanguage(target) ?? file.language, target);
      edges.push({ id: createEdgeId('imports', fileNodeId, targetFileNodeId, binding.localName), kind: 'imports', from: fileNodeId, to: targetFileNodeId, importSource: binding.source });
    }
  }

  for (const edge of collectTypeScriptTypeAliasReferenceEdges(projectRoot, index, typeScriptTypeAliasSymbolIds, fileNodeIds, options.onlyFiles)) {
    edges.push(edge);
  }

  for (const edge of collectTypeScriptSymbolReferenceEdges(projectRoot, index, callableSymbolIds, typeScriptClassSymbolIds, typeScriptTypeAliasSymbolIds, typeScriptValueSymbolIds, fileNodeIds, options.onlyFiles)) {
    edges.push(edge);
  }

  for (const edge of collectTypeScriptMemberReadEdges(projectRoot, index, typeScriptMemberSymbolIds, typeScriptObjectPropertySymbolIdsByName, callableSymbolIds, fileNodeIds, options.onlyFiles)) {
    edges.push(edge);
  }

  for (const edge of collectTypeScriptPropertyAliasCallEdges(projectRoot, index, callableSymbolIds, typeScriptClassSymbolIds, fileNodeIds, options.onlyFiles)) {
    edges.push(edge);
  }

  for (const callable of index.callables) {
    if (options.onlyFiles && !options.onlyFiles.has(callable.file)) continue;
    const fromId = callableSymbolIds.get(typeScriptCallableSymbolKey(callable.file, callable.ownerName, callable.symbol));
    if (!fromId) continue;
    for (const call of extractTypeScriptCalls(callable.node)) {
      const resolved = resolveTypeScriptCall(index, callable, call);
      const typedReceiver = resolved.receiverType ?? inferTypeScriptReceiverTypeForGraph(index, callable, call.receiver, call.symbol);
      const target = resolved.target;
      const directToId = target
        ? callableSymbolIds.get(typeScriptCallableSymbolKey(target.file, target.ownerName, target.symbol))
        : undefined;
      const memberToId = !directToId && typedReceiver ? typeScriptMemberSymbolIds.get(typeScriptMemberSymbolKey(typedReceiver, call.symbol)) : undefined;
      const toId = directToId ?? memberToId;
      const reason = memberToId && !directToId ? 'receiver-type-contract-method' : resolved.reason;
      edges.push({
        id: createEdgeId('calls', fromId, toId ?? `external:${callable.language}:${call.symbol}`, `${call.line}:${call.column}`),
        kind: 'calls',
        from: fromId,
        to: toId ?? `external:${callable.language}:${call.symbol}`,
        occurrenceRange: pointOccurrenceRange(call.line, call.column),
        targetStatus: toId ? 'resolved' : 'external',
        resolution: toId ? 'exact' : 'heuristic',
        callsite: { line: call.line, column: call.column, receiverName: call.receiver, receiverType: typedReceiver ?? (resolved.ownerKind === 'class' ? resolved.owner : undefined) },
        external: !toId,
        externalName: !toId ? call.symbol : undefined,
        externalKind: call.receiver ? 'method' : 'function',
        externalSource: !toId ? resolved.source : undefined,
        externalOwner: !toId ? resolved.owner : undefined,
        externalOwnerKind: !toId ? resolved.ownerKind : undefined,
        reason,
      });
    }

    for (const read of extractTypeScriptJsxReads(callable.node)) {
      const resolved = resolveTypeScriptJsxRead(index, callable, read.symbol);
      const target = resolved.target;
      const toId = target
        ? callableSymbolIds.get(typeScriptCallableSymbolKey(target.file, target.ownerName, target.symbol))
        : undefined;
      if (!toId) continue;
      edges.push({
        id: createEdgeId('reads', fromId, toId, `${read.line}:${read.column}`),
        kind: 'reads',
        from: fromId,
        to: toId,
        occurrenceRange: pointOccurrenceRange(read.line, read.column),
        targetStatus: 'resolved',
        resolution: 'heuristic',
        callsite: { line: read.line, column: read.column },
      });
    }
  }

  clearTypeScriptSourceCaches();
  return {
    modelVersion: TYPESCRIPT_SYMBOL_COVERAGE_MODEL_VERSION,
    compilerModelVersion: TYPESCRIPT_COMPILER_MODEL_VERSION,
    grammar: { typescript: TYPESCRIPT_GRAMMAR_VERSION, tsx: TYPESCRIPT_GRAMMAR_VERSION },
    generation,
    completeFiles: completeFiles.sort(),
    skippedFiles: skippedFiles.sort((a, b) => a.file.localeCompare(b.file) || a.reason.localeCompare(b.reason)),
    fileProofs: Object.fromEntries(Object.entries(fileProofs).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function inferTypeScriptReceiverTypeForGraph(
  index: TypeScriptProjectIndex,
  current: TsIndexedCallable,
  receiver: string | undefined,
  methodName: string
): string | undefined {
  if (!receiver) return undefined;
  const file = index.files.get(current.file);
  if (!file) return undefined;
  const declarations = new Map<string, string>();
  for (const match of file.source.matchAll(/\b([A-Za-z_$][\w$]*)\??\s*:\s*([A-Za-z_$][\w$]*)\b/g)) {
    if (!match[1] || !match[2]) continue;
    declarations.set(match[1], match[2]);
    declarations.set(`this.${match[1]}`, match[2]);
  }
  const receiverType = declarations.get(receiver);
  if (!receiverType) return undefined;
  const receiverPattern = receiver.includes('.') ? escapeRegExp(receiver) : `(?<![.\\w$])${escapeRegExp(receiver)}`;
  if (!new RegExp(`${receiverPattern}\\s*\\.\\s*${escapeRegExp(methodName)}\\s*\\(`).test(file.source)) return undefined;
  return receiverType;
}

function collectTypeScriptSymbolReferenceEdges(
  projectRoot: string,
  index: TypeScriptProjectIndex,
  callableSymbolIds: Map<string, string>,
  classSymbolIds: Map<string, string>,
  typeAliasSymbolIds: Map<string, string>,
  valueSymbolIds: Map<string, string>,
  fileNodeIds: Map<string, string>,
  onlyFiles?: Set<string>
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const moduleCallablesByFile = new Map<string, TsIndexedCallable[]>();
  for (const callable of index.callables) {
    if (callable.ownerName) continue;
    const items = moduleCallablesByFile.get(callable.file) ?? [];
    items.push(callable);
    moduleCallablesByFile.set(callable.file, items);
  }
  const classesByFile = new Map<string, TsIndexedClass[]>();
  for (const klass of index.classes) {
    const items = classesByFile.get(klass.file) ?? [];
    items.push(klass);
    classesByFile.set(klass.file, items);
  }
  const valuesByFile = new Map<string, Array<{ targetName: string; id: string }>>();
  for (const [key, id] of valueSymbolIds) {
    const [targetFile, targetName] = key.split('\u0000');
    if (!targetFile || !targetName) continue;
    const items = valuesByFile.get(targetFile) ?? [];
    items.push({ targetName, id });
    valuesByFile.set(targetFile, items);
  }
  const importContext = createTypeScriptGraphImportContext(index);

  for (const file of index.files.values()) {
    if (onlyFiles && !onlyFiles.has(file.file)) continue;
    const relFile = toProjectRelativePath(projectRoot, file.file);
    const fileNodeId = fileNodeIds.get(relFile);
    if (!fileNodeId) continue;

    const localTargets = new Map<string, { id: string; kind: 'function' | 'class' | 'interface' | 'type_alias' | 'value'; targetName: string; importSource?: string }>();
    for (const callable of moduleCallablesByFile.get(file.file) ?? []) {
      const id = callableSymbolIds.get(typeScriptCallableSymbolKey(callable.file, callable.ownerName, callable.symbol));
      if (id) localTargets.set(callable.symbol, { id, kind: 'function', targetName: callable.symbol });
    }
    for (const klass of classesByFile.get(file.file) ?? []) {
      const id = classSymbolIds.get(typeScriptExportedSymbolKey(klass.file, klass.className));
      if (!id) continue;
      localTargets.set(klass.className, { id, kind: isTypeScriptInterfaceNode(klass.node) ? 'interface' : 'class', targetName: klass.className });
    }
    for (const value of valuesByFile.get(file.file) ?? []) {
      localTargets.set(value.targetName, { id: value.id, kind: 'value', targetName: value.targetName });
    }

    for (const binding of file.imports.values()) {
      const resolved = resolveTypeScriptImportedGraphSymbol(index, binding, file.file, importContext, callableSymbolIds, classSymbolIds, typeAliasSymbolIds, valueSymbolIds);
      if (!resolved) continue;
      localTargets.set(binding.localName, { ...resolved, importSource: binding.source });
      const importRange = findTypeScriptImportBindingRange(file.source, binding.localName);
      if (importRange && resolved.kind !== 'function') {
        edges.push({
          id: createEdgeId('imports', fileNodeId, resolved.id, `typescript_symbol:${binding.localName}:${importRange.startLine}:${importRange.startColumn}`),
          kind: 'imports',
          from: fileNodeId,
          to: resolved.id,
          occurrenceRange: importRange,
          importSource: binding.source,
          calledAs: binding.localName,
          targetStatus: 'resolved',
          resolution: 'exact',
          reason: 'typescript_symbol_import',
        });
      }
    }

    for (const match of findTypeScriptIdentifierPositions(file.source)) {
      const target = localTargets.get(match.text);
      if (!target) continue;
      if (isTypeScriptImportLine(file.source, match.line) || isTypeScriptDeclarationLine(file.source, match.text, match.line)) continue;

      if (target.kind === 'class' && isTypeScriptNewExpressionAt(file.source, match.line, match.column, match.text)) {
        const fromId = findTypeScriptContextCallableSymbolId(projectRoot, index, callableSymbolIds, file.file, match.line) ?? fileNodeId;
        const startColumn = findTypeScriptNewExpressionStartColumn(file.source, match.line, match.column) ?? match.column;
        const calledAs = extractTypeScriptNewExpressionText(file.source, match.line, startColumn, match.column, match.text);
        edges.push({
          id: createEdgeId('reads', fromId, target.id, `typescript_instantiate:${match.text}:${match.line}:${startColumn}`),
          kind: 'reads',
          from: fromId,
          to: target.id,
          occurrenceRange: { startLine: match.line, startColumn, endLine: match.line, endColumn: startColumn + calledAs.length },
          callsite: { line: match.line, column: startColumn },
          calledAs,
          targetStatus: 'resolved',
          resolution: 'exact',
          reason: 'typescript_instantiate',
        });
        continue;
      }

      if (target.kind === 'function' || target.kind === 'value') {
        if (target.kind === 'function' && isTypeScriptJsxTagAt(file.source, match.line, match.column)) continue;
        const isFunctionCall = target.kind === 'function' && isTypeScriptCallAt(file.source, match.line, match.column, match.text);
        const contextId = findTypeScriptContextCallableSymbolId(projectRoot, index, callableSymbolIds, file.file, match.line);
        if (target.kind === 'function' && isFunctionCall && !contextId) {
          edges.push({
            id: createEdgeId('calls', fileNodeId, target.id, `typescript_top_level:${match.text}:${match.line}:${match.column}`),
            kind: 'calls',
            from: fileNodeId,
            to: target.id,
            occurrenceRange: pointOccurrenceRange(match.line, match.column),
            callsite: { line: match.line, column: match.column },
            calledAs: extractTypeScriptLineCallText(file.source, match.line, match.column),
            targetStatus: 'resolved',
            resolution: 'exact',
            reason: 'typescript_imported_function_call',
          });
        }
        const fromId = contextId ?? fileNodeId;
        edges.push({
          id: createEdgeId(isFunctionCall ? 'calls' : 'reads', fromId, target.id, `typescript_identifier_${isFunctionCall ? 'call' : 'read'}:${match.text}:${match.line}:${match.column}`),
          kind: isFunctionCall ? 'calls' : 'reads',
          from: fromId,
          to: target.id,
          occurrenceRange: { startLine: match.line, startColumn: match.column, endLine: match.line, endColumn: match.column + match.text.length },
          callsite: { line: match.line, column: match.column },
          calledAs: isFunctionCall ? extractTypeScriptLineCallText(file.source, match.line, match.column) : match.text,
          targetStatus: 'resolved',
          resolution: 'exact',
          external: false,
          reason: isFunctionCall ? 'typescript_function_identifier_call' : target.kind === 'function' ? 'typescript_function_value_read' : 'typescript_value_read',
        });
      }
    }

    for (const [localName, target] of localTargets) {
      if (target.kind === 'interface') {
        for (const match of findAllTypeScriptRegexPositions(file.source, new RegExp(`\\bimplements\\b[^\\n{]*\\b${escapeRegExp(localName)}(?:\\b|\\s*<)`, 'g'))) {
          const fromId = findTypeScriptClassSymbolIdForLine(projectRoot, index, classSymbolIds, file.file, match.line) ?? fileNodeId;
          edges.push({
            id: createEdgeId('implements', fromId, target.id, `typescript_implements:${localName}:${match.line}:${match.column}`),
            kind: 'implements',
            from: fromId,
            to: target.id,
            occurrenceRange: { startLine: match.line, startColumn: match.column, endLine: match.line, endColumn: match.column + match.text.length },
            calledAs: match.text.trim().replace(/\s+</g, '<'),
            targetStatus: 'resolved',
            resolution: 'exact',
            reason: 'typescript_implements',
          });
        }
      }
    }
  }

  return dedupeGraphEdges(edges);
}

function collectTypeScriptMemberReadEdges(
  projectRoot: string,
  index: TypeScriptProjectIndex,
  memberSymbolIds: Map<string, string>,
  objectPropertySymbolIdsByName: Map<string, string[]>,
  callableSymbolIds: Map<string, string>,
  fileNodeIds: Map<string, string>,
  onlyFiles?: Set<string>
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const exactMembers = new Map<string, { targetId: string; owner: string; memberName: string }>();
  for (const [key, targetId] of memberSymbolIds) {
    const [owner, memberName] = key.split('\u0000');
    if (!owner || !memberName) continue;
    exactMembers.set(typeScriptMemberSymbolKey(owner, memberName), { targetId, owner, memberName });
  }

  const uniqueObjectProperties = new Map<string, string>();
  for (const [memberName, targetIds] of objectPropertySymbolIdsByName) {
    if (targetIds.length === 1 && targetIds[0]) uniqueObjectProperties.set(memberName, targetIds[0]);
  }

  const memberAccessPattern = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\b/g;
  for (const file of index.files.values()) {
    if (onlyFiles && !onlyFiles.has(file.file)) continue;
    const relFile = toProjectRelativePath(projectRoot, file.file);
    const fileNodeId = fileNodeIds.get(relFile);
    if (!fileNodeId) continue;

    for (const match of findAllTypeScriptRegexPositions(file.source, memberAccessPattern)) {
      const owner = match.text.split('.')[0]?.trim();
      const memberName = match.text.split('.').pop()?.trim();
      if (!owner || !memberName) continue;
      if (isTypeScriptDeclarationLine(file.source, memberName, match.line)) continue;

      const exact = exactMembers.get(typeScriptMemberSymbolKey(owner, memberName));
      if (exact) {
        const fromId = findTypeScriptContextCallableSymbolId(projectRoot, index, callableSymbolIds, file.file, match.line) ?? fileNodeId;
        edges.push({
          id: createEdgeId('reads', fromId, exact.targetId, `typescript_member_read:${owner}.${memberName}:${match.line}:${match.column}`),
          kind: 'reads',
          from: fromId,
          to: exact.targetId,
          occurrenceRange: { startLine: match.line, startColumn: match.column, endLine: match.line, endColumn: match.column + match.text.length },
          callsite: { line: match.line, column: match.column, receiverName: owner },
          calledAs: match.text.replace(/\s+/g, ''),
          targetStatus: 'resolved',
          resolution: 'exact',
          reason: 'typescript_member_read',
        });
      }

      const objectPropertyTargetId = uniqueObjectProperties.get(memberName);
      if (objectPropertyTargetId) {
        const fromId = findTypeScriptContextCallableSymbolId(projectRoot, index, callableSymbolIds, file.file, match.line) ?? fileNodeId;
        edges.push({
          id: createEdgeId('reads', fromId, objectPropertyTargetId, `typescript_object_property_name_read:${memberName}:${match.line}:${match.column}`),
          kind: 'reads',
          from: fromId,
          to: objectPropertyTargetId,
          occurrenceRange: { startLine: match.line, startColumn: match.column, endLine: match.line, endColumn: match.column + match.text.length },
          callsite: { line: match.line, column: match.column },
          calledAs: match.text.replace(/\s+/g, ''),
          targetStatus: 'resolved',
          resolution: 'heuristic',
          reason: 'typescript_object_property_name_read',
        });
      }
    }
  }
  return dedupeGraphEdges(edges);
}

function collectTypeScriptPropertyAliasCallEdges(
  projectRoot: string,
  index: TypeScriptProjectIndex,
  callableSymbolIds: Map<string, string>,
  classSymbolIds: Map<string, string>,
  fileNodeIds: Map<string, string>,
  onlyFiles?: Set<string>
): GraphEdge[] {
  const importedTargetsByFile = new Map<string, Map<string, { id: string; kind: 'function' | 'class' }>>();
  for (const file of index.files.values()) {
    const targets = new Map<string, { id: string; kind: 'function' | 'class' }>();
    for (const binding of file.imports.values()) {
      if (binding.kind === 'namespace') continue;
      const callable = resolveImportedCallableForGraph(index, file.file, binding);
      if (callable) {
        const targetId = callableSymbolIds.get(typeScriptCallableSymbolKey(callable.file, callable.ownerName, callable.symbol));
        if (targetId) targets.set(binding.localName, { id: targetId, kind: 'function' });
      }
      const klass = resolveImportedClassForGraph(index, file.file, binding);
      if (klass) {
        const targetId = classSymbolIds.get(typeScriptExportedSymbolKey(klass.file, klass.className));
        if (targetId) targets.set(binding.localName, { id: targetId, kind: 'class' });
      }
    }
    importedTargetsByFile.set(file.file, targets);
  }

  const propertyAliases = new Map<string, { id: string; kind: 'function' | 'class' }>();
  const edges: GraphEdge[] = [];
  for (const file of index.files.values()) {
    const targets = importedTargetsByFile.get(file.file) ?? new Map<string, { id: string; kind: 'function' | 'class' }>();
    const objectPattern = /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*([A-Za-z_$][\w$]*)\b\s*=\s*\{([\s\S]*?)\n\s*\}/g;
    let objectMatch: RegExpExecArray | null;
    while ((objectMatch = objectPattern.exec(file.source)) !== null) {
      const typeName = objectMatch[1];
      const body = objectMatch[2] ?? '';
      if (!typeName) continue;
      const propertyPattern = /\b([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\b/g;
      let propertyMatch: RegExpExecArray | null;
      while ((propertyMatch = propertyPattern.exec(body)) !== null) {
        const propertyName = propertyMatch[1];
        const valueName = propertyMatch[2];
        if (!propertyName || !valueName) continue;
        const target = targets.get(valueName);
        if (target) {
          propertyAliases.set(`${typeName}\u0000${propertyName}`, target);
          const valueOffset = objectMatch.index + (objectMatch[0].indexOf(body) >= 0 ? objectMatch[0].indexOf(body) : 0) + propertyMatch.index + propertyMatch[0].lastIndexOf(valueName);
          const position = offsetToLineColumn(file.source, valueOffset);
          const fileNodeId = fileNodeIds.get(toProjectRelativePath(projectRoot, file.file));
          if (fileNodeId) {
            edges.push({
              id: createEdgeId('reads', fileNodeId, target.id, `typescript_property_alias_assignment:${propertyName}:${position.line}:${position.column}`),
              kind: 'reads',
              from: fileNodeId,
              to: target.id,
              occurrenceRange: { startLine: position.line, startColumn: position.column, endLine: position.line, endColumn: position.column + valueName.length },
              callsite: { line: position.line, column: position.column },
              calledAs: valueName,
              targetStatus: 'resolved',
              resolution: 'exact',
              reason: 'typescript_property_alias_assignment',
            });
          }
        }
      }
    }
  }
  if (propertyAliases.size === 0) return edges;

  for (const file of index.files.values()) {
    if (onlyFiles && !onlyFiles.has(file.file)) continue;
    const relFile = toProjectRelativePath(projectRoot, file.file);
    const fileNodeId = fileNodeIds.get(relFile);
    if (!fileNodeId) continue;
    const typedReceivers = collectTypeScriptReceiverTypesFromSource(file.source);
    for (const [receiver, typeName] of typedReceivers) {
      const receiverPattern = receiver.includes('.') ? escapeRegExp(receiver) : `(?<![.\\w$])${escapeRegExp(receiver)}`;
      for (const [key, target] of propertyAliases) {
        const [aliasType, propertyName] = key.split('\u0000');
        if (aliasType !== typeName || !propertyName) continue;
        const expressionPattern = target.kind === 'class'
          ? `\\bnew\\s+${receiverPattern}\\s*\\.\\s*${escapeRegExp(propertyName)}\\s*\\(`
          : `${receiverPattern}\\s*\\.\\s*${escapeRegExp(propertyName)}\\s*\\(`;
        for (const match of findAllTypeScriptRegexPositions(file.source, new RegExp(expressionPattern, 'g'))) {
          const fromId = findTypeScriptContextCallableSymbolId(projectRoot, index, callableSymbolIds, file.file, match.line) ?? fileNodeId;
          const edgeKind = target.kind === 'class' ? 'reads' : 'calls';
          edges.push({
            id: createEdgeId(edgeKind, fromId, target.id, `typescript_property_alias:${receiver}:${propertyName}:${match.line}:${match.column}`),
            kind: edgeKind,
            from: fromId,
            to: target.id,
            occurrenceRange: pointOccurrenceRange(match.line, match.column),
            callsite: { line: match.line, column: match.column, receiverName: receiver, receiverType: typeName },
            calledAs: extractTypeScriptLineCallText(file.source, match.line, match.column),
            targetStatus: 'resolved',
            resolution: 'heuristic',
            reason: target.kind === 'class' ? 'typescript_property_alias_instantiate' : 'typescript_property_alias_call',
          });
        }
      }
    }
  }
  return dedupeGraphEdges(edges);
}

function resolveImportedCallableForGraph(index: TypeScriptProjectIndex, currentFile: string, binding: TsImportBinding): TsIndexedCallable | undefined {
  if (binding.kind === 'namespace') return undefined;
  const targetFile = resolveTypeScriptImportCandidates(currentFile, binding.source, index.projectConfig).find((candidate) => index.files.has(candidate));
  if (!targetFile) return undefined;
  return resolveExportedCallable(index, targetFile, binding.importedName);
}

function resolveImportedClassForGraph(index: TypeScriptProjectIndex, currentFile: string, binding: TsImportBinding): TsIndexedClass | undefined {
  if (binding.kind === 'namespace') return undefined;
  const targetFile = resolveTypeScriptImportCandidates(currentFile, binding.source, index.projectConfig).find((candidate) => index.files.has(candidate));
  if (!targetFile) return undefined;
  return index.classes.find((item) => item.file === targetFile && item.exportedName === binding.importedName);
}

function collectTypeScriptReceiverTypesFromSource(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\??\s*:\s*([A-Za-z_$][\w$]*)\b/g)) {
    if (!match[1] || !match[2]) continue;
    result.set(match[1], match[2]);
    result.set(`this.${match[1]}`, match[2]);
  }
  return result;
}

function collectTypeScriptTypeAliasReferenceEdges(
  projectRoot: string,
  index: TypeScriptProjectIndex,
  typeAliasSymbolIds: Map<string, string>,
  fileNodeIds: Map<string, string>,
  onlyFiles?: Set<string>
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const declarationFilesByName = new Map<string, Set<string>>();
  for (const key of typeAliasSymbolIds.keys()) {
    const [file, name] = key.split('\u0000');
    if (!file || !name) continue;
    const files = declarationFilesByName.get(name) ?? new Set<string>();
    files.add(file);
    declarationFilesByName.set(name, files);
  }

  for (const file of index.files.values()) {
    if (onlyFiles && !onlyFiles.has(file.file)) continue;
    const relFile = toProjectRelativePath(projectRoot, file.file);
    const fileNodeId = fileNodeIds.get(relFile);
    if (!fileNodeId) continue;
    const localNames = new Map<string, { targetFile: string; targetName: string; importSource?: string }>();

    for (const [targetName, targetFiles] of declarationFilesByName) {
      if (targetFiles.has(file.file)) localNames.set(targetName, { targetFile: file.file, targetName });
    }

    for (const binding of file.imports.values()) {
      const targetFile = resolveTypeScriptImportCandidates(file.file, binding.source, index.projectConfig).find((candidate) => typeAliasSymbolIds.has(typeScriptExportedSymbolKey(candidate, binding.importedName)));
      if (!targetFile) continue;
      localNames.set(binding.localName, { targetFile, targetName: binding.importedName, importSource: binding.source });
      const importRange = findTypeScriptTokenRange(file.source, binding.localName, true);
      const targetId = typeAliasSymbolIds.get(typeScriptExportedSymbolKey(targetFile, binding.importedName));
      if (targetId && importRange) {
        edges.push({
          id: createEdgeId('imports', fileNodeId, targetId, `type_alias:${binding.localName}:${importRange.startLine}:${importRange.startColumn}`),
          kind: 'imports',
          from: fileNodeId,
          to: targetId,
          occurrenceRange: importRange,
          importSource: binding.source,
          targetStatus: 'resolved',
          resolution: 'exact',
          reason: 'typescript_type_alias_import',
        });
      }
    }

    const lines = getTypeScriptSourceLines(file.source);
    for (let indexLine = 0; indexLine < lines.length; indexLine += 1) {
      const line = lines[indexLine];
      if (/^\s*import\b/.test(line)) continue;
      for (const [localName, target] of localNames) {
        const targetId = typeAliasSymbolIds.get(typeScriptExportedSymbolKey(target.targetFile, target.targetName));
        if (!targetId) continue;
        const pattern = new RegExp(`\\b${escapeRegExp(localName)}\\b`, 'g');
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          if (target.targetFile === file.file && new RegExp(`\\b(?:export\\s+)?type\\s+${escapeRegExp(localName)}\\b`).test(line)) continue;
          const startLine = indexLine + 1;
          edges.push({
            id: createEdgeId('reads', fileNodeId, targetId, `type_alias:${localName}:${startLine}:${match.index}`),
            kind: 'reads',
            from: fileNodeId,
            to: targetId,
            occurrenceRange: { startLine, startColumn: match.index, endLine: startLine, endColumn: match.index + localName.length },
            callsite: { line: startLine, column: match.index },
            calledAs: localName,
            targetStatus: 'resolved',
            resolution: 'exact',
            reason: 'typescript_type_alias_reference',
            importSource: target.importSource,
          });
        }
      }
    }
  }

  return edges;
}

interface TypeScriptGraphImportContext {
  moduleFileCache: Map<string, string | undefined>;
  exportedCallables: Map<string, TsIndexedCallable>;
  exportedClasses: Map<string, TsIndexedClass>;
}

function createTypeScriptGraphImportContext(index: TypeScriptProjectIndex): TypeScriptGraphImportContext {
  const exportedCallables = new Map<string, TsIndexedCallable>();
  for (const callable of index.callables) {
    if (callable.exportedName) exportedCallables.set(typeScriptExportedSymbolKey(callable.file, callable.exportedName), callable);
  }
  const exportedClasses = new Map<string, TsIndexedClass>();
  for (const klass of index.classes) {
    if (klass.exportedName) exportedClasses.set(typeScriptExportedSymbolKey(klass.file, klass.exportedName), klass);
  }
  return { moduleFileCache: new Map(), exportedCallables, exportedClasses };
}

function resolveTypeScriptGraphModuleFile(index: TypeScriptProjectIndex, context: TypeScriptGraphImportContext, currentFile: string, source: string): string | undefined {
  const key = `${currentFile}\u0000${source}`;
  if (context.moduleFileCache.has(key)) return context.moduleFileCache.get(key);
  const targetFile = resolveTypeScriptImportCandidates(currentFile, source, index.projectConfig).find((candidate) => index.files.has(candidate));
  context.moduleFileCache.set(key, targetFile);
  return targetFile;
}

function resolveTypeScriptExportedGraphCallable(
  index: TypeScriptProjectIndex,
  context: TypeScriptGraphImportContext,
  filePath: string,
  exportedName: string,
  visited = new Set<string>()
): TsIndexedCallable | undefined {
  const visitKey = `${filePath}:${exportedName}`;
  if (visited.has(visitKey)) return undefined;
  visited.add(visitKey);

  const direct = context.exportedCallables.get(typeScriptExportedSymbolKey(filePath, exportedName));
  if (direct) return direct;

  const file = index.files.get(filePath);
  if (!file) return undefined;
  for (const reExport of file.reExports) {
    if (reExport.kind !== 'namespace' && reExport.exportedName !== exportedName) continue;
    const targetFile = resolveTypeScriptGraphModuleFile(index, context, filePath, reExport.source);
    if (!targetFile) continue;
    const targetExportName = reExport.kind === 'namespace' ? exportedName : reExport.importedName;
    const target = resolveTypeScriptExportedGraphCallable(index, context, targetFile, targetExportName, visited);
    if (target) return target;
  }
  return undefined;
}

function resolveTypeScriptImportedGraphSymbol(
  index: TypeScriptProjectIndex,
  binding: TsImportBinding,
  currentFile: string,
  context: TypeScriptGraphImportContext,
  callableSymbolIds: Map<string, string>,
  classSymbolIds: Map<string, string>,
  typeAliasSymbolIds: Map<string, string>,
  valueSymbolIds: Map<string, string>
): { id: string; kind: 'function' | 'class' | 'interface' | 'type_alias' | 'value'; targetName: string } | undefined {
  if (binding.kind === 'namespace') return undefined;
  const targetFile = resolveTypeScriptGraphModuleFile(index, context, currentFile, binding.source);
  if (!targetFile) return undefined;

  const callable = resolveTypeScriptExportedGraphCallable(index, context, targetFile, binding.importedName);
  if (callable) {
    const id = callableSymbolIds.get(typeScriptCallableSymbolKey(callable.file, callable.ownerName, callable.symbol));
    if (id) return { id, kind: 'function', targetName: callable.symbol };
  }

  const klass = context.exportedClasses.get(typeScriptExportedSymbolKey(targetFile, binding.importedName));
  if (klass) {
    const id = classSymbolIds.get(typeScriptExportedSymbolKey(klass.file, klass.className));
    if (id) return { id, kind: isTypeScriptInterfaceNode(klass.node) ? 'interface' : 'class', targetName: klass.className };
  }

  const typeAliasId = typeAliasSymbolIds.get(typeScriptExportedSymbolKey(targetFile, binding.importedName));
  if (typeAliasId) return { id: typeAliasId, kind: 'type_alias', targetName: binding.importedName };

  const valueId = valueSymbolIds.get(typeScriptExportedSymbolKey(targetFile, binding.importedName));
  if (valueId) return { id: valueId, kind: 'value', targetName: binding.importedName };
  return undefined;
}

function isTypeScriptInterfaceNode(node: any): boolean {
  return node?.type === 'interface_declaration';
}

interface TypeScriptCallableRange {
  start: number;
  end: number;
  id: string;
}

interface TypeScriptClassRange {
  start: number;
  end: number;
  id: string;
}

const typeScriptCallableRangeCache = new WeakMap<TypeScriptProjectIndex, Map<string, TypeScriptCallableRange[]>>();
const typeScriptClassRangeCache = new WeakMap<TypeScriptProjectIndex, Map<string, TypeScriptClassRange[]>>();

function findTypeScriptContextCallableSymbolId(
  projectRoot: string,
  index: TypeScriptProjectIndex,
  callableSymbolIds: Map<string, string>,
  file: string,
  line: number
): string | undefined {
  const rangesByFile = getTypeScriptCallableRangesByFile(index, callableSymbolIds);
  const ranges = rangesByFile.get(file);
  if (!ranges) return undefined;
  for (let i = ranges.length - 1; i >= 0; i -= 1) {
    const range = ranges[i];
    if (line >= range.start && line <= range.end) return range.id;
  }
  return undefined;
}

function getTypeScriptCallableRangesByFile(index: TypeScriptProjectIndex, callableSymbolIds: Map<string, string>): Map<string, TypeScriptCallableRange[]> {
  const cached = typeScriptCallableRangeCache.get(index);
  if (cached) return cached;
  const rangesByFile = new Map<string, TypeScriptCallableRange[]>();
  for (const callable of index.callables) {
    const id = callableSymbolIds.get(typeScriptCallableSymbolKey(callable.file, callable.ownerName, callable.symbol));
    if (!id) continue;
    const ranges = rangesByFile.get(callable.file) ?? [];
    ranges.push({
      start: callable.line,
      end: callable.node?.endPosition?.row !== undefined ? callable.node.endPosition.row + 1 : callable.line,
      id,
    });
    rangesByFile.set(callable.file, ranges);
  }
  for (const ranges of rangesByFile.values()) ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  typeScriptCallableRangeCache.set(index, rangesByFile);
  return rangesByFile;
}

function findTypeScriptClassSymbolIdForLine(
  projectRoot: string,
  index: TypeScriptProjectIndex,
  classSymbolIds: Map<string, string>,
  file: string,
  line: number
): string | undefined {
  const rangesByFile = getTypeScriptClassRangesByFile(index, classSymbolIds);
  const ranges = rangesByFile.get(file);
  if (!ranges) return undefined;
  for (let i = ranges.length - 1; i >= 0; i -= 1) {
    const range = ranges[i];
    if (line >= range.start && line <= range.end) return range.id;
  }
  return undefined;
}

function getTypeScriptClassRangesByFile(index: TypeScriptProjectIndex, classSymbolIds: Map<string, string>): Map<string, TypeScriptClassRange[]> {
  const cached = typeScriptClassRangeCache.get(index);
  if (cached) return cached;
  const rangesByFile = new Map<string, TypeScriptClassRange[]>();
  for (const klass of index.classes) {
    if (isTypeScriptInterfaceNode(klass.node)) continue;
    const id = classSymbolIds.get(typeScriptExportedSymbolKey(klass.file, klass.className));
    if (!id) continue;
    const ranges = rangesByFile.get(klass.file) ?? [];
    ranges.push({
      start: klass.line,
      end: klass.node?.endPosition?.row !== undefined ? klass.node.endPosition.row + 1 : klass.line,
      id,
    });
    rangesByFile.set(klass.file, ranges);
  }
  for (const ranges of rangesByFile.values()) ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  typeScriptClassRangeCache.set(index, rangesByFile);
  return rangesByFile;
}

function findTypeScriptImportBindingRange(source: string, token: string): SourceRange | undefined {
  return findTypeScriptTokenRange(source, token, true);
}

const TYPE_SCRIPT_SOURCE_CACHE_LIMIT = 2000;
const typeScriptSourceLineCache = new Map<string, string[]>();
const typeScriptLineStartCache = new Map<string, number[]>();
const typeScriptImportLineCache = new Map<string, Set<number>>();
const typeScriptDeclarationLineCache = new Map<string, Map<number, Set<string>>>();
const typeScriptFunctionDeclarationLineCache = new Map<string, Map<number, Set<string>>>();

function getTypeScriptSourceLines(source: string): string[] {
  const cached = typeScriptSourceLineCache.get(source);
  if (cached) return cached;
  if (typeScriptSourceLineCache.size > TYPE_SCRIPT_SOURCE_CACHE_LIMIT) typeScriptSourceLineCache.clear();
  const lines = source.split('\n');
  typeScriptSourceLineCache.set(source, lines);
  return lines;
}

function getTypeScriptLineStarts(source: string): number[] {
  const cached = typeScriptLineStartCache.get(source);
  if (cached) return cached;
  if (typeScriptLineStartCache.size > TYPE_SCRIPT_SOURCE_CACHE_LIMIT) typeScriptLineStartCache.clear();
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  typeScriptLineStartCache.set(source, starts);
  return starts;
}

function getTypeScriptSourceLine(source: string, line: number): string {
  return getTypeScriptSourceLines(source)[line - 1] ?? '';
}

function clearTypeScriptSourceCaches(): void {
  typeScriptSourceLineCache.clear();
  typeScriptLineStartCache.clear();
  typeScriptImportLineCache.clear();
  typeScriptDeclarationLineCache.clear();
  typeScriptFunctionDeclarationLineCache.clear();
}

function isTypeScriptImportLine(source: string, line: number): boolean {
  let lines = typeScriptImportLineCache.get(source);
  if (!lines) {
    if (typeScriptImportLineCache.size > TYPE_SCRIPT_SOURCE_CACHE_LIMIT) typeScriptImportLineCache.clear();
    lines = new Set<number>();
    getTypeScriptSourceLines(source).forEach((lineText, index) => {
      if (/^\s*import\b/.test(lineText)) lines!.add(index + 1);
    });
    typeScriptImportLineCache.set(source, lines);
  }
  return lines.has(line);
}

function isTypeScriptFunctionDeclarationLine(source: string, name: string, line: number): boolean {
  return getTypeScriptFunctionDeclarationsByLine(source).get(line)?.has(name) ?? false;
}

function isTypeScriptDeclarationLine(source: string, name: string, line: number): boolean {
  return getTypeScriptDeclarationsByLine(source).get(line)?.has(name) ?? false;
}

function getTypeScriptDeclarationsByLine(source: string): Map<number, Set<string>> {
  const cached = typeScriptDeclarationLineCache.get(source);
  if (cached) return cached;
  if (typeScriptDeclarationLineCache.size > TYPE_SCRIPT_SOURCE_CACHE_LIMIT) typeScriptDeclarationLineCache.clear();
  const declarations = new Map<number, Set<string>>();
  getTypeScriptSourceLines(source).forEach((lineText, index) => {
    const match = /\b(?:export\s+)?(?:const|let|var|function|class|interface|type)\s+([A-Za-z_$][\w$]*)\b/.exec(lineText);
    if (!match?.[1]) return;
    declarations.set(index + 1, new Set([match[1]]));
  });
  typeScriptDeclarationLineCache.set(source, declarations);
  return declarations;
}

function getTypeScriptFunctionDeclarationsByLine(source: string): Map<number, Set<string>> {
  const cached = typeScriptFunctionDeclarationLineCache.get(source);
  if (cached) return cached;
  if (typeScriptFunctionDeclarationLineCache.size > TYPE_SCRIPT_SOURCE_CACHE_LIMIT) typeScriptFunctionDeclarationLineCache.clear();
  const declarations = new Map<number, Set<string>>();
  getTypeScriptSourceLines(source).forEach((lineText, index) => {
    const match = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/.exec(lineText);
    if (!match?.[1]) return;
    declarations.set(index + 1, new Set([match[1]]));
  });
  typeScriptFunctionDeclarationLineCache.set(source, declarations);
  return declarations;
}

function isTypeScriptCallAt(source: string, line: number, column: number, name: string): boolean {
  const lineText = getTypeScriptSourceLine(source, line);
  return /^\s*(?:<[^>\n]+>\s*)?\(/.test(lineText.slice(column + name.length));
}

function isTypeScriptJsxTagAt(source: string, line: number, column: number): boolean {
  const lineText = getTypeScriptSourceLine(source, line);
  return /<\/?\s*$/.test(lineText.slice(0, column));
}

function isTypeScriptNewExpressionAt(source: string, line: number, column: number, name: string): boolean {
  const lineText = getTypeScriptSourceLine(source, line);
  if (!/^\s*\(/.test(lineText.slice(column + name.length))) return false;
  return /\bnew\s+$/.test(lineText.slice(0, column));
}

function findTypeScriptNewExpressionStartColumn(source: string, line: number, column: number): number | undefined {
  const lineText = getTypeScriptSourceLine(source, line);
  const prefix = lineText.slice(0, column);
  const match = prefix.match(/\bnew\s+$/);
  return match?.index;
}

function extractTypeScriptNewExpressionText(source: string, line: number, startColumn: number, nameColumn: number, name: string): string {
  const lineText = getTypeScriptSourceLine(source, line);
  const afterName = lineText.slice(nameColumn + name.length);
  const openParenOffset = afterName.search(/\(/);
  const endColumn = openParenOffset >= 0 ? nameColumn + name.length + openParenOffset + 1 : nameColumn + name.length;
  return lineText.slice(startColumn, endColumn);
}

function findTypeScriptIdentifierPositions(source: string): Array<{ line: number; column: number; text: string }> {
  return findAllTypeScriptRegexPositions(source, /\b[A-Za-z_$][\w$]*\b/g);
}

function findAllTypeScriptRegexPositions(source: string, pattern: RegExp): Array<{ line: number; column: number; text: string }> {
  const results: Array<{ line: number; column: number; text: string }> = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const position = offsetToLineColumn(source, match.index);
    results.push({ ...position, text: match[0] });
  }
  return results;
}

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  const starts = getTypeScriptLineStarts(source);
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  const lineIndex = Math.max(0, high);
  return { line: lineIndex + 1, column: offset - starts[lineIndex] };
}

function extractTypeScriptLineCallText(source: string, line: number, column: number): string {
  const lineText = getTypeScriptSourceLine(source, line);
  const tail = lineText.slice(column);
  const match = tail.match(/^[^;\n]+/);
  return (match?.[0] ?? tail).trim();
}

function dedupeGraphEdges(items: GraphEdge[]): GraphEdge[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function findTypeScriptTokenRange(source: string, token: string, preferImportLine = false): SourceRange | undefined {
  const lines = getTypeScriptSourceLines(source);
  const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (preferImportLine && !/^\s*import\b/.test(line)) continue;
    const match = pattern.exec(line);
    if (match?.index !== undefined) {
      return { startLine: index + 1, startColumn: match.index, endLine: index + 1, endColumn: match.index + token.length };
    }
  }
  return undefined;
}

function typeScriptCallableSymbolKey(file: string, owner: string | undefined, symbol: string): string {
  return `${file}\u0000${owner ?? '<module>'}\u0000${symbol}`;
}

function typeScriptExportedSymbolKey(file: string, symbol: string): string {
  return `${file}\u0000${symbol}`;
}

function typeScriptMemberSymbolKey(owner: string, symbol: string): string {
  return `${owner}\u0000${symbol}`;
}

function isCallableGraphDeclaration(kind: string): boolean {
  return kind === 'function' || kind === 'function_overload' || kind === 'callable_variable' || kind === 'constructor' || kind === 'method' || kind === 'interface_method' || kind === 'getter' || kind === 'setter' || kind === 'object_method';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizePersistedSignature(signature: string | undefined): string | undefined {
  return signature?.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '$1<redacted>$1');
}

function extractTypeScriptCalls(callableNode: any): ReturnType<typeof extractTypeScriptDirectCalls> {
  return extractTypeScriptDirectCalls(callableNode, { includeNestedCallableBodies: true });
}

function extractTypeScriptJsxReads(callableNode: any): Array<{ symbol: string; text: string; line: number; column: number }> {
  const body = getTypeScriptCallableBodyNode(callableNode);
  if (!body) return [];
  const reads: Array<{ symbol: string; text: string; line: number; column: number }> = [];
  function visit(node: any) {
    if (!node?.isNamed) return;
    if (node.type === 'jsx_opening_element' || node.type === 'jsx_self_closing_element') {
      const nameNode = node.children.find((child: any) => child.isNamed && (child.type === 'identifier' || child.type === 'nested_identifier'));
      const symbol = nameNode?.text?.split('.')?.[0];
      if (symbol && /^[A-Z]/.test(symbol)) {
        reads.push({ symbol, text: node.text, line: node.startPosition.row + 1, column: node.startPosition.column });
      }
    }
    for (const child of node.children) visit(child);
  }
  visit(body);
  return reads;
}

function resolveTypeScriptJsxRead(
  index: TypeScriptProjectIndex,
  current: TsIndexedCallable,
  symbol: string
): { target?: TsIndexedCallable; reason?: string } {
  const local = index.callables.find((item) => item.file === current.file && item.symbol === symbol && item.kind === 'function');
  if (local) return { target: local };

  const imported = index.files.get(current.file)?.imports.get(symbol);
  if (!imported || imported.kind === 'namespace') return { reason: 'jsx tag is not a local callable or import' };

  const targetFile = resolveTypeScriptImportCandidates(current.file, imported.source, index.projectConfig).find((candidate) => index.files.has(candidate));
  if (!targetFile) return { reason: 'jsx import does not resolve to an indexed file' };

  const target = resolveExportedCallable(index, targetFile, imported.importedName);
  return target ? { target } : { reason: 'jsx import does not resolve to an indexed callable' };
}

function resolveTypeScriptCall(
  index: TypeScriptProjectIndex,
  current: TsIndexedCallable,
  call: { symbol: string; receiver?: string; text: string; line: number; column: number }
): { target?: TsIndexedCallable; source: CallSource; owner?: string; ownerKind?: OwnerKind; receiverType?: string; reason?: string } {
  const resolved = resolveTypeScriptDirectCall(index, current, call);
  return {
    target: resolved.callable,
    source: resolved.source,
    owner: resolved.className ?? resolved.callable?.ownerName,
    ownerKind: resolved.ownerKind,
    receiverType: resolved.receiverType,
    reason: resolved.reason,
  };
}

function getTypeScriptCallableBodyNode(callableNode: any): any {
  const body = callableNode.childForFieldName?.('body');
  if (body) return body;
  const value = findTypeScriptCallableValueNode(callableNode);
  if (!value) return undefined;
  const unwrapped = unwrapTransparentTypeScriptNode(value);
  if (unwrapped?.type === 'arrow_function' || unwrapped?.type === 'function_expression' || unwrapped?.type === 'function_declaration') return unwrapped;
  return unwrapped?.childForFieldName?.('body') ?? unwrapped?.childForFieldName?.('value') ?? value;
}

function findTypeScriptCallableValueNode(node: any): any {
  if (!node?.isNamed) return undefined;
  const direct = node.childForFieldName?.('value');
  if (direct) return direct;
  for (const child of node.children ?? []) {
    const found = findTypeScriptCallableValueNode(child);
    if (found) return found;
  }
  return undefined;
}

function unwrapTransparentTypeScriptNode(node: any): any {
  let current = node;
  while (current?.isNamed) {
    if (current.type === 'parenthesized_expression') {
      current = current.children?.find((child: any) => child.isNamed);
      continue;
    }
    if (current.type === 'as_expression' || current.type === 'satisfies_expression' || current.type === 'type_assertion' || current.type === 'non_null_expression') {
      current = current.childForFieldName('expression') ?? current.children?.find((child: any) => child.isNamed && child.type !== 'type_annotation' && child.type !== 'type_arguments' && child.type !== 'type');
      continue;
    }
    break;
  }
  return current;
}

function findTypeScriptLocalConstructedInstanceClass(index: TypeScriptProjectIndex, current: TsIndexedCallable, receiver: string): string | undefined {
  const body = getTypeScriptCallableBodyNode(current.node);
  if (!body) return undefined;
  let className: string | undefined;
  function visit(node: any): void {
    if (!node?.isNamed || className) return;
    if (node.type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name');
      if (nameNode?.text === receiver) {
        const valueNode = unwrapTransparentTypeScriptNode(node.childForFieldName('value'));
        if (valueNode?.type === 'new_expression') {
          const constructorNode = valueNode.childForFieldName('constructor') ?? valueNode.children?.find((child: any) => child.isNamed);
          const candidate = constructorNode?.text;
          if (candidate) {
            const imported = index.files.get(current.file)?.imports.get(candidate);
            if (imported) {
              const targetFile = resolveTypeScriptImportCandidates(current.file, imported.source, index.projectConfig).find((path) => index.files.has(path));
              className = targetFile ? index.classes.find((item) => item.file === targetFile && item.exportedName === imported.importedName)?.className : undefined;
            }
            className ??= candidate;
          }
        }
        return;
      }
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(body);
  return className;
}
