import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeReverseFunctionCallTree } from '../src/core/reverse-function-call-tree-resolver.js';
import { buildProjectIndex } from '../src/core/project-index.js';
import { buildReverseCallTree } from '../src/languages/java/reverse-function-call-tree.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import { loadWorkspaceGraphState, writeWorkspaceGraphState } from '../src/core/workspace-state.js';

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
  it('does not index callback-consuming call results as reverse-callable declarations', async () => {
    const rootDir = await createProject('pi-reverse-call-tree-ts-non-callable', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `declare function consume<T>(value: T): { value: T };\nexport const Wrapped = (((() => 1) as () => number)!);\nexport function useWrapped(): void { Wrapped(); }\nexport const NotCallable = consume(() => 1);\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const notCallable = await executeReverseFunctionCallTree(rootDir, {
      path: 'src/service.ts',
      symbol: 'NotCallable',
      language: 'ts',
      kind: 'function',
      max_depth: 4,
    });
    expect(notCallable.status).toBe('not_found');

    const wrapped = await executeReverseFunctionCallTree(rootDir, {
      path: 'src/service.ts',
      symbol: 'Wrapped',
      language: 'ts',
      kind: 'function',
      max_depth: 4,
    });
    expect(wrapped.status).toBe('ok');
    if (wrapped.status !== 'ok') return;
    expect(wrapped.result.root.callers?.[0].symbol).toBe('useWrapped');
  });

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

  it('falls back to direct parsing when reverse graph state is stale', async () => {
    const rootDir = await createProject('pi-reverse-call-tree-stale', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function oldHelper(): void {}\n\nexport function oldRunService(): void {\n  oldHelper();\n}\n`,
      'src/controller.ts': `import { oldRunService } from './service';\n\nexport function handleRequest(): void {\n  oldRunService();\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await writeFile(join(rootDir, 'src/service.ts'), `export function helper(): void {}\n\nexport function runService(): void {\n  helper();\n}\n`, 'utf8');
    await writeFile(join(rootDir, 'src/controller.ts'), `import { runService } from './service';\n\nexport function handleRequest(): void {\n  runService();\n}\n`, 'utf8');
    const state = await loadWorkspaceGraphState(rootDir);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    await writeWorkspaceGraphState(rootDir, { ...state.data, status: 'stale' });

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
    expect(execution.result.root.callers?.[0].symbol).toBe('runService');
    expect(execution.result.root.callers?.[0].callers?.[0].symbol).toBe('handleRequest');
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

  it('uses conservative object-creation syntax to bind reverse edges to one Java overload', async () => {
    const rootDir = await createProject('pi-reverse-call-tree-java-object-overloads', {
      'src/main/java/app/Example.java': `package app;\n\npublic class Example {\n  public void runString() { process(new String("x")); }\n  private void process(String value) {}\n  private void process(Integer value) {}\n}\n`,
    });

    const index = await buildProjectIndex(rootDir);
    const stringOverload = index.methods.find(
      (method) => method.symbol === 'process' && method.normalizedParameterTypes.join(',') === 'String'
    );
    const integerOverload = index.methods.find(
      (method) => method.symbol === 'process' && method.normalizedParameterTypes.join(',') === 'Integer'
    );
    expect(stringOverload).toBeDefined();
    expect(integerOverload).toBeDefined();

    expect(buildReverseCallTree({ index, rootMethod: stringOverload!, maxDepth: 5 }).root.callers?.map((node) => node.symbol)).toEqual(['runString']);
    expect(buildReverseCallTree({ index, rootMethod: integerOverload!, maxDepth: 5 }).root.callers).toBeUndefined();
  });

  it('keeps reverse-call edges bound to the matching Java overload instead of the first declaration', async () => {
    const rootDir = await createProject('pi-reverse-call-tree-java-overloads', {
      'src/main/java/app/Example.java': `package app;\n\npublic class Example {\n  public void runInt() {\n    process(1);\n  }\n\n  public void runString() {\n    process("x");\n  }\n\n  private void process(int value) {}\n\n  private void process(String value) {}\n}\n`,
    });

    const index = await buildProjectIndex(rootDir);
    const intOverload = index.methods.find(
      (method) => method.className === 'Example' && method.symbol === 'process' && method.normalizedParameterTypes.join(',') === 'int'
    );
    const stringOverload = index.methods.find(
      (method) => method.className === 'Example' && method.symbol === 'process' && method.normalizedParameterTypes.join(',') === 'String'
    );
    expect(intOverload).toBeDefined();
    expect(stringOverload).toBeDefined();

    const intResult = buildReverseCallTree({ index, rootMethod: intOverload!, maxDepth: 5 });
    const stringResult = buildReverseCallTree({ index, rootMethod: stringOverload!, maxDepth: 5 });

    expect(intResult.root.callers?.map((node) => node.symbol)).toEqual(['runInt']);
    expect(intResult.root.callers?.[0].called_as).toBe('process(1)');
    expect(stringResult.root.callers?.map((node) => node.symbol)).toEqual(['runString']);
    expect(stringResult.root.callers?.[0].called_as).toBe('process("x")');
  });

  it('keeps graph-backed locally constructed instance reverse call trees aligned with direct mode', async () => {
    const files = {
      'src/service.ts': `export class Worker {\n  run(): void {\n    this.helper();\n  }\n\n  helper(): void {}\n}\n`,
      'src/controller.ts': `import { Worker } from './service';\n\nexport function handle(): void {\n  const worker = new Worker();\n  worker.run();\n}\n`,
      'src/root.ts': `import { handle } from './controller';\n\nexport function main(): void {\n  handle();\n}\n`,
    };
    const directRoot = await createProject('pi-reverse-call-tree-local-instance-direct', files);
    const graphRoot = await createProject('pi-reverse-call-tree-local-instance-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const direct = await executeReverseFunctionCallTree(directRoot, { path: 'src/service.ts', symbol: 'helper', language: 'ts', kind: 'method', max_depth: 5 });
    const graph = await executeReverseFunctionCallTree(graphRoot, { path: 'src/service.ts', symbol: 'helper', language: 'ts', kind: 'method', max_depth: 5 });

    expect(direct.status).toBe('ok');
    expect(graph.status).toBe('ok');
    if (direct.status !== 'ok' || graph.status !== 'ok') return;

    const flatten = (node: any): string[] => [node.symbol, ...(node.callers ?? []).flatMap(flatten)];
    expect(flatten(graph.result.root)).toEqual(flatten(direct.result.root));
  });

  it('keeps graph-backed inline-import typed receiver reverse call trees aligned with direct mode', async () => {
    const files = {
      'src/service.ts': `export class A {\n  run(): void {\n    this.helper();\n  }\n\n  helper(): void {}\n}\n`,
      'src/owner.ts': `export function ownerCalls(a: import('./service').A): void {\n  a.run();\n}\n`,
      'src/root.ts': `import { ownerCalls } from './owner';\nimport { A } from './service';\n\nexport function main(): void {\n  ownerCalls(new A());\n}\n`,
    };
    const directRoot = await createProject('pi-reverse-call-tree-inline-import-direct', files);
    const graphRoot = await createProject('pi-reverse-call-tree-inline-import-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const direct = await executeReverseFunctionCallTree(directRoot, { path: 'src/service.ts', symbol: 'helper', language: 'ts', kind: 'method', max_depth: 5 });
    const graph = await executeReverseFunctionCallTree(graphRoot, { path: 'src/service.ts', symbol: 'helper', language: 'ts', kind: 'method', max_depth: 5 });

    expect(direct.status).toBe('ok');
    expect(graph.status).toBe('ok');
    if (direct.status !== 'ok' || graph.status !== 'ok') return;

    const flatten = (node: any): string[] => [`${node.class ?? '<module>'}.${node.symbol}`, ...(node.callers ?? []).flatMap(flatten)];
    expect(flatten(graph.result.root)).toEqual(flatten(direct.result.root));
    expect(graph.result.root.callers?.[0]?.callers?.[0]?.symbol).toBe('ownerCalls');
  });

  it('keeps graph-backed namespace-import reverse call trees aligned with direct mode', async () => {
    const files = {
      'src/forms.js': `export function declared(name) {\n  return name;\n}\n`,
      'src/consumer.js': `import * as Forms from './forms.js';\n\nexport function middle() {\n  return Forms.declared('ns');\n}\n`,
      'src/root.js': `import { middle } from './consumer.js';\n\nexport function main() {\n  return middle();\n}\n`,
    };
    const directRoot = await createProject('pi-reverse-call-tree-namespace-direct', files);
    const graphRoot = await createProject('pi-reverse-call-tree-namespace-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const direct = await executeReverseFunctionCallTree(directRoot, { path: 'src/forms.js', symbol: 'declared', language: 'js', kind: 'function', max_depth: 5 });
    const graph = await executeReverseFunctionCallTree(graphRoot, { path: 'src/forms.js', symbol: 'declared', language: 'js', kind: 'function', max_depth: 5 });

    expect(direct.status).toBe('ok');
    expect(graph.status).toBe('ok');
    if (direct.status !== 'ok' || graph.status !== 'ok') return;

    const flatten = (node: any): string[] => [node.symbol, ...(node.callers ?? []).flatMap(flatten)];
    expect(flatten(graph.result.root)).toEqual(flatten(direct.result.root));
  });

  it('keeps expression-bodied arrow reverse call trees aligned in direct and graph modes', async () => {
    const files = {
      'src/forms.js': `export function declared(name) {\n  return name;\n}\n\nexport const arrow = name => declared(name);\n`,
    };
    const directRoot = await createProject('pi-reverse-call-tree-arrow-direct', files);
    const graphRoot = await createProject('pi-reverse-call-tree-arrow-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const direct = await executeReverseFunctionCallTree(directRoot, { path: 'src/forms.js', symbol: 'declared', language: 'js', kind: 'function', max_depth: 4 });
    const graph = await executeReverseFunctionCallTree(graphRoot, { path: 'src/forms.js', symbol: 'declared', language: 'js', kind: 'function', max_depth: 4 });

    expect(direct.status).toBe('ok');
    expect(graph.status).toBe('ok');
    if (direct.status !== 'ok' || graph.status !== 'ok') return;

    expect(direct.result.root.callers?.map((node: any) => node.symbol)).toContain('arrow');
    expect(graph.result.root.callers?.map((node: any) => node.symbol)).toEqual(direct.result.root.callers?.map((node: any) => node.symbol));
  });

  it('keeps exact-file JavaScript method reverse graph queries attached to the method owner and callers', async () => {
    const rootDir = await createProject('pi-reverse-call-tree-js-exact-method', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/forms.js': `export class Worker {\n  run() {\n    this.helper();\n  }\n\n  helper() {}\n}\n`,
      'src/consumer.js': `import { Worker } from './forms.js';\n\nexport function top() {\n  const worker = new Worker();\n  worker.run();\n}\n`,
      'src/root.js': `import { top } from './consumer.js';\n\nexport function main() {\n  top();\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const execution = await executeReverseFunctionCallTree(rootDir, {
      path: 'src/forms.js',
      symbol: 'run',
      language: 'js',
      kind: 'method',
      max_depth: 5,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    expect(execution.rootClassName).toBe('Worker');
    expect(execution.result.root.class).toBe('Worker');
    expect(execution.result.root.callers?.[0]?.symbol).toBe('top');
    expect(execution.result.root.callers?.[0]?.callers?.[0]?.symbol).toBe('main');
  });
});
