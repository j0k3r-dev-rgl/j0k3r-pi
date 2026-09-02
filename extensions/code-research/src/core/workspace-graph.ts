import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CallSource,
  GraphEdge,
  GraphManifest,
  GraphNode,
  OwnerKind,
  SubprojectGraphShard,
  WorkspaceGraphState,
} from '../types.js';
import { buildProjectIndex, type IndexedMethod, type ProjectIndex } from './project-index.js';
import { compareSubprojectSnapshot, createSubprojectSnapshot } from './freshness.js';
import {
  createBaseArtifact,
  createEdgeId,
  createFileNodeId,
  createSubprojectNodeId,
  createSymbolNodeId,
  createWorkspaceNodeId,
  TYPESCRIPT_COMPILER_MODEL_VERSION,
  TYPESCRIPT_GRAMMAR_VERSION,
  TYPESCRIPT_SYMBOL_COVERAGE_MODEL_VERSION,
} from './graph-schema.js';
import { ensureWorkspaceGraphGitignore, writeSubprojectGraphShard, writeWorkspaceGraphManifest } from './graph-persistence.js';
import { detectWorkspaceSubprojects } from './project-detector.js';
import { collectWorkspaceSourceFiles, detectGraphLanguage, toProjectRelativePath } from './source-policy.js';
import { compareCanonicalPathStrings } from './shared.js';
import { createWorkspaceGraphState, loadWorkspaceGraphState, writeWorkspaceGraphState } from './workspace-state.js';
import {
  buildTypeScriptProjectIndex,
  resolveCall as resolveTypeScriptDirectCall,
  resolveExportedCallable,
  type IndexedCallable as TsIndexedCallable,
  type IndexedClass as TsIndexedClass,
  type TypeScriptProjectIndex,
} from '../languages/typescript/function-call-tree.js';
import { extractSignature as extractTypeScriptSignature, resolveTypeScriptImportCandidates } from '../languages/typescript/shared.js';
import { extractTypeScriptSymbols } from '../languages/typescript/symbol-extractor.js';
import { extractSignature as extractJavaSignature } from '../languages/java/shared.js';
import { resolveJavaCallsForGraph, type ResolvedJavaGraphCall } from '../languages/java/function-call-tree.js';
import { buildGoProjectIndex, extractCalls as extractGoCalls, findGoImplementations, resolveGoCall, type GoProjectIndex } from '../languages/go/workspace-graph.js';
import { extractGoSymbolRecords } from '../languages/go/symbol-extractor.js';
import { packagePathToName } from '../languages/go/shared.js';

export async function ensureWorkspaceGraphFreshness(projectRoot: string): Promise<{ state: WorkspaceGraphState; manifest?: GraphManifest; changed: boolean }> {
  await ensureWorkspaceGraphGitignore(projectRoot);
  const current = await loadWorkspaceGraphState(projectRoot);
  if (current.status !== 'ok') {
    const built = await buildWorkspaceGraph(projectRoot);
    return { ...built, changed: true };
  }

  const existing = current.data;
  const unreadableDirectories = new Set<string>();
  const reportUnreadableDirectory = (dir: string) => unreadableDirectories.add(toProjectRelativePath(projectRoot, dir));
  const detected = await detectWorkspaceSubprojects(projectRoot, { onUnreadableDirectory: reportUnreadableDirectory });
  const previousById = new Map(existing.subprojects.map((subproject) => [subproject.id, subproject]));

  let stale = existing.status !== 'fresh';
  if (detected.length !== existing.subprojects.length) stale = true;

  for (const subproject of detected) {
    const previous = previousById.get(subproject.id);
    if (!previous || previous.root !== subproject.root || previous.markers.join('|') !== subproject.markers.join('|')) {
      stale = true;
      break;
    }

    const files = await collectWorkspaceSourceFiles(subproject.absoluteRoot, { onUnreadableDirectory: reportUnreadableDirectory });
    const snapshot = await createSubprojectSnapshot(projectRoot, files);
    if (compareSubprojectSnapshot(previous.snapshot, snapshot).stale) {
      stale = true;
      break;
    }
  }

  const previousUnreadable = [...(existing.coverage.unreadableDirectories ?? [])].sort();
  const nextUnreadable = [...unreadableDirectories].sort();
  if (previousUnreadable.join('|') !== nextUnreadable.join('|')) stale = true;

  if (!stale) {
    return { state: existing, changed: false };
  }

  await writeWorkspaceGraphState(projectRoot, {
    ...existing,
    status: 'refreshing',
  });

  const built = await buildWorkspaceGraph(projectRoot);
  return { ...built, changed: true };
}

