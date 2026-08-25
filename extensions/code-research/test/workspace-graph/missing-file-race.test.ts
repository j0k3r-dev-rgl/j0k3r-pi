import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-graph-race-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return rootDir;
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('node:fs/promises');
});

describe('workspace graph missing-file race tolerance', () => {
  it('skips java files that disappear between discovery and read', async () => {
    const rootDir = await createProject({
      'pom.xml': '<project />\n',
      'src/main/java/app/Stable.java': 'package app; class Stable {}\n',
      'src/main/java/app/Transient.java': 'package app; class Transient {}\n',
    });
    const transientFile = join(rootDir, 'src/main/java/app/Transient.java');

    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.doMock('node:fs/promises', () => ({
      ...actualFs,
      readFile: vi.fn(async (path: Parameters<typeof actualFs.readFile>[0], ...args: any[]) => {
        if (path === transientFile) {
          const error = new Error(`ENOENT: no such file or directory, open '${transientFile}'`) as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        }
        return (actualFs.readFile as any)(path, ...args);
      }),
    }));

    const { buildWorkspaceGraph } = await import('../../src/core/workspace-graph.js');
    const result = await buildWorkspaceGraph(rootDir);

    expect(result.state.status).toBe('fresh');
    expect(result.state.subprojects).toHaveLength(1);
  });
});
