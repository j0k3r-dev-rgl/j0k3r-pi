import { describe, expect, it } from 'vitest';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph, ensureWorkspaceGraphFreshness } from '../../src/core/workspace-graph.js';
import { readSubprojectGraphShard, readWorkspaceGraphState, readWorkspaceGraphManifest, writeWorkspaceGraphState } from '../../src/core/graph-persistence.js';
import { ensureWorkspaceGraphReadable } from '../../src/core/graph-ensure.js';
import { workspaceGraphScheduler } from '../../src/core/graph-scheduler.js';
import { findReferences } from '../../src/core/find-references-resolver.js';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-graph-ensure-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  const effectiveFiles = files['.pi/code-research.json'] === undefined
    ? { '.pi/code-research.json': `{"graph":{"enable":true}}\n`, ...files }
    : files;
  for (const [relativePath, content] of Object.entries(effectiveFiles)) {
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

  it('schedules background refresh on stale-but-readable graph without making the current state unreadable', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'src/original.ts': `export function original() { return 1; }\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await writeFile(
      join(rootDir, 'src/probe.ts'),
      `import { original } from './original.js';\nexport function probe() { return original(); }\n`,
      'utf8'
    );
    const stateBeforeSchedule = await readWorkspaceGraphState(rootDir);
    expect(stateBeforeSchedule.status).toBe('ok');
    if (stateBeforeSchedule.status !== 'ok') return;
    await writeWorkspaceGraphState(rootDir, { ...stateBeforeSchedule.data, status: 'stale' });

    const readable = await ensureWorkspaceGraphReadable(rootDir, { refreshStale: true });
    expect(readable.state.status).toBe('ok');
    if (readable.state.status !== 'ok') return;
    expect(readable.state.data.status).toBe('stale');
    expect(readable.manifest.status).toBe('ok');

    const duringRefresh = await readWorkspaceGraphState(rootDir);
    expect(duringRefresh.status).toBe('ok');
    if (duringRefresh.status !== 'ok') return;
    expect(duringRefresh.data.status).toBe('stale');

    await workspaceGraphScheduler.flush();
    const after = await readWorkspaceGraphState(rootDir);
    expect(after.status).toBe('ok');
    if (after.status !== 'ok') return;
    expect(after.data.subprojects.some((subproject) => Object.keys(subproject.snapshot).includes('src/probe.ts'))).toBe(true);
  });

  it('uses a controlled blocking build when graph artifacts are unreadable', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'src/original.ts': `export function original() { return 1; }\n`,
    });
    await buildWorkspaceGraph(rootDir);
    await writeFile(join(rootDir, '.pi/workspace-code-graph/graph-manifest.json'), '{not-json', 'utf8');

    const readable = await ensureWorkspaceGraphReadable(rootDir, { refreshStale: true });
    expect(readable.state.status).toBe('ok');
    expect(readable.manifest.status).toBe('ok');
    expect((await readWorkspaceGraphManifest(rootDir)).status).toBe('ok');
  });

  it('rebuilds only changed subproject shards when a safe source-only diff appears', async () => {
    const rootDir = await createProject({
      'tsconfig.json': `{"compilerOptions":{}}
`,
      'src/root.ts': `export function rootValue() { return 1; }
`,
      'packages/api/package.json': `{"name":"api","type":"module"}
`,
      'packages/api/src/api.ts': `export function apiValue() { return 1; }
`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const rootSubproject = built.state.subprojects.find((subproject) => subproject.root === '.');
    const apiSubproject = built.state.subprojects.find((subproject) => subproject.root === 'packages/api');
    expect(rootSubproject).toBeTruthy();
    expect(apiSubproject).toBeTruthy();
    if (!rootSubproject || !apiSubproject) return;

    const apiShardPath = join(rootDir, '.pi/workspace-code-graph', apiSubproject.shardPath);
    const apiShardStatBefore = await stat(apiShardPath);

    await writeFile(join(rootDir, 'src/root-added.ts'), `export function rootAdded() { return 2; }\n`, 'utf8');

    const after = await ensureWorkspaceGraphFreshness(rootDir);
    expect(after.changed).toBe(true);
    expect(after.state.status).toBe('fresh');

    const refreshedRoot = after.state.subprojects.find((subproject) => subproject.id === rootSubproject.id);
    const preservedApi = after.state.subprojects.find((subproject) => subproject.id === apiSubproject.id);
    expect(refreshedRoot?.generation).toBeGreaterThan(rootSubproject.generation);
    expect(preservedApi?.generation).toBe(apiSubproject.generation);
    expect(after.manifest?.generation).toBe(after.state.generation);
    expect(after.manifest?.subprojects.find((subproject) => subproject.id === apiSubproject.id)?.generation).toBe(apiSubproject.generation);

    const apiShardStatAfter = await stat(apiShardPath);
    expect(apiShardStatAfter.mtimeMs).toBe(apiShardStatBefore.mtimeMs);

    const rootShardResult = await readSubprojectGraphShard(rootDir, rootSubproject.id, { generation: refreshedRoot?.generation });
    expect(rootShardResult.status).toBe('ok');
    if (rootShardResult.status !== 'ok') return;
    expect(rootShardResult.data.nodes.some((node) => node.kind === 'file' && node.path === 'src/root-added.ts')).toBe(true);

    const apiShardResult = await readSubprojectGraphShard(rootDir, apiSubproject.id, { generation: apiSubproject.generation });
    expect(apiShardResult.status).toBe('ok');
  });

  it('serves graph-backed references from refreshed shards after a safe incremental update', async () => {
    const rootDir = await createProject({
      'tsconfig.json': `{"compilerOptions":{}}
`,
      'src/service.ts': `export function rootService(): void {}\n`,
      'packages/api/package.json': `{"name":"api","type":"module"}
`,
      'packages/api/src/api.ts': `export function apiValue() { return 1; }\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await writeFile(
      join(rootDir, 'src/consumer.ts'),
      `import { rootService } from './service.js';\n\nexport function useRoot(): void {\n  rootService();\n}\n`,
      'utf8'
    );

    const refreshed = await ensureWorkspaceGraphFreshness(rootDir);
    expect(refreshed.changed).toBe(true);

    const results = await findReferences(rootDir, {
      path: 'src/service.ts',
      symbol: 'rootService',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      file: join(rootDir, 'src/consumer.ts'),
      line: 4,
      reference_kind: 'call',
      context_symbol: 'useRoot',
    });
  });

  it('rebuilds when topology changes instead of preserving mixed stale shards', async () => {
    const rootDir = await createProject({
      'tsconfig.json': `{"compilerOptions":{}}
`,
      'src/root.ts': `export function rootValue() { return 1; }\n`,
      'packages/api/package.json': `{"name":"api","type":"module"}
`,
      'packages/api/src/api.ts': `export function apiValue() { return 1; }\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const apiSubproject = built.state.subprojects.find((subproject) => subproject.root === 'packages/api');
    expect(apiSubproject).toBeTruthy();
    if (!apiSubproject) return;
    const apiShardPath = join(rootDir, '.pi/workspace-code-graph', apiSubproject.shardPath);
    const apiShardStatBefore = await stat(apiShardPath);

    await mkdir(join(rootDir, 'packages/worker/src'), { recursive: true });
    await writeFile(join(rootDir, 'packages/worker/package.json'), `{"name":"worker","type":"module"}\n`, 'utf8');
    await writeFile(join(rootDir, 'packages/worker/src/worker.ts'), `export function worker() { return 1; }\n`, 'utf8');

    const after = await ensureWorkspaceGraphFreshness(rootDir);
    expect(after.changed).toBe(true);
    expect(after.state.subprojects.some((subproject) => subproject.root === 'packages/worker')).toBe(true);
    expect(after.state.subprojects.every((subproject) => subproject.generation === after.state.generation)).toBe(true);

    const apiShardStatAfter = await stat(apiShardPath);
    expect(apiShardStatAfter.mtimeMs).toBeGreaterThanOrEqual(apiShardStatBefore.mtimeMs);
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
