import { describe, expect, it } from 'vitest';
import { mkdir, readFile, truncate, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph } from '../../src/core/workspace-graph.js';
import {
  clearSubprojectGraphShardCache,
  getSubprojectGraphShardCacheStats,
  readSubprojectGraphShard,
  writeSubprojectGraphShard,
} from '../../src/core/graph-persistence.js';
import { WORKSPACE_GRAPH_BUILDER_FINGERPRINT, WORKSPACE_GRAPH_BUILDER_MODEL_VERSION } from '../../src/core/graph-schema.js';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-graph-shard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return rootDir;
}

describe('workspace graph shard content', () => {
  it('persists validated TypeScript symbol coverage proofs and canonical symbol metadata', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export class Vault {\n  #secret = 1;\n  get value() { return this.#secret; }\n}\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const shardResult = await readSubprojectGraphShard(rootDir, built.state.subprojects[0].id);
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;

    const shard = shardResult.data;
    expect(shard.typescriptSymbolCoverage).toMatchObject({
      modelVersion: 1,
      compilerModelVersion: 'typescript@6.0.3',
      grammar: { typescript: '0.23.2', tsx: '0.23.2' },
      generation: shard.generation,
      completeFiles: ['src/service.ts'],
    });
    expect(shard.typescriptSymbolCoverage?.fileProofs['src/service.ts']?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    const secret = shard.nodes.find((node): node is Extract<(typeof shard.nodes)[number], { kind: 'symbol' }> => node.kind === 'symbol' && node.file === 'src/service.ts' && node.name === 'secret');
    expect(secret).toMatchObject({
      kind: 'symbol',
      declarationKind: 'field',
      sourceName: '#secret',
      modifiers: ['private'],
      isDefinition: true,
      isImplementation: true,
      qualifiedName: 'Vault.secret',
    });
    expect(secret?.codeRange).toEqual(secret?.range);
    expect(secret?.symbolId).toMatch(/^[a-f0-9]{64}$/);
    expect(secret?.logicalSymbolKey).toContain('ts::');
    expect(secret?.snapshotSymbolId).toMatch(/^[a-f0-9]{64}$/);
    expect(secret?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects malformed coverage, malformed nested nodes, incompatible schemas, and oversized shards', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function runService(): void {}\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const subprojectId = built.state.subprojects[0].id;
    const shardPath = join(rootDir, '.pi/workspace-code-graph/graphs', `${subprojectId}.json`);
    const shardResult = await readSubprojectGraphShard(rootDir, subprojectId);
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;

    const malformedCoverage = structuredClone(shardResult.data);
    if (malformedCoverage.typescriptSymbolCoverage) malformedCoverage.typescriptSymbolCoverage.fileProofs['src/service.ts'].symbolCount += 1;
    await writeFile(shardPath, `${JSON.stringify(malformedCoverage, null, 2)}\n`, 'utf8');
    expect((await readSubprojectGraphShard(rootDir, subprojectId)).status).toBe('incompatible');

    const malformedNode = structuredClone(shardResult.data);
    const symbolNode = malformedNode.nodes.find((node: any) => node.kind === 'symbol');
    expect(symbolNode).toBeTruthy();
    if (!symbolNode || symbolNode.kind !== 'symbol') return;
    symbolNode.range.startLine = '1' as any;
    await writeFile(shardPath, `${JSON.stringify(malformedNode, null, 2)}\n`, 'utf8');
    expect((await readSubprojectGraphShard(rootDir, subprojectId)).status).toBe('incompatible');

    const malformedId = structuredClone(shardResult.data);
    const malformedIdNode = malformedId.nodes.find((node: any) => node.kind === 'symbol' && (node.language === 'ts' || node.language === 'js'));
    expect(malformedIdNode).toBeTruthy();
    if (!malformedIdNode || malformedIdNode.kind !== 'symbol') return;
    malformedIdNode.symbolId = 'not-a-sha256';
    await writeFile(shardPath, `${JSON.stringify(malformedId, null, 2)}\n`, 'utf8');
    expect((await readSubprojectGraphShard(rootDir, subprojectId)).status).toBe('incompatible');

    const malformedEdge = structuredClone(shardResult.data);
    const edge = malformedEdge.edges.find((candidate: any) => candidate.callsite);
    if (edge?.callsite) edge.callsite.line = 99_999_999;
    else malformedEdge.edges.push({ id: 'bad-edge', kind: 'calls', from: 'missing', to: 'missing', callsite: { line: 99_999_999, column: 0 } });
    await writeFile(shardPath, `${JSON.stringify(malformedEdge, null, 2)}\n`, 'utf8');
    expect((await readSubprojectGraphShard(rootDir, subprojectId)).status).toBe('incompatible');

    await writeFile(shardPath, `${JSON.stringify(shardResult.data, null, 2)}\n`, 'utf8');
    expect((await readSubprojectGraphShard(rootDir, subprojectId, { generation: shardResult.data.generation + 1 })).status).toBe('incompatible');

    const legacySchema = { ...shardResult.data, schemaVersion: 1 };
    await writeFile(shardPath, `${JSON.stringify(legacySchema, null, 2)}\n`, 'utf8');
    expect((await readSubprojectGraphShard(rootDir, subprojectId)).status).toBe('incompatible');

    const futureSchema = { ...shardResult.data, schemaVersion: 999 };
    await writeFile(shardPath, `${JSON.stringify(futureSchema, null, 2)}\n`, 'utf8');
    expect((await readSubprojectGraphShard(rootDir, subprojectId)).status).toBe('incompatible');

    await writeFile(shardPath, '{}', 'utf8');
    await truncate(shardPath, 256 * 1024 * 1024 + 1);
    expect((await readSubprojectGraphShard(rootDir, subprojectId)).status).toBe('oversized');
  });

  it('invalidates cached shard reads after corrupt replacement and supports bounded eviction/clear behavior', async () => {
    const rootDir = await createProject({ '.pi/code-research.json': `{"graph":{"enable":true}}\n` });

    clearSubprojectGraphShardCache();
    await writeSubprojectGraphShard(rootDir, 'cache-a', { schemaVersion: 4, builderModelVersion: WORKSPACE_GRAPH_BUILDER_MODEL_VERSION, builderFingerprint: WORKSPACE_GRAPH_BUILDER_FINGERPRINT, createdBy: 'pi-code-research-extension', subprojectId: 'cache-a', generation: 1, nodes: [], edges: [] });
    await writeSubprojectGraphShard(rootDir, 'cache-b', { schemaVersion: 4, builderModelVersion: WORKSPACE_GRAPH_BUILDER_MODEL_VERSION, builderFingerprint: WORKSPACE_GRAPH_BUILDER_FINGERPRINT, createdBy: 'pi-code-research-extension', subprojectId: 'cache-b', generation: 1, nodes: [], edges: [] });
    await writeSubprojectGraphShard(rootDir, 'cache-c', { schemaVersion: 4, builderModelVersion: WORKSPACE_GRAPH_BUILDER_MODEL_VERSION, builderFingerprint: WORKSPACE_GRAPH_BUILDER_FINGERPRINT, createdBy: 'pi-code-research-extension', subprojectId: 'cache-c', generation: 1, nodes: [], edges: [] });
    await writeSubprojectGraphShard(rootDir, 'cache-d', { schemaVersion: 4, builderModelVersion: WORKSPACE_GRAPH_BUILDER_MODEL_VERSION, builderFingerprint: WORKSPACE_GRAPH_BUILDER_FINGERPRINT, createdBy: 'pi-code-research-extension', subprojectId: 'cache-d', generation: 1, nodes: [], edges: [] });
    await writeSubprojectGraphShard(rootDir, 'cache-e', { schemaVersion: 4, builderModelVersion: WORKSPACE_GRAPH_BUILDER_MODEL_VERSION, builderFingerprint: WORKSPACE_GRAPH_BUILDER_FINGERPRINT, createdBy: 'pi-code-research-extension', subprojectId: 'cache-e', generation: 1, nodes: [], edges: [] });
    await writeSubprojectGraphShard(rootDir, 'cache-f', { schemaVersion: 4, builderModelVersion: WORKSPACE_GRAPH_BUILDER_MODEL_VERSION, builderFingerprint: WORKSPACE_GRAPH_BUILDER_FINGERPRINT, createdBy: 'pi-code-research-extension', subprojectId: 'cache-f', generation: 1, nodes: [], edges: [] });
    await writeSubprojectGraphShard(rootDir, 'cache-g', { schemaVersion: 4, builderModelVersion: WORKSPACE_GRAPH_BUILDER_MODEL_VERSION, builderFingerprint: WORKSPACE_GRAPH_BUILDER_FINGERPRINT, createdBy: 'pi-code-research-extension', subprojectId: 'cache-g', generation: 1, nodes: [], edges: [] });
    await writeSubprojectGraphShard(rootDir, 'cache-h', { schemaVersion: 4, builderModelVersion: WORKSPACE_GRAPH_BUILDER_MODEL_VERSION, builderFingerprint: WORKSPACE_GRAPH_BUILDER_FINGERPRINT, createdBy: 'pi-code-research-extension', subprojectId: 'cache-h', generation: 1, nodes: [], edges: [] });
    await writeSubprojectGraphShard(rootDir, 'cache-i', { schemaVersion: 4, builderModelVersion: WORKSPACE_GRAPH_BUILDER_MODEL_VERSION, builderFingerprint: WORKSPACE_GRAPH_BUILDER_FINGERPRINT, createdBy: 'pi-code-research-extension', subprojectId: 'cache-i', generation: 1, nodes: [], edges: [] });

    for (const subprojectId of ['cache-a', 'cache-b', 'cache-c', 'cache-d', 'cache-e', 'cache-f', 'cache-g', 'cache-h', 'cache-i']) {
      const shard = await readSubprojectGraphShard(rootDir, subprojectId, { generation: 1 });
      expect(shard.status).toBe('ok');
    }

    const afterEviction = getSubprojectGraphShardCacheStats();
    expect(afterEviction.entryCount).toBeLessThanOrEqual(8);
    expect(afterEviction.evictions).toBeGreaterThan(0);

    await writeFile(join(rootDir, '.pi/workspace-code-graph/graphs/cache-i.json'), '{"schemaVersion":2,"createdBy":"pi-code-research-extension","subprojectId":"cache-i"', 'utf8');
    const corruptRead = await readSubprojectGraphShard(rootDir, 'cache-i', { generation: 1 });
    expect(corruptRead.status).toBe('corrupt');

    clearSubprojectGraphShardCache();
    const afterClear = getSubprojectGraphShardCacheStats();
    expect(afterClear.entryCount).toBe(0);
    expect(afterClear.totalBytes).toBe(0);
  });

  it('keeps ensureFileNode free of deferred stat updates that rescan the full node array', async () => {
    const source = await readFile(join(dirname(new URL(import.meta.url).pathname), '../../src/core/workspace-graph.ts'), 'utf8');
    const ensureFileNodeBlock = source.match(/function ensureFileNode\([\s\S]*?\n}\n\nfunction extractTypeScriptCalls/);
    expect(ensureFileNodeBlock?.[0]).toBeTruthy();
    expect(ensureFileNodeBlock?.[0]).not.toContain('void stat(');
    expect(ensureFileNodeBlock?.[0]).not.toContain('nodes.find(');
  });

  it('stores symbol ranges and internal import/call relationships for ts source referenced via .js specifiers', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'src/service.ts': `export function runService(): void {\n  helper();\n}\n\nfunction helper(): void {}\n`,
      'src/controller.ts': `import { runService } from './service.js';\n\nexport function handle(): void {\n  runService();\n}\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const subprojectId = built.state.subprojects[0]?.id;
    expect(subprojectId).toBeTruthy();
    if (!subprojectId) return;

    const shardResult = await readSubprojectGraphShard(rootDir, subprojectId);
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;

    const shard = shardResult.data;
    const handle = shard.nodes.find(
      (node) =>
        node.kind === 'symbol' &&
        node.file === 'src/controller.ts' &&
        node.name === 'handle'
    );
    const runService = shard.nodes.find(
      (node) =>
        node.kind === 'symbol' &&
        node.file === 'src/service.ts' &&
        node.name === 'runService'
    );

    expect(handle).toMatchObject({
      kind: 'symbol',
      symbolKind: 'function',
      file: 'src/controller.ts',
      range: { startLine: 3, startColumn: 16, endLine: 5, endColumn: 1 },
    });
    expect(runService).toMatchObject({
      kind: 'symbol',
      symbolKind: 'function',
      file: 'src/service.ts',
      range: { startLine: 1, startColumn: 16, endLine: 3, endColumn: 1 },
    });

    const importEdge = shard.edges.find(
      (edge) =>
        edge.kind === 'imports' &&
        edge.importSource === './service.js' &&
        edge.from.endsWith(':src/controller.ts') &&
        edge.to.endsWith(':src/service.ts')
    );
    expect(importEdge).toBeTruthy();

    const callEdge = shard.edges.find(
      (edge) => edge.kind === 'calls' && edge.from === handle?.id && edge.to === runService?.id
    );
    expect(callEdge).toMatchObject({
      kind: 'calls',
      external: false,
      callsite: { line: 4, column: 2 },
    });
  });

  it('excludes python files and project markers from schema v4 graph indexing', async () => {
    const rootDir = await createProject({
      'pyproject.toml': `[project]
name = "python-fixture"
`,
      'src/app.py': `def run():
    return True
`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const subprojectId = built.state.subprojects[0]?.id;
    expect(subprojectId).toBeTruthy();
    if (!subprojectId) return;

    expect(built.state.coverage.indexedFiles).toBe(0);
    expect(built.state.subprojects[0]?.languageHints).not.toContain('py');

    const shardResult = await readSubprojectGraphShard(rootDir, subprojectId);
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;

    expect(shardResult.data.nodes.some((node) => node.kind === 'file' && node.path.endsWith('.py'))).toBe(false);
    expect(shardResult.data.nodes.some((node) => node.kind === 'symbol' && node.language === ('py' as any))).toBe(false);
    expect(shardResult.data.edges.some((edge) => edge.kind === ('entrypoint' as any))).toBe(false);
  });

  it('stores internal java call edges for dependency-injected fields with a unique application implementation', async () => {
    const rootDir = await createProject({
      'pom.xml': `<project />\n`,
      'src/main/java/api/Service.java': `package api;\npublic interface Service {\n  void run();\n}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport api.Service;\n\npublic class AppService implements Service {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport api.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const subprojectId = built.state.subprojects[0]?.id;
    expect(subprojectId).toBeTruthy();
    if (!subprojectId) return;

    const shardResult = await readSubprojectGraphShard(rootDir, subprojectId);
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;

    const shard = shardResult.data;
    const handle = shard.nodes.find(
      (node) =>
        node.kind === 'symbol' &&
        node.file === 'src/main/java/web/Controller.java' &&
        node.name === 'handle'
    );
    const run = shard.nodes.find(
      (node) =>
        node.kind === 'symbol' &&
        node.file === 'src/main/java/app/AppService.java' &&
        node.name === 'run'
    );

    expect(handle).toMatchObject({
      kind: 'symbol',
      symbolKind: 'method',
      file: 'src/main/java/web/Controller.java',
      range: { startLine: 12, startColumn: 14, endLine: 12, endColumn: 23 },
    });
    expect(run).toMatchObject({
      kind: 'symbol',
      symbolKind: 'method',
      file: 'src/main/java/app/AppService.java',
      range: { startLine: 6, startColumn: 14, endLine: 6, endColumn: 20 },
    });

    const callEdge = shard.edges.find(
      (edge) => edge.kind === 'calls' && edge.from === handle?.id && edge.to === run?.id
    );
    expect(callEdge).toMatchObject({
      kind: 'calls',
      external: false,
      callsite: { line: 13, column: 4, receiverName: 'service', receiverType: 'Service' },
      occurrenceRange: { startLine: 13, startColumn: 4, endLine: 13, endColumn: 4 },
      targetStatus: 'resolved',
    });
  });

  it('validates java coverage proofs deeply and persists canonical permits edges', async () => {
    const rootDir = await createProject({
      'pom.xml': `<project />\n`,
      'src/main/java/app/Shape.java': `package app;\n\npublic sealed class Shape permits Circle, Square {}\n`,
      'src/main/java/app/Circle.java': `package app;\n\npublic final class Circle extends Shape {}\n`,
      'src/main/java/app/Square.java': `package app;\n\npublic final class Square extends Shape {}\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const subprojectId = built.state.subprojects[0]?.id;
    expect(subprojectId).toBeTruthy();
    if (!subprojectId) return;

    const shardResult = await readSubprojectGraphShard(rootDir, subprojectId);
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;

    const shard = shardResult.data;
    const shape = shard.nodes.find((node) => node.kind === 'symbol' && node.file === 'src/main/java/app/Shape.java' && node.name === 'Shape');
    const circle = shard.nodes.find((node) => node.kind === 'symbol' && node.file === 'src/main/java/app/Circle.java' && node.name === 'Circle');
    const square = shard.nodes.find((node) => node.kind === 'symbol' && node.file === 'src/main/java/app/Square.java' && node.name === 'Square');
    expect(shape).toBeTruthy();
    expect(circle).toBeTruthy();
    expect(square).toBeTruthy();
    expect(shard.edges.some((edge) => edge.kind === 'permits' && edge.from === shape?.id && edge.to === circle?.id)).toBe(true);
    expect(shard.edges.some((edge) => edge.kind === 'permits' && edge.from === shape?.id && edge.to === square?.id)).toBe(true);

    const shardPath = join(rootDir, '.pi/workspace-code-graph/graphs', `${subprojectId}.json`);
    const malformedCases = [
      {
        name: 'symbol count mismatch',
        mutate(candidate: typeof shard) {
          if (candidate.javaSymbolCoverage) candidate.javaSymbolCoverage.fileProofs['src/main/java/app/Shape.java'].symbolCount += 1;
        },
      },
      {
        name: 'unknown observed family',
        mutate(candidate: typeof shard) {
          if (candidate.javaSymbolCoverage) candidate.javaSymbolCoverage.fileProofs['src/main/java/app/Shape.java'].observedFamilies = ['not-a-java-family' as any];
        },
      },
      {
        name: 'symbol source hash does not match file proof',
        mutate(candidate: typeof shard) {
          const symbol = candidate.nodes.find((node) => node.kind === 'symbol' && node.file === 'src/main/java/app/Shape.java');
          if (symbol?.kind === 'symbol') symbol.sourceHash = '0'.repeat(64);
        },
      },
      {
        name: 'snapshot id does not describe file proofs',
        mutate(candidate: typeof shard) {
          if (candidate.javaSymbolCoverage) candidate.javaSymbolCoverage.sourceSnapshotId = '0'.repeat(64);
        },
      },
    ];

    for (const malformedCase of malformedCases) {
      const malformed = structuredClone(shard);
      malformedCase.mutate(malformed);
      await writeFile(shardPath, `${JSON.stringify(malformed, null, 2)}\n`, 'utf8');
      expect((await readSubprojectGraphShard(rootDir, subprojectId)).status, malformedCase.name).toBe('incompatible');
    }
  });

  it('accepts fresh schema-v3 java shards for mixed-case coverage file ordering', async () => {
    const rootDir = await createProject({
      'pom.xml': `<project />\n`,
      'src/main/java/app/B.java': `package app;\n\npublic class B {}\n`,
      'src/main/java/app/b.java': `package app;\n\npublic class b {}\n`,
    });

    const built = await buildWorkspaceGraph(rootDir);
    const subprojectId = built.state.subprojects[0]?.id;
    expect(subprojectId).toBeTruthy();
    if (!subprojectId) return;

    const shardResult = await readSubprojectGraphShard(rootDir, subprojectId);
    expect(shardResult.status).toBe('ok');
    if (shardResult.status !== 'ok') return;

    expect(shardResult.data.javaSymbolCoverage?.completeFiles).toEqual([
      'src/main/java/app/B.java',
      'src/main/java/app/b.java',
    ]);
  });
});