export async function buildWorkspaceGraph(projectRoot: string): Promise<{ state: WorkspaceGraphState; manifest: GraphManifest }> {
  const generation = Date.now();
  const workspaceNodeId = createWorkspaceNodeId(projectRoot);
  const unreadableDirectories = new Set<string>();
  const reportUnreadableDirectory = (dir: string) => unreadableDirectories.add(toProjectRelativePath(projectRoot, dir));
  const detected = await detectWorkspaceSubprojects(projectRoot, { onUnreadableDirectory: reportUnreadableDirectory });
  const manifestSubprojects: GraphManifest['subprojects'] = [];
  const stateSubprojects: WorkspaceGraphState['subprojects'] = [];
  const coverage = {
    indexedFiles: 0,
    skippedLargeFiles: 0,
    skippedUnsupportedFiles: 0,
    excludedDirectories: ['node_modules', 'build', 'dist', 'coverage', '.next', '.nuxt', '.svelte-kit', '.react-router', '.turbo', '.vite', '.cache', 'out', 'vendor', 'target'],
    unreadableDirectories: [] as string[],
  };
  let workspaceStatus: WorkspaceGraphState['status'] = 'fresh';

  for (const subproject of detected) {
    const files = await collectWorkspaceSourceFiles(subproject.absoluteRoot, { onUnreadableDirectory: reportUnreadableDirectory });
    const snapshot = await createSubprojectSnapshot(projectRoot, files);
    coverage.indexedFiles += files.length;

    const shard = await buildSubprojectShard(projectRoot, subproject.absoluteRoot, subproject.id, subproject.root, subproject.markers, generation);
    if (shard.nodes.length === 0) workspaceStatus = 'partial';
    const shardPath = `graphs/${subproject.id}.json`;
    await writeSubprojectGraphShard(projectRoot, subproject.id, shard);

    manifestSubprojects.push({ id: subproject.id, root: subproject.root, shardPath, generation });
    stateSubprojects.push({
      id: subproject.id,
      root: subproject.root,
      status: shard.nodes.length > 0 ? 'fresh' : 'partial',
      languageHints: Array.from(new Set(shard.nodes.flatMap((node) => node.kind === 'file' ? [node.language] : []))),
      shardPath,
      snapshot,
      generation,
      markers: subproject.markers,
    });
  }

  const manifest: GraphManifest = createBaseArtifact({
    projectRoot,
    generation,
    workspaceNodeId,
    subprojects: manifestSubprojects,
  });

  await writeWorkspaceGraphManifest(projectRoot, manifest);

  const state = createWorkspaceGraphState({
    projectRoot,
    status: workspaceStatus,
    generation,
    manifestPath: '.pi/workspace-code-graph/graph-manifest.json',
    subprojects: stateSubprojects,
    coverage: {
      ...coverage,
      unreadableDirectories: [...unreadableDirectories].sort(),
    },
  });

  await writeWorkspaceGraphState(projectRoot, state);
  return { state, manifest };
}

async function buildSubprojectShard(
  projectRoot: string,
  subprojectRoot: string,
  subprojectId: string,
  subprojectRelativeRoot: string,
  markers: string[],
  generation: number
): Promise<SubprojectGraphShard> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const pendingFileStats: Array<Promise<void>> = [];
  const workspaceNodeId = createWorkspaceNodeId(projectRoot);
  const subprojectNodeId = createSubprojectNodeId(subprojectId);

  nodes.push({ id: workspaceNodeId, kind: 'workspace', name: 'workspace', root: '.' });
  nodes.push({ id: subprojectNodeId, kind: 'subproject', name: subprojectRelativeRoot, root: subprojectRelativeRoot, markers, languages: [] });
  edges.push({ id: createEdgeId('contains', workspaceNodeId, subprojectNodeId), kind: 'contains', from: workspaceNodeId, to: subprojectNodeId });

  const files = await collectWorkspaceSourceFiles(subprojectRoot);
  const languages = new Set<string>();

  let javaSymbolCoverage: SubprojectGraphShard['javaSymbolCoverage'];
  const javaFiles = files.filter((file) => detectGraphLanguage(file) === 'java');
  if (javaFiles.length > 0) {
    languages.add('java');
    const javaIndex = await buildProjectIndex(subprojectRoot);
    javaSymbolCoverage = buildJavaGraph(projectRoot, subprojectId, javaIndex, nodes, edges, pendingFileStats, generation);
  }

  let typeScriptSymbolCoverage: SubprojectGraphShard['typescriptSymbolCoverage'];
  const tsFiles = files.filter((file) => {
    const language = detectGraphLanguage(file);
    return language === 'ts' || language === 'js';
  });
  if (tsFiles.length > 0) {
    const tsIndex = await buildTypeScriptProjectIndex(subprojectRoot);
    for (const file of tsFiles) {
      const language = detectGraphLanguage(file);
      if (language) languages.add(language);
    }
    typeScriptSymbolCoverage = buildTypeScriptGraph(projectRoot, subprojectId, tsIndex, nodes, edges, pendingFileStats, generation);
  }

  let goSymbolCoverage: SubprojectGraphShard['goSymbolCoverage'];
  const goFiles = files.filter((file) => detectGraphLanguage(file) === 'go');
  if (goFiles.length > 0) {
    languages.add('go');
    const goIndex = await buildGoProjectIndex(subprojectRoot);
    goSymbolCoverage = buildGoGraph(projectRoot, subprojectId, goIndex, nodes, edges, pendingFileStats, generation);
  }

  await Promise.all(pendingFileStats);

  const subprojectNode = nodes.find((node) => node.id === subprojectNodeId && node.kind === 'subproject');
  if (subprojectNode?.kind === 'subproject') subprojectNode.languages = [...languages];

  return createBaseArtifact({
    subprojectId,
    generation,
    nodes,
    edges,
    typescriptSymbolCoverage: typeScriptSymbolCoverage,
    javaSymbolCoverage,
    goSymbolCoverage,
  });
}

