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
  | { status: 'incompatible'; data?: T }
  | { status: 'errored'; error: Error }
  | { status: 'ok'; data: T };

export async function writeGraphArtifactJson(path: string, value: unknown): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
  return path;
}

export async function readGraphArtifactJson<T = any>(path: string): Promise<GraphArtifactReadResult<T>> {
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw) as T;
    if (data && typeof data === 'object' && 'schemaVersion' in (data as any) && !isCompatibleGraphArtifact(data)) {
      return { status: 'incompatible', data };
    }
    return { status: 'ok', data };
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { status: 'missing' };
    return { status: 'errored', error: error instanceof Error ? error : new Error(String(error)) };
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
  return writeGraphArtifactJson(getSubprojectShardPath(projectRoot, subprojectId), shard);
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

export async function readSubprojectGraphShard(projectRoot: string, subprojectId: string): Promise<GraphArtifactReadResult<SubprojectGraphShard>> {
  const result = await readGraphArtifactJson<SubprojectGraphShard>(getSubprojectShardPath(projectRoot, subprojectId));
  if (result.status !== 'ok') return result;
  return validateSubprojectGraphShard(result.data) ? result : { status: 'incompatible', data: result.data };
}
