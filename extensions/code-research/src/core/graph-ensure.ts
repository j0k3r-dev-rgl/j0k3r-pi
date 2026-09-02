import { readWorkspaceGraphManifest, readWorkspaceGraphState } from './graph-persistence.js';

export async function ensureWorkspaceGraphReadable(cwd: string) {
  const state = await readWorkspaceGraphState(cwd);
  const manifest = await readWorkspaceGraphManifest(cwd);
  return { state, manifest };
}