function createLogicalSymbolKey(language: 'ts' | 'js' | 'java' | 'go', subprojectId: string, file: string, owner: string | undefined, qualifiedName: string | undefined, declarationKind: string | undefined, signature: string | undefined): string {
  return [language, subprojectId, file, owner ?? '<root>', qualifiedName ?? '<anonymous>', declarationKind ?? 'unknown', sanitizePersistedSignature(signature) ?? ''].join('::');
}

function createSnapshotSymbolId(symbolId: string, sourceHash: string, range: { startLine: number; startColumn: number; endLine: number; endColumn: number }): string {
  return createHash('sha256').update(`${symbolId}:${sourceHash}:${range.startLine}:${range.startColumn}:${range.endLine}:${range.endColumn}`).digest('hex');
}

function pointOccurrenceRange(line: number, column: number) {
  return { startLine: line, startColumn: column, endLine: line, endColumn: column };
}

function buildJavaGraph(
  projectRoot: string,
  subprojectId: string,
  index: Awaited<ReturnType<typeof buildProjectIndex>>,
  nodes: GraphNode[],
  edges: GraphEdge[],
  pendingFileStats: Array<Promise<void>>,
  generation: number
): SubprojectGraphShard['javaSymbolCoverage'] {
  const fileNodeIds = new Map<string, string>();
  const fileNodes = new Map<string, Extract<GraphNode, { kind: 'file' }>>();
  const symbolIds = new Map<string, string>();
  const subprojectNodeId = createSubprojectNodeId(subprojectId);
  const completeFiles: string[] = [];
  const skippedFiles: Array<{ file: string; reason: 'parse_error' | 'input_unreadable' | 'unsupported_source' }> = [];
  const fileProofs: Record<string, { sourceHash: string; symbolCount: number; relationshipScopeCount: number; observedFamilies: any[]; unsupportedForms: any[] }> = {};

  for (const file of index.files) {
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
        ownerKind: record.owner ? (index.classes.find((klass) => klass.fullName === record.owner || klass.className === record.owner)?.kind === 'interface' ? 'interface' : 'class') : 'unknown',
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
    const fromId = symbolIds.get(classRecord.symbolId);
    if (!fromId) continue;
    for (const implemented of classRecord.implements ?? []) {
      const target = index.classes.find((candidate) => candidate.fullName === implemented || candidate.className === implemented);
      const to = target ? symbolIds.get(target.symbolId) ?? `external:java:${implemented}` : `external:java:${implemented}`;
      edges.push({ id: createEdgeId('implements', fromId, to), kind: 'implements', from: fromId, to, targetStatus: to.startsWith('external:') ? 'external' : 'resolved', resolution: to.startsWith('external:') ? 'heuristic' : 'exact' });
    }
    for (const extended of classRecord.extends ?? []) {
      const target = index.classes.find((candidate) => candidate.fullName === extended || candidate.className === extended);
      const to = target ? symbolIds.get(target.symbolId) ?? `external:java:${extended}` : `external:java:${extended}`;
      edges.push({ id: createEdgeId('extends', fromId, to), kind: 'extends', from: fromId, to, targetStatus: to.startsWith('external:') ? 'external' : 'resolved', resolution: to.startsWith('external:') ? 'heuristic' : 'exact' });
    }
    for (const permitted of classRecord.permits ?? []) {
      const target = index.classes.find((candidate) => candidate.fullName === permitted || candidate.className === permitted);
      const to = target ? symbolIds.get(target.symbolId) ?? `external:java:${permitted}` : `external:java:${permitted}`;
      edges.push({ id: createEdgeId('permits', fromId, to), kind: 'permits', from: fromId, to, targetStatus: to.startsWith('external:') ? 'external' : 'resolved', resolution: to.startsWith('external:') ? 'heuristic' : 'exact' });
    }
  }

  for (const method of index.methods) {
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

function buildTypeScriptGraph(
  projectRoot: string,
  subprojectId: string,
  index: TypeScriptProjectIndex,
  nodes: GraphNode[],
  edges: GraphEdge[],
  pendingFileStats: Array<Promise<void>>,
  generation: number
) {
  const fileNodeIds = new Map<string, string>();
  const fileNodes = new Map<string, Extract<GraphNode, { kind: 'file' }>>();
  const callableSymbolIds = new Map<string, string>();
  const typeScriptMemberSymbolIds = new Map<string, string>();
  const subprojectNodeId = createSubprojectNodeId(subprojectId);
  const completeFiles: string[] = [];
  const skippedFiles: Array<{ file: string; reason: 'parse_error' | 'input_unreadable' | 'unsupported_language' | 'unsupported_source' }> = [];
  const fileProofs: Record<string, { sourceHash: string; symbolCount: number }> = {};

  for (const file of index.files.values()) {
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
      }
      if (isCallableGraphDeclaration(record.declarationKind)) {
        const callableKey = typeScriptCallableSymbolKey(file.file, record.owner, record.name);
        if (!callableSymbolIds.has(callableKey) || record.isImplementation) callableSymbolIds.set(callableKey, symbolId);
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

  for (const callable of index.callables) {
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

function typeScriptCallableSymbolKey(file: string, owner: string | undefined, symbol: string): string {
  return `${file}\u0000${owner ?? '<module>'}\u0000${symbol}`;
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

function buildGoGraph(
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

function ensureFileNode(
  nodes: GraphNode[],
  edges: GraphEdge[],
  fileNodeIds: Map<string, string>,
  fileNodes: Map<string, Extract<GraphNode, { kind: 'file' }>>,
  pendingFileStats: Array<Promise<void>>,
  subprojectNodeId: string,
  subprojectId: string,
  relativeFile: string,
  language: 'ts' | 'js' | 'java' | 'go',
  absoluteFile: string,
  entrypoint = false
): string {
  const existing = fileNodeIds.get(relativeFile);
  if (existing) {
    if (entrypoint) {
      const node = fileNodes.get(relativeFile);
      if (node) node.entrypoint = true;
    }
    return existing;
  }
  const fileNodeId = createFileNodeId(subprojectId, relativeFile);
  const fileNode: Extract<GraphNode, { kind: 'file' }> = {
    id: fileNodeId,
    kind: 'file',
    path: relativeFile,
    language,
    size: 0,
    entrypoint: entrypoint || undefined,
  };
  fileNodeIds.set(relativeFile, fileNodeId);
  fileNodes.set(relativeFile, fileNode);
  nodes.push(fileNode);
  edges.push({ id: createEdgeId('contains', subprojectNodeId, fileNodeId), kind: 'contains', from: subprojectNodeId, to: fileNodeId });
  pendingFileStats.push(
    stat(absoluteFile)
      .then((fileStat) => {
        fileNode.size = fileStat.size;
      })
      .catch(() => undefined)
  );
  return fileNodeId;
}

function extractTypeScriptCalls(callableNode: any): Array<{ symbol: string; receiver?: string; text: string; line: number; column: number }> {
  const body = getTypeScriptCallableBodyNode(callableNode);
  if (!body) return [];
  const calls: Array<{ symbol: string; receiver?: string; text: string; line: number; column: number }> = [];
  function visit(node: any) {
    if (!node?.isNamed) return;
    if (node.type === 'call_expression') {
      const functionNode = node.childForFieldName('function');
      if (functionNode?.type === 'identifier') {
        calls.push({ symbol: functionNode.text, text: node.text, line: node.startPosition.row + 1, column: node.startPosition.column });
      }
      if (functionNode?.type === 'member_expression') {
        const propertyNode = functionNode.childForFieldName('property');
        const objectNode = functionNode.childForFieldName('object');
        if (propertyNode) calls.push({ symbol: propertyNode.text.replace(/^#/, ''), receiver: objectNode?.text, text: node.text, line: node.startPosition.row + 1, column: node.startPosition.column });
      }
    }
    for (const child of node.children) visit(child);
  }
  visit(body);
  return calls;
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
