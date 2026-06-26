import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph } from '../../src/core/workspace-graph.js';
import { readSubprojectGraphShard } from '../../src/core/graph-persistence.js';

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
      range: { startLine: 3, startColumn: 7, endLine: 5, endColumn: 1 },
    });
    expect(runService).toMatchObject({
      kind: 'symbol',
      symbolKind: 'function',
      file: 'src/service.ts',
      range: { startLine: 1, startColumn: 7, endLine: 3, endColumn: 1 },
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
      range: { startLine: 12, startColumn: 2, endLine: 14, endColumn: 3 },
    });
    expect(run).toMatchObject({
      kind: 'symbol',
      symbolKind: 'method',
      file: 'src/main/java/app/AppService.java',
      range: { startLine: 6, startColumn: 2, endLine: 8, endColumn: 3 },
    });

    const callEdge = shard.edges.find(
      (edge) => edge.kind === 'calls' && edge.from === handle?.id && edge.to === run?.id
    );
    expect(callEdge).toMatchObject({
      kind: 'calls',
      external: false,
      callsite: { line: 13, column: 4, text: 'service.run()', receiverName: 'service', receiverType: 'Service' },
    });
  });
});
