import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';
import type {
  GraphEdge,
  GraphManifest,
  GraphNode,
  SubprojectGraphShard,
  SupportedLanguage,
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
import { collectWorkspaceSourceFiles, detectGraphLanguage, shouldIndexSourceFile, toProjectRelativePath } from './source-policy.js';
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

export async function ensureWorkspaceGraphFreshness(projectRoot: string, options?: { changedPaths?: string[] }): Promise<{ state: WorkspaceGraphState; manifest?: GraphManifest; changed: boolean }> {
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
  const assessment = options?.changedPaths?.length
    ? await assessKnownChangedPathsWorkspaceGraphFreshness(projectRoot, existing, detected, unreadableDirectories, options.changedPaths)
    : await assessWorkspaceGraphFreshness(projectRoot, existing, detected, unreadableDirectories, reportUnreadableDirectory);

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

async function assessKnownChangedPathsWorkspaceGraphFreshness(
  projectRoot: string,
  existing: WorkspaceGraphState,
  detected: Awaited<ReturnType<typeof detectWorkspaceSubprojects>>,
  unreadableDirectories: Set<string>,
  changedPaths: string[]
): Promise<FreshnessAssessment> {
  if (existing.status !== 'fresh') return { mode: 'full' };
  if (detected.length !== existing.subprojects.length) return { mode: 'full' };
  if (changedPaths.length > 64) return { mode: 'full' };

  const manifest = await readWorkspaceGraphManifest(projectRoot);
  if (manifest.status !== 'ok') return { mode: 'full' };
  const manifestById = new Map(manifest.data.subprojects.map((subproject) => [subproject.id, subproject]));
  const previousById = new Map(existing.subprojects.map((subproject) => [subproject.id, subproject]));
  const assessedById = new Map<string, FreshnessAssessmentSubproject>();
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
    assessedById.set(subproject.id, {
      id: subproject.id,
      root: subproject.root,
      absoluteRoot: subproject.absoluteRoot,
      excludedNestedRoots,
      markers: subproject.markers,
      snapshot: { ...previous.snapshot },
      indexedFiles: Object.keys(previous.snapshot).length,
      changedFiles: [],
    });
  }

  const normalizedChanges = [...new Set(changedPaths.map((path) => resolve(path)))].sort();
  for (const absolutePath of normalizedChanges) {
    const changedSubproject = detected
      .filter((subproject) => absolutePath === subproject.absoluteRoot || absolutePath.startsWith(`${subproject.absoluteRoot}${sep}`))
      .sort((a, b) => b.absoluteRoot.length - a.absoluteRoot.length)[0];
    if (!changedSubproject) return { mode: 'full' };

    const assessed = assessedById.get(changedSubproject.id);
    const previous = previousById.get(changedSubproject.id);
    if (!assessed || !previous) return { mode: 'full' };
    const relFile = toProjectRelativePath(projectRoot, absolutePath);
    const previousEntry = previous.snapshot[relFile];
    if (!previousEntry) return { mode: 'full' };
    if (!await shouldIndexSourceFile(projectRoot, absolutePath)) return { mode: 'full' };

    const nextSnapshot = await createSubprojectSnapshot(projectRoot, [absolutePath]);
    const nextEntry = nextSnapshot[relFile];
    if (!nextEntry) return { mode: 'full' };
    if (previousEntry.mtimeMs === nextEntry.mtimeMs && previousEntry.size === nextEntry.size && previousEntry.hash === nextEntry.hash) continue;

    assessed.snapshot[relFile] = nextEntry;
    assessed.changedFiles.push(relFile);
    changedSubprojectIds.add(changedSubproject.id);
  }

  const previousUnreadable = [...(existing.coverage.unreadableDirectories ?? [])].sort();
  const nextUnreadable = [...unreadableDirectories].sort();
  if (previousUnreadable.join('|') !== nextUnreadable.join('|')) return { mode: 'full' };

  const assessedSubprojects = detected.map((subproject) => assessedById.get(subproject.id)).filter((item): item is FreshnessAssessmentSubproject => Boolean(item));
  for (const assessed of assessedSubprojects) assessed.changedFiles.sort(compareCanonicalPathStrings);
  if (changedSubprojectIds.size === 0) return { mode: 'fresh', subprojects: assessedSubprojects };
  return { mode: 'incremental', subprojects: assessedSubprojects, changedSubprojectIds };
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
  const changedSubprojects = subprojects.filter((subproject) => changedSubprojectIds.has(subproject.id));
  const changedResults = new Map<string, WorkspaceGraphState['subprojects'][number]>();

  for (const subproject of subprojects) {
    if (!previousById.has(subproject.id)) return undefined;
  }

  const refreshed = await mapWithConcurrency(changedSubprojects, getWorkspaceGraphBuildConcurrency(), async (subproject) => {
    const previous = previousById.get(subproject.id);
    if (!previous) return undefined;
    const previousShardResult = await readSubprojectGraphShard(projectRoot, subproject.id, { generation: previous.generation });
    if (previousShardResult.status !== 'ok') return undefined;

    const fastShard = await createFastTypeScriptFileIncrementalShard(projectRoot, subproject.absoluteRoot, subproject.id, subproject.root, subproject.markers, previousShardResult.data, subproject.changedFiles, generation, subproject.excludedNestedRoots)
      ?? await createFastJavaFileIncrementalShard(projectRoot, subproject.absoluteRoot, subproject.id, subproject.root, subproject.markers, previousShardResult.data, subproject.changedFiles, generation, subproject.excludedNestedRoots);
    const rebuiltShard = fastShard ?? await buildSubprojectShard(projectRoot, subproject.absoluteRoot, subproject.id, subproject.root, subproject.markers, generation, subproject.excludedNestedRoots);
    const shard = fastShard ?? createSafeFileIncrementalShard(previousShardResult.data, rebuiltShard, subproject.changedFiles, generation) ?? rebuiltShard;
    const shardPath = `graphs/${subproject.id}.json`;
    await writeSubprojectGraphShard(projectRoot, subproject.id, shard);
    return {
      id: subproject.id,
      root: subproject.root,
      status: shard.nodes.length > 0 ? 'fresh' as const : 'partial' as const,
      languageHints: Array.from(new Set(shard.nodes.flatMap((node) => node.kind === 'file' ? [node.language] : []))),
      shardPath,
      snapshot: subproject.snapshot,
      generation,
      markers: subproject.markers,
    };
  });

  for (const result of refreshed) {
    if (!result) return undefined;
    changedResults.set(result.id, result);
  }

  const manifestSubprojects: GraphManifest['subprojects'] = [];
  const stateSubprojects: WorkspaceGraphState['subprojects'] = [];
  let workspaceStatus: WorkspaceGraphState['status'] = 'fresh';

  for (const subproject of subprojects) {
    const previous = previousById.get(subproject.id);
    if (!previous) return undefined;
    const current = changedResults.get(subproject.id) ?? previous;
    if (current.status !== 'fresh') workspaceStatus = 'partial';
    manifestSubprojects.push({ id: current.id, root: current.root, shardPath: current.shardPath, generation: current.generation });
    stateSubprojects.push(current);
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

  const preparedSubprojects = [];
  for (const subproject of detected) {
    const excludedNestedRoots = nestedSubprojectRoots(subproject, detected);
    const files = await collectWorkspaceSourceFiles(subproject.absoluteRoot, { onUnreadableDirectory: reportUnreadableDirectory, excludeDirectories: excludedNestedRoots });
    const snapshot = await createSubprojectSnapshot(projectRoot, files);
    coverage.indexedFiles += files.length;
    preparedSubprojects.push({ subproject, excludedNestedRoots, snapshot });
  }

  const builtSubprojects = await mapWithConcurrency(preparedSubprojects, getWorkspaceGraphBuildConcurrency(), async ({ subproject, excludedNestedRoots, snapshot }) => {
    const built = await buildSubprojectShardIsolated(projectRoot, subproject.absoluteRoot, subproject.id, subproject.root, subproject.markers, generation, excludedNestedRoots);
    return { subproject, snapshot, built };
  });

  for (const { subproject, snapshot, built } of builtSubprojects) {
    if (built.status !== 'fresh') workspaceStatus = 'partial';
    manifestSubprojects.push({ id: subproject.id, root: subproject.root, shardPath: built.shardPath, generation });
    stateSubprojects.push({
      id: subproject.id,
      root: subproject.root,
      status: built.status,
      languageHints: built.languageHints,
      shardPath: built.shardPath,
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

type GraphLanguage = Exclude<SupportedLanguage, 'auto'>;

interface IsolatedSubprojectBuildResult {
  status: 'fresh' | 'partial';
  languageHints: GraphLanguage[];
  shardPath: string;
}

function getWorkspaceGraphBuildConcurrency(): number {
  if (process.env.VITEST_WORKER_ID) return 1;
  return Math.max(1, Math.floor(availableParallelism() / 2));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function buildSubprojectShardIsolated(
  projectRoot: string,
  subprojectRoot: string,
  subprojectId: string,
  subprojectRelativeRoot: string,
  markers: string[],
  generation: number,
  excludedNestedRoots: string[]
): Promise<IsolatedSubprojectBuildResult> {
  if (getWorkspaceGraphBuildConcurrency() <= 1) {
    const shard = await buildSubprojectShard(projectRoot, subprojectRoot, subprojectId, subprojectRelativeRoot, markers, generation, excludedNestedRoots);
    const shardPath = `graphs/${subprojectId}.json`;
    await writeSubprojectGraphShard(projectRoot, subprojectId, shard);
    return {
      status: shard.nodes.length > 0 ? 'fresh' : 'partial',
      languageHints: Array.from(new Set(shard.nodes.flatMap((node) => node.kind === 'file' ? [node.language] : []))),
      shardPath,
    };
  }

  return buildSubprojectShardInChild(projectRoot, subprojectRoot, subprojectId, subprojectRelativeRoot, markers, generation, excludedNestedRoots);
}

function buildSubprojectShardInChild(
  projectRoot: string,
  subprojectRoot: string,
  subprojectId: string,
  subprojectRelativeRoot: string,
  markers: string[],
  generation: number,
  excludedNestedRoots: string[]
): Promise<IsolatedSubprojectBuildResult> {
  return new Promise((resolve, reject) => {
    const workerPath = fileURLToPath(new URL('./graph-shard-worker.js', import.meta.url));
    const payload = JSON.stringify({ projectRoot, subprojectRoot, subprojectId, subprojectRelativeRoot, markers, generation, excludedNestedRoots });
    const child = spawn(process.execPath, [workerPath, payload], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Workspace graph shard worker failed for ${subprojectRelativeRoot} with code ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as IsolatedSubprojectBuildResult);
      } catch (error) {
        reject(new Error(`Workspace graph shard worker returned invalid JSON for ${subprojectRelativeRoot}: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

export async function buildSubprojectShard(
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

