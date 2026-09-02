import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CallSource,
  GraphEdge,
  GraphManifest,
  GraphNode,
  OwnerKind,
  SourceRange,
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
  validateSubprojectGraphShard,
} from './graph-schema.js';
import {
  ensureWorkspaceGraphGitignore,
  readSubprojectGraphShard,
  readWorkspaceGraphManifest,
  writeSubprojectGraphShard,
  writeWorkspaceGraphManifest,
} from './graph-persistence.js';
import { detectWorkspaceSubprojects } from './project-detector.js';
import { collectWorkspaceSourceFiles, detectGraphLanguage, toProjectRelativePath } from './source-policy.js';
import { compareCanonicalPathStrings } from './shared.js';
import { createWorkspaceGraphState, loadWorkspaceGraphState, writeWorkspaceGraphState } from './workspace-state.js';
import {
  buildTypeScriptProjectIndex,
  extractCalls as extractTypeScriptDirectCalls,
  resolveCall as resolveTypeScriptDirectCall,
  resolveExportedCallable,
  type IndexedCallable as TsIndexedCallable,
  type IndexedClass as TsIndexedClass,
  type ImportBinding as TsImportBinding,
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
  const assessment = await assessWorkspaceGraphFreshness(projectRoot, existing, detected, unreadableDirectories, reportUnreadableDirectory);

  if (assessment.mode === 'fresh') {
    return { state: existing, changed: false };
  }

  if (assessment.mode === 'incremental') {
    const refreshed = await refreshChangedSubprojectShards(projectRoot, existing, assessment.subprojects, assessment.changedSubprojectIds);
    if (refreshed) return { ...refreshed, changed: true };
  }

  const built = await buildWorkspaceGraph(projectRoot);
  return { ...built, changed: true };
}

interface FreshnessAssessmentSubproject {
  id: string;
  root: string;
  absoluteRoot: string;
  markers: string[];
  snapshot: WorkspaceGraphState['subprojects'][number]['snapshot'];
  indexedFiles: number;
  changedFiles: string[];
}

type FreshnessAssessment =
  | { mode: 'fresh'; subprojects: FreshnessAssessmentSubproject[] }
  | { mode: 'incremental'; subprojects: FreshnessAssessmentSubproject[]; changedSubprojectIds: Set<string> }
  | { mode: 'full' };

async function assessWorkspaceGraphFreshness(
  projectRoot: string,
  existing: WorkspaceGraphState,
  detected: Awaited<ReturnType<typeof detectWorkspaceSubprojects>>,
  unreadableDirectories: Set<string>,
  reportUnreadableDirectory: (dir: string) => void
): Promise<FreshnessAssessment> {
  if (existing.status !== 'fresh') return { mode: 'full' };
  if (detected.length !== existing.subprojects.length) return { mode: 'full' };

  const manifest = await readWorkspaceGraphManifest(projectRoot);
  if (manifest.status !== 'ok') return { mode: 'full' };
  const manifestById = new Map(manifest.data.subprojects.map((subproject) => [subproject.id, subproject]));
  const previousById = new Map(existing.subprojects.map((subproject) => [subproject.id, subproject]));
  const assessedSubprojects: FreshnessAssessmentSubproject[] = [];
  const changedSubprojectIds = new Set<string>();

  for (const subproject of detected) {
    const previous = previousById.get(subproject.id);
    const manifestEntry = manifestById.get(subproject.id);
    if (!previous || !manifestEntry || previous.root !== subproject.root || manifestEntry.root !== subproject.root || previous.shardPath !== manifestEntry.shardPath || previous.generation !== manifestEntry.generation || previous.markers.join('|') !== subproject.markers.join('|')) {
      return { mode: 'full' };
    }

    const shard = await readSubprojectGraphShard(projectRoot, subproject.id, { generation: previous.generation });
    if (shard.status !== 'ok') return { mode: 'full' };

    const files = await collectWorkspaceSourceFiles(subproject.absoluteRoot, { onUnreadableDirectory: reportUnreadableDirectory });
    const snapshot = await createSubprojectSnapshot(projectRoot, files);
    const diff = compareSubprojectSnapshot(previous.snapshot, snapshot);
    if (diff.stale) changedSubprojectIds.add(subproject.id);
    assessedSubprojects.push({
      id: subproject.id,
      root: subproject.root,
      absoluteRoot: subproject.absoluteRoot,
      markers: subproject.markers,
      snapshot,
      indexedFiles: files.length,
      changedFiles: diff.changedFiles,
    });
  }

  const previousUnreadable = [...(existing.coverage.unreadableDirectories ?? [])].sort();
  const nextUnreadable = [...unreadableDirectories].sort();
  if (previousUnreadable.join('|') !== nextUnreadable.join('|')) return { mode: 'full' };

  if (changedSubprojectIds.size === 0) return { mode: 'fresh', subprojects: assessedSubprojects };
  return { mode: 'incremental', subprojects: assessedSubprojects, changedSubprojectIds };
}

