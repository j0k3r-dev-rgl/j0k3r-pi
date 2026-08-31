import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { SubprojectGraphShard } from '../../src/types.js';
import {
  clearSubprojectGraphShardCache,
  getSubprojectShardPath,
  getSubprojectGraphShardCacheStats,
  readGraphArtifactJson,
  readSubprojectGraphShard,
  writeGraphArtifactJson,
  writeSubprojectGraphShard,
} from '../../src/core/graph-persistence.js';
import { WORKSPACE_GRAPH_BUILDER_FINGERPRINT, WORKSPACE_GRAPH_BUILDER_MODEL_VERSION } from '../../src/core/graph-schema.js';

function createRepresentativeShard(generation = 7): SubprojectGraphShard {
  return {
    schemaVersion: 4,
    builderModelVersion: WORKSPACE_GRAPH_BUILDER_MODEL_VERSION,
    builderFingerprint: WORKSPACE_GRAPH_BUILDER_FINGERPRINT,
    createdBy: 'pi-code-research-extension',
    subprojectId: 'fixture-subproject',
    generation,
    nodes: [
      {
        id: 'file:fixture-subproject:src/service.ts',
        kind: 'file',
        path: 'src/service.ts',
        language: 'ts',
        size: 321,
      },
      {
        id: 'symbol:fixture-subproject:src/service.ts:Service:run:2:2',
        kind: 'symbol',
        language: 'ts',
        symbolKind: 'method',
        name: 'run',
        file: 'src/service.ts',
        range: { startLine: 2, startColumn: 2, endLine: 4, endColumn: 3 },
        exported: true,
        owner: 'Service',
        ownerKind: 'class',
        declarationKind: 'method',
        symbolId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        logicalSymbolKey: 'ts::fixture-subproject::src/service.ts::Service::Service.run::method::run(): void',
        snapshotSymbolId: '1111111111111111111111111111111111111111111111111111111111111111',
        qualifiedName: 'Service.run',
        modifiers: ['public'],
        isDefinition: true,
        isImplementation: true,
        sourceHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        signature: 'run(): void',
      },
    ],
    edges: [
      {
        id: 'contains:file:fixture-subproject:src/service.ts:symbol:fixture-subproject:src/service.ts:Service:run:2:2',
        kind: 'contains',
        from: 'file:fixture-subproject:src/service.ts',
        to: 'symbol:fixture-subproject:src/service.ts:Service:run:2:2',
      },
    ],
    typescriptSymbolCoverage: {
      modelVersion: 1,
      compilerModelVersion: 'typescript@6.0.3',
      grammar: { typescript: '0.23.2', tsx: '0.23.2' },
      generation,
      completeFiles: ['src/service.ts'],
      skippedFiles: [],
      fileProofs: {
        'src/service.ts': {
          sourceHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
          symbolCount: 1,
        },
      },
    },
  };
}

describe('graph persistence', () => {
  it('writes compact deterministic json with newline, round-trips, and is materially smaller than pretty json', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pi-graph-persistence-'));
    const artifactPath = join(rootDir, 'artifact.json');
    const shard = createRepresentativeShard();

    await writeGraphArtifactJson(artifactPath, shard);

    const raw = await readFile(artifactPath, 'utf8');
    const compact = `${JSON.stringify(shard)}\n`;
    const pretty = `${JSON.stringify(shard, null, 2)}\n`;

    expect(raw).toBe(compact);
    expect(raw.length).toBeLessThan(pretty.length * 0.8);

    const readResult = await readGraphArtifactJson<SubprojectGraphShard>(artifactPath);
    expect(readResult).toEqual({ status: 'ok', data: shard });
  });

  it('preserves atomic replacement semantics and invalidates shard cache when compact artifacts are rewritten', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pi-graph-cache-'));
    await mkdir(join(rootDir, '.pi', 'workspace-code-graph', 'graphs'), { recursive: true });
    clearSubprojectGraphShardCache();

    const first = createRepresentativeShard(1);
    const second = createRepresentativeShard(2);
    second.nodes = [...second.nodes, {
      id: 'symbol:fixture-subproject:src/service.ts:<root>:helper:6:0',
      kind: 'symbol',
      language: 'ts',
      symbolKind: 'function',
      name: 'helper',
      file: 'src/service.ts',
      range: { startLine: 6, startColumn: 0, endLine: 8, endColumn: 1 },
      exported: false,
      declarationKind: 'function',
      symbolId: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      logicalSymbolKey: 'ts::fixture-subproject::src/service.ts::<root>::helper::function::helper(): void',
      snapshotSymbolId: '2222222222222222222222222222222222222222222222222222222222222222',
      qualifiedName: 'helper',
      modifiers: [],
      isDefinition: true,
      isImplementation: true,
      sourceHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      signature: 'helper(): void',
    }];
    second.typescriptSymbolCoverage = {
      ...second.typescriptSymbolCoverage!,
      generation: 2,
      fileProofs: {
        'src/service.ts': {
          sourceHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
          symbolCount: 2,
        },
      },
    };

    await writeSubprojectGraphShard(rootDir, 'fixture-subproject', first);
    expect((await readSubprojectGraphShard(rootDir, 'fixture-subproject', { generation: 1 })).status).toBe('ok');
    expect((await readSubprojectGraphShard(rootDir, 'fixture-subproject', { generation: 1 })).status).toBe('ok');
    expect(getSubprojectGraphShardCacheStats().hits).toBeGreaterThan(0);

    await writeSubprojectGraphShard(rootDir, 'fixture-subproject', second);

    const shardPath = getSubprojectShardPath(rootDir, 'fixture-subproject');
    const graphDirEntries = await readdir(join(rootDir, '.pi', 'workspace-code-graph', 'graphs'));
    expect(graphDirEntries).toEqual(['fixture-subproject.json']);
    expect(await readFile(shardPath, 'utf8')).toBe(`${JSON.stringify(second)}\n`);

    const updated = await readSubprojectGraphShard(rootDir, 'fixture-subproject', { generation: 2 });
    expect(updated).toEqual({ status: 'ok', data: second });
    expect(updated.status === 'ok' && updated.data.nodes).toHaveLength(3);
    expect(getSubprojectGraphShardCacheStats().misses).toBeGreaterThanOrEqual(2);
  });

  it('returns explicit corrupt and oversized statuses for shard reads', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pi-graph-status-'));
    await mkdir(join(rootDir, '.pi', 'workspace-code-graph', 'graphs'), { recursive: true });

    await writeSubprojectGraphShard(rootDir, 'fixture-subproject', createRepresentativeShard(1));
    const shardPath = getSubprojectShardPath(rootDir, 'fixture-subproject');

    await writeFile(shardPath, '{corrupt', 'utf8');
    expect((await readSubprojectGraphShard(rootDir, 'fixture-subproject')).status).toBe('corrupt');

    await writeFile(shardPath, '{}', 'utf8');
    const oversized = Buffer.alloc(256 * 1024 * 1024 + 1, 0x20);
    await writeFile(shardPath, oversized);
    expect((await readSubprojectGraphShard(rootDir, 'fixture-subproject')).status).toBe('oversized');
  });
});
