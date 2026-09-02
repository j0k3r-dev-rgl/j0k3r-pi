import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { executeFunctionCallTree } from '../src/core/function-call-tree-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';

async function createProject(files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `pi-function-call-tree-ts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  const effectiveFiles = files['.pi/code-research.json'] === undefined
    ? { '.pi/code-research.json': `{"graph":{"enable":true}}
`, ...files }
    : files;

  for (const [relativePath, content] of Object.entries(effectiveFiles)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('function_call_tree TypeScript', () => {
  it('does not index callback-consuming call results as callable declarations', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `declare function consume<T>(value: T): { value: T };\nexport const Wrapped = (((() => 1) as () => number)!);\nexport const Direct = () => Wrapped();\nexport const NotCallable = consume(() => 1);\nexport function run(): void {\n  Direct();\n  Wrapped();\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const notCallable = await executeFunctionCallTree(rootDir, {
      path: 'src/service.ts',
      symbol: 'NotCallable',
      language: 'ts',
      kind: 'function',
    });
    expect(notCallable.status).toBe('not_found');

    const direct = await executeFunctionCallTree(rootDir, {
      path: 'src/service.ts',
      symbol: 'run',
      language: 'ts',
      kind: 'function',
      max_depth: 5,
    });
    expect(direct.status).toBe('ok');
    if (direct.status !== 'ok') return;
    expect(direct.result.root.children?.map((child) => child.symbol).sort()).toEqual(['Direct', 'Wrapped']);
  });

  it('follows imported functions recursively across project files', async () => {
    const rootDir = await createProject({
      'src/service.ts': `export function runService(): void {\n  helper();\n}\n\nfunction helper(): void {}\n`,
      'src/controller.ts': `import { runService } from './service';\n\nexport function handle(): void {\n  runService();\n}\n`,
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

    expect(execution.result.root.symbol).toBe('handle');
    expect(execution.result.root.kind).toBe('function');
    expect(execution.result.root.children?.[0].symbol).toBe('runService');
    expect(execution.result.root.children?.[0].kind).toBe('function');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
    expect(execution.result.stats.application_nodes).toBe(3);
  });

  it('resolves absolute file paths through the workspace graph root', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'app/service.ts': `export function runService(): void {\n  helper();\n}\n\nfunction helper(): void {}\n`,
      'app/routes/controller.ts': `import { runService } from '../service';\n\nexport async function loader(): Promise<void> {\n  runService();\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const execution = await executeFunctionCallTree(rootDir, {
      path: resolve(rootDir, 'app/routes/controller.ts'),
      symbol: 'loader',
      language: 'ts',
      kind: 'function',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    expect(execution.result.root.symbol).toBe('loader');
    expect(execution.result.root.children?.[0].symbol).toBe('runService');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
  });

  it('ignores generated output directories that contain oversized bundled files', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'app/service.ts': `export function runService(): void {\n  helper();\n}\n\nfunction helper(): void {}\n`,
      'app/routes/controller.ts': `import { runService } from '../service';\n\nexport async function loader(): Promise<void> {\n  runService();\n}\n`,
      'build/server/index.js': `export const bundle = "${'x'.repeat(1024 * 1024 + 64)}";\n`,
      '.react-router/types/routes.ts': `export const generated = true;\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'app/routes/controller.ts',
      symbol: 'loader',
      language: 'ts',
      kind: 'function',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    expect(execution.result.root.symbol).toBe('loader');
    expect(execution.result.root.children?.[0].symbol).toBe('runService');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
  });

  it('resolves tsconfig path aliases as application imports', async () => {
    const rootDir = await createProject({
      'tsconfig.json': `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./app/*"]
    }
  }
}
`,
      'app/server/auth/guards.server.ts': `export async function requirePermission(request: Request, roles: string[]) {\n  return requireAuthenticated(request, roles);\n}\n\nasync function requireAuthenticated(request: Request, roles: string[]) {\n  return { request, roles, token: 'x' };\n}\n`,
      'app/routes/root/resenia.tsx': `import { requirePermission } from '~/server/auth/guards.server';\n\nexport async function loader({ request }: { request: Request }) {\n  return requirePermission(request, ['ROLE_ROOT']);\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'app/routes/root/resenia.tsx',
      symbol: 'loader',
      language: 'ts',
      kind: 'function',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    const child = execution.result.root.children?.[0];
    expect(child?.symbol).toBe('requirePermission');
    expect(child?.node_type).toBe('application');
    expect(child?.children?.[0].symbol).toBe('requireAuthenticated');
    expect(execution.result.stats.application_nodes).toBe(3);
  });

  it('treats destructured exported bindings from internal alias modules as application call targets', async () => {
    const rootDir = await createProject({
      'tsconfig.json': `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./app/*"]
    }
  }
}
`,
      'app/services/cookies.service.server.ts': `const authSessionStorage = {\n  getSession: async function getSession(cookieHeader: string | null) {\n    return { cookieHeader };\n  },\n};\n\nexport const { getSession, commitSession } = authSessionStorage;\n`,
      'app/server/auth/session.server.ts': `import { getSession } from '~/services/cookies.service.server';\n\nexport async function getSessionInfo(request: Request) {\n  return getSession(request.headers.get('Cookie'));\n}\n`,
      'app/routes/root/resenia.tsx': `import { getSessionInfo } from '~/server/auth/session.server';\n\nexport async function loader({ request }: { request: Request }) {\n  return getSessionInfo(request);\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'app/routes/root/resenia.tsx',
      symbol: 'loader',
      language: 'ts',
      kind: 'function',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    const getSessionInfo = execution.result.root.children?.[0];
    expect(getSessionInfo?.symbol).toBe('getSessionInfo');
    expect(getSessionInfo?.node_type).toBe('application');
    expect(getSessionInfo?.children?.[0].symbol).toBe('getSession');
    expect(getSessionInfo?.children?.[0].node_type).toBe('application');
    expect(execution.result.stats.application_nodes).toBe(3);
  });

  it('follows class method calls through locally constructed instances', async () => {
    const rootDir = await createProject({
      'src/service.ts': `export class AppService {\n  run(): void {\n    this.helper();\n  }\n\n  private helper(): void {}\n}\n`,
      'src/controller.ts': `import { AppService } from './service';\n\nexport class Controller {\n  handle(): void {\n    const service = new AppService();\n    service.run();\n  }\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'src/controller.ts',
      symbol: 'handle',
      language: 'ts',
      kind: 'method',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    expect(execution.rootClassName).toBe('Controller');
    expect(execution.result.root.class).toBe('Controller');
    expect(execution.result.root.children?.[0].class).toBe('AppService');
    expect(execution.result.root.children?.[0].symbol).toBe('run');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
    expect(execution.result.root.children?.[0].children?.[0].class).toBe('AppService');
  });

  it('uses graph-backed locally constructed instance call trees', async () => {
    const rootDir = await createProject({
      'src/service.ts': `export class Worker {\n  run(): void {\n    this.helper();\n  }\n\n  helper(): void {}\n}\n`,
      'src/controller.ts': `import { Worker } from './service';\n\nexport function handle(): void {\n  const worker = new Worker();\n  worker.run();\n}\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const graph = await executeFunctionCallTree(rootDir, { path: 'src/controller.ts', symbol: 'handle', language: 'ts', kind: 'function', max_depth: 5 });

    expect(graph.status).toBe('ok');
    if (graph.status !== 'ok') return;

    const flatten = (node: any): string[] => [node.symbol, ...(node.children ?? []).flatMap(flatten)];
    expect(flatten(graph.result.root)).toEqual(['handle', 'run', 'helper']);
  });

  it('includes optional-chained TypeScript calls in graph-backed outgoing call trees', async () => {
    const rootDir = await createProject({
      'src/repository.ts': `export class Repository {\n  save(input: object): Promise<void> { void input; return Promise.resolve(); }\n}\n`,
      'src/processor.ts': `import { Repository } from './repository';\nexport class Processor {\n  constructor(private repo?: Repository) {}\n  async persist(repo: Repository): Promise<void> {\n    await this.repo?.save({ source: 'field' });\n    await repo?.save({ source: 'param' });\n    await repo.save({ source: 'normal' });\n    await repo.save?.({ source: 'optional-call' });\n  }\n}\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const graph = await executeFunctionCallTree(rootDir, { path: 'src/processor.ts', symbol: 'persist', language: 'ts', kind: 'method', max_depth: 2 });

    expect(graph.status).toBe('ok');
    if (graph.status !== 'ok') return;

    const summarize = (node: any): string[] => (node.children ?? []).map((child: any) => `${child.receiver_name}:${child.receiver_type}:${child.symbol}`).sort();
    expect(summarize(graph.result.root)).toEqual([
      'repo:Repository:save',
      'repo:Repository:save',
      'repo:Repository:save',
      'this.repo:Repository:save',
    ]);
  });

  it('uses graph-backed type-alias object members for outgoing call trees', async () => {
    const rootDir = await createProject({
      'src/use-case.ts': `export type Scheduler = {\n  enqueue(record: object): void;\n  acceptsNewWork(): boolean;\n};\n\nexport class UseCase {\n  constructor(private readonly scheduler: Scheduler) {}\n  execute(record: object): void {\n    if (!this.scheduler.acceptsNewWork()) return;\n    this.scheduler.enqueue(record);\n  }\n}\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const graph = await executeFunctionCallTree(rootDir, { path: 'src/use-case.ts', symbol: 'execute', language: 'ts', kind: 'method', max_depth: 2 });

    expect(graph.status).toBe('ok');
    if (graph.status !== 'ok') return;

    expect((graph.result.root.children ?? []).map((child: any) => `${child.class}.${child.symbol}`).sort()).toEqual([
      'Scheduler.acceptsNewWork',
      'Scheduler.enqueue',
    ]);
  });

  it('uses graph-backed inline-import typed receiver call trees', async () => {
    const rootDir = await createProject({
      'src/service.ts': `export class A {\n  run(): void {\n    this.helper();\n  }\n\n  helper(): void {}\n}\n`,
      'src/owner.ts': `export function ownerCalls(a: import('./service').A): void {\n  a.run();\n}\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const graph = await executeFunctionCallTree(rootDir, { path: 'src/owner.ts', symbol: 'ownerCalls', language: 'ts', kind: 'function', max_depth: 5 });

    expect(graph.status).toBe('ok');
    if (graph.status !== 'ok') return;

    const flatten = (node: any): string[] => [`${node.class ?? '<module>'}.${node.symbol}`, ...(node.children ?? []).flatMap(flatten)];
    expect(flatten(graph.result.root)).toEqual(['<module>.ownerCalls', 'A.run', 'A.helper']);
    expect(graph.result.root.children?.[0]?.receiver_type).toBe('A');
  });
});
