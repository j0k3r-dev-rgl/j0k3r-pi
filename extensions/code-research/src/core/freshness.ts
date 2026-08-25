import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { SubprojectSnapshot } from '../types.js';
import { isMissingFileError, toProjectRelativePath } from './source-policy.js';

export async function createSubprojectSnapshot(projectRoot: string, files: string[]): Promise<SubprojectSnapshot> {
  const snapshot: SubprojectSnapshot = {};
  for (const file of files) {
    try {
      const fileStat = await stat(file);
      const raw = await readFile(file);
      snapshot[toProjectRelativePath(projectRoot, file)] = {
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
        hash: createHash('sha256').update(raw).digest('hex'),
      };
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
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
    return a.mtimeMs !== b.mtimeMs || a.size !== b.size || a.hash !== b.hash;
  }).sort();

  return {
    stale: changedFiles.length > 0,
    changedFiles,
  };
}
