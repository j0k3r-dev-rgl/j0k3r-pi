import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findReferences } from '../src/core/find-references-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import { registerCodeFindTool } from '../src/tools/code-find.js';

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

function registerToolForTest(register: (pi: any) => void): any {
  let tool: any;
  register({ registerTool(definition: any) { tool = definition; } });
  return tool;
}

describe('find_references', () => {
  it('does not treat callback-consuming call results as callable reference targets', async () => {
    const rootDir = await createProject('pi-find-references-ts-non-callable', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `declare function consume<T>(value: T): { value: T };\nexport const Wrapped = (((() => 1) as () => number)!);\nexport const NotCallable = consume(() => 1);\nexport function run(): void {\n  Wrapped();\n  NotCallable();\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const wrapped = await findReferences(rootDir, {
      path: 'src/service.ts',
      symbol: 'Wrapped',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
    });
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].context_symbol).toBe('run');

    const notCallable = await findReferences(rootDir, {
      path: 'src/service.ts',
      symbol: 'NotCallable',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
    });
    expect(notCallable).toEqual([]);
  });

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

  it('finds TypeScript call references inside nested function bodies', async () => {
    const rootDir = await createProject('pi-find-references-ts-nested', {
      'src/runtime-state.ts': `export function setCurrentMemorySessionId(id: string | undefined): void {\n  void id;\n}\n`,
      'src/lifecycle.ts': `import { setCurrentMemorySessionId } from './runtime-state.js';\n\nexport function registerMemoryLifecycle(): void {\n  function ensureMemorySession(activeMemorySessionId: string): void {\n    setCurrentMemorySessionId(activeMemorySessionId);\n  }\n\n  const closeActiveMemorySession = async (): Promise<void> => {\n    setCurrentMemorySessionId(undefined);\n  };\n\n  ensureMemorySession('session_1');\n  void closeActiveMemorySession;\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/runtime-state.ts',
      symbol: 'setCurrentMemorySessionId',
      language: 'ts',
      kind: 'function',
    });

    expect(results.map((item) => item.called_as).sort()).toEqual([
      'setCurrentMemorySessionId(activeMemorySessionId)',
      'setCurrentMemorySessionId(undefined)',
    ]);
    expect(results.every((item) => item.reference_kind === 'call')).toBe(true);
  });

  it('finds TypeScript class and method references through .js imports and constructed receivers', async () => {
    const rootDir = await createProject('pi-find-references-ts-class-method-js-import', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'tsconfig.json': `{}\n`,
      'src/application/review-analysis/review-analysis-processor.ts': `export class ReviewAnalysisProcessor {\n  stop(): void {}\n}\n`,
      'src/server.ts': `import { ReviewAnalysisProcessor } from "./application/review-analysis/review-analysis-processor.js";\nlet injected?: ReviewAnalysisProcessor;\nconst reviewAnalysisProcessor = injected ?? new ReviewAnalysisProcessor();\nreviewAnalysisProcessor.stop();\n`,
      'test/unit/review-analysis-processor.test.ts': `import { ReviewAnalysisProcessor } from "../../src/application/review-analysis/review-analysis-processor.js";\nconst processor = new ReviewAnalysisProcessor();\nprocessor.stop();\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const classRefs = await findReferences(rootDir, {
      path: 'src/application/review-analysis/review-analysis-processor.ts',
      symbol: 'ReviewAnalysisProcessor',
      language: 'ts',
      kind: 'class',
      compare_direct_fallback: true,
    });
    expect(classRefs.map((item) => `${item.reference_kind}:${item.line}`).sort()).toEqual([
      'import:1',
      'import:1',
      'instantiate:2',
      'instantiate:3',
      'type_reference:2',
    ]);

    const methodRefs = await findReferences(rootDir, {
      path: 'src/application/review-analysis/review-analysis-processor.ts',
      symbol: 'stop',
      language: 'ts',
      kind: 'method',
      reference_kinds: ['call'],
      compare_direct_fallback: true,
    });
    expect(methodRefs.map((item) => item.called_as).sort()).toEqual(['processor.stop()', 'reviewAnalysisProcessor.stop()']);
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

  it('filters fallback references by requested reference kinds', async () => {
    const rootDir = await createProject('pi-find-references-filter-kinds', {
      'src/helpers.ts': `export const helper = () => {};\n\nexport function register(cb: () => void): void {\n  cb();\n}\n\nexport function run(): void {\n  helper();\n  register(helper);\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/helpers.ts',
      symbol: 'helper',
      language: 'ts',
      kind: 'function',
      reference_kinds: ['call'],
    });

    expect(results).toHaveLength(1);
    expect(results[0].reference_kind).toBe('call');
    expect(results[0].called_as).toBe('helper()');
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

  it('keeps all uniquely resolved Java overload references instead of collapsing to the first declaration', async () => {
    const files = {
      'src/main/java/app/Example.java': `package app;\n\npublic class Example {\n  public void runInt() { process(1); }\n  public void runString() { process("x"); }\n  private void process(int value) {}\n  private void process(String value) {}\n}\n`,
    };
    const directRoot = await createProject('pi-find-references-java-overloads-direct', files);
    const graphRoot = await createProject('pi-find-references-java-overloads-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const query = {
      path: 'src/main/java/app/Example.java',
      symbol: 'process',
      language: 'java' as const,
      kind: 'method' as const,
      reference_kinds: ['call' as const],
    };
    const direct = await findReferences(directRoot, query);
    const graph = await findReferences(graphRoot, query);
    const normalizeDirect = (results: typeof direct) => results.map((item) => `${item.context_symbol}:${item.called_as}`).sort();
    const normalizeGraph = (results: typeof graph) => results.map((item) => `${item.context_symbol}:${item.line}:${item.column}`).sort();

    expect(normalizeDirect(direct)).toEqual(['runInt:process(1)', 'runString:process("x")']);
    expect(normalizeGraph(graph)).toEqual(['runInt:4:25', 'runString:5:28']);
  });

  it('does not leak ambiguous overload-group graph edges across canonical Java owners', async () => {
    const rootDir = await createProject('pi-find-references-java-overload-owner-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/a/Target.java': `package a;\npublic class Target {\n  void process(String value) {}\n  void process(Integer value) {}\n}\n`,
      'src/main/java/b/Other.java': `package b;\npublic class Other {\n  void run(Object value) { process(value); }\n  void process(String value) {}\n  void process(Integer value) {}\n}\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src/main/java/a/Target.java',
      symbol: 'process',
      language: 'java',
      kind: 'method',
      reference_kinds: ['call'],
    });

    expect(results).toEqual([]);
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

  it('keeps same-file TSX and JSX component reads aligned in direct and graph modes', async () => {
    const files = {
      'src/ts-view.tsx': `export const Shared = () => <section />;\nexport function Screen() {\n  return <Shared />;\n}\n`,
      'src/js-view.jsx': `export const SharedJs = () => <section />;\nexport function ScreenJs() {\n  return <SharedJs />;\n}\n`,
    };

    const directRoot = await createProject('pi-find-references-jsx-direct', files);
    const graphRoot = await createProject('pi-find-references-jsx-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const directTs = await findReferences(directRoot, { path: 'src/ts-view.tsx', symbol: 'Shared', language: 'ts', kind: 'function', reference_kinds: ['read'] });
    const graphTs = await findReferences(graphRoot, { path: 'src/ts-view.tsx', symbol: 'Shared', language: 'ts', kind: 'function', reference_kinds: ['read'] });
    const directJs = await findReferences(directRoot, { path: 'src/js-view.jsx', symbol: 'SharedJs', language: 'js', kind: 'function', reference_kinds: ['read'] });
    const graphJs = await findReferences(graphRoot, { path: 'src/js-view.jsx', symbol: 'SharedJs', language: 'js', kind: 'function', reference_kinds: ['read'] });

    const normalize = (results: typeof directTs) => results.map((item) => ({ file: item.file.split('/').slice(-2).join('/'), line: item.line, column: item.column, context_symbol: item.context_symbol, reference_kind: item.reference_kind }));
    expect(normalize(graphTs)).toEqual(normalize(directTs));
    expect(normalize(graphJs)).toEqual(normalize(directJs));
  });

  it('keeps wrapped TSX component reads aligned in direct and graph modes', async () => {
    const files = {
      'src/Shared.tsx': `export const Shared = () => <section />;\n`,
      'src/Screen.tsx': `import { Shared } from './Shared';\nconst Wrapped = (((() => <Shared />) as () => JSX.Element))!;\nexport function Screen() {\n  return <Wrapped />;\n}\n`,
    };

    const directRoot = await createProject('pi-find-references-wrapped-jsx-direct', files);
    const graphRoot = await createProject('pi-find-references-wrapped-jsx-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const direct = await findReferences(directRoot, { path: 'src/Shared.tsx', symbol: 'Shared', language: 'ts', kind: 'function', reference_kinds: ['read'] });
    const graph = await findReferences(graphRoot, { path: 'src/Shared.tsx', symbol: 'Shared', language: 'ts', kind: 'function', reference_kinds: ['read'] });

    expect(graph.map((item) => `${item.context_symbol}:${item.line}:${item.column}`)).toEqual(direct.map((item) => `${item.context_symbol}:${item.line}:${item.column}`));
  });

  it('keeps callback-body TSX reads without promoting callback results into callables', async () => {
    const files = {
      'src/Shared.tsx': `export const Shared = () => <section />;\n`,
      'src/Screen.tsx': `declare function consume<T>(value: T): { value: T };\nimport { Shared } from './Shared';\nconst NotCallable = consume(() => <Shared />);\n`,
    };

    const directRoot = await createProject('pi-find-references-callback-jsx-direct', files);
    const graphRoot = await createProject('pi-find-references-callback-jsx-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const directReads = await findReferences(directRoot, { path: 'src/Shared.tsx', symbol: 'Shared', language: 'ts', kind: 'function', reference_kinds: ['read'] });
    const graphReads = await findReferences(graphRoot, { path: 'src/Shared.tsx', symbol: 'Shared', language: 'ts', kind: 'function', reference_kinds: ['read'], compare_direct_fallback: true });
    const graphCalls = await findReferences(graphRoot, { path: 'src/Screen.tsx', symbol: 'NotCallable', language: 'ts', kind: 'function', reference_kinds: ['call'] });

    expect(directReads).toHaveLength(1);
    expect(graphReads.map((item) => `${item.context_symbol}:${item.line}:${item.column}`)).toEqual(
      directReads.map((item) => `${item.context_symbol}:${item.line}:${item.column}`)
    );
    expect(graphCalls).toEqual([]);
  });

  it('keeps locally constructed instance method call references aligned in direct and graph modes', async () => {
    const files = {
      'src/service.ts': `export class Worker {\n  run(): void {\n    this.helper();\n  }\n\n  helper(): void {}\n}\n`,
      'src/controller.ts': `import { Worker } from './service';\n\nexport function handle(): void {\n  const worker = new Worker();\n  worker.run();\n}\n`,
    };

    const directRoot = await createProject('pi-find-references-local-instance-direct', files);
    const graphRoot = await createProject('pi-find-references-local-instance-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const direct = await findReferences(directRoot, { path: 'src/service.ts', symbol: 'run', language: 'ts', kind: 'method', reference_kinds: ['call'] });
    const graph = await findReferences(graphRoot, { path: 'src/service.ts', symbol: 'run', language: 'ts', kind: 'method', reference_kinds: ['call'] });

    expect(graph.map((item) => `${item.context_symbol}:${item.line}:${item.column}:${item.receiver_name}:${item.receiver_type}`)).toEqual(
      direct.map((item) => `${item.context_symbol}:${item.line}:${item.column}:${item.receiver_name}:${item.receiver_type}`)
    );
  });

  it('keeps namespace-import function call references aligned in direct and graph modes', async () => {
    const files = {
      'src/forms.js': `export function declared(name) {\n  return name;\n}\n`,
      'src/consumer.js': `import * as Forms from './forms.js';\n\nexport function middle() {\n  Forms.declared('ns');\n}\n`,
    };

    const directRoot = await createProject('pi-find-references-namespace-direct', files);
    const graphRoot = await createProject('pi-find-references-namespace-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const direct = await findReferences(directRoot, { path: 'src/forms.js', symbol: 'declared', language: 'js', kind: 'function', reference_kinds: ['call'] });
    const graph = await findReferences(graphRoot, { path: 'src/forms.js', symbol: 'declared', language: 'js', kind: 'function', reference_kinds: ['call'] });

    expect(graph.map((item) => `${item.context_symbol}:${item.line}:${item.column}:${item.receiver_name}`)).toEqual(
      direct.map((item) => `${item.context_symbol}:${item.line}:${item.column}:${item.receiver_name}`)
    );
  });

  it('keeps expression-bodied arrow function call references aligned in direct and graph modes', async () => {
    const files = {
      'src/forms.js': `export function declared(name) {\n  return name;\n}\n\nexport const arrow = name => declared(name);\n`,
    };

    const directRoot = await createProject('pi-find-references-arrow-direct', files);
    const graphRoot = await createProject('pi-find-references-arrow-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const direct = await findReferences(directRoot, { path: 'src/forms.js', symbol: 'declared', language: 'js', kind: 'function', reference_kinds: ['call'] });
    const graph = await findReferences(graphRoot, { path: 'src/forms.js', symbol: 'declared', language: 'js', kind: 'function', reference_kinds: ['call'] });

    expect(graph.map((item) => `${item.context_symbol}:${item.line}:${item.column}`)).toEqual(direct.map((item) => `${item.context_symbol}:${item.line}:${item.column}`));
    expect(direct.map((item) => item.context_symbol)).toContain('arrow');
  });

  it('keeps provable local alias and transparent-wrapper calls aligned in direct and graph modes', async () => {
    const files = {
      'src/forms.js': `export const helper = () => 1;\nexport const Wrapped = (((() => helper())));\nexport function user() {\n  const alias = helper;\n  return alias();\n}\n`,
    };

    const directRoot = await createProject('pi-find-references-alias-direct', files);
    const graphRoot = await createProject('pi-find-references-alias-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const direct = await findReferences(directRoot, { path: 'src/forms.js', symbol: 'helper', language: 'js', kind: 'function', reference_kinds: ['call'] });
    const graph = await findReferences(graphRoot, { path: 'src/forms.js', symbol: 'helper', language: 'js', kind: 'function', reference_kinds: ['call'] });

    expect(graph.map((item) => `${item.context_symbol}:${item.line}:${item.column}`)).toEqual(direct.map((item) => `${item.context_symbol}:${item.line}:${item.column}`));
    expect(new Set(direct.map((item) => item.context_symbol))).toEqual(new Set(['Wrapped', 'user']));
  });

  it('finds Java interface method calls through interface-typed fields and lambdas', async () => {
    const files = {
      'src/main/java/app/RootDeleteReview.java': `package app;\n\npublic interface RootDeleteReview {\n  void deleteById(String id);\n}\n`,
      'src/main/java/app/RootDeleteReviewUseCase.java': `package app;\n\npublic class RootDeleteReviewUseCase implements RootDeleteReview {\n  public void deleteById(String id) {}\n}\n`,
      'src/main/java/app/RootReviewRestController.java': `package app;\n\npublic class RootReviewRestController {\n  private final RootDeleteReview rootDeleteReview;\n\n  public RootReviewRestController(RootDeleteReview rootDeleteReview) {\n    this.rootDeleteReview = rootDeleteReview;\n  }\n\n  public void deleteReview(String id) {\n    rootDeleteReview.deleteById(id);\n  }\n}\n`,
      'src/test/java/app/RootDeleteReviewUseCaseTest.java': `package app;\n\nimport static org.junit.jupiter.api.Assertions.assertThrows;\n\nclass RootDeleteReviewUseCaseTest {\n  private final RootDeleteReview useCase = new RootDeleteReviewUseCase();\n\n  void direct() {\n    useCase.deleteById("1");\n  }\n\n  void assertion() {\n    assertThrows(RuntimeException.class, () -> useCase.deleteById("2"));\n  }\n}\n`,
    };

    const directRoot = await createProject('pi-find-references-java-interface-method-direct', files);
    const graphRoot = await createProject('pi-find-references-java-interface-method-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const direct = await findReferences(directRoot, { path: 'src/main/java/app/RootDeleteReview.java', symbol: 'deleteById', language: 'java', kind: 'method', reference_kinds: ['call'] });
    const graph = await findReferences(graphRoot, { path: 'src/main/java/app/RootDeleteReview.java', symbol: 'deleteById', language: 'java', kind: 'method', reference_kinds: ['call'] });

    expect(new Set(direct.map((item) => `${item.context_class}.${item.context_symbol}`))).toEqual(new Set(['RootReviewRestController.deleteReview', 'RootDeleteReviewUseCaseTest.direct', 'RootDeleteReviewUseCaseTest.assertion']));
    expect(new Set(graph.map((item) => `${item.context_class}.${item.context_symbol}`))).toEqual(new Set(['RootReviewRestController.deleteReview', 'RootDeleteReviewUseCaseTest.direct', 'RootDeleteReviewUseCaseTest.assertion']));
  });

  it('keeps Java field reads truthful, includes record implementations, and falls back for diamond instantiation references', async () => {
    const files = {
      'src/main/java/app/Base.java': `package app;\n\npublic class Base {\n  protected int baseValue;\n}\n`,
      'src/main/java/app/Worker.java': `package app;\n\npublic class Worker extends Base implements Service<String> {\n  private int first;\n\n  int readFirst() {\n    return first;\n  }\n\n  int readBase() {\n    return baseValue;\n  }\n}\n`,
      'src/main/java/app/Job.java': `package app;\n\npublic record Job(String name) implements Service<String> {}\n`,
      'src/main/java/app/Service.java': `package app;\n\npublic interface Service<T> {}\n`,
      'src/main/java/app/UseWorker.java': `package app;\n\npublic class UseWorker {\n  Worker create() {\n    return new Worker<>();\n  }\n}\n`,
    };

    const directRoot = await createProject('pi-find-references-java-remediation-direct', files);
    const graphRoot = await createProject('pi-find-references-java-remediation-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const directFirst = await findReferences(directRoot, { path: 'src/main/java/app/Worker.java', symbol: 'first', language: 'java', kind: 'variable', reference_kinds: ['read'] });
    const graphFirst = await findReferences(graphRoot, { path: 'src/main/java/app/Worker.java', symbol: 'first', language: 'java', kind: 'variable', reference_kinds: ['read'], compare_direct_fallback: true });
    const directBase = await findReferences(directRoot, { path: 'src/main/java/app/Base.java', symbol: 'baseValue', language: 'java', kind: 'variable', reference_kinds: ['read'] });
    const graphBase = await findReferences(graphRoot, { path: 'src/main/java/app/Base.java', symbol: 'baseValue', language: 'java', kind: 'variable', reference_kinds: ['read'], compare_direct_fallback: true });
    const directImplements = await findReferences(directRoot, { path: 'src/main/java/app/Service.java', symbol: 'Service', language: 'java', kind: 'interface', reference_kinds: ['implements'] });
    const graphImplements = await findReferences(graphRoot, { path: 'src/main/java/app/Service.java', symbol: 'Service', language: 'java', kind: 'interface', reference_kinds: ['implements'], compare_direct_fallback: true });
    const directInstantiate = await findReferences(directRoot, { path: 'src/main/java/app/Worker.java', symbol: 'Worker', language: 'java', kind: 'class', reference_kinds: ['instantiate'] });
    const graphInstantiate = await findReferences(graphRoot, { path: 'src/main/java/app/Worker.java', symbol: 'Worker', language: 'java', kind: 'class', reference_kinds: ['instantiate'], compare_direct_fallback: true });

    expect(graphFirst.map((item) => `${item.context_class}.${item.context_symbol}:${item.reference_kind}`)).toEqual(
      directFirst.map((item) => `${item.context_class}.${item.context_symbol}:${item.reference_kind}`)
    );
    expect(graphBase.map((item) => `${item.context_class}.${item.context_symbol}:${item.reference_kind}`)).toEqual(
      directBase.map((item) => `${item.context_class}.${item.context_symbol}:${item.reference_kind}`)
    );
    expect(new Set(directImplements.map((item) => item.context_class))).toEqual(new Set(['Job', 'Worker']));
    expect(new Set(graphImplements.map((item) => item.context_class))).toEqual(new Set(['Job', 'Worker']));
    expect(directInstantiate.map((item) => item.called_as ?? `${item.line}:${item.column}`)).toHaveLength(1);
    expect(graphInstantiate.map((item) => item.called_as ?? `${item.line}:${item.column}`)).toEqual(
      directInstantiate.map((item) => item.called_as ?? `${item.line}:${item.column}`)
    );
  });

  it('falls back to complete direct references when graph coverage is incomplete and direct comparison is requested', async () => {
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
      compare_direct_fallback: true,
    });

    expect(new Set(results.map((item) => item.reference_kind))).toEqual(new Set(['extends', 'implements', 'import']));
  });

  it('keeps owner identity stable for same-named Java interfaces across packages in direct and graph modes', async () => {
    const files = {
      'src/main/java/ports/Service.java': `package ports;\n\npublic interface Service {}\n`,
      'src/main/java/api/Service.java': `package api;\n\npublic interface Service {}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport api.Service;\n\npublic class AppService implements Service {}\n`,
    };

    const fallbackRoot = await createProject('pi-find-references-java-owner-fallback', files);
    const graphRoot = await createProject('pi-find-references-java-owner-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });

    await buildWorkspaceGraph(graphRoot);

    const fallbackResults = await findReferences(fallbackRoot, {
      path: 'src/main/java/ports/Service.java',
      symbol: 'Service',
      language: 'java',
      kind: 'interface',
    });
    const graphResults = await findReferences(graphRoot, {
      path: 'src/main/java/ports/Service.java',
      symbol: 'Service',
      language: 'java',
      kind: 'interface',
    });

    expect(fallbackResults).toEqual([]);
    expect(graphResults).toEqual([]);
  });

  it('keeps java extends reference metadata aligned in direct and graph modes', async () => {
    const files = {
      'src/main/java/app/WorkerBase.java': `package app;\n\npublic class WorkerBase {}\n`,
      'src/main/java/app/Worker.java': `package app;\n\npublic class Worker extends WorkerBase {}\n`,
      'src/main/java/app/Task.java': `package app;\n\npublic interface Task {}\n`,
      'src/main/java/app/WorkerRecord.java': `package app;\n\npublic record WorkerRecord(String name) implements Task {}\n`,
      'src/main/java/app/WorkerPermits.java': `package app;\n\npublic sealed class WorkerPermits permits WorkerPermitted {}\n`,
      'src/main/java/app/WorkerPermitted.java': `package app;\n\npublic final class WorkerPermitted extends WorkerPermits {}\n`,
    };

    const directRoot = await createProject('pi-find-references-java-extends-direct', files);
    const graphRoot = await createProject('pi-find-references-java-extends-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const query = {
      path: 'src/main/java/app/WorkerBase.java',
      symbol: 'WorkerBase',
      language: 'java' as const,
      kind: 'class' as const,
      reference_kinds: ['extends' as const],
    };
    const direct = await findReferences(directRoot, query);
    const graph = await findReferences(graphRoot, query);
    const directImplements = await findReferences(directRoot, {
      path: 'src/main/java/app/Task.java',
      symbol: 'Task',
      language: 'java',
      kind: 'interface',
      reference_kinds: ['implements'],
    });
    const graphImplements = await findReferences(graphRoot, {
      path: 'src/main/java/app/Task.java',
      symbol: 'Task',
      language: 'java',
      kind: 'interface',
      reference_kinds: ['implements'],
    });
    const directPermits = await findReferences(directRoot, {
      path: 'src/main/java/app/WorkerPermits.java',
      symbol: 'WorkerPermits',
      language: 'java',
      kind: 'class',
      reference_kinds: ['extends'],
    });
    const graphPermits = await findReferences(graphRoot, {
      path: 'src/main/java/app/WorkerPermits.java',
      symbol: 'WorkerPermits',
      language: 'java',
      kind: 'class',
      reference_kinds: ['extends'],
    });

    const normalize = (results: typeof direct) => results.map((item) => ({
      file: item.file.split('/').slice(-3).join('/'),
      line: item.line,
      column: item.column,
      end_line: item.end_line,
      end_column: item.end_column,
      context_symbol: item.context_symbol,
      context_kind: item.context_kind,
      context_class: item.context_class,
      owner_kind: item.owner_kind,
      reference_kind: item.reference_kind,
      called_as: item.called_as,
    }));

    expect(normalize(graph)).toEqual(normalize(direct));
    expect(normalize(graphImplements)).toEqual(normalize(directImplements));
    expect(normalize(graphPermits)).toEqual(normalize(directPermits));
    expect(direct[0]).toMatchObject({
      line: 3,
      column: 0,
      end_line: 3,
      end_column: 38,
      context_symbol: 'Worker',
      context_class: 'Worker',
      owner_kind: 'class',
      reference_kind: 'extends',
      called_as: 'extends WorkerBase',
    });
    expect(graph[0]).toMatchObject({
      line: 3,
      column: 0,
      end_line: 3,
      end_column: 38,
      context_symbol: 'Worker',
      context_class: 'Worker',
      owner_kind: 'class',
      reference_kind: 'extends',
      called_as: 'extends WorkerBase',
    });
  });

  it('includes Java test-source concrete calls when querying a main-source method', async () => {
    const rootDir = await createProject('pi-find-references-java-main-test-sources', {
      'src/main/java/app/ExportUseCase.java': `package app;\n\npublic class ExportUseCase {\n  public void export(String reviewId) {}\n}\n`,
      'src/test/java/app/ExportUseCaseTest.java': `package app;\n\npublic class ExportUseCaseTest {\n  void exportsReview() {\n    var useCase = new ExportUseCase();\n    useCase.export("review-1");\n  }\n\n  void exportsAgain() {\n    var useCase = new ExportUseCase();\n    useCase.export("review-2");\n  }\n\n  void rejectsTraversal() {\n    var useCase = new ExportUseCase();\n    assertThrows(() -> useCase.export("../escape"));\n  }\n\n  private void assertThrows(Runnable runnable) {}\n}\n`,
    });

    const results = await findReferences(rootDir, {
      path: 'src/main/java/app/ExportUseCase.java',
      symbol: 'export',
      language: 'java',
      kind: 'method',
      reference_kinds: ['call'],
    });

    expect(results.map((item) => item.called_as).sort()).toEqual([
      'useCase.export("../escape")',
      'useCase.export("review-1")',
      'useCase.export("review-2")',
    ]);
  });

  it('falls back to direct TypeScript interface relationships when graph edges do not cover them', async () => {
    const rootDir = await createProject('pi-find-references-ts-interface-graph-fallback', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/repository.ts': `export interface ReviewAnalysisRepository {}\n`,
      'src/noop.ts': `import { ReviewAnalysisRepository } from './repository.js';\nexport class NoopReviewAnalysisRepository implements ReviewAnalysisRepository {}\n`,
      'test/repository.test.ts': `import { ReviewAnalysisRepository } from '../src/repository.js';\nclass InMemoryReviewAnalysisRepository implements ReviewAnalysisRepository {}\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src',
      symbol: 'ReviewAnalysisRepository',
      language: 'ts',
      kind: 'interface',
      reference_kinds: ['implements'],
      compare_direct_fallback: true,
    });

    expect(new Set(results.map((item) => item.context_symbol))).toEqual(new Set([
      'NoopReviewAnalysisRepository',
      'InMemoryReviewAnalysisRepository',
    ]));
  });

  it('does not return a TypeScript false negative when reference kind is omitted', async () => {
    const rootDir = await createProject('pi-find-references-ts-no-kind', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/query.server.ts': `export function getReviewAnalysisStatus(): string {\n  return 'ready';\n}\n`,
      'src/resenia.tsx': `import { getReviewAnalysisStatus } from './query.server.js';\nexport async function loader() {\n  return getReviewAnalysisStatus();\n}\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src',
      symbol: 'getReviewAnalysisStatus',
      language: 'ts',
      compare_direct_fallback: true,
    });

    expect(results.map((item) => item.called_as)).toContain('getReviewAnalysisStatus()');
  });

  it('deduplicates TypeScript interface method call references while preserving receiver and reason metadata', async () => {
    const files = {
      'src/repository.ts': `export interface ReviewAnalysisRepository {\n  transitionToTerminal(id: string, status: string): void;\n}\n`,
      'src/sql-repository.ts': `import { ReviewAnalysisRepository } from './repository.js';\n\nexport class SqlReviewAnalysisRepository implements ReviewAnalysisRepository {\n  transitionToTerminal(id: string, status: string): void { void id; void status; }\n}\n`,
      'src/service.ts': `import { ReviewAnalysisRepository } from './repository.js';\n\nexport class ReviewAnalysisService {\n  constructor(private readonly repository: ReviewAnalysisRepository) {}\n\n  cancelActiveReviewAnalysis(id: string): void {\n    this.repository.transitionToTerminal(id, 'cancelled');\n  }\n\n  beginTerminalTransition(id: string): void {\n    this.repository.transitionToTerminal(id, 'running');\n  }\n}\n`,
    };
    const directRoot = await createProject('pi-find-references-ts-interface-method-direct', files);
    const graphRoot = await createProject('pi-find-references-ts-interface-method-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      ...files,
    });
    await buildWorkspaceGraph(graphRoot);

    const query = { path: 'src/repository.ts', symbol: 'transitionToTerminal', language: 'ts' as const, kind: 'method' as const, reference_kinds: ['call' as const] };
    const direct = await findReferences(directRoot, query);
    const graph = await findReferences(graphRoot, { ...query, compare_direct_fallback: true });
    const normalize = (results: typeof direct) => results.map((item) => ({
      context_symbol: item.context_symbol,
      called_as: item.called_as,
      receiver_name: item.receiver_name,
      receiver_type: item.receiver_type,
      reason: item.reason,
    })).sort((a, b) => String(a.context_symbol).localeCompare(String(b.context_symbol)));

    expect(normalize(direct)).toEqual([
      {
        context_symbol: 'beginTerminalTransition',
        called_as: "this.repository.transitionToTerminal(id, 'running')",
        receiver_name: 'this.repository',
        receiver_type: 'ReviewAnalysisRepository',
        reason: 'receiver-type-contract-method',
      },
      {
        context_symbol: 'cancelActiveReviewAnalysis',
        called_as: "this.repository.transitionToTerminal(id, 'cancelled')",
        receiver_name: 'this.repository',
        receiver_type: 'ReviewAnalysisRepository',
        reason: 'receiver-type-contract-method',
      },
    ]);
    expect(normalize(graph)).toEqual(normalize(direct));
    expect(new Set(graph.map((item) => `${item.context_symbol}:${item.called_as}`)).size).toBe(graph.length);
  });

  it('exposes visible classification counts and row-level classification with reason in code_find references output', async () => {
    const rootDir = await createProject('pi-code-find-visible-classification', {
      'src/repository.ts': `export interface ReviewAnalysisRepository {\n  transitionToTerminal(id: string, status: string): void;\n}\n`,
      'src/sql-repository.ts': `import { ReviewAnalysisRepository } from './repository.js';\n\nexport class SqlReviewAnalysisRepository implements ReviewAnalysisRepository {\n  transitionToTerminal(id: string, status: string): void { void id; void status; }\n}\n`,
      'src/service.ts': `import { ReviewAnalysisRepository } from './repository.js';\n\nexport class ReviewAnalysisService {\n  constructor(private readonly repository: ReviewAnalysisRepository) {}\n\n  cancelActiveReviewAnalysis(id: string): void {\n    this.repository.transitionToTerminal(id, 'cancelled');\n  }\n\n  beginTerminalTransition(id: string): void {\n    this.repository.transitionToTerminal(id, 'running');\n  }\n}\n`,
    });

    const tool = registerToolForTest(registerCodeFindTool);
    const result = await tool.execute('tool-call', {
      path: 'src/repository.ts',
      query: 'transitionToTerminal',
      relation: 'references',
      language: 'ts',
      kind: 'method',
      reference_kinds: ['call'],
    }, undefined, undefined, { cwd: rootDir });
    const text = result.content[0].text;

    expect(text).toContain('classification counts: confirmed=2');
    expect(text).toContain('classification: confirmed');
    expect(text).toContain('reason: receiver-type-contract-method');
    expect(result.details.summary.classification_counts).toEqual({ confirmed: 2 });
    expect(result.details.items.every((item: any) => item.classification === 'confirmed')).toBe(true);
    expect(result.details.items.every((item: any) => item.reason === 'receiver-type-contract-method')).toBe(true);
  });

  it('does not return incomplete Java interface references when reference kind is omitted', async () => {
    const rootDir = await createProject('pi-find-references-java-no-kind-interface', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/ports/StartReviewAnalysis.java': `package ports;\n\npublic interface StartReviewAnalysis {}\n`,
      'src/main/java/app/StartReviewAnalysisUseCase.java': `package app;\n\nimport ports.StartReviewAnalysis;\n\npublic class StartReviewAnalysisUseCase implements StartReviewAnalysis {}\n`,
      'src/main/java/web/ReviewAnalysisRestController.java': `package web;\n\nimport ports.StartReviewAnalysis;\n\npublic class ReviewAnalysisRestController {\n  private final StartReviewAnalysis startReviewAnalysis;\n\n  public ReviewAnalysisRestController(StartReviewAnalysis startReviewAnalysis) {\n    this.startReviewAnalysis = startReviewAnalysis;\n  }\n}\n`,
      'src/test/java/web/ReviewAnalysisRestControllerTest.java': `package web;\n\nimport ports.StartReviewAnalysis;\n\nclass ReviewAnalysisRestControllerTest {\n  private StartReviewAnalysis startReviewAnalysis;\n}\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src',
      symbol: 'StartReviewAnalysis',
      language: 'java',
      compare_direct_fallback: true,
    });

    const kinds = new Set(results.map((item) => item.reference_kind));
    expect(kinds.has('implements')).toBe(true);
    expect(kinds.has('import')).toBe(true);
    expect(kinds.has('type_reference')).toBe(true);
    expect(new Set(results.map((item) => item.context_class).filter(Boolean))).toEqual(new Set([
      'StartReviewAnalysisUseCase',
      'ReviewAnalysisRestController',
      'ReviewAnalysisRestControllerTest',
    ]));
  });
});
