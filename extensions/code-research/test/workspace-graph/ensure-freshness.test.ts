import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph, ensureWorkspaceGraphFreshness } from '../../src/core/workspace-graph.js';
import { readSubprojectGraphShard } from '../../src/core/graph-persistence.js';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-graph-ensure-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return rootDir;
}

describe('workspace graph ensure freshness', () => {
  it('ensures gitignore even when the graph is already fresh and does not rebuild', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      '.git/HEAD': `ref: refs/heads/main\n`,
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'src/original.ts': `export function original() { return 1; }\n`,
    });

    await buildWorkspaceGraph(rootDir);
    const before = await ensureWorkspaceGraphFreshness(rootDir);
    expect(before.changed).toBe(false);

    const gitignore = await readFile(join(rootDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.pi/workspace-code-graph/');
  });

  it('rebuilds when a new source file appears after the graph was already fresh', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'src/original.ts': `export function original() { return 1; }\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const subprojectId = built.state.subprojects[0]?.id;
    expect(subprojectId).toBeTruthy();
    if (!subprojectId) return;

    const before = await ensureWorkspaceGraphFreshness(rootDir);
    expect(before.changed).toBe(false);

    await writeFile(
      join(rootDir, 'src/probe.ts'),
      `import { original } from './original.js';\nexport function probe() { return original(); }\n`,
      'utf8'
    );

    const after = await ensureWorkspaceGraphFreshness(rootDir);
    expect(after.changed).toBe(true);
    expect(after.state.status).toBe('fresh');

    const shardResult = await readSubprojectGraphShard(rootDir, subprojectId);
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;

    const shard = shardResult.data;
    expect(shard.nodes.some((node) => node.kind === 'file' && node.path === 'src/probe.ts')).toBe(true);
    expect(shard.nodes.some((node) => node.kind === 'symbol' && node.file === 'src/probe.ts' && node.name === 'probe')).toBe(true);
  });
});
