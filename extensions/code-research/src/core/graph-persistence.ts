import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadCodeResearchConfig } from '../config.js';
import type { GraphManifest, SubprojectGraphShard, WorkspaceGraphState } from '../types.js';
import {
  isCompatibleGraphArtifact,
  validateGraphManifest,
  validateSubprojectGraphShard,
  validateWorkspaceGraphState,
} from './graph-schema.js';
import { WORKSPACE_GRAPH_DIR } from './source-policy.js';

export type GraphArtifactReadResult<T = any> =
  | { status: 'missing' }
  | { status: 'corrupt'; error: Error }
  | { status: 'oversized'; error: Error }
  | { status: 'incompatible'; data?: T }
  | { status: 'errored'; error: Error }
  | { status: 'ok'; data: T };

const MAX_GRAPH_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_SUBPROJECT_SHARD_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_SUBPROJECT_SHARD_CACHE_ENTRIES = 8;

interface CachedSubprojectShardEntry {
  cacheKey: string;
  path: string;
  generation: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  data: SubprojectGraphShard;
}

const subprojectShardCache = new Map<string, CachedSubprojectShardEntry>();
let subprojectShardCacheBytes = 0;
const subprojectShardCacheStats = { hits: 0, misses: 0, evictions: 0 };

export async function writeGraphArtifactJson(path: string, value: unknown): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(tempPath, path);
  return path;
}

export async function readGraphArtifactJson<T = any>(path: string): Promise<GraphArtifactReadResult<T>> {
  try {
    const fileStat = await stat(path);
    if (fileStat.size > MAX_GRAPH_ARTIFACT_BYTES) {
      return { status: 'oversized', error: new Error('graph artifact exceeds size limit') };
    }
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw) as T;
    if (data && typeof data === 'object' && 'schemaVersion' in (data as any) && !isCompatibleGraphArtifact(data)) {
      return { status: 'incompatible', data };
    }
    return { status: 'ok', data };
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { status: 'missing' };
    return { status: 'corrupt', error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export function getWorkspaceGraphRoot(projectRoot: string): string {
  return join(projectRoot, WORKSPACE_GRAPH_DIR);
}

export function getWorkspaceStatePath(projectRoot: string): string {
  return join(getWorkspaceGraphRoot(projectRoot), 'workspace-state.json');
}

export function getWorkspaceGraphManifestPath(projectRoot: string): string {
  return join(getWorkspaceGraphRoot(projectRoot), 'graph-manifest.json');
}

export function getSubprojectShardPath(projectRoot: string, subprojectId: string): string {
  return join(getWorkspaceGraphRoot(projectRoot), 'graphs', `${subprojectId}.json`);
}

export async function ensureWorkspaceGraphGitignore(projectRoot: string): Promise<void> {
  const config = await loadCodeResearchConfig(projectRoot);
  if (!config.graph.addGitignore) return;

  const gitPath = join(projectRoot, '.git');
  const gitignorePath = join(projectRoot, '.gitignore');
  const ignoreEntry = '.pi/workspace-code-graph/';

  const gitExists = await stat(gitPath).then(() => true).catch(() => false);
  if (!gitExists) return;

  const existing = await readFile(gitignorePath, 'utf8').catch((error: any) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });

  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(ignoreEntry)) return;

  const content = existing.length === 0
    ? `${ignoreEntry}\n`
    : `${existing}${existing.endsWith('\n') ? '' : '\n'}${ignoreEntry}\n`;
  await writeFile(gitignorePath, content, 'utf8');
}

export async function writeWorkspaceGraphState(projectRoot: string, state: WorkspaceGraphState): Promise<string> {
  await ensureWorkspaceGraphGitignore(projectRoot);
  return writeGraphArtifactJson(getWorkspaceStatePath(projectRoot), state);
}

export async function writeWorkspaceGraphManifest(projectRoot: string, manifest: GraphManifest): Promise<string> {
  await ensureWorkspaceGraphGitignore(projectRoot);
  return writeGraphArtifactJson(getWorkspaceGraphManifestPath(projectRoot), manifest);
}

export async function writeSubprojectGraphShard(
  projectRoot: string,
  subprojectId: string,
  shard: SubprojectGraphShard
): Promise<string> {
  await ensureWorkspaceGraphGitignore(projectRoot);
  const path = getSubprojectShardPath(projectRoot, subprojectId);
  invalidateSubprojectGraphShardCachePath(path);
  return writeGraphArtifactJson(path, shard);
}

export async function readWorkspaceGraphState(projectRoot: string): Promise<GraphArtifactReadResult<WorkspaceGraphState>> {
  const result = await readGraphArtifactJson<WorkspaceGraphState>(getWorkspaceStatePath(projectRoot));
  if (result.status !== 'ok') return result;
  return validateWorkspaceGraphState(result.data) ? result : { status: 'incompatible', data: result.data };
}