async function refreshChangedSubprojectShards(
  projectRoot: string,
  existing: WorkspaceGraphState,
  subprojects: FreshnessAssessmentSubproject[],
  changedSubprojectIds: Set<string>
): Promise<{ state: WorkspaceGraphState; manifest: GraphManifest } | undefined> {
  const generation = Math.max(Date.now(), existing.generation + 1);
  const workspaceNodeId = createWorkspaceNodeId(projectRoot);
  const previousById = new Map(existing.subprojects.map((subproject) => [subproject.id, subproject]));
  const manifestSubprojects: GraphManifest['subprojects'] = [];
  const stateSubprojects: WorkspaceGraphState['subprojects'] = [];
  let workspaceStatus: WorkspaceGraphState['status'] = 'fresh';

  for (const subproject of subprojects) {
    const previous = previousById.get(subproject.id);
    if (!previous) return undefined;

    if (!changedSubprojectIds.has(subproject.id)) {
      manifestSubprojects.push({ id: previous.id, root: previous.root, shardPath: previous.shardPath, generation: previous.generation });
      stateSubprojects.push(previous);
      if (previous.status !== 'fresh') workspaceStatus = 'partial';
      continue;
    }

    const previousShardResult = await readSubprojectGraphShard(projectRoot, subproject.id, { generation: previous.generation });
    if (previousShardResult.status !== 'ok') return undefined;

    const rebuiltShard = await buildSubprojectShard(projectRoot, subproject.absoluteRoot, subproject.id, subproject.root, subproject.markers, generation);
    const shard = createSafeFileIncrementalShard(previousShardResult.data, rebuiltShard, subproject.changedFiles, generation) ?? rebuiltShard;
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
      snapshot: subproject.snapshot,
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
      indexedFiles: subprojects.reduce((total, subproject) => total + subproject.indexedFiles, 0),
      skippedLargeFiles: 0,
      skippedUnsupportedFiles: 0,
      excludedDirectories: WORKSPACE_GRAPH_EXCLUDED_DIRECTORIES,
      unreadableDirectories: [...(existing.coverage.unreadableDirectories ?? [])].sort(),
    },
  });
  await writeWorkspaceGraphState(projectRoot, state);
  return { state, manifest };
}

const WORKSPACE_GRAPH_EXCLUDED_DIRECTORIES = ['node_modules', 'build', 'dist', 'coverage', '.next', '.nuxt', '.svelte-kit', '.react-router', '.turbo', '.vite', '.cache', 'out', 'vendor', 'target'];

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
    excludedDirectories: WORKSPACE_GRAPH_EXCLUDED_DIRECTORIES,
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

