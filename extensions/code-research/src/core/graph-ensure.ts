import { buildWorkspaceGraph } from './workspace-graph.js';
import { readWorkspaceGraphManifest, readWorkspaceGraphState } from './graph-persistence.js';
import { scheduleWorkspaceGraphRefresh } from './graph-scheduler.js';

const pendingBuilds = new Map<string, Promise<void>>();

async function buildOnce(cwd: string): Promise<void> {
  const existing = pendingBuilds.get(cwd);
  if (existing) return existing;
  const build = buildWorkspaceGraph(cwd).then(() => undefined).finally(() => pendingBuilds.delete(cwd));
  pendingBuilds.set(cwd, build);
  return build;
}

export async function ensureWorkspaceGraphReadable(cwd: string, options?: { refreshStale?: boolean }) {
  let state = await readWorkspaceGraphState(cwd);
  let manifest = await readWorkspaceGraphManifest(cwd);
  if (state.status !== 'ok' || manifest.status !== 'ok') {
    await buildOnce(cwd);
    state = await readWorkspaceGraphState(cwd);
    manifest = await readWorkspaceGraphManifest(cwd);
  } else if (options?.refreshStale && state.status === 'ok' && state.data.status === 'stale') {
    scheduleWorkspaceGraphRefresh(cwd);
  }
  return { state, manifest };
}
