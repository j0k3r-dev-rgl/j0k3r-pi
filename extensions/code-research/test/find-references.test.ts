import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findReferences } from '../src/core/find-references-resolver.js';
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

describe('find_references', () => {
  it('finds TypeScript call references for a function across multiple files', async () => {
    const rootDir = await createProject('pi-find-references-ts', {
      'src/service.ts': `export function helper(): void {}\n\nexport function runService(): void {\n  helper();\n}\n\nexport function warmupService(): void {\n  helper();\n}\n`,
      'src/controller.ts': `import { runService, warmupService } from './service';\n\nexport function handleRequest(): void {\n  runService();\n}\n\nexport function warmupRoute(): void {\n  warmupService();\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/service.ts',
      symbol: 'helper',
      language: 'ts',
      kind: 'function',
    });

    expect(results).toHaveLength(2);
    expect(results.map((item) => item.context_symbol).sort()).toEqual(['runService', 'warmupService']);
    expect(results.every((item) => item.reference_kind === 'call')).toBe(true);
    expect(results.every((item) => item.called_as === 'helper()')).toBe(true);
  });

  it('finds JavaScript call references for a function across multiple files', async () => {
    const rootDir = await createProject('pi-find-references-js', {
      'src/service.js': `export function helper() {}\n\nexport function runService() {\n  helper();\n}\n\nexport function warmupService() {\n  helper();\n}\n`,
      'src/controller.js': `import { runService, warmupService } from './service.js';\n\nexport function handleRequest() {\n  runService();\n}\n\nexport function warmupRoute() {\n  warmupService();\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/service.js',
      symbol: 'helper',
      language: 'js',
      kind: 'function',
    });

    expect(results).toHaveLength(2);
    expect(results.map((item) => item.context_symbol).sort()).toEqual(['runService', 'warmupService']);
    expect(results.every((item) => item.reference_kind === 'call')).toBe(true);
  });

  it('finds Java call references for a method across multiple classes', async () => {
    const rootDir = await createProject('pi-find-references-java', {
      'src/main/java/app/AppService.java': `package app;\n\npublic class AppService {\n  public void run() {\n    helper();\n  }\n\n  public void warmup() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport app.AppService;\n\npublic class Controller {\n  private final AppService service;\n\n  public Controller(AppService service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/main/java/app/AppService.java',
      symbol: 'helper',
      language: 'java',
      kind: 'method',
    });

    expect(results).toHaveLength(2);
    expect(results.map((item) => item.context_symbol).sort()).toEqual(['run', 'warmup']);
    expect(results.every((item) => item.reference_kind === 'call')).toBe(true);
  });

  it('finds TypeScript class references for import instantiate extends and type_reference cases', async () => {
    const rootDir = await createProject('pi-find-references-ts-class', {
      'src/service.ts': `export class Service {}\n`,
      'src/controller.ts': `import { Service } from './service';\n\nexport class Controller extends Service {\n  private current: Service = new Service();\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/service.ts',
      symbol: 'Service',
      language: 'ts',
      kind: 'class',
    });

    expect(results.map((item) => item.reference_kind).sort()).toEqual(['extends', 'import', 'instantiate', 'type_reference']);
  });

  it('finds TypeScript interface references for import implements extends and type_reference cases', async () => {
    const rootDir = await createProject('pi-find-references-ts-interface', {
      'src/service.ts': `export interface Service {}\n`,
      'src/impl.ts': `import { Service } from './service';\n\nexport interface ExtendedService extends Service {}\n\nexport class LocalService implements Service {\n  constructor(private service: Service) {}\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/service.ts',
      symbol: 'Service',
      language: 'ts',
      kind: 'interface',
    });

    expect(results.map((item) => item.reference_kind).sort()).toEqual(['extends', 'implements', 'import', 'type_reference']);
  });

  it('finds Java class references for import instantiate extends and type_reference cases', async () => {
    const rootDir = await createProject('pi-find-references-java-class', {
      'src/main/java/app/AppService.java': `package app;\n\npublic class AppService {}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport app.AppService;\n\npublic class Controller extends AppService {\n  private final AppService current = new AppService();\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/main/java/app/AppService.java',
      symbol: 'AppService',
      language: 'java',
      kind: 'class',
    });

    expect(results.map((item) => item.reference_kind).sort()).toEqual(['extends', 'import', 'instantiate', 'type_reference']);
  });

  it('finds Java interface references for import implements extends and type_reference cases', async () => {
    const rootDir = await createProject('pi-find-references-java-interface', {
      'src/main/java/ports/Service.java': `package ports;\n\npublic interface Service {}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport ports.Service;\n\npublic class AppService implements Service {}\n`,
      'src/main/java/ports/ExtendedService.java': `package ports;\n\npublic interface ExtendedService extends Service {}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport ports.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/main/java/ports/Service.java',
      symbol: 'Service',
      language: 'java',
      kind: 'interface',
    });

    expect(new Set(results.map((item) => item.reference_kind))).toEqual(new Set(['extends', 'implements', 'import', 'type_reference']));
  });

  it('finds TypeScript variable read and write references for obvious cases', async () => {
    const rootDir = await createProject('pi-find-references-ts-variable', {
      'src/state.ts': `export let counter = 0;\n\nexport function setCounter(value: number): void {\n  counter = value;\n}\n\nexport function getCounter(): number {\n  return counter;\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/state.ts',
      symbol: 'counter',
      language: 'ts',
      kind: 'variable',
    });

    expect(new Set(results.map((item) => item.reference_kind))).toEqual(new Set(['read', 'write']));
    expect(results.find((item) => item.reference_kind === 'write')?.context_symbol).toBe('setCounter');
    expect(results.find((item) => item.reference_kind === 'read')?.context_symbol).toBe('getCounter');
  });

  it('finds JavaScript variable read and write references for obvious cases', async () => {
    const rootDir = await createProject('pi-find-references-js-variable', {
      'src/state.js': `export let counter = 0;\n\nexport function setCounter(value) {\n  counter = value;\n}\n\nexport function getCounter() {\n  return counter;\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/state.js',
      symbol: 'counter',
      language: 'js',
      kind: 'variable',
    });

    expect(new Set(results.map((item) => item.reference_kind))).toEqual(new Set(['read', 'write']));
    expect(results.find((item) => item.reference_kind === 'write')?.context_symbol).toBe('setCounter');
    expect(results.find((item) => item.reference_kind === 'read')?.context_symbol).toBe('getCounter');
  });

  it('finds Java field read and write references for obvious cases', async () => {
    const rootDir = await createProject('pi-find-references-java-variable', {
      'src/main/java/app/AppService.java': `package app;\n\npublic class AppService {\n  private int counter;\n\n  public void setCounter(int value) {\n    this.counter = value;\n  }\n\n  public int getCounter() {\n    return counter;\n  }\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/main/java/app/AppService.java',
      symbol: 'counter',
      language: 'java',
      kind: 'variable',
    });

    expect(new Set(results.map((item) => item.reference_kind))).toEqual(new Set(['read', 'write']));
    expect(results.find((item) => item.reference_kind === 'write')?.context_symbol).toBe('setCounter');
    expect(results.find((item) => item.reference_kind === 'read')?.context_symbol).toBe('getCounter');
  });

  it('finds TypeScript arrow function, alias call, and callback references', async () => {
    const rootDir = await createProject('pi-find-references-ts-callbacks', {
      'src/helpers.ts': `export const helper = () => {};\n\nexport function register(cb: () => void): void {\n  cb();\n}\n\nexport function run(): void {\n  const alias = helper;\n  alias();\n  register(helper);\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/helpers.ts',
      symbol: 'helper',
      language: 'ts',
      kind: 'function',
    });

    expect(new Set(results.map((item) => item.reference_kind))).toEqual(new Set(['call', 'callback']));
    expect(results.filter((item) => item.reference_kind === 'call').map((item) => item.context_symbol)).toContain('run');
    expect(results.filter((item) => item.reference_kind === 'callback').map((item) => item.context_symbol)).toContain('run');
  });

  it('finds JavaScript destructured export, direct call, and callback references', async () => {
    const rootDir = await createProject('pi-find-references-js-callbacks', {
      'src/helpers.js': `const fns = { helper: () => {} };\nexport const { helper } = fns;\n\nexport function useLater(cb) {\n  cb();\n}\n\nexport function run() {\n  helper();\n  useLater(helper);\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/helpers.js',
      symbol: 'helper',
      language: 'js',
      kind: 'function',
    });

    expect(new Set(results.map((item) => item.reference_kind))).toEqual(new Set(['call', 'callback']));
    expect(results.filter((item) => item.reference_kind === 'call').map((item) => item.context_symbol)).toContain('run');
    expect(results.filter((item) => item.reference_kind === 'callback').map((item) => item.context_symbol)).toContain('run');
  });

  it('does not leak same-named ts/js function references across language-specific file queries', async () => {
    const rootDir = await createProject('pi-find-references-ts-js-scope', {
      'src/helpers.ts': `export const helper = () => {};\n\nexport function register(cb: () => void): void {\n  cb();\n}\n\nexport function runTs(): void {\n  const alias = helper;\n  alias();\n  register(helper);\n}\n`,
      'src/helpers.js': `export const helper = () => {};\n\nexport function useLater(cb) {\n  cb();\n}\n\nexport function runJs() {\n  helper();\n  useLater(helper);\n}\n`,
    });

    const tsResults = await findReferences(rootDir, {
      path: 'src/helpers.ts',
      symbol: 'helper',
      language: 'ts',
      kind: 'function',
    });

    const jsResults = await findReferences(rootDir, {
      path: 'src/helpers.js',
      symbol: 'helper',
      language: 'js',
      kind: 'function',
    });

    expect(new Set(tsResults.map((item) => item.context_symbol))).toEqual(new Set(['runTs']));
    expect(new Set(jsResults.map((item) => item.context_symbol))).toEqual(new Set(['runJs']));
    expect(tsResults.every((item) => item.file.endsWith('helpers.ts'))).toBe(true);
    expect(jsResults.every((item) => item.file.endsWith('helpers.js'))).toBe(true);
  });

  it('finds Java lambda callback and method reference usages for a method', async () => {
    const rootDir = await createProject('pi-find-references-java-callbacks', {
      'src/main/java/app/AppService.java': `package app;\n\npublic class AppService {\n  interface Runner {\n    void run();\n  }\n\n  private void helper() {}\n\n  private void consume(Runner runner) {\n    runner.run();\n  }\n\n  public void run() {\n    consume(() -> helper());\n    consume(this::helper);\n  }\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/main/java/app/AppService.java',
      symbol: 'helper',
      language: 'java',
      kind: 'method',
    });

    const referenceKinds = new Set(results.map((item) => item.reference_kind));
    expect(referenceKinds.has('callback')).toBe(true);
    expect(referenceKinds.has('method_reference')).toBe(true);
    expect(results.filter((item) => item.reference_kind === 'callback').map((item) => item.context_symbol)).toContain('run');
    expect(results.filter((item) => item.reference_kind === 'method_reference').map((item) => item.context_symbol)).toContain('run');
  });

  it('keeps graph-backed and fallback call references aligned where both can answer', async () => {
    const files = {
      'src/main/java/app/AppService.java': `package app;\n\npublic class AppService {\n  public void run() {\n    helper();\n  }\n\n  public void warmup() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport app.AppService;\n\npublic class Controller {\n  private final AppService service;\n\n  public Controller(AppService service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
    };

    const fallbackRoot = await createProject('pi-find-references-graph-parity-fallback', files);
    const graphRoot = await createProject('pi-find-references-graph-parity-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });

    await buildWorkspaceGraph(graphRoot);

    const fallbackResults = await findReferences(fallbackRoot, {
      path: 'src/main/java/app/AppService.java',
      symbol: 'helper',
      language: 'java',
      kind: 'method',
    });

    const graphResults = await findReferences(graphRoot, {
      path: 'src/main/java/app/AppService.java',
      symbol: 'helper',
      language: 'java',
      kind: 'method',
    });

    expect(fallbackResults.map((item) => `${item.reference_kind}:${item.context_symbol}`).sort()).toEqual(
      graphResults.map((item) => `${item.reference_kind}:${item.context_symbol}`).sort()
    );
  });

  it('prefers graph-backed references when graph is enabled and available', async () => {
    const rootDir = await createProject('pi-find-references-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/ports/Service.java': `package ports;\n\npublic interface Service {}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport ports.Service;\n\npublic class AppService implements Service {}\n`,
      'src/main/java/ports/ExtendedService.java': `package ports;\n\npublic interface ExtendedService extends Service {}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src/main/java/ports/Service.java',
      symbol: 'Service',
      language: 'java',
      kind: 'interface',
    });

    expect(new Set(results.map((item) => item.reference_kind))).toEqual(new Set(['implements']));
  });
});