function createSafeFileIncrementalShard(
  previous: SubprojectGraphShard,
  rebuilt: SubprojectGraphShard,
  changedFiles: string[],
  generation: number
): SubprojectGraphShard | undefined {
  if (previous.subprojectId !== rebuilt.subprojectId) return undefined;
  const changed = new Set(changedFiles);
  if (changed.size === 0) return undefined;

  const previousFilePaths = new Set(previous.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file').map((node) => node.path));
  const rebuiltFilePaths = new Set(rebuilt.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file').map((node) => node.path));
  for (const file of changed) {
    if (!previousFilePaths.has(file) && rebuiltFilePaths.has(file)) return undefined;
    if (!previousFilePaths.has(file) && !rebuiltFilePaths.has(file)) return undefined;
  }

  if (!hasStableUntouchedFiles(previous, rebuilt, changed)) return undefined;
  if (!hasSafeChangedFileTopology(previous, rebuilt, changed)) return undefined;

  const previousAffected = collectFileScopedNodeIds(previous, changed);
  const rebuiltAffected = collectFileScopedNodeIds(rebuilt, changed);
  const nodes = [
    ...previous.nodes.filter((node) => !previousAffected.has(node.id)),
    ...rebuilt.nodes.filter((node) => rebuiltAffected.has(node.id)),
  ];
  const edgesById = new Map<string, GraphEdge>();
  for (const edge of previous.edges) {
    if (previousAffected.has(edge.from) || previousAffected.has(edge.to)) continue;
    edgesById.set(edge.id, edge);
  }
  for (const edge of rebuilt.edges) {
    if (rebuiltAffected.has(edge.from) || rebuiltAffected.has(edge.to)) edgesById.set(edge.id, edge);
  }

  const candidate = createBaseArtifact({
    subprojectId: previous.subprojectId,
    generation,
    nodes,
    edges: [...edgesById.values()],
    typescriptSymbolCoverage: rebuilt.typescriptSymbolCoverage,
    javaSymbolCoverage: rebuilt.javaSymbolCoverage,
    goSymbolCoverage: rebuilt.goSymbolCoverage,
  });
  return validateSubprojectGraphShard(candidate) ? candidate : undefined;
}

function collectFileScopedNodeIds(shard: SubprojectGraphShard, files: Set<string>): Set<string> {
  const ids = new Set<string>();
  for (const node of shard.nodes) {
    if (node.kind === 'file' && files.has(node.path)) ids.add(node.id);
    if (node.kind === 'symbol' && files.has(node.file)) ids.add(node.id);
  }
  return ids;
}

function hasStableUntouchedFiles(previous: SubprojectGraphShard, rebuilt: SubprojectGraphShard, changed: Set<string>): boolean {
  const previousFiles = previous.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file' && !changed.has(node.path));
  const rebuiltFileIds = new Set(rebuilt.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file' && !changed.has(node.path)).map((node) => node.id));
  for (const file of previousFiles) {
    if (!rebuiltFileIds.has(file.id)) return false;
  }
  return true;
}

function hasSafeChangedFileTopology(previous: SubprojectGraphShard, rebuilt: SubprojectGraphShard, changed: Set<string>): boolean {
  const previousFiles = new Set(previous.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file').map((node) => node.path));
  const rebuiltFiles = new Set(rebuilt.nodes.filter((node): node is Extract<GraphNode, { kind: 'file' }> => node.kind === 'file').map((node) => node.path));
  const retainedChanged = new Set([...changed].filter((file) => previousFiles.has(file) && rebuiltFiles.has(file)));
  const deletedChanged = new Set([...changed].filter((file) => previousFiles.has(file) && !rebuiltFiles.has(file)));

  const previousRetained = collectFileScopedNodeIds(previous, retainedChanged);
  const rebuiltRetained = collectFileScopedNodeIds(rebuilt, retainedChanged);
  if (!sameStringSet(previousRetained, rebuiltRetained)) return false;

  const previousDeleted = collectFileScopedNodeIds(previous, deletedChanged);
  if (publicTopologyFingerprints(previous, deletedChanged).size > 0) return false;
  if (inboundFingerprints(previous, previousDeleted).size > 0) return false;

  const previousPublic = publicTopologyFingerprints(previous, retainedChanged);
  const rebuiltPublic = publicTopologyFingerprints(rebuilt, retainedChanged);
  if (!sameStringSet(previousPublic, rebuiltPublic)) return false;

  const previousRelationships = relationshipFingerprints(previous, previousRetained);
  const rebuiltRelationships = relationshipFingerprints(rebuilt, rebuiltRetained);
  if (!sameStringSet(previousRelationships, rebuiltRelationships)) return false;

  const previousInbound = inboundFingerprints(previous, previousRetained);
  const rebuiltInbound = inboundFingerprints(rebuilt, rebuiltRetained);
  return sameStringSet(previousInbound, rebuiltInbound);
}

function publicTopologyFingerprints(shard: SubprojectGraphShard, files: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const node of shard.nodes) {
    if (node.kind !== 'symbol' || !files.has(node.file)) continue;
    const topologySensitive = node.exported || node.declarationKind === 'interface' || node.declarationKind === 'interface_method' || node.declarationKind === 'property' || node.declarationKind === 'call_signature' || node.declarationKind === 'construct_signature' || node.declarationKind === 'index_signature' || node.declarationKind === 'type_alias';
    if (!topologySensitive) continue;
    result.add([node.id, node.language, node.symbolKind, node.name, node.owner ?? '', node.declarationKind ?? '', node.qualifiedName ?? '', node.signature ?? '', node.exportedName ?? ''].join('\u0000'));
  }
  return result;
}

function relationshipFingerprints(shard: SubprojectGraphShard, scopedIds: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const edge of shard.edges) {
    if (!scopedIds.has(edge.from)) continue;
    if (edge.kind === 'contains') continue;
    result.add(edgeTopologyFingerprint(edge));
  }
  return result;
}

function inboundFingerprints(shard: SubprojectGraphShard, scopedIds: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const edge of shard.edges) {
    if (scopedIds.has(edge.from) || !scopedIds.has(edge.to)) continue;
    if (edge.kind === 'contains') continue;
    result.add(edgeTopologyFingerprint(edge));
  }
  return result;
}

function edgeTopologyFingerprint(edge: GraphEdge): string {
  return [edge.kind, edge.from, edge.to, edge.targetStatus ?? '', edge.resolution ?? '', edge.calledAs ?? '', edge.importSource ?? '', edge.externalName ?? '', edge.externalKind ?? '', edge.externalOwner ?? '', edge.reason ?? ''].join('\u0000');
}

function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
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
      const relationshipMetadata = getJavaTypeRelationshipMetadataForGraph(index, classRecord.file, classRecord.line, 'implements', target?.className ?? implemented.split('.').pop() ?? implemented);
      edges.push({ id: createEdgeId('implements', fromId, to), kind: 'implements', from: fromId, to, occurrenceRange: relationshipMetadata?.range, calledAs: relationshipMetadata?.calledAs, targetStatus: to.startsWith('external:') ? 'external' : 'resolved', resolution: to.startsWith('external:') ? 'heuristic' : 'exact' });
    }
    for (const extended of classRecord.extends ?? []) {
      const target = index.classes.find((candidate) => candidate.fullName === extended || candidate.className === extended);
      const to = target ? symbolIds.get(target.symbolId) ?? `external:java:${extended}` : `external:java:${extended}`;
      const relationshipMetadata = getJavaTypeRelationshipMetadataForGraph(index, classRecord.file, classRecord.line, 'extends', target?.className ?? extended.split('.').pop() ?? extended);
      edges.push({ id: createEdgeId('extends', fromId, to), kind: 'extends', from: fromId, to, occurrenceRange: relationshipMetadata?.range, calledAs: relationshipMetadata?.calledAs, targetStatus: to.startsWith('external:') ? 'external' : 'resolved', resolution: to.startsWith('external:') ? 'heuristic' : 'exact' });
    }
    for (const permitted of classRecord.permits ?? []) {
      const target = index.classes.find((candidate) => candidate.fullName === permitted || candidate.className === permitted);
      const to = target ? symbolIds.get(target.symbolId) ?? `external:java:${permitted}` : `external:java:${permitted}`;
      edges.push({ id: createEdgeId('permits', fromId, to), kind: 'permits', from: fromId, to, targetStatus: to.startsWith('external:') ? 'external' : 'resolved', resolution: to.startsWith('external:') ? 'heuristic' : 'exact' });
    }
  }

  for (const typeReference of index.typeReferences) {
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

function getJavaTypeRelationshipMetadataForGraph(
  index: ProjectIndex,
  file: string,
  line: number,
  relationship: 'extends' | 'implements',
  targetName: string
): { range: { startLine: number; startColumn: number; endLine: number; endColumn: number }; calledAs: string } | undefined {
  const source = index.files.find((candidate) => candidate.file === file)?.source;
  const lineText = source?.split('\n')[line - 1];
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
  const typeScriptClassSymbolIds = new Map<string, string>();
  const typeScriptMemberSymbolIds = new Map<string, string>();
  const typeScriptTypeAliasSymbolIds = new Map<string, string>();
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
      if ((record.declarationKind === 'class' || record.declarationKind === 'interface') && !record.owner) {
        typeScriptClassSymbolIds.set(typeScriptExportedSymbolKey(file.file, record.name), symbolId);
      }
      if (record.declarationKind === 'type_alias' && !record.owner) {
        typeScriptTypeAliasSymbolIds.set(typeScriptExportedSymbolKey(file.file, record.name), symbolId);
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

  for (const edge of collectTypeScriptTypeAliasReferenceEdges(projectRoot, index, typeScriptTypeAliasSymbolIds, fileNodeIds)) {
    edges.push(edge);
  }

  for (const edge of collectTypeScriptSymbolReferenceEdges(projectRoot, index, callableSymbolIds, typeScriptClassSymbolIds, typeScriptTypeAliasSymbolIds, fileNodeIds)) {
    edges.push(edge);
  }

  for (const edge of collectTypeScriptPropertyAliasCallEdges(projectRoot, index, callableSymbolIds, fileNodeIds)) {
    edges.push(edge);
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

function collectTypeScriptSymbolReferenceEdges(
  projectRoot: string,
  index: TypeScriptProjectIndex,
  callableSymbolIds: Map<string, string>,
  classSymbolIds: Map<string, string>,
  typeAliasSymbolIds: Map<string, string>,
  fileNodeIds: Map<string, string>
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const file of index.files.values()) {
    const relFile = toProjectRelativePath(projectRoot, file.file);
    const fileNodeId = fileNodeIds.get(relFile);
    if (!fileNodeId) continue;

    const localTargets = new Map<string, { id: string; kind: 'function' | 'class' | 'interface' | 'type_alias'; targetName: string; importSource?: string }>();
    for (const callable of index.callables.filter((item) => item.file === file.file && item.exportedName && !item.ownerName)) {
      const id = callableSymbolIds.get(typeScriptCallableSymbolKey(callable.file, callable.ownerName, callable.symbol));
      if (id) localTargets.set(callable.symbol, { id, kind: 'function', targetName: callable.symbol });
    }
    for (const klass of index.classes.filter((item) => item.file === file.file && item.exportedName)) {
      const id = classSymbolIds.get(typeScriptExportedSymbolKey(klass.file, klass.className));
      if (!id) continue;
      localTargets.set(klass.className, { id, kind: isTypeScriptInterfaceNode(klass.node) ? 'interface' : 'class', targetName: klass.className });
    }

    for (const binding of file.imports.values()) {
      const resolved = resolveTypeScriptImportedGraphSymbol(index, binding, file.file, callableSymbolIds, classSymbolIds, typeAliasSymbolIds);
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

    for (const [localName, target] of localTargets) {
      if (target.kind === 'function') {
        for (const match of findAllTypeScriptRegexPositions(file.source, new RegExp(`\\b${escapeRegExp(localName)}\\s*\\(`, 'g'))) {
          if (isTypeScriptImportLine(file.source, match.line) || isTypeScriptFunctionDeclarationLine(file.source, localName, match.line)) continue;
          const contextId = findTypeScriptContextCallableSymbolId(projectRoot, index, callableSymbolIds, file.file, match.line);
          if (contextId) continue;
          edges.push({
            id: createEdgeId('calls', fileNodeId, target.id, `typescript_top_level:${localName}:${match.line}:${match.column}`),
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
      }

      if (target.kind === 'class') {
        for (const match of findAllTypeScriptRegexPositions(file.source, new RegExp(`\\bnew\\s+${escapeRegExp(localName)}\\s*\\(`, 'g'))) {
          if (isTypeScriptImportLine(file.source, match.line)) continue;
          const fromId = findTypeScriptContextCallableSymbolId(projectRoot, index, callableSymbolIds, file.file, match.line) ?? fileNodeId;
          edges.push({
            id: createEdgeId('reads', fromId, target.id, `typescript_instantiate:${localName}:${match.line}:${match.column}`),
            kind: 'reads',
            from: fromId,
            to: target.id,
            occurrenceRange: { startLine: match.line, startColumn: match.column, endLine: match.line, endColumn: match.column + match.text.length },
            callsite: { line: match.line, column: match.column },
            calledAs: match.text,
            targetStatus: 'resolved',
            resolution: 'exact',
            reason: 'typescript_instantiate',
          });
        }
      }

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

function collectTypeScriptPropertyAliasCallEdges(
  projectRoot: string,
  index: TypeScriptProjectIndex,
  callableSymbolIds: Map<string, string>,
  fileNodeIds: Map<string, string>
): GraphEdge[] {
  const importedFunctionTargets = new Map<string, Map<string, string>>();
  for (const file of index.files.values()) {
    const targets = new Map<string, string>();
    for (const binding of file.imports.values()) {
      if (binding.kind === 'namespace') continue;
      const callable = resolveImportedCallableForGraph(index, file.file, binding);
      if (!callable) continue;
      const targetId = callableSymbolIds.get(typeScriptCallableSymbolKey(callable.file, callable.ownerName, callable.symbol));
      if (targetId) targets.set(binding.localName, targetId);
    }
    importedFunctionTargets.set(file.file, targets);
  }

  const propertyAliases = new Map<string, string>();
  for (const file of index.files.values()) {
    const targets = importedFunctionTargets.get(file.file) ?? new Map<string, string>();
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
        const targetId = targets.get(valueName);
        if (targetId) propertyAliases.set(`${typeName}\u0000${propertyName}`, targetId);
      }
    }
  }
  if (propertyAliases.size === 0) return [];

  const edges: GraphEdge[] = [];
  for (const file of index.files.values()) {
    const relFile = toProjectRelativePath(projectRoot, file.file);
    const fileNodeId = fileNodeIds.get(relFile);
    if (!fileNodeId) continue;
    const typedReceivers = collectTypeScriptReceiverTypesFromSource(file.source);
    for (const [receiver, typeName] of typedReceivers) {
      const receiverPattern = receiver.includes('.') ? escapeRegExp(receiver) : `(?<![.\\w$])${escapeRegExp(receiver)}`;
      for (const [key, targetId] of propertyAliases) {
        const [aliasType, propertyName] = key.split('\u0000');
        if (aliasType !== typeName || !propertyName) continue;
        for (const match of findAllTypeScriptRegexPositions(file.source, new RegExp(`${receiverPattern}\\s*\\.\\s*${escapeRegExp(propertyName)}\\s*\\(`, 'g'))) {
          const fromId = findTypeScriptContextCallableSymbolId(projectRoot, index, callableSymbolIds, file.file, match.line) ?? fileNodeId;
          edges.push({
            id: createEdgeId('calls', fromId, targetId, `typescript_property_alias:${receiver}:${propertyName}:${match.line}:${match.column}`),
            kind: 'calls',
            from: fromId,
            to: targetId,
            occurrenceRange: pointOccurrenceRange(match.line, match.column),
            callsite: { line: match.line, column: match.column, receiverName: receiver, receiverType: typeName },
            calledAs: extractTypeScriptLineCallText(file.source, match.line, match.column),
            targetStatus: 'resolved',
            resolution: 'heuristic',
            reason: 'typescript_property_alias_call',
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
  fileNodeIds: Map<string, string>
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

    const lines = file.source.split('\n');
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

function resolveTypeScriptImportedGraphSymbol(
  index: TypeScriptProjectIndex,
  binding: TsImportBinding,
  currentFile: string,
  callableSymbolIds: Map<string, string>,
  classSymbolIds: Map<string, string>,
  typeAliasSymbolIds: Map<string, string>
): { id: string; kind: 'function' | 'class' | 'interface' | 'type_alias'; targetName: string } | undefined {
  if (binding.kind === 'namespace') return undefined;
  const targetFile = resolveTypeScriptImportCandidates(currentFile, binding.source, index.projectConfig).find((candidate) => index.files.has(candidate));
  if (!targetFile) return undefined;

  const callable = resolveExportedCallable(index, targetFile, binding.importedName);
  if (callable) {
    const id = callableSymbolIds.get(typeScriptCallableSymbolKey(callable.file, callable.ownerName, callable.symbol));
    if (id) return { id, kind: 'function', targetName: callable.symbol };
  }

  const klass = index.classes.find((item) => item.file === targetFile && item.exportedName === binding.importedName);
  if (klass) {
    const id = classSymbolIds.get(typeScriptExportedSymbolKey(klass.file, klass.className));
    if (id) return { id, kind: isTypeScriptInterfaceNode(klass.node) ? 'interface' : 'class', targetName: klass.className };
  }

  const typeAliasId = typeAliasSymbolIds.get(typeScriptExportedSymbolKey(targetFile, binding.importedName));
  if (typeAliasId) return { id: typeAliasId, kind: 'type_alias', targetName: binding.importedName };
  return undefined;
}

function isTypeScriptInterfaceNode(node: any): boolean {
  return node?.type === 'interface_declaration';
}

function findTypeScriptContextCallableSymbolId(
  projectRoot: string,
  index: TypeScriptProjectIndex,
  callableSymbolIds: Map<string, string>,
  file: string,
  line: number
): string | undefined {
  let best: TsIndexedCallable | undefined;
  for (const callable of index.callables) {
    if (callable.file !== file) continue;
    const start = callable.line;
    const end = callable.node?.endPosition?.row !== undefined ? callable.node.endPosition.row + 1 : start;
    if (line < start || line > end) continue;
    if (!best || start >= best.line) best = callable;
  }
  if (!best) return undefined;
  return callableSymbolIds.get(typeScriptCallableSymbolKey(best.file, best.ownerName, best.symbol));
}

function findTypeScriptClassSymbolIdForLine(
  projectRoot: string,
  index: TypeScriptProjectIndex,
  classSymbolIds: Map<string, string>,
  file: string,
  line: number
): string | undefined {
  let best: TsIndexedClass | undefined;
  for (const klass of index.classes) {
    if (klass.file !== file || isTypeScriptInterfaceNode(klass.node)) continue;
    const start = klass.line;
    const end = klass.node?.endPosition?.row !== undefined ? klass.node.endPosition.row + 1 : start;
    if (line < start || line > end) continue;
    if (!best || start >= best.line) best = klass;
  }
  if (!best) return undefined;
  return classSymbolIds.get(typeScriptExportedSymbolKey(best.file, best.className));
}

function findTypeScriptImportBindingRange(source: string, token: string): SourceRange | undefined {
  return findTypeScriptTokenRange(source, token, true);
}

function isTypeScriptImportLine(source: string, line: number): boolean {
  return /^\s*import\b/.test(source.split('\n')[line - 1] ?? '');
}

function isTypeScriptFunctionDeclarationLine(source: string, name: string, line: number): boolean {
  return new RegExp(`\\bfunction\\s+${escapeRegExp(name)}\\s*\\(`).test(source.split('\n')[line - 1] ?? '');
}

function findAllTypeScriptRegexPositions(source: string, pattern: RegExp): Array<{ line: number; column: number; text: string }> {
  const results: Array<{ line: number; column: number; text: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const position = offsetToLineColumn(source, match.index);
    results.push({ ...position, text: match[0] });
  }
  return results;
}

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  const lines = source.slice(0, offset).split('\n');
  return { line: lines.length, column: lines[lines.length - 1]?.length ?? 0 };
}

function extractTypeScriptLineCallText(source: string, line: number, column: number): string {
  const lineText = source.split('\n')[line - 1] ?? '';
  const tail = lineText.slice(column);
  const match = tail.match(/^[^;\n]+/);
  return (match?.[0] ?? tail).trim();
}

function dedupeGraphEdges(items: GraphEdge[]): GraphEdge[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function findTypeScriptTokenRange(source: string, token: string, preferImportLine = false): SourceRange | undefined {
  const lines = source.split('\n');
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
