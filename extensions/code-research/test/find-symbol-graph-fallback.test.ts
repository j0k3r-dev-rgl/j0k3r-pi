import { describe, it, expect } from 'vitest';
import { mkdir, readFile, rm, stat, truncate, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  clearFindSymbolGraphQueryCache,
  findSymbol,
  getFindSymbolGraphQueryCacheStats,
  GRAPH_FILE_VALIDATION_CONCURRENCY,
  resolveFindSymbol,
  validateGraphAuthorityForFiles,
} from '../src/core/find-symbol-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import {
  clearSubprojectGraphShardCache,
  getSubprojectGraphShardCacheStats,
  getSubprojectShardPath,
} from '../src/core/graph-persistence.js';
import { loadWorkspaceGraphState, writeWorkspaceGraphState } from '../src/core/workspace-state.js';
import { normalizeSymbolResults } from './helpers/typescript-symbol-parity.js';

async function createProject(files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `pi-find-symbol-graph-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('findSymbol graph fallback', () => {
  it('validates shard file authority with bounded concurrency while preserving ordered stale mismatches', async () => {
    const cwd = '/virtual/workspace';
    const totalFiles = GRAPH_FILE_VALIDATION_CONCURRENCY * 2;
    const files = Array.from({ length: totalFiles }, (_, index) => `${cwd}/src/file-${index}.ts`);
    const mismatchIndex = Math.floor(totalFiles / 2);
    const snapshotByFile = new Map(files.map((filePath, index) => [filePath, {
      hash: `hash-${index}`,
      mtimeMs: index + 1,
      size: 100 + index,
      subprojectId: 'subproject-a',
    }]));
    const fileNodes = new Set(files.map((filePath) => filePath.slice(cwd.length + 1)));
    const completeFiles = [...fileNodes];
    const fileProofs = Object.fromEntries(completeFiles.map((rel, index) => [rel, { sourceHash: `hash-${index}`, symbolCount: 1 }]));
    const symbolsByFile = new Map(completeFiles.map((rel, index) => [rel, [{
      kind: 'symbol',
      id: `symbol-${index}`,
      language: 'ts',
      file: rel,
      name: `target_${index}`,
      exported: true,
      symbolKind: 'function',
      declarationKind: 'function',
      qualifiedName: `target_${index}`,
      owner: undefined,
      modifiers: [],
      isDefinition: true,
      isImplementation: true,
      sourceHash: `hash-${index}`,
      symbolId: `symbol-id-${index}`,
      range: {
        startLine: index + 1,
        startColumn: 0,
        endLine: index + 1,
        endColumn: 20,
      },
      signature: `function target_${index}(): void`,
    } as any]]));
    const coverage = {
      generation: 7,
      modelVersion: 1,
      compilerModelVersion: 1,
      grammar: { typescript: '0.23.2', tsx: '0.23.2' },
      completeFiles,
      skippedFiles: [],
      fileProofs,
    } as any;
    const waitMs = 5;
    let active = 0;
    let maxActive = 0;
    const orderedStatuses: Array<{ filePath: string; issue?: string }> = [];

    const validations = await validateGraphAuthorityForFiles(cwd, files, {
      snapshotByFile,
      fileNodes,
      symbolsByFile,
      coverage,
      generation: 7,
    }, {
      statFile: async (filePath) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        active -= 1;
        const index = Number(String(filePath).match(/file-(\d+)\.ts$/)?.[1] ?? '-1');
        return { size: 100 + index, mtimeMs: index + 1, ctimeMs: index + 1, ino: index + 1 } as any;
      },
      readSourceHash: async (filePath) => {
        const index = Number(String(filePath).match(/file-(\d+)\.ts$/)?.[1] ?? '-1');
        return index === mismatchIndex ? `mismatch-${index}` : `hash-${index}`;
      },
    });

    for (const result of validations) orderedStatuses.push({ filePath: result.filePath, issue: result.issue });

    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(GRAPH_FILE_VALIDATION_CONCURRENCY);
    expect(orderedStatuses).toHaveLength(totalFiles);
    expect(orderedStatuses[mismatchIndex]).toEqual({ filePath: files[mismatchIndex], issue: 'snapshot_mismatch' });
    expect(orderedStatuses.filter((entry) => entry.issue === 'snapshot_mismatch')).toEqual([{ filePath: files[mismatchIndex], issue: 'snapshot_mismatch' }]);
    expect(validations[0]?.records?.[0]?.symbolId).toBe('symbol-id-0');
    expect(validations.at(-1)?.records?.[0]?.symbolId).toBe(`symbol-id-${totalFiles - 1}`);
  });

  it('reports exact graph-state diagnostics and preserves direct parity across shard failure modes', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function targetService(): void {}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const cases = [
      {
        name: 'fresh',
        mutate: async () => {},
        expected: { source_mode: 'graph', graph_status: 'fresh', completeness: 'complete', fallback_reason: null, unreadable_shards_count: 0, skipped_files_count: 0 },
      },
      {
        name: 'snapshot mismatch',
        mutate: async () => { await writeFile(join(rootDir, 'src/service.ts'), `export function targetServiceFresh(): void {}\n`, 'utf8'); },
        expected: { source_mode: 'direct', graph_status: 'stale', completeness: 'fallback', fallback_reason: 'snapshot_mismatch', unreadable_shards_count: 0, skipped_files_count: 0 },
      },
      {
        name: 'missing shard',
        mutate: async () => {
          const state = await loadWorkspaceGraphState(rootDir);
          expect(state.status).toBe('ok');
          if (state.status !== 'ok') return;
          await rm(getSubprojectShardPath(rootDir, state.data.subprojects[0].id), { force: true });
        },
        expected: { source_mode: 'direct', graph_status: 'missing', completeness: 'fallback', fallback_reason: 'shard_missing', unreadable_shards_count: 0, skipped_files_count: 0 },
      },
      {
        name: 'corrupt shard',
        mutate: async () => {
          const state = await loadWorkspaceGraphState(rootDir);
          expect(state.status).toBe('ok');
          if (state.status !== 'ok') return;
          await writeFile(getSubprojectShardPath(rootDir, state.data.subprojects[0].id), '{corrupt', 'utf8');
        },
        expected: { source_mode: 'direct', graph_status: 'error', completeness: 'fallback', fallback_reason: 'shard_corrupt', unreadable_shards_count: 0, skipped_files_count: 0 },
      },
      {
        name: 'incompatible shard',
        mutate: async () => {
          const state = await loadWorkspaceGraphState(rootDir);
          expect(state.status).toBe('ok');
          if (state.status !== 'ok') return;
          const path = getSubprojectShardPath(rootDir, state.data.subprojects[0].id);
          const artifact = JSON.parse(await readFile(path, 'utf8'));
          await writeFile(path, `${JSON.stringify({ ...artifact, schemaVersion: 1 })}\n`, 'utf8');
        },
        expected: { source_mode: 'direct', graph_status: 'incompatible', completeness: 'fallback', fallback_reason: 'shard_incompatible', unreadable_shards_count: 0, skipped_files_count: 0 },
      },
      {
        name: 'partial state',
        mutate: async () => {
          const state = await loadWorkspaceGraphState(rootDir);
          expect(state.status).toBe('ok');
          if (state.status !== 'ok') return;
          await writeWorkspaceGraphState(rootDir, { ...state.data, status: 'partial' });
        },
        expected: { source_mode: 'hybrid', graph_status: 'partial', completeness: 'fallback', fallback_reason: 'graph_partial', unreadable_shards_count: 0, skipped_files_count: 0 },
      },
    ] as const;

    for (const testCase of cases) {
      await buildWorkspaceGraph(rootDir);
      await testCase.mutate();
      await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":false}}\n', 'utf8');
      const currentDirect = await resolveFindSymbol(rootDir, { path: 'src/service.ts', symbol: 'target', language: 'ts', search_mode: 'contains' });
      await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
      const resolution = await resolveFindSymbol(rootDir, { path: 'src/service.ts', symbol: 'target', language: 'ts', search_mode: 'contains' });
      expect(normalizeSymbolResults(resolution.results)).toEqual(normalizeSymbolResults(currentDirect.results));
      expect(resolution.diagnostics).toMatchObject(testCase.expected);
    }
  });

  it('detects source-hash mismatch even when size and mtime are preserved', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function targetAlpha(): void {}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    const file = join(rootDir, 'src/service.ts');
    const before = await stat(file);
    await writeFile(file, `export function targetBravo(): void {}\n`, 'utf8');
    await utimes(file, before.atime, before.mtime);
    const after = await stat(file);
    const state = await loadWorkspaceGraphState(rootDir);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    const relative = 'src/service.ts';
    const subproject = state.data.subprojects[0];
    await writeWorkspaceGraphState(rootDir, {
      ...state.data,
      subprojects: [{
        ...subproject,
        snapshot: {
          ...subproject.snapshot,
          [relative]: { ...subproject.snapshot[relative], size: after.size, mtimeMs: after.mtimeMs },
        },
      }],
    });

    const resolution = await resolveFindSymbol(rootDir, { path: 'src/service.ts', symbol: 'target', language: 'ts', search_mode: 'contains' });
    expect(resolution.results.map((result) => result.symbol)).toEqual(['targetBravo']);
    expect(resolution.diagnostics).toMatchObject({
      source_mode: 'direct',
      graph_status: 'stale',
      completeness: 'fallback',
      fallback_reason: 'snapshot_mismatch',
      unreadable_shards_count: 0,
      skipped_files_count: 0,
    });
  });

  it('counts unreadable shards rather than files affected by one corrupt shard', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/a.ts': `export function targetA(): void {}\n`,
      'src/b.ts': `export function targetB(): void {}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    const state = await loadWorkspaceGraphState(rootDir);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    await writeFile(getSubprojectShardPath(rootDir, state.data.subprojects[0].id), '{corrupt', 'utf8');

    const resolution = await resolveFindSymbol(rootDir, { path: 'src', symbol: 'target', language: 'ts', search_mode: 'contains' });
    expect(resolution.results.map((result) => result.symbol).sort()).toEqual(['targetA', 'targetB']);
    expect(resolution.diagnostics).toMatchObject({
      source_mode: 'direct',
      graph_status: 'error',
      completeness: 'fallback',
      fallback_reason: 'shard_corrupt',
      unreadable_shards_count: 0,
      skipped_files_count: 0,
    });
  });

  it('reports mixed-shard hybrid fallback without losing direct parity', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'tsconfig.json': `{"compilerOptions":{"target":"ES2022"}}\n`,
      'packages/a/package.json': `{"name":"a"}\n`,
      'packages/a/src/a.ts': `export function serviceA(): void {}\n`,
      'packages/b/pom.xml': `<project />\n`,
      'packages/b/src/b.ts': `export function serviceB(): void {}\n`,
    });

    await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":false}}\n', 'utf8');
    const direct = await resolveFindSymbol(rootDir, { path: 'packages', symbol: 'service', language: 'ts', search_mode: 'contains' });
    await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
    await buildWorkspaceGraph(rootDir);
    const state = await loadWorkspaceGraphState(rootDir);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    const broken = state.data.subprojects.find((subproject) => subproject.root.includes('packages/b'));
    expect(broken).toBeTruthy();
    if (!broken) return;
    await writeFile(getSubprojectShardPath(rootDir, broken.id), '{corrupt', 'utf8');

    const resolution = await resolveFindSymbol(rootDir, { path: 'packages', symbol: 'service', language: 'ts', search_mode: 'contains' });
    expect(normalizeSymbolResults(resolution.results)).toEqual(normalizeSymbolResults(direct.results));
    expect(resolution.diagnostics).toMatchObject({
      source_mode: 'hybrid',
      graph_status: 'error',
      completeness: 'fallback',
      fallback_reason: 'shard_corrupt',
      unreadable_shards_count: 0,
      skipped_files_count: 0,
    });
  });

  it('preserves private-name modifiers in fresh graph results', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/private.ts': `class Vault {\n  #secret = 1;\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    const results = await findSymbol(rootDir, { path: 'src/private.ts', symbol: 'secret', language: 'ts' });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ declaration_kind: 'field', source_name: '#secret', modifiers: ['private'] });
  });

  it('reports exact Java graph fallback diagnostics across fresh stale partial missing corrupt incompatible oversized snapshot and unproven states', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/app/Service.java': `package app;\n\npublic class Service {\n  public String targetValue() {\n    return "value";\n  }\n}\n`,
    });

    const cases = [
      {
        name: 'fresh',
        mutate: async () => {},
        expected: { source_mode: 'graph', graph_status: 'fresh', completeness: 'complete', fallback_reason: null },
      },
      {
        name: 'stale state',
        mutate: async () => {
          const state = await loadWorkspaceGraphState(rootDir);
          expect(state.status).toBe('ok');
          if (state.status !== 'ok') return;
          await writeWorkspaceGraphState(rootDir, { ...state.data, status: 'stale' });
        },
        expected: { source_mode: 'direct', graph_status: 'stale', completeness: 'fallback', fallback_reason: 'graph_stale' },
      },
      {
        name: 'snapshot mismatch',
        mutate: async () => {
          await writeFile(join(rootDir, 'src/main/java/app/Service.java'), `package app;\n\npublic class Service {\n  public String targetValueFresh() {\n    return "value";\n  }\n}\n`, 'utf8');
        },
        expected: { source_mode: 'direct', graph_status: 'stale', completeness: 'fallback', fallback_reason: 'snapshot_mismatch' },
      },
      {
        name: 'missing shard',
        mutate: async () => {
          const state = await loadWorkspaceGraphState(rootDir);
          expect(state.status).toBe('ok');
          if (state.status !== 'ok') return;
          await rm(getSubprojectShardPath(rootDir, state.data.subprojects[0].id), { force: true });
        },
        expected: { source_mode: 'direct', graph_status: 'missing', completeness: 'fallback', fallback_reason: 'shard_missing' },
      },
      {
        name: 'corrupt shard',
        mutate: async () => {
          const state = await loadWorkspaceGraphState(rootDir);
          expect(state.status).toBe('ok');
          if (state.status !== 'ok') return;
          await writeFile(getSubprojectShardPath(rootDir, state.data.subprojects[0].id), '{corrupt', 'utf8');
        },
        expected: { source_mode: 'direct', graph_status: 'error', completeness: 'fallback', fallback_reason: 'shard_corrupt' },
      },
      {
        name: 'incompatible shard',
        mutate: async () => {
          const state = await loadWorkspaceGraphState(rootDir);
          expect(state.status).toBe('ok');
          if (state.status !== 'ok') return;
          const path = getSubprojectShardPath(rootDir, state.data.subprojects[0].id);
          const artifact = JSON.parse(await readFile(path, 'utf8'));
          await writeFile(path, `${JSON.stringify({ ...artifact, schemaVersion: 1 })}\n`, 'utf8');
        },
        expected: { source_mode: 'direct', graph_status: 'incompatible', completeness: 'fallback', fallback_reason: 'shard_incompatible' },
      },
      {
        name: 'oversized shard',
        mutate: async () => {
          const state = await loadWorkspaceGraphState(rootDir);
          expect(state.status).toBe('ok');
          if (state.status !== 'ok') return;
          const path = getSubprojectShardPath(rootDir, state.data.subprojects[0].id);
          await writeFile(path, '{}', 'utf8');
          await truncate(path, 256 * 1024 * 1024 + 1);
        },
        expected: { source_mode: 'direct', graph_status: 'error', completeness: 'fallback', fallback_reason: 'shard_oversized' },
      },
      {
        name: 'partial state',
        mutate: async () => {
          const state = await loadWorkspaceGraphState(rootDir);
          expect(state.status).toBe('ok');
          if (state.status !== 'ok') return;
          await writeWorkspaceGraphState(rootDir, { ...state.data, status: 'partial' });
        },
        expected: { source_mode: 'hybrid', graph_status: 'partial', completeness: 'fallback', fallback_reason: 'graph_partial' },
      },
      {
        name: 'coverage unproven',
        mutate: async () => {
          const state = await loadWorkspaceGraphState(rootDir);
          expect(state.status).toBe('ok');
          if (state.status !== 'ok') return;
          const path = getSubprojectShardPath(rootDir, state.data.subprojects[0].id);
          const artifact = JSON.parse(await readFile(path, 'utf8'));
          delete artifact.javaSymbolCoverage;
          await writeFile(path, `${JSON.stringify(artifact)}\n`, 'utf8');
        },
        expected: { source_mode: 'direct', graph_status: 'partial', completeness: 'fallback', fallback_reason: 'coverage_unproven' },
      },
    ] as const;

    for (const testCase of cases) {
      await buildWorkspaceGraph(rootDir);
      await testCase.mutate();
      await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":false}}\n', 'utf8');
      const direct = await resolveFindSymbol(rootDir, { path: 'src/main/java/app/Service.java', symbol: 'target', language: 'java', search_mode: 'contains' });
      await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
      const resolution = await resolveFindSymbol(rootDir, { path: 'src/main/java/app/Service.java', symbol: 'target', language: 'java', search_mode: 'contains' });
      expect(normalizeSymbolResults(resolution.results)).toEqual(normalizeSymbolResults(direct.results));
      expect(resolution.diagnostics).toMatchObject(testCase.expected);
    }
  });

  it('falls back to direct lookup when the graph is stale', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function oldHelper(): void {}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await writeFile(join(rootDir, 'src/service.ts'), `export function freshHelper(): void {}\n`, 'utf8');

    const state = await loadWorkspaceGraphState(rootDir);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    await writeWorkspaceGraphState(rootDir, { ...state.data, status: 'stale' });

    const results = await findSymbol(rootDir, {
      path: 'src/service.ts',
      symbol: 'freshHelper',
      language: 'ts',
      include_signature: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('freshHelper');
    expect(results[0].signature).toContain('freshHelper');
  });

  it('reuses safely validated shard reads across repeated unchanged warm graph queries', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function runService(): void { helper(); }\nfunction helper(): void {}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    clearSubprojectGraphShardCache();
    clearFindSymbolGraphQueryCache();

    const first = await findSymbol(rootDir, {
      path: 'src/service.ts',
      symbol: 'runService',
      language: 'ts',
      include_code: true,
      include_signature: true,
    });
    const afterFirst = getSubprojectGraphShardCacheStats();
    const queryCacheAfterFirst = getFindSymbolGraphQueryCacheStats();

    const second = await findSymbol(rootDir, {
      path: 'src/service.ts',
      symbol: 'runService',
      language: 'ts',
      include_code: true,
      include_signature: true,
    });
    const afterSecond = getSubprojectGraphShardCacheStats();
    const queryCacheAfterSecond = getFindSymbolGraphQueryCacheStats();

    expect(first).toEqual(second);
    expect(afterFirst.misses).toBeGreaterThan(0);
    expect(afterFirst.hits).toBe(0);
    expect(afterFirst.entryCount).toBeGreaterThan(0);
    expect(afterSecond.misses).toBe(afterFirst.misses);
    expect(afterSecond.hits).toBeGreaterThan(afterFirst.hits);
    expect(queryCacheAfterFirst.misses).toBeGreaterThan(0);
    expect(queryCacheAfterFirst.hits).toBe(0);
    expect(queryCacheAfterSecond.misses).toBe(queryCacheAfterFirst.misses);
    expect(queryCacheAfterSecond.hits).toBeGreaterThan(queryCacheAfterFirst.hits);
    expect(second).toHaveLength(1);
    expect(second[0].symbol).toBe('runService');
    expect(second[0].signature).toContain('runService');
    expect(second[0].code).toContain('helper();');
  });

  it('invalidates cached shard and canonical query data after rebuild or corrupt replacement', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function beforeRebuild(): void {}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    clearSubprojectGraphShardCache();
    clearFindSymbolGraphQueryCache();
    expect(await findSymbol(rootDir, { path: 'src', symbol: 'beforeRebuild', language: 'ts' })).toHaveLength(1);

    await writeFile(join(rootDir, 'src/service.ts'), `export function afterRebuild(): void {}\n`, 'utf8');
    await buildWorkspaceGraph(rootDir);
    expect(await findSymbol(rootDir, { path: 'src', symbol: 'afterRebuild', language: 'ts' })).toHaveLength(1);

    const state = await loadWorkspaceGraphState(rootDir);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    const shardPath = getSubprojectShardPath(rootDir, state.data.subprojects[0].id);
    await writeFile(shardPath, '{corrupt', 'utf8');

    const fallback = await findSymbol(rootDir, { path: 'src', symbol: 'afterRebuild', language: 'ts' });
    expect(fallback).toHaveLength(1);
    expect(getSubprojectGraphShardCacheStats().entryCount).toBe(0);
  });

  it('bounds cached shards with LRU eviction and supports explicit clear for monorepos', async () => {
    clearSubprojectGraphShardCache();
    clearFindSymbolGraphQueryCache();

    for (let index = 0; index < 9; index += 1) {
      const rootDir = await createProject({
        '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
        'src/service.ts': `export function service${index}(): void {}\n`,
      });
      await buildWorkspaceGraph(rootDir);
      await findSymbol(rootDir, { path: 'src', symbol: `service${index}`, language: 'ts' });
    }

    const bounded = getSubprojectGraphShardCacheStats();
    expect(bounded.entryCount).toBeLessThanOrEqual(8);
    expect(bounded.evictions).toBeGreaterThan(0);

    clearSubprojectGraphShardCache();
    clearFindSymbolGraphQueryCache();
    expect(getSubprojectGraphShardCacheStats()).toMatchObject({ entryCount: 0, totalBytes: 0 });
    expect(getFindSymbolGraphQueryCacheStats()).toMatchObject({ hits: 0, misses: 0 });
  });

  it('indexes exported TSX arrow function components in the fresh graph', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/ImageUploader.tsx': `export const ImageUploader = ({ label }: { label: string }) => {\n  return <section><span>{label}</span></section>;\n};\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findSymbol(rootDir, {
      path: 'src/ImageUploader.tsx',
      symbol: 'ImageUploader',
      language: 'ts',
      kind: 'function',
      include_signature: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('ImageUploader');
    expect(results[0].file).toBe(join(rootDir, 'src/ImageUploader.tsx'));
    expect(results[0].signature).toContain('ImageUploader');
  });

  it('indexes TSX components with separate default identifier exports in the fresh graph', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/ImageUploader.tsx': `const ImageUploader = ({ label }: { label: string }) => {\n  return <section><span>{label}</span></section>;\n};\n\nexport default ImageUploader;\n`,
      'src/documentacion.tsx': `import Uploader from './ImageUploader';\n\nexport function Documentation() {\n  return <Uploader name="file" label="Documento" />;\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findSymbol(rootDir, {
      path: 'src/ImageUploader.tsx',
      symbol: 'ImageUploader',
      language: 'ts',
      kind: 'function',
      include_signature: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('ImageUploader');
    expect(results[0].signature).toContain('ImageUploader');
  });

  it('does not classify arbitrary wrapped TSX components as callable without configured wrappers', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/ImageUploader.tsx': `declare function withWidgetBehavior<T>(value: T): T;\n\nexport const ImageUploader = withWidgetBehavior(({ label }: { label: string }) => {\n  return <section><span>{label}</span></section>;\n});\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findSymbol(rootDir, {
      path: 'src/ImageUploader.tsx',
      symbol: 'ImageUploader',
      language: 'ts',
      kind: 'function',
      include_signature: true,
    });

    expect(results).toHaveLength(0);
  });

  it('finds TSX arrow function components with direct fallback when no graph exists', async () => {
    const rootDir = await createProject({
      'src/ImageUploader.tsx': `export const ImageUploader = ({ label }: { label: string }) => {\n  return <section><span>{label}</span></section>;\n};\n`,
    });

    const results = await findSymbol(rootDir, {
      path: 'src/ImageUploader.tsx',
      symbol: 'ImageUploader',
      language: 'ts',
      kind: 'function',
      include_signature: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('ImageUploader');
    expect(results[0].file).toBe(join(rootDir, 'src/ImageUploader.tsx'));
    expect(results[0].signature).toContain('ImageUploader');
  });

  it('uses fresh java graph authority for additive declaration kinds and package-aware parity', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/app/annotations/Adapter.java': `package app.annotations;\npublic @interface Adapter {}\n`,
      'src/main/java/app/domain/UserDraft.java': `package app.domain;\npublic record UserDraft(String email) {}\n`,
      'src/main/java/app/domain/UserKind.java': `package app.domain;\npublic enum UserKind { ADMIN, USER }\n`,
      'src/main/java/app/service/Example.java': `package app.service;\npublic class Example {\n  private int first = 1, second = 2;\n  public void run(String value) { int localValue = value.length(); }\n}\n`,
      'src/main/java/app/service/package-info.java': `package app.service;\n`,
      'src/main/java/module-info.java': `module app.module { }\n`,
    });

    await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":false}}\n', 'utf8');
    const direct = await resolveFindSymbol(rootDir, { path: 'src/main/java', symbol: 'User', language: 'java', search_mode: 'contains' });

    await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
    await buildWorkspaceGraph(rootDir);
    const graph = await resolveFindSymbol(rootDir, { path: 'src/main/java', symbol: 'User', language: 'java', search_mode: 'contains' });
    const packageQuery = await resolveFindSymbol(rootDir, { path: 'src/main/java', symbol: 'app.service', language: 'java', search_mode: 'exact' });
    const moduleQuery = await resolveFindSymbol(rootDir, { path: 'src/main/java', symbol: 'app.module', language: 'java', declaration_kind: 'module' });

    expect(normalizeSymbolResults(graph.results)).toEqual(normalizeSymbolResults(direct.results));
    expect(graph.diagnostics).toMatchObject({ source_mode: 'graph', graph_status: 'fresh', completeness: 'complete', fallback_reason: null });
    expect(packageQuery.results[0]).toMatchObject({ declaration_kind: 'package', kind: 'variable' });
    expect(moduleQuery.results[0]).toMatchObject({ declaration_kind: 'module', kind: 'variable' });
  });

  it('keeps fresh interface diagnostics truthful when direct canonical context is still required', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/contracts/Service.ts': `export interface Service { run(): void; }\nexport class Impl implements Service { run(): void {} }\n`,
    });

    await buildWorkspaceGraph(rootDir);
    const resolution = await resolveFindSymbol(rootDir, {
      path: 'src/contracts/Service.ts',
      symbol: 'Service',
      language: 'ts',
      kind: 'interface',
    });

    expect(resolution.results).toHaveLength(1);
    expect(resolution.diagnostics.graph_status).toBe('fresh');
    expect(resolution.diagnostics.source_mode).toBe('hybrid');
    expect(resolution.diagnostics.fallback_reason).not.toBe('graph_disabled');
  });

  it('uses fresh java graph authority for mixed-case file paths without fallback', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/app/B.java': `package app;\n\npublic class B {\n  public void targetUpper() {}\n}\n`,
      'src/main/java/app/b.java': `package app;\n\npublic class b {\n  public void targetLower() {}\n}\n`,
    });

    await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":false}}\n', 'utf8');
    const direct = await resolveFindSymbol(rootDir, { path: 'src/main/java/app', symbol: 'target', language: 'java', search_mode: 'contains' });

    await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
    await buildWorkspaceGraph(rootDir);
    const graph = await resolveFindSymbol(rootDir, { path: 'src/main/java/app', symbol: 'target', language: 'java', search_mode: 'contains' });

    expect(normalizeSymbolResults(graph.results)).toEqual(normalizeSymbolResults(direct.results));
    expect(graph.results.map((result) => result.symbol)).toEqual(['targetLower', 'targetUpper']);
    expect(graph.diagnostics).toMatchObject({
      source_mode: 'graph',
      graph_status: 'fresh',
      completeness: 'complete',
      fallback_reason: null,
    });
  });

  it('preserves java directory inclusion parity for graph-backed mixed-case contains and prefix queries', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/App/BindingCarrier.java': `package app.mixed;\n\npublic class BindingCarrier<TTarget> {\n  public <TTargetMethod> void targetMethod(String targetParameter, java.util.List<String> values) {\n    int targetLocal = targetParameter.length();\n    for (String targetItem : values) {\n      targetLocal += targetItem.length();\n    }\n  }\n}\n`,
      'src/main/java/App/package-info.java': `package app.mixed;\n`,
      'src/main/java/app/TargetApi.java': `package app.other;\n\npublic class TargetApi {\n  public void targetVisible() {}\n}\n`,
    });

    const queries = [
      { symbol: 'app', search_mode: 'contains' as const },
      { symbol: 'app', search_mode: 'prefix' as const },
      { symbol: 'target', search_mode: 'contains' as const },
      { symbol: 'target', search_mode: 'prefix' as const },
      { symbol: 'app.mixed', search_mode: 'exact' as const },
      { symbol: 'targetParameter', search_mode: 'exact' as const },
      { symbol: 'targetLocal', search_mode: 'exact' as const },
      { symbol: 'TTarget', search_mode: 'exact' as const },
      { symbol: 'targetItem', search_mode: 'exact' as const },
      { symbol: 'app', search_mode: 'prefix' as const, declaration_kind: 'package' as const },
      { symbol: 'target', search_mode: 'contains' as const, declaration_kind: 'parameter' as const },
      { symbol: 'target', search_mode: 'contains' as const, declaration_kind: 'local_variable' as const },
      { symbol: 'TTarget', search_mode: 'prefix' as const, declaration_kind: 'type_parameter' as const },
      { symbol: 'target', search_mode: 'prefix' as const, declaration_kind: 'enhanced_for_variable' as const },
    ];

    await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":false}}\n', 'utf8');
    const direct = await Promise.all(queries.map((query) => resolveFindSymbol(rootDir, {
      path: 'src/main/java',
      language: 'java',
      ...query,
    })));

    await writeFile(join(rootDir, '.pi/code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
    await buildWorkspaceGraph(rootDir);
    const graph = await Promise.all(queries.map((query) => resolveFindSymbol(rootDir, {
      path: 'src/main/java',
      language: 'java',
      ...query,
    })));

    for (let index = 0; index < queries.length; index += 1) {
      expect(normalizeSymbolResults(graph[index].results)).toEqual(normalizeSymbolResults(direct[index].results));
      expect(graph[index].diagnostics).toMatchObject({
        source_mode: 'graph',
        graph_status: 'fresh',
        completeness: 'complete',
        fallback_reason: null,
      });
    }

    const directoryExcludedKinds = new Set(['package', 'parameter', 'local_variable', 'type_parameter', 'enhanced_for_variable']);
    for (const index of [0, 1, 2, 3]) {
      expect(direct[index].results.filter((result) => directoryExcludedKinds.has(result.declaration_kind ?? ''))).toEqual([]);
      expect(graph[index].results.filter((result) => directoryExcludedKinds.has(result.declaration_kind ?? ''))).toEqual([]);
    }
    expect(graph[2].results.map((result) => result.symbol)).toEqual(['targetMethod', 'targetVisible']);
    expect(graph[3].results.map((result) => result.symbol)).toEqual(['targetMethod', 'targetVisible']);
    expect(direct[4].results[0]).toMatchObject({ declaration_kind: 'package', symbol: 'app.mixed' });
    expect(graph[4].results[0]).toMatchObject({ declaration_kind: 'package', symbol: 'app.mixed' });
    expect(direct[5].results[0]).toMatchObject({ declaration_kind: 'parameter', symbol: 'targetParameter' });
    expect(graph[5].results[0]).toMatchObject({ declaration_kind: 'parameter', symbol: 'targetParameter' });
    expect(direct[6].results[0]).toMatchObject({ declaration_kind: 'local_variable', symbol: 'targetLocal' });
    expect(graph[6].results[0]).toMatchObject({ declaration_kind: 'local_variable', symbol: 'targetLocal' });
    expect(direct[7].results[0]).toMatchObject({ declaration_kind: 'type_parameter', symbol: 'TTarget' });
    expect(graph[7].results[0]).toMatchObject({ declaration_kind: 'type_parameter', symbol: 'TTarget' });
    expect(direct[8].results[0]).toMatchObject({ declaration_kind: 'enhanced_for_variable', symbol: 'targetItem' });
    expect(graph[8].results[0]).toMatchObject({ declaration_kind: 'enhanced_for_variable', symbol: 'targetItem' });
  });

  it('keeps broad java interface implementation context truthful and duplicate-free in direct and graph modes', async () => {
    const files = {
      'src/main/java/app/Task.java': `package app;\n\npublic interface Task {}\n`,
      'src/main/java/app/WorkerBase.java': `package app;\n\npublic class WorkerBase implements Task {}\n`,
      'src/main/java/app/WorkerRecord.java': `package app;\n\npublic record WorkerRecord(String name) implements Task {}\n`,
    };
    const directRoot = await createProject(files);
    const graphRoot = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });

    await buildWorkspaceGraph(graphRoot);

    const direct = await resolveFindSymbol(directRoot, {
      path: 'src/main/java',
      symbol: 'Task',
      language: 'java',
    });
    const graph = await resolveFindSymbol(graphRoot, {
      path: 'src/main/java',
      symbol: 'Task',
      language: 'java',
    });
    const exactInterface = await resolveFindSymbol(graphRoot, {
      path: 'src/main/java',
      symbol: 'Task',
      language: 'java',
      kind: 'interface',
    });

    const normalizeWithImplementations = (results: typeof direct.results) => results.map((result) => ({
      ...normalizeSymbolResults([result])[0],
      file: result.file.replace(/\\/g, '/').split('/src/main/java/')[1],
      implementations: (result.implementation_locations ?? []).map((location) => ({
        file: location.file.replace(/\\/g, '/').split('/src/main/java/')[1],
        symbol: location.symbol,
        declaration_kind: location.declaration_kind,
      })).sort((a, b) => a.file.localeCompare(b.file) || a.symbol.localeCompare(b.symbol)),
    }));
    const implementationSymbols = (results: typeof direct.results) => new Set(
      results.flatMap((result) => result.implementation_locations ?? []).map((location) => location.symbol)
    );

    expect(direct.results).toHaveLength(1);
    expect(graph.results).toHaveLength(1);
    expect(exactInterface.results).toHaveLength(1);
    expect(implementationSymbols(direct.results)).toEqual(new Set(['WorkerBase', 'WorkerRecord']));
    expect(implementationSymbols(graph.results)).toEqual(new Set(['WorkerBase', 'WorkerRecord']));
    expect(implementationSymbols(exactInterface.results)).toEqual(new Set(['WorkerBase', 'WorkerRecord']));
    expect(normalizeWithImplementations(graph.results)).toEqual(normalizeWithImplementations(direct.results));
    expect(graph.results[0]?.implementation_locations?.map((location) => location.symbol)).toEqual(['WorkerBase', 'WorkerRecord']);
    expect(exactInterface.results[0]?.implementation_locations?.map((location) => location.symbol)).toEqual(['WorkerBase', 'WorkerRecord']);
    expect(new Set(graph.results[0]?.implementation_locations?.map((location) => `${location.file}:${location.symbol}`)).size).toBe(2);
    if (graph.diagnostics.source_mode === 'graph') {
      expect(graph.diagnostics).toMatchObject({ completeness: 'complete', fallback_reason: null });
    }
  });
});
