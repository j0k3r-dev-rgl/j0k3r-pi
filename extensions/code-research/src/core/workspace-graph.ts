import { stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type {
  GraphEdge,
  GraphManifest,
  GraphNode,
  SubprojectGraphShard,
  WorkspaceGraphState,
} from '../types.js';
import { buildProjectIndex } from './project-index.js';
import { compareSubprojectSnapshot, createSubprojectSnapshot } from './freshness.js';
import {
  createBaseArtifact,
  createEdgeId,
  createSubprojectNodeId,
  createWorkspaceNodeId,
  validateSubprojectGraphShard,
} from './graph-schema.js';
import {
  ensureWorkspaceGraphGitignore,
  readSubprojectGraphShard,
  readWorkspaceGraphManifest,
  getWorkspaceGraphRoot,
  writeSubprojectGraphShard,
  writeWorkspaceGraphManifest,
} from './graph-persistence.js';
import { detectWorkspaceSubprojects } from './project-detector.js';
import { collectWorkspaceSourceFiles, detectGraphLanguage, toProjectRelativePath } from './source-policy.js';
import { compareCanonicalPathStrings } from './shared.js';
import { createWorkspaceGraphState, loadWorkspaceGraphState, writeWorkspaceGraphState } from './workspace-state.js';
import { buildJavaGraph, createFastJavaFileIncrementalShard } from './graph-java.js';
import { buildTypeScriptGraph, createFastTypeScriptFileIncrementalShard } from './graph-typescript.js';
import { buildGoGraph } from './graph-go.js';
import { buildTypeScriptProjectIndex } from '../languages/typescript/function-call-tree.js';
import { buildGoProjectIndex } from '../languages/go/workspace-graph.js';
import {
  collectFileScopedNodeIds,
  hasSafeChangedFileTopology,
  hasStableUntouchedFiles,
  inboundFingerprints,
  publicTopologyFingerprints,
  relationshipFingerprints,
  sameStringSet,
} from './graph-language-shared.js';

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
  excludedNestedRoots: string[];
  markers: string[];
  snapshot: WorkspaceGraphState['subprojects'][number]['snapshot'];
  indexedFiles: number;
  changedFiles: string[];
}

type FreshnessAssessment =
  | { mode: 'fresh'; subprojects: FreshnessAssessmentSubproject[] }
  | { mode: 'incremental'; subprojects: FreshnessAssessmentSubproject[]; changedSubprojectIds: Set<string> }
  | { mode: 'full' };

type DetectedSubproject = Awaited<ReturnType<typeof detectWorkspaceSubprojects>>[number];

function nestedSubprojectRoots(subproject: DetectedSubproject, allSubprojects: DetectedSubproject[]): string[] {
  return allSubprojects
    .filter((candidate) => candidate.id !== subproject.id && candidate.absoluteRoot.startsWith(`${subproject.absoluteRoot}${sep}`))
    .map((candidate) => candidate.absoluteRoot)
    .sort((a, b) => a.localeCompare(b));
}

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

    const shardExists = await stat(join(getWorkspaceGraphRoot(projectRoot), manifestEntry.shardPath)).then((file) => file.isFile()).catch(() => false);
    if (!shardExists) return { mode: 'full' };

    const excludedNestedRoots = nestedSubprojectRoots(subproject, detected);
    const files = await collectWorkspaceSourceFiles(subproject.absoluteRoot, { onUnreadableDirectory: reportUnreadableDirectory, excludeDirectories: excludedNestedRoots });
    const snapshot = await createSubprojectSnapshot(projectRoot, files);
    const diff = compareSubprojectSnapshot(previous.snapshot, snapshot);
    if (diff.stale) changedSubprojectIds.add(subproject.id);
    assessedSubprojects.push({
      id: subproject.id,
      root: subproject.root,
      absoluteRoot: subproject.absoluteRoot,
      excludedNestedRoots,
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

    const fastShard = await createFastTypeScriptFileIncrementalShard(projectRoot, subproject.absoluteRoot, subproject.id, subproject.root, subproject.markers, previousShardResult.data, subproject.changedFiles, generation, subproject.excludedNestedRoots)
      ?? await createFastJavaFileIncrementalShard(projectRoot, subproject.absoluteRoot, subproject.id, subproject.root, subproject.markers, previousShardResult.data, subproject.changedFiles, generation, subproject.excludedNestedRoots);
    const rebuiltShard = fastShard ?? await buildSubprojectShard(projectRoot, subproject.absoluteRoot, subproject.id, subproject.root, subproject.markers, generation, subproject.excludedNestedRoots);
    const shard = fastShard ?? createSafeFileIncrementalShard(previousShardResult.data, rebuiltShard, subproject.changedFiles, generation) ?? rebuiltShard;
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
    const excludedNestedRoots = nestedSubprojectRoots(subproject, detected);
    const files = await collectWorkspaceSourceFiles(subproject.absoluteRoot, { onUnreadableDirectory: reportUnreadableDirectory, excludeDirectories: excludedNestedRoots });
    const snapshot = await createSubprojectSnapshot(projectRoot, files);
    coverage.indexedFiles += files.length;

    const shard = await buildSubprojectShard(projectRoot, subproject.absoluteRoot, subproject.id, subproject.root, subproject.markers, generation, excludedNestedRoots);
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
  generation: number,
  excludedNestedRoots: string[] = []
): Promise<SubprojectGraphShard> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const pendingFileStats: Array<Promise<void>> = [];
  const workspaceNodeId = createWorkspaceNodeId(projectRoot);
  const subprojectNodeId = createSubprojectNodeId(subprojectId);

  nodes.push({ id: workspaceNodeId, kind: 'workspace', name: 'workspace', root: '.' });
  nodes.push({ id: subprojectNodeId, kind: 'subproject', name: subprojectRelativeRoot, root: subprojectRelativeRoot, markers, languages: [] });
  edges.push({ id: createEdgeId('contains', workspaceNodeId, subprojectNodeId), kind: 'contains', from: workspaceNodeId, to: subprojectNodeId });

  const files = await collectWorkspaceSourceFiles(subprojectRoot, { excludeDirectories: excludedNestedRoots });
  const languages = new Set<string>();

  let javaSymbolCoverage: SubprojectGraphShard['javaSymbolCoverage'];
  const javaFiles = files.filter((file) => detectGraphLanguage(file) === 'java');
  if (javaFiles.length > 0) {
    languages.add('java');
    const javaIndex = await buildProjectIndex(subprojectRoot, { excludeDirectories: excludedNestedRoots });
    javaSymbolCoverage = buildJavaGraph(projectRoot, subprojectId, javaIndex, nodes, edges, pendingFileStats, generation);
  }

  let typeScriptSymbolCoverage: SubprojectGraphShard['typescriptSymbolCoverage'];
  const tsFiles = files.filter((file) => {
    const language = detectGraphLanguage(file);
    return language === 'ts' || language === 'js';
  });
  if (tsFiles.length > 0) {
    const tsIndex = await buildTypeScriptProjectIndex(subprojectRoot, { excludeDirectories: excludedNestedRoots });
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
    const goIndex = await buildGoProjectIndex(subprojectRoot, { excludeDirectories: excludedNestedRoots });
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

