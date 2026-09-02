import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph } from '../../src/core/workspace-graph.js';
import { executeFunctionCallTree } from '../../src/core/function-call-tree-resolver.js';
import { loadWorkspaceGraphState, writeWorkspaceGraphState } from '../../src/core/workspace-state.js';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-graph-unavailable-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('graph-backed function_call_tree unavailable', () => {
  it('prefers a fresh graph when available', async () => {
    const rootDir = await createProject({
      'src/service.ts': `export function runService(): void { helper(); }\nfunction helper(): void {}\n`,
      'src/controller.ts': `import { runService } from './service';\nexport function handle(): void { runService(); }\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'src/controller.ts',
      symbol: 'handle',
      language: 'ts',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;
    expect(execution.result.root.children?.[0].symbol).toBe('runService');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
  });

  it('returns not_found when graph state is partial', async () => {
    const rootDir = await createProject({
      'src/service.js': `export function runService() { helper(); }\nfunction helper() {}\n`,
      'src/controller.js': `import { runService } from './service.js';\nexport function handle() { runService(); }\n`,
    });
    const built = await buildWorkspaceGraph(rootDir);
    await writeWorkspaceGraphState(rootDir, { ...built.state, status: 'partial' });

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'src/controller.js',
      symbol: 'handle',
      language: 'js',
      max_depth: 5,
      include_external: true,
    });

    expect(execution).toMatchObject({ status: 'not_found', details: { found: 0 } });
  });

  it('returns not_found when graph state is stale', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function oldRunService(): void { oldHelper(); }\nfunction oldHelper(): void {}\n`,
      'src/controller.ts': `import { oldRunService } from './service';\nexport function handle(): void { oldRunService(); }\n`,
    });
    await buildWorkspaceGraph(rootDir);
    await writeFile(join(rootDir, 'src/service.ts'), `export function runService(): void { helper(); }\nfunction helper(): void {}\n`, 'utf8');
    await writeFile(join(rootDir, 'src/controller.ts'), `import { runService } from './service';\nexport function handle(): void { runService(); }\n`, 'utf8');
    const state = await loadWorkspaceGraphState(rootDir);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    await writeWorkspaceGraphState(rootDir, { ...state.data, status: 'stale' });

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'src/controller.ts',
      symbol: 'handle',
      language: 'ts',
      max_depth: 5,
      include_external: true,
    });

    expect(execution).toMatchObject({ status: 'not_found', details: { found: 0 } });
  });

  it('uses a fresh graph for ts projects that import local source through .js specifiers', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'src/service.ts': `export function runService(): void { helper(); }\nfunction helper(): void {}\n`,
      'src/controller.ts': `import { runService } from './service.js';\nexport function handle(): void { runService(); }\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'src/controller.ts',
      symbol: 'handle',
      language: 'ts',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;
    expect(execution.result.root.children?.[0].symbol).toBe('runService');
    expect(execution.result.root.children?.[0].node_type).toBe('application');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
  });

  it('uses a fresh graph for java projects with dependency-injected interface fields', async () => {
    const rootDir = await createProject({
      'pom.xml': `<project />\n`,
      'src/main/java/api/Service.java': `package api;\npublic interface Service {\n  void run();\n}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport api.Service;\n\npublic class AppService implements Service {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport api.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'src/main/java/web/Controller.java',
      symbol: 'handle',
      language: 'java',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;
    expect(execution.result.root.children?.[0].symbol).toBe('run');
    expect(execution.result.root.children?.[0].class).toBe('AppService');
    expect(execution.result.root.children?.[0].receiver_name).toBe('service');
    expect(execution.result.root.children?.[0].receiver_type).toBe('Service');
    expect(execution.result.root.children?.[0].node_type).toBe('application');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
  });
});
