import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import codeResearchExtension from '../index.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import { loadWorkspaceGraphState, writeWorkspaceGraphState } from '../src/core/workspace-state.js';

interface RegisteredTool {
  name: string;
  execute: (toolCallId: any, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any>;
  renderResult?: (result: any, options: { expanded?: boolean; isPartial?: boolean }, theme: any) => { render(width: number): string[] };
}

const renderTheme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

function renderToolResult(tool: RegisteredTool, result: any, expanded: boolean): string {
  expect(tool.renderResult).toBeTypeOf('function');
  return tool.renderResult!(result, { expanded, isPartial: false }, renderTheme).render(120).join('\n');
}

async function createJavaProject(files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `pi-extension-entry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('code-research extension entry integration', () => {
  it('keeps public tool language schemas free of python and fallback metadata', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const findSymbolTool: any = tools.find((tool) => tool.name === 'find_symbol');
    const findReferencesTool: any = tools.find((tool) => tool.name === 'find_references');
    const functionCallTreeTool: any = tools.find((tool) => tool.name === 'function_call_tree');
    const reverseFunctionCallTreeTool: any = tools.find((tool) => tool.name === 'reverse_function_call_tree');

    expect(JSON.stringify(findSymbolTool.parameters)).not.toContain('py');
    expect(JSON.stringify(findReferencesTool.parameters)).not.toContain('py');
    expect(JSON.stringify(functionCallTreeTool.parameters)).not.toContain('py');
    expect(JSON.stringify(reverseFunctionCallTreeTool.parameters)).not.toContain('py');

    const rootDir = await createJavaProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/app/AppService.java': `package app;\n\npublic class AppService {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    const state = await loadWorkspaceGraphState(rootDir);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    await writeWorkspaceGraphState(rootDir, { ...state.data, status: 'stale' });

    const result = await tools.find((tool) => tool.name === 'find_references')!.execute(
      'test-call-no-fallback-metadata',
      {
        path: 'src/main/java/app/AppService.java',
        symbol: 'helper',
        language: 'java',
        kind: 'method',
      },
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.details.found).toBe(1);
    expect(result.details).not.toHaveProperty('graph');
    expect(result.details).not.toHaveProperty('fallback');
    expect(result.details.results[0]).not.toHaveProperty('graph');
    expect(result.details.results[0]).not.toHaveProperty('fallback_reason');
  });

