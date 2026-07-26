import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createSubprojectId } from './graph-schema.js';
import { isExcludedPath, isPathWithinRoot, toProjectRelativePath } from './source-policy.js';

export const SUBPROJECT_MARKERS = [
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'pom.xml',
  'build.gradle',
  'settings.gradle',
  'go.mod',
  'go.work',
  'pyproject.toml',
  'uv.lock',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'requirements-dev.txt',
  'requirements-test.txt',
  'Pipfile',
  'poetry.lock',
] as const;

export interface DetectedSubproject {
  id: string;
  root: string;
  absoluteRoot: string;
  markers: string[];
  implicit: boolean;
}

export async function detectWorkspaceSubprojects(
  projectRoot: string,
  options?: { onUnreadableDirectory?: (dir: string, error: NodeJS.ErrnoException) => void }
): Promise<DetectedSubproject[]> {
  const candidates: Array<{ absoluteRoot: string; markers: string[] }> = [];
  await walk(projectRoot, projectRoot, async (dir) => {
    const markers = await findMarkers(dir);
    if (markers.length > 0) {
      candidates.push({ absoluteRoot: dir, markers });
    }
  }, options);

  const filtered = candidates
    .sort((a, b) => a.absoluteRoot.length - b.absoluteRoot.length)
    .filter((candidate, index, array) => {
      return !array.some((other, otherIndex) => {
        if (otherIndex === index) return false;
        if (other.absoluteRoot === candidate.absoluteRoot) return false;
        return candidate.absoluteRoot.startsWith(`${other.absoluteRoot}/`) && other.markers.some((m) => candidate.markers.includes(m));
      });
    });

  if (filtered.length === 0) {
    return [{ id: createSubprojectId('.'), root: '.', absoluteRoot: projectRoot, markers: [], implicit: true }];
  }

  return filtered.map((candidate) => {
    const root = toProjectRelativePath(projectRoot, candidate.absoluteRoot);
    return {
      id: createSubprojectId(root),
      root,
      absoluteRoot: candidate.absoluteRoot,
      markers: candidate.markers,
      implicit: false,
    };
  });
}

async function walk(
  projectRoot: string,
  dir: string = projectRoot,
  onDir?: (dir: string) => Promise<void>,
  options?: { onUnreadableDirectory?: (dir: string, error: NodeJS.ErrnoException) => void }
): Promise<void> {
  if (!isPathWithinRoot(projectRoot, dir) || isExcludedPath(projectRoot, dir)) return;
  await onDir?.(dir);

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'ENOENT') {
      options?.onUnreadableDirectory?.(dir, error as NodeJS.ErrnoException);
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await walk(projectRoot, join(dir, entry.name), onDir, options);
  }
}

async function findMarkers(dir: string): Promise<string[]> {
  const found: string[] = [];
  await Promise.all(
    SUBPROJECT_MARKERS.map(async (marker) => {
      try {
        await access(join(dir, marker));
        found.push(marker);
      } catch {}
    })
  );
  return found.sort();
}