export async function readWorkspaceGraphManifest(projectRoot: string): Promise<GraphArtifactReadResult<GraphManifest>> {
  const result = await readGraphArtifactJson<GraphManifest>(getWorkspaceGraphManifestPath(projectRoot));
  if (result.status !== 'ok') return result;
  return validateGraphManifest(result.data) ? result : { status: 'incompatible', data: result.data };
}

export function clearSubprojectGraphShardCache(): void {
  subprojectShardCache.clear();
  subprojectShardCacheBytes = 0;
  subprojectShardCacheStats.hits = 0;
  subprojectShardCacheStats.misses = 0;
  subprojectShardCacheStats.evictions = 0;
}

export function getSubprojectGraphShardCacheStats(): { hits: number; misses: number; evictions: number; entryCount: number; totalBytes: number } {
  return {
    hits: subprojectShardCacheStats.hits,
    misses: subprojectShardCacheStats.misses,
    evictions: subprojectShardCacheStats.evictions,
    entryCount: subprojectShardCache.size,
    totalBytes: subprojectShardCacheBytes,
  };
}

export async function readSubprojectGraphShard(
  projectRoot: string,
  subprojectId: string,
  options?: { generation?: number }
): Promise<GraphArtifactReadResult<SubprojectGraphShard>> {
  const path = getSubprojectShardPath(projectRoot, subprojectId);
  const fileStat = await stat(path).catch((error: any) => {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!fileStat) {
    invalidateSubprojectGraphShardCachePath(path);
    return { status: 'missing' };
  }
  if (fileStat.size > MAX_GRAPH_ARTIFACT_BYTES) {
    invalidateSubprojectGraphShardCachePath(path);
    return { status: 'oversized', error: new Error('graph artifact exceeds size limit') };
  }

  const statEvidence = { size: fileStat.size, mtimeMs: fileStat.mtimeMs, ctimeMs: fileStat.ctimeMs, ino: fileStat.ino };
  invalidateSubprojectGraphShardCachePath(path, statEvidence);
  const requestedGeneration = options?.generation ?? -1;
  const cacheKey = `${path}:${requestedGeneration}:${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}:${fileStat.ino}`;
  const cached = subprojectShardCache.get(cacheKey);
  if (cached) {
    subprojectShardCacheStats.hits += 1;
    touchSubprojectGraphShardCacheEntry(cacheKey, cached);
    return { status: 'ok', data: cached.data };
  }

  subprojectShardCacheStats.misses += 1;
  const result = await readGraphArtifactJson<SubprojectGraphShard>(path);
  if (result.status !== 'ok') {
    invalidateSubprojectGraphShardCachePath(path);
    return result;
  }
  if (!validateSubprojectGraphShard(result.data)) {
    invalidateSubprojectGraphShardCachePath(path);
    return { status: 'incompatible', data: result.data };
  }
  if (options?.generation !== undefined && result.data.generation !== options.generation) {
    invalidateSubprojectGraphShardCachePath(path);
    return { status: 'incompatible', data: result.data };
  }

  cacheSubprojectGraphShard({
    cacheKey,
    path,
    generation: result.data.generation,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    ctimeMs: fileStat.ctimeMs,
    ino: fileStat.ino,
    data: result.data,
  });
  return result;
}

function touchSubprojectGraphShardCacheEntry(cacheKey: string, entry: CachedSubprojectShardEntry): void {
  subprojectShardCache.delete(cacheKey);
  subprojectShardCache.set(cacheKey, entry);
}

function cacheSubprojectGraphShard(entry: CachedSubprojectShardEntry): void {
  if (entry.size > MAX_SUBPROJECT_SHARD_CACHE_BYTES) return;
  const existing = subprojectShardCache.get(entry.cacheKey);
  if (existing) {
    subprojectShardCacheBytes -= existing.size;
    subprojectShardCache.delete(entry.cacheKey);
  }
  while (
    subprojectShardCache.size >= MAX_SUBPROJECT_SHARD_CACHE_ENTRIES ||
    subprojectShardCacheBytes + entry.size > MAX_SUBPROJECT_SHARD_CACHE_BYTES
  ) {
    const oldestKey = subprojectShardCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = subprojectShardCache.get(oldestKey);
    subprojectShardCache.delete(oldestKey);
    if (oldest) {
      subprojectShardCacheBytes -= oldest.size;
      subprojectShardCacheStats.evictions += 1;
    }
  }
  subprojectShardCache.set(entry.cacheKey, entry);
  subprojectShardCacheBytes += entry.size;
}

function invalidateSubprojectGraphShardCachePath(
  path: string,
  statEvidence?: { size: number; mtimeMs: number; ctimeMs: number; ino: number }
): void {
  for (const [cacheKey, entry] of subprojectShardCache.entries()) {
    if (entry.path !== path) continue;
    if (
      statEvidence &&
      entry.size === statEvidence.size &&
      entry.mtimeMs === statEvidence.mtimeMs &&
      entry.ctimeMs === statEvidence.ctimeMs &&
      entry.ino === statEvidence.ino
    ) continue;
    subprojectShardCache.delete(cacheKey);
    subprojectShardCacheBytes -= entry.size;
    subprojectShardCacheStats.evictions += 1;
  }
}