  it('registers and executes find_symbol through the extension entrypoint', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const findSymbolTool = tools.find((tool) => tool.name === 'find_symbol');
    expect(findSymbolTool).toBeDefined();

    const rootDir = await createJavaProject({
      'src/main/java/ports/Service.java': `package ports;\npublic interface Service {\n  String run();\n}\n`,
      'src/main/java/impl/LocalService.java': `package impl;\n\nimport ports.Service;\n\npublic class LocalService implements Service {\n  public String run() {\n    return "local";\n  }\n}\n`,
    });

    const result = await findSymbolTool!.execute(
      'test-call',
      {
        path: 'src/main/java',
        symbol: 'Service',
        language: 'java',
        kind: 'interface',
      },
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.details.found).toBe(1);
    expect(result.details.results[0].symbol).toBe('Service');
    expect(result.details.results[0].implementation_locations?.[0].symbol).toBe('LocalService');
  });

  it('surfaces find_references diagnostics in tool details including zero-result responses', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const findReferencesTool = tools.find((tool) => tool.name === 'find_references');
    expect(findReferencesTool).toBeDefined();

    const rootDir = await createJavaProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/app/AppService.java': `package app;\n\npublic class AppService {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const hit = await findReferencesTool!.execute(
      'test-call-references-diagnostics',
      {
        path: 'src/main/java/app/AppService.java',
        symbol: 'helper',
        language: 'java',
        kind: 'method',
        reference_kinds: ['call'],
      },
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(hit.details).toMatchObject({ found: 1, source_mode: 'graph', graph_status: 'fresh', completeness: 'complete', fallback_reason: null });

    const miss = await findReferencesTool!.execute(
      'test-call-references-zero-diagnostics',
      {
        path: 'src/main/java/app/AppService.java',
        symbol: 'missingHelper',
        language: 'java',
        kind: 'method',
        reference_kinds: ['call'],
      },
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(miss.details).toMatchObject({ found: 0, source_mode: 'graph', graph_status: 'fresh' });
    expect(miss.content[0].text).toContain("No references found for 'missingHelper'.");
  });

  it('registers and executes find_references through the extension entrypoint', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const findReferencesTool = tools.find((tool) => tool.name === 'find_references');
    expect(findReferencesTool).toBeDefined();

    const rootDir = await createJavaProject({
      'src/main/java/app/AppService.java': `package app;\n\npublic class AppService {\n  public void run() {\n    helper();\n  }\n\n  public void warmup() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
    });

    const result = await findReferencesTool!.execute(
      'test-call-references',
      {
        path: 'src/main/java/app/AppService.java',
        symbol: 'helper',
        language: 'java',
        kind: 'method',
      },
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.details.found).toBe(2);
    expect(result.details.results.map((item: any) => item.context_symbol).sort()).toEqual(['run', 'warmup']);
    expect(result.details.results.every((item: any) => item.reference_kind === 'call')).toBe(true);
    expect(result.content[0].text).toContain('src/main/java/app/AppService.java:5:4: helper();');
    expect(result.details.results[0].source_line).toBe('helper();');
  });

  it('registers and executes function_call_tree through the extension entrypoint', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const functionCallTreeTool = tools.find((tool) => tool.name === 'function_call_tree');
    expect(functionCallTreeTool).toBeDefined();

    const rootDir = await createJavaProject({
      'src/main/java/ports/Service.java': `package ports;\npublic interface Service {\n  void run();\n}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport ports.Service;\n\npublic class AppService implements Service {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport ports.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
    });

    const result = await functionCallTreeTool!.execute(
      'test-call',
      {
        path: 'src/main/java/web/Controller.java',
        symbol: 'handle',
        language: 'java',
        max_depth: 5,
        include_external: true,
      },
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.details.root.symbol).toBe('handle');
    expect(result.details.root.class).toBe('Controller');
    expect(result.details.root.children?.[0].class).toBe('AppService');
    expect(result.details.root.children?.[0].children?.[0].symbol).toBe('helper');
  });

  it('registers and executes reverse_function_call_tree through the extension entrypoint', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const reverseFunctionCallTreeTool = tools.find((tool) => tool.name === 'reverse_function_call_tree');
    expect(reverseFunctionCallTreeTool).toBeDefined();

    const rootDir = await createJavaProject({
      'src/main/java/ports/Service.java': `package ports;\npublic interface Service {\n  void run();\n}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport ports.Service;\n\npublic class AppService implements Service {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport ports.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
    });

    const result = await reverseFunctionCallTreeTool!.execute(
      'test-call-reverse',
      {
        path: 'src/main/java/app/AppService.java',
        symbol: 'helper',
        language: 'java',
        max_depth: 5,
        include_external: true,
      },
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.details.root.symbol).toBe('helper');
    expect(result.details.root.callers?.[0].symbol).toBe('run');
    expect(result.details.root.callers?.[0].callers?.[0].symbol).toBe('handle');
  });

  it('renders code-research results compactly by default while preserving full content for the agent', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const functionCallTreeTool = tools.find((tool) => tool.name === 'function_call_tree');
    expect(functionCallTreeTool).toBeDefined();
    expect(functionCallTreeTool!.renderResult).toBeTypeOf('function');

    const rootDir = await createJavaProject({
      'src/main/java/app/DeepService.java': `package app;\n\npublic class DeepService {\n  public void root() {\n    stepOne();\n  }\n\n  private void stepOne() {\n    stepTwo();\n  }\n\n  private void stepTwo() {\n    CODE_RESEARCH_RENDER_FULL_CONTENT_MARKER();\n  }\n\n  private void CODE_RESEARCH_RENDER_FULL_CONTENT_MARKER() {}\n}\n`,
    });

    const result = await functionCallTreeTool!.execute(
      'test-call-render',
      {
        path: 'src/main/java/app/DeepService.java',
        symbol: 'root',
        language: 'java',
        max_depth: 8,
        include_external: true,
      },
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.content[0].text).toContain('CODE_RESEARCH_RENDER_FULL_CONTENT_MARKER');

    const compact = renderToolResult(functionCallTreeTool!, result, false);
    const expanded = renderToolResult(functionCallTreeTool!, result, true);

    expect(compact).toContain('function_call_tree');
    expect(compact).toContain('root');
    expect(compact).toContain('ctrl+o expand');
    expect(compact).not.toContain('CODE_RESEARCH_RENDER_FULL_CONTENT_MARKER');
    expect(expanded).toContain('function_call_tree');
    expect(expanded).toContain('ctrl+o collapse');
    expect(expanded).toContain('CODE_RESEARCH_RENDER_FULL_CONTENT_MARKER');
  });

  it('registers compact/expanded renderers for all code-research result tools', () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    for (const name of ['find_symbol', 'find_references', 'function_call_tree', 'reverse_function_call_tree']) {
      expect(tools.find((tool) => tool.name === name)?.renderResult, `${name} renderResult`).toBeTypeOf('function');
    }
  });

  it('allows graph-backed read reference filters in the public schema', () => {
    const tools: any[] = [];
    codeResearchExtension({
      registerTool(tool: any) {
        tools.push(tool);
      },
    });

    const findReferencesTool = tools.find((tool) => tool.name === 'find_references');
    expect(JSON.stringify(findReferencesTool.parameters)).toContain('read');
  });

  it('keeps graph.enable as the query and scheduler gate in this slice', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const findSymbolTool = tools.find((tool) => tool.name === 'find_symbol');
    expect(findSymbolTool).toBeDefined();

    const rootDir = await createJavaProject({
      'src/main/java/app/App.java': `package app;\npublic class App { public void run() {} }\n`,
    });

    const result = await findSymbolTool!.execute(
      'test-call-graph-disabled-gate',
      {
        path: 'src/main/java/app/App.java',
        symbol: 'run',
        language: 'java',
        kind: 'method',
      },
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.details.found).toBe(1);
  });

  it('reports workspace graph as disabled by default until explicitly enabled', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const workspaceGraphStatusTool = tools.find((tool) => tool.name === 'workspace_graph_status');
    expect(workspaceGraphStatusTool).toBeDefined();

    const rootDir = await createJavaProject({
      'pom.xml': `<project />\n`,
      'src/main/java/app/App.java': `package app;\npublic class App { public void run() {} }\n`,
    });

    const result = await workspaceGraphStatusTool!.execute(
      'test-call-disabled',
      {},
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.content[0].text).toContain('disabled');
    expect(result.details).toMatchObject({
      status: 'disabled',
      graph: {
        enable: false,
        addGitignore: true,
      },
    });
  });

  it('registers workspace_graph_status with compact metadata-only details when graph is enabled', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const workspaceGraphStatusTool = tools.find((tool) => tool.name === 'workspace_graph_status');
    expect(workspaceGraphStatusTool).toBeDefined();

    const rootDir = await createJavaProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'pom.xml': `<project />\n`,
      'src/main/java/app/App.java': `package app;\npublic class App { public void run() {} }\n`,
    });

    const result = await workspaceGraphStatusTool!.execute(
      'test-call',
      {},
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.details.status).toBe('missing');

    await buildWorkspaceGraph(rootDir);

    const statusAfter = await workspaceGraphStatusTool!.execute(
      'test-call-3',
      {},
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(statusAfter.details).toMatchObject({
      status: 'fresh',
      projectRoot: rootDir,
      monorepo: {
        detected: false,
        subprojectCount: 1,
      },
      graphUsableForQueries: true,
      freshness: {
        isFreshEnough: true,
      },
      indexing: {
        sectioned: false,
        layout: 'single-subproject-shard',
        shardCount: 1,
        manifestStatus: 'ok',
      },
      coverage: {
        indexedFiles: 1,
        skippedLargeFiles: 0,
        skippedUnsupportedFiles: 0,
        unreadableDirectoryCount: 0,
        detectedProjects: 1,
        indexedProjects: 1,
        emptyProjects: 0,
        emptyProjectRoots: [],
        partialProjects: 0,
        erroredProjects: 0,
      },
      languages: {
        java: 1,
        ts: 0,
        js: 0,
      },
    });
    expect(statusAfter.content[0].text).toContain('usable=yes');
    expect(statusAfter.content[0].text).toContain('monorepo=no');
    expect(statusAfter.content[0].text).toContain('shards=1');
    expect(statusAfter.content[0].text).toContain('indexed_files=1');
    expect(statusAfter.content[0].text).toContain('detected_projects=1');
    expect(statusAfter.content[0].text).toContain('indexed_projects=1');
    expect(statusAfter.content[0].text).toContain('empty_projects=0');
    expect(statusAfter.content[0].text).toContain('workspace_projects=.');
    expect(statusAfter.details.projects).toHaveLength(1);
    expect(statusAfter.details.projects[0]).toMatchObject({
      root: '.',
      workspaceRelativeRoot: '.',
      status: 'fresh',
      fileCount: 1,
      primaryLanguage: 'java',
      snapshotStatus: 'indexed',
      shardPath: expect.stringContaining('graphs/'),
    });
    expect(statusAfter.details.subprojects[0]).toHaveProperty('root');
    expect(statusAfter.details.subprojects[0]).toHaveProperty('fileCount', 1);
    expect(statusAfter.details.unreadableDirectories).toEqual([]);
    expect(statusAfter.details.subprojects[0]).not.toHaveProperty('snapshot');
    expect(statusAfter.details.subprojects[0]).toHaveProperty('shardPath');
  });

  it('reports empty detected projects separately from indexed projects', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const workspaceGraphStatusTool = tools.find((tool) => tool.name === 'workspace_graph_status');
    expect(workspaceGraphStatusTool).toBeDefined();

    const rootDir = await createJavaProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'npm/package.json': `{"name":"npm-only"}\n`,
      'app/pom.xml': `<project />\n`,
      'app/src/main/java/app/App.java': `package app;\npublic class App { public void run() {} }\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const result = await workspaceGraphStatusTool!.execute(
      'test-call-empty-project',
      {},
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.details.coverage).toMatchObject({
      detectedProjects: 2,
      indexedProjects: 1,
      emptyProjects: 1,
      emptyProjectRoots: ['npm'],
    });
    expect(result.content[0].text).toContain('detected_projects=2');
    expect(result.content[0].text).toContain('indexed_projects=1');
    expect(result.content[0].text).toContain('empty_projects=1');
    expect(result.details.projects.find((item: any) => item.root === 'npm')).toMatchObject({
      fileCount: 0,
      snapshotStatus: 'empty',
    });
  });

  it('reports rich monorepo and sectioned indexing metadata through workspace_graph_status', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const workspaceGraphStatusTool = tools.find((tool) => tool.name === 'workspace_graph_status');
    expect(workspaceGraphStatusTool).toBeDefined();

    const rootDir = await createJavaProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'back/pom.xml': `<project />\n`,
      'back/src/main/java/app/App.java': `package app;\npublic class App { public void run() {} }\n`,
      'front/package.json': `{"name":"front","type":"module"}\n`,
      'front/src/index.ts': `export function run(): void {}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const result = await workspaceGraphStatusTool!.execute(
      'test-call-monorepo',
      {},
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.details).toMatchObject({
      status: 'fresh',
      monorepo: {
        detected: true,
        subprojectCount: 2,
        roots: ['back', 'front'],
      },
      graphUsableForQueries: true,
      freshness: {
        isFreshEnough: true,
      },
      indexing: {
        sectioned: true,
        layout: 'per-subproject-shards',
        shardCount: 2,
        manifestStatus: 'ok',
      },
      coverage: {
        indexedFiles: 2,
        detectedProjects: 2,
        indexedProjects: 2,
        emptyProjects: 0,
        emptyProjectRoots: [],
        partialProjects: 0,
        erroredProjects: 0,
      },
      languages: {
        java: 1,
        ts: 1,
        js: 0,
      },
    });
    expect(result.content[0].text).toContain('usable=yes');
    expect(result.content[0].text).toContain('monorepo=yes');
    expect(result.content[0].text).toContain('shards=2');
    expect(result.content[0].text).toContain('detected_projects=2');
    expect(result.content[0].text).toContain('indexed_projects=2');
    expect(result.content[0].text).toContain('empty_projects=0');
    expect(result.content[0].text).toContain('workspace_projects=back,front');
    expect(result.details.subprojects).toHaveLength(2);
    expect(result.details.projects).toHaveLength(2);
    expect(result.details.subprojects.map((item: any) => item.root).sort()).toEqual(['back', 'front']);
    expect(result.details.projects.map((item: any) => item.root).sort()).toEqual(['back', 'front']);
    expect(result.details.projects.find((item: any) => item.root === 'back')).toMatchObject({
      markers: ['pom.xml'],
      workspaceRelativeRoot: 'back',
      fileCount: 1,
      primaryLanguage: 'java',
      snapshotStatus: 'indexed',
      shardPath: expect.stringContaining('graphs/'),
    });
    expect(result.details.projects.find((item: any) => item.root === 'front')).toMatchObject({
      markers: ['package.json'],
      workspaceRelativeRoot: 'front',
      fileCount: 1,
      primaryLanguage: 'ts',
      snapshotStatus: 'indexed',
      shardPath: expect.stringContaining('graphs/'),
    });
    expect(result.details.subprojects.every((item: any) => item.fileCount === 1)).toBe(true);
  });
});
