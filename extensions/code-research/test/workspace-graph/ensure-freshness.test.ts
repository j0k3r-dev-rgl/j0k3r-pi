import { describe, expect, it } from 'vitest';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph, ensureWorkspaceGraphFreshness } from '../../src/core/workspace-graph.js';
import { readSubprojectGraphShard, readWorkspaceGraphState, readWorkspaceGraphManifest, writeWorkspaceGraphState } from '../../src/core/graph-persistence.js';
import { ensureWorkspaceGraphReadable } from '../../src/core/graph-ensure.js';
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

  it('reads stale-but-readable graph without scheduling refresh from query paths', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'src/original.ts': `export function original() { return 1; }\n`,
    });

    await buildWorkspaceGraph(rootDir);
    const stateBeforeRead = await readWorkspaceGraphState(rootDir);
    expect(stateBeforeRead.status).toBe('ok');
    if (stateBeforeRead.status !== 'ok') return;
    await writeWorkspaceGraphState(rootDir, { ...stateBeforeRead.data, status: 'stale' });

    const readable = await ensureWorkspaceGraphReadable(rootDir);
    expect(readable.state.status).toBe('ok');
    if (readable.state.status !== 'ok') return;
    expect(readable.state.data.status).toBe('stale');
    expect(readable.manifest.status).toBe('ok');
  });

  it('does not build from query paths when graph artifacts are unreadable', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'src/original.ts': `export function original() { return 1; }\n`,
    });
    await buildWorkspaceGraph(rootDir);
    await writeFile(join(rootDir, '.pi/workspace-code-graph/graph-manifest.json'), '{not-json', 'utf8');

    const readable = await ensureWorkspaceGraphReadable(rootDir);
    expect(readable.state.status).toBe('ok');
    expect(readable.manifest.status).toBe('corrupt');
    expect((await readWorkspaceGraphManifest(rootDir)).status).toBe('corrupt');
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

  it('does not duplicate nested subproject files into ancestor shards', async () => {
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

    const rootShardResult = await readSubprojectGraphShard(rootDir, rootSubproject.id, { generation: rootSubproject.generation });
    expect(rootShardResult.status).toBe('ok');
    if (rootShardResult.status !== 'ok') return;
    expect(rootShardResult.data.nodes.some((node) => node.kind === 'file' && node.path === 'packages/api/src/api.ts')).toBe(false);

    await writeFile(join(rootDir, 'packages/api/src/api.ts'), `export function apiValue() { return 2; }\n`, 'utf8');
    const after = await ensureWorkspaceGraphFreshness(rootDir);
    const preservedRoot = after.state.subprojects.find((subproject) => subproject.id === rootSubproject.id);
    const refreshedApi = after.state.subprojects.find((subproject) => subproject.id === apiSubproject.id);
    expect(preservedRoot?.generation).toBe(rootSubproject.generation);
    expect(refreshedApi?.generation).toBeGreaterThan(apiSubproject.generation);
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

  it('updates an existing file in place when public topology and relationships stay stable', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'src/service.ts': `export function stableService() { return 1; }\n`,
      'src/consumer.ts': `import { stableService } from './service.js';\nexport function consumer() { return stableService(); }\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const subprojectId = built.state.subprojects[0]?.id;
    expect(subprojectId).toBeTruthy();
    if (!subprojectId) return;

    await writeFile(join(rootDir, 'src/service.ts'), `export function stableService() { return 2; }\n`, 'utf8');

    const after = await ensureWorkspaceGraphFreshness(rootDir);
    expect(after.changed).toBe(true);
    const shardResult = await readSubprojectGraphShard(rootDir, subprojectId, { generation: after.state.subprojects[0]?.generation });
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;
    expect(shardResult.data.nodes.filter((node) => node.kind === 'file' && node.path === 'src/service.ts')).toHaveLength(1);
    expect(shardResult.data.edges.every((edge) => shardResult.data.nodes.some((node) => node.id === edge.from) && (edge.to.startsWith('external:') || shardResult.data.nodes.some((node) => node.id === edge.to)))).toBe(true);

    const references = await findReferences(rootDir, {
      path: 'src/service.ts',
      symbol: 'stableService',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
    });
    expect(references).toHaveLength(1);
    expect(references[0]?.file).toBe(join(rootDir, 'src/consumer.ts'));
  });

  it('removes stale graph nodes and edges when a private file is safely deleted', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'src/service.ts': `export function stableService() { return 1; }\n`,
      'src/private.ts': `function privateHelper() { return 1; }\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const subprojectId = built.state.subprojects[0]?.id;
    expect(subprojectId).toBeTruthy();
    if (!subprojectId) return;

    await writeFile(join(rootDir, 'src/private.ts'), '', 'utf8');
    const afterEmpty = await ensureWorkspaceGraphFreshness(rootDir);
    expect(afterEmpty.changed).toBe(true);
    await import('node:fs/promises').then(({ rm }) => rm(join(rootDir, 'src/private.ts')));

    const afterDelete = await ensureWorkspaceGraphFreshness(rootDir);
    expect(afterDelete.changed).toBe(true);
    const shardResult = await readSubprojectGraphShard(rootDir, subprojectId, { generation: afterDelete.state.subprojects[0]?.generation });
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;
    expect(shardResult.data.nodes.some((node) => node.kind === 'file' && node.path === 'src/private.ts')).toBe(false);
    expect(shardResult.data.nodes.some((node) => node.kind === 'symbol' && node.file === 'src/private.ts')).toBe(false);
    expect(shardResult.data.edges.every((edge) => !edge.from.includes('src/private.ts') && !edge.to.includes('src/private.ts'))).toBe(true);
  });

  it('falls back to full shard rebuild when an exported signature changes', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'src/api.ts': `export type ApiValue = { value: number };\nexport function apiValue(input: ApiValue) { return input.value; }\n`,
      'src/consumer.ts': `import { apiValue, type ApiValue } from './api.js';\nexport function consumer(input: ApiValue) { return apiValue(input); }\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const subprojectId = built.state.subprojects[0]?.id;
    expect(subprojectId).toBeTruthy();
    if (!subprojectId) return;

    await writeFile(join(rootDir, 'src/api.ts'), `export type ApiValue = { value: number; label: string };\nexport function apiValue(input: ApiValue, label: string) { return input.value; }\n`, 'utf8');

    const after = await ensureWorkspaceGraphFreshness(rootDir);
    expect(after.changed).toBe(true);
    const shardResult = await readSubprojectGraphShard(rootDir, subprojectId, { generation: after.state.subprojects[0]?.generation });
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;
    const apiFunction = shardResult.data.nodes.find((node) => node.kind === 'symbol' && node.file === 'src/api.ts' && node.name === 'apiValue');
    expect(apiFunction?.kind).toBe('symbol');
    if (apiFunction?.kind !== 'symbol') return;
    expect(apiFunction.signature).toContain('label');
    expect(shardResult.data.edges.some((edge) => edge.reason === 'typescript_type_alias_import' && edge.importSource === './api.js')).toBe(true);
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
