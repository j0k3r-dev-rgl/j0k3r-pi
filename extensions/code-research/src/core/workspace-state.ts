import type { WorkspaceGraphState } from '../types.js';
import { createBaseArtifact } from './graph-schema.js';
import { readWorkspaceGraphState as readState, writeWorkspaceGraphState as writeState } from './graph-persistence.js';

export function createWorkspaceGraphState(input: Omit<WorkspaceGraphState, 'schemaVersion' | 'createdBy' | 'updatedAt'>): WorkspaceGraphState {
  return createBaseArtifact({
    ...input,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadWorkspaceGraphState(projectRoot: string) {
  return readState(projectRoot);
}

export async function writeWorkspaceGraphState(projectRoot: string, state: WorkspaceGraphState) {
  return writeState(projectRoot, {
    ...state,
    updatedAt: new Date().toISOString(),
  });
}
