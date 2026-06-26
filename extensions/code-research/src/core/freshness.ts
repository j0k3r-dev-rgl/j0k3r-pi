import { stat } from 'node:fs/promises';
import type { SubprojectSnapshot } from '../types.js';
import { toProjectRelativePath } from './source-policy.js';

export async function createSubprojectSnapshot(projectRoot: string, files: string[]): Promise<SubprojectSnapshot> {
  const snapshot: SubprojectSnapshot = {};
  for (const file of files) {
    const fileStat = await stat(file);
    snapshot[toProjectRelativePath(projectRoot, file)] = {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
    };
  }
  return snapshot;
}

export function compareSubprojectSnapshot(previous: SubprojectSnapshot, next: SubprojectSnapshot): {
  stale: boolean;
  changedFiles: string[];
} {
  const allKeys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changedFiles = [...allKeys].filter((key) => {
    const a = previous[key];
    const b = next[key];
    if (!a || !b) return true;
    return a.mtimeMs !== b.mtimeMs || a.size !== b.size;
  }).sort();

  return {
    stale: changedFiles.length > 0,
    changedFiles,
  };
}
