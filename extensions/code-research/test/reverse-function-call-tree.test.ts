import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeReverseFunctionCallTree } from '../src/core/reverse-function-call-tree-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';

async function createProject(prefix: string, files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('reverse_function_call_tree', () => {
  it('returns TypeScript callers recursively with callers arrays and multiple incoming branches across higher levels', async () => {
    const rootDir = await createProject('pi-reverse-call-tree-ts', {
      'src/service.ts': `export function helper(): void {}\n\nexport function runService(): void {\n  helper();\n}\n\nexport function warmupService(): void {\n  helper();\n}\n`,
      'src/controller.ts': `import { runService, warmupService } from './service';\n\nexport function handleRequest(): void {\n  runService();\n}\n\nexport function warmupRoute(): void {\n  warmupService();\n}\n`,
      'src/app.ts': `import { handleRequest, warmupRoute } from './controller';\n\nexport function main(): void {\n  handleRequest();\n}\n\nexport function bootstrap(): void {\n  warmupRoute();\n}\n`,
      'src/root.ts': `import { main, bootstrap } from './app';\n\nexport function startHttp(): void {\n  main();\n}\n\nexport function startWarmup(): void {\n  bootstrap();\n}\n`,
    });

    const execution = await executeReverseFunctionCallTree(rootDir, {
      path: 'src/service.ts',
      symbol: 'helper',
      language: 'ts',
      kind: 'function',
      max_depth: 6,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    expect(execution.result.root.symbol).toBe('helper');
    expect(execution.result.root).not.toHaveProperty('children');
    expect(execution.result.root.callers?.map((node: any) => node.symbol).sort()).toEqual(['runService', 'warmupService']);

    const runService = execution.result.root.callers?.find((node: any) => node.symbol === 'runService');
    const warmupService = execution.result.root.callers?.find((node: any) => node.symbol === 'warmupService');

    expect(runService?.called_as).toBe('helper()');
    expect(runService?.callers?.[0].symbol).toBe('handleRequest');
    expect(runService?.callers?.[0].callers?.[0].symbol).toBe('main');
    expect(runService?.callers?.[0].callers?.[0].callers?.[0].symbol).toBe('startHttp');

    expect(warmupService?.callers?.[0].symbol).toBe('warmupRoute');
    expect(warmupService?.callers?.[0].callers?.[0].symbol).toBe('bootstrap');
    expect(warmupService?.callers?.[0].callers?.[0].callers?.[0].symbol).toBe('startWarmup');
    expect(execution.result.stats.application_nodes).toBe(9);
  });

  it('returns JavaScript callers recursively with callers arrays and multiple incoming branches across higher levels', async () => {
    const rootDir = await createProject('pi-reverse-call-tree-js', {
      'src/service.js': `export function helper() {}\n\nexport function runService() {\n  helper();\n}\n\nexport function warmupService() {\n  helper();\n}\n`,
      'src/controller.js': `import { runService, warmupService } from './service.js';\n\nexport function handleRequest() {\n  runService();\n}\n\nexport function warmupRoute() {\n  warmupService();\n}\n`,
      'src/app.js': `import { handleRequest, warmupRoute } from './controller.js';\n\nexport function main() {\n  handleRequest();\n}\n\nexport function bootstrap() {\n  warmupRoute();\n}\n`,
      'src/root.js': `import { main, bootstrap } from './app.js';\n\nexport function startHttp() {\n  main();\n}\n\nexport function startWarmup() {\n  bootstrap();\n}\n`,
    });

    const execution = await executeReverseFunctionCallTree(rootDir, {
      path: 'src/service.js',
      symbol: 'helper',
      language: 'js',
      kind: 'function',
      max_depth: 6,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    expect(execution.result.root.symbol).toBe('helper');
    expect(execution.result.root).not.toHaveProperty('children');
    expect(execution.result.root.callers?.map((node: any) => node.symbol).sort()).toEqual(['runService', 'warmupService']);

    const runService = execution.result.root.callers?.find((node: any) => node.symbol === 'runService');
    const warmupService = execution.result.root.callers?.find((node: any) => node.symbol === 'warmupService');

    expect(runService?.callers?.[0].symbol).toBe('handleRequest');
    expect(runService?.callers?.[0].callers?.[0].symbol).toBe('main');
    expect(runService?.callers?.[0].callers?.[0].callers?.[0].symbol).toBe('startHttp');

    expect(warmupService?.callers?.[0].symbol).toBe('warmupRoute');
    expect(warmupService?.callers?.[0].callers?.[0].symbol).toBe('bootstrap');
    expect(warmupService?.callers?.[0].callers?.[0].callers?.[0].symbol).toBe('startWarmup');
    expect(execution.result.stats.application_nodes).toBe(9);
  });

  it('prefers persisted graph data when graph is enabled and available while still expanding upward recursively', async () => {
    const rootDir = await createProject('pi-reverse-call-tree-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function helper(): void {}\n\nexport function runService(): void {\n  helper();\n}\n\nexport function warmupService(): void {\n  helper();\n}\n`,
      'src/controller.ts': `import { runService, warmupService } from './service';\n\nexport function handleRequest(): void {\n  runService();\n}\n\nexport function warmupRoute(): void {\n  warmupService();\n}\n`,
      'src/app.ts': `import { handleRequest, warmupRoute } from './controller';\n\nexport function main(): void {\n  handleRequest();\n}\n\nexport function bootstrap(): void {\n  warmupRoute();\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const execution = await executeReverseFunctionCallTree(rootDir, {
      path: 'src/service.ts',
      symbol: 'helper',
      language: 'ts',
      kind: 'function',
      max_depth: 5,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    expect(execution.result.root.symbol).toBe('helper');
    expect(execution.result.root.callers?.map((node: any) => node.symbol).sort()).toEqual(['runService', 'warmupService']);
    expect(execution.result.root.callers?.find((node: any) => node.symbol === 'runService')?.callers?.[0].symbol).toBe('handleRequest');
  });

  it('returns Java callers recursively with callers arrays, multiple branches, and higher levels', async () => {
    const rootDir = await createProject('pi-reverse-call-tree-java', {
      'src/main/java/ports/Service.java': `package ports;\npublic interface Service {\n  void run();\n  void warmup();\n}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport ports.Service;\n\npublic class AppService implements Service {\n  public void run() {\n    helper();\n  }\n\n  public void warmup() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport ports.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
      'src/main/java/web/WarmupController.java': `package web;\n\nimport ports.Service;\n\npublic class WarmupController {\n  private final Service service;\n\n  public WarmupController(Service service) {\n    this.service = service;\n  }\n\n  public void prime() {\n    service.warmup();\n  }\n}\n`,
      'src/main/java/root/Application.java': `package root;\n\nimport web.Controller;\n\npublic class Application {\n  private final Controller controller;\n\n  public Application(Controller controller) {\n    this.controller = controller;\n  }\n\n  public void startHttp() {\n    controller.handle();\n  }\n}\n`,
      'src/main/java/root/Bootstrap.java': `package root;\n\nimport web.WarmupController;\n\npublic class Bootstrap {\n  private final WarmupController warmupController;\n\n  public Bootstrap(WarmupController warmupController) {\n    this.warmupController = warmupController;\n  }\n\n  public void startWarmup() {\n    warmupController.prime();\n  }\n}\n`,
    });

    const execution = await executeReverseFunctionCallTree(rootDir, {
      path: 'src/main/java/app/AppService.java',
      symbol: 'helper',
      language: 'java',
      kind: 'method',
      max_depth: 6,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    expect(execution.result.root.symbol).toBe('helper');
    expect(execution.result.root.class).toBe('AppService');
    expect(execution.result.root).not.toHaveProperty('children');
    expect(execution.result.root.callers?.map((node: any) => node.symbol).sort()).toEqual(['run', 'warmup']);

    const run = execution.result.root.callers?.find((node: any) => node.symbol === 'run');
    const warmup = execution.result.root.callers?.find((node: any) => node.symbol === 'warmup');

    expect(run?.class).toBe('AppService');
    expect(run?.callers?.[0].symbol).toBe('handle');
    expect(run?.callers?.[0].class).toBe('Controller');
    expect(run?.callers?.[0].callers?.[0].symbol).toBe('startHttp');
    expect(run?.callers?.[0].callers?.[0].class).toBe('Application');

    expect(warmup?.class).toBe('AppService');
    expect(warmup?.callers?.[0].symbol).toBe('prime');
    expect(warmup?.callers?.[0].class).toBe('WarmupController');
    expect(warmup?.callers?.[0].callers?.[0].symbol).toBe('startWarmup');
    expect(warmup?.callers?.[0].callers?.[0].class).toBe('Bootstrap');
    expect(execution.result.stats.application_nodes).toBe(7);
  });
});
