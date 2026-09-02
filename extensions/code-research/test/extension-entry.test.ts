import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import codeResearchExtension from '../index.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';

interface RegisteredTool {
  name: string;
  parameters?: unknown;
  execute: (toolCallId: any, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any>;
  renderResult?: (result: any, options: { expanded?: boolean; isPartial?: boolean }, theme: any) => { render(width: number): string[] };
}

const renderTheme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

function registerTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  codeResearchExtension({
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    on() {},
  });
  return tools;
}

function renderToolResult(tool: RegisteredTool, result: any, expanded: boolean): string {
  expect(tool.renderResult).toBeTypeOf('function');
  return tool.renderResult!(result, { expanded, isPartial: false }, renderTheme).render(120).join('\n');
}

async function createProject(files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `pi-code-research-entry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('code-research extension entry integration', () => {
  it('registers the minimal public tool surface while preserving workspace graph status', () => {
    const tools = registerTools();
    expect(tools.map((tool) => tool.name)).toEqual(['code_find', 'code_call_hierarchy', 'workspace_graph_status', 'code_change_surface']);
    expect(JSON.stringify(tools.map((tool) => tool.parameters))).not.toContain('py');
    for (const tool of tools) expect(tool.renderResult ?? (() => undefined)).toBeTypeOf('function');
  });

  it('executes code_find declaration lookup through the extension entrypoint', async () => {
    const tools = registerTools();
    const codeFind = tools.find((tool) => tool.name === 'code_find');
    expect(codeFind).toBeDefined();

    const rootDir = await createProject({
      'src/main/java/ports/Service.java': `package ports;\npublic interface Service {\n  String run();\n}\n`,
      'src/main/java/impl/LocalService.java': `package impl;\n\nimport ports.Service;\n\npublic class LocalService implements Service {\n  public String run() {\n    return "local";\n  }\n}\n`,
    });

    const result = await codeFind!.execute('test-call', {
      path: 'src/main/java',
      query: 'Service',
      relation: 'declaration',
      language: 'java',
      kind: 'interface',
      include_signature: true,
    }, undefined, undefined, { cwd: rootDir });

    expect(result.details.relation).toBe('declaration');
    expect(result.details.found).toBe(1);
    expect(result.details.items[0].symbol).toBe('Service');
    expect(result.details.items[0].implementation_locations?.[0].symbol).toBe('LocalService');
    expect(result.details.summary).toMatchObject({ returned: 1, total: 1, has_more: false });
  });

  it('includes bounded source code in declaration output when include_code is requested', async () => {
    const tools = registerTools();
    const codeFind = tools.find((tool) => tool.name === 'code_find');
    expect(codeFind).toBeDefined();

    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/app/Worker.java': `package app;\n\npublic class Worker {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const result = await codeFind!.execute('test-call-code', {
      path: 'src/main/java/app/Worker.java',
      query: 'run',
      relation: 'declaration',
      language: 'java',
      kind: 'method',
      include_code: true,
      include_signature: true,
    }, undefined, undefined, { cwd: rootDir });

    expect(result.details.items[0].code).toContain('public void run()');
    expect(result.content[0].text).toContain('public void run()');
    expect(result.content[0].text).toContain('```');
  });

  it('executes code_find references lookup with auto language and bounded cursor metadata', async () => {
    const tools = registerTools();
    const codeFind = tools.find((tool) => tool.name === 'code_find');
    expect(codeFind).toBeDefined();

    const rootDir = await createProject({
      'src/service.ts': `export function helper(): void {}\n\nexport function runService(): void {\n  helper();\n}\n\nexport function warmupService(): void {\n  helper();\n}\n`,
    });

    const result = await codeFind!.execute('test-call-references', {
      path: 'src/service.ts',
      query: 'helper',
      relation: 'references',
      language: 'auto',
      kind: 'function',
      limit: 1,
    }, undefined, undefined, { cwd: rootDir });

    expect(result.details.relation).toBe('references');
    expect(result.details.found).toBe(1);
    expect(result.details.summary).toMatchObject({ returned: 1, total: 2, has_more: true, next_cursor: '1' });
    expect(result.content[0].text).toContain('More results available');
    expect(result.content[0].text).toContain('cursor=1');
  });

  it('executes outgoing and incoming code_call_hierarchy through one directional tool', async () => {
    const tools = registerTools();
    const hierarchy = tools.find((tool) => tool.name === 'code_call_hierarchy');
    expect(hierarchy).toBeDefined();

    const rootDir = await createProject({
      'src/main/java/ports/Service.java': `package ports;\npublic interface Service {\n  void run();\n}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport ports.Service;\n\npublic class AppService implements Service {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport ports.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
    });

    const outgoing = await hierarchy!.execute('test-call-outgoing', {
      path: 'src/main/java/web/Controller.java',
      symbol: 'handle',
      direction: 'outgoing',
      language: 'java',
      max_depth: 5,
      include_external: true,
    }, undefined, undefined, { cwd: rootDir });

    expect(outgoing.details.direction).toBe('outgoing');
    expect(outgoing.details.root.symbol).toBe('handle');
    expect(outgoing.details.root.children?.[0].class).toBe('AppService');

    const incoming = await hierarchy!.execute('test-call-incoming', {
      path: 'src/main/java/app/AppService.java',
      symbol: 'helper',
      direction: 'incoming',
      language: 'java',
      max_depth: 5,
    }, undefined, undefined, { cwd: rootDir });

    expect(incoming.details.direction).toBe('incoming');
    expect(incoming.details.root.symbol).toBe('helper');
    expect(incoming.details.root.callers?.[0].symbol).toBe('run');
  });

  it('renders new code-research tools compactly by default while preserving full content for the agent', async () => {
    const tools = registerTools();
    const hierarchy = tools.find((tool) => tool.name === 'code_call_hierarchy');
    expect(hierarchy).toBeDefined();

    const rootDir = await createProject({
      'src/main/java/app/DeepService.java': `package app;\n\npublic class DeepService {\n  public void root() {\n    stepOne();\n  }\n\n  private void stepOne() {\n    stepTwo();\n  }\n\n  private void stepTwo() {\n    CODE_RESEARCH_RENDER_FULL_CONTENT_MARKER();\n  }\n\n  private void CODE_RESEARCH_RENDER_FULL_CONTENT_MARKER() {}\n}\n`,
    });

    const result = await hierarchy!.execute('test-call-render', {
      path: 'src/main/java/app/DeepService.java',
      symbol: 'root',
      direction: 'outgoing',
      language: 'java',
      max_depth: 8,
      include_external: true,
    }, undefined, undefined, { cwd: rootDir });

    expect(result.content[0].text).toContain('CODE_RESEARCH_RENDER_FULL_CONTENT_MARKER');

    const compact = renderToolResult(hierarchy!, result, false);
    const expanded = renderToolResult(hierarchy!, result, true);

    expect(compact).toContain('code_call_hierarchy');
    expect(compact).toContain('search direction=outgoing');
    expect(compact).toContain('query=root');
    expect(compact).toContain('root');
    expect(compact).not.toContain('CODE_RESEARCH_RENDER_FULL_CONTENT_MARKER');
    expect(expanded).toContain('code_call_hierarchy');
    expect(expanded).toContain('search direction=outgoing');
    expect(expanded).toContain('CODE_RESEARCH_RENDER_FULL_CONTENT_MARKER');
  });

  it('keeps graph.enable as the query and scheduler gate in this slice', async () => {
    const tools = registerTools();
    const codeFind = tools.find((tool) => tool.name === 'code_find');
    expect(codeFind).toBeDefined();

    const rootDir = await createProject({
      'src/main/java/app/App.java': `package app;\npublic class App { public void run() {} }\n`,
    });

    const result = await codeFind!.execute('test-call-graph-disabled-gate', {
      path: 'src/main/java/app/App.java',
      query: 'run',
      relation: 'declaration',
      language: 'java',
      kind: 'method',
    }, undefined, undefined, { cwd: rootDir });

    expect(result.details.found).toBe(1);
  });

  it('reports workspace graph as disabled by default until explicitly enabled', async () => {
    const tools = registerTools();
    const workspaceGraphStatusTool = tools.find((tool) => tool.name === 'workspace_graph_status');
    expect(workspaceGraphStatusTool).toBeDefined();

    const rootDir = await createProject({
      'pom.xml': `<project />\n`,
      'src/main/java/app/App.java': `package app;\npublic class App { public void run() {} }\n`,
    });

    const result = await workspaceGraphStatusTool!.execute('test-call-disabled', {}, undefined, undefined, { cwd: rootDir });

    expect(result.content[0].text).toContain('disabled');
    expect(result.details).toMatchObject({ status: 'disabled', graph: { enable: false, addGitignore: true } });
  });

  it('registers workspace_graph_status with compact monorepo metadata when graph is enabled', async () => {
    const tools = registerTools();
    const workspaceGraphStatusTool = tools.find((tool) => tool.name === 'workspace_graph_status');
    expect(workspaceGraphStatusTool).toBeDefined();

    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'back/pom.xml': `<project />\n`,
      'back/src/main/java/app/App.java': `package app;\npublic class App { public void run() {} }\n`,
      'front/package.json': `{"name":"front","type":"module"}\n`,
      'front/src/index.ts': `export function run(): void {}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const result = await workspaceGraphStatusTool!.execute('test-call-monorepo', {}, undefined, undefined, { cwd: rootDir });

    expect(result.details).toMatchObject({
      status: 'fresh',
      monorepo: { detected: true, subprojectCount: 2, roots: ['back', 'front'] },
      graphUsableForQueries: true,
      coverage: { indexedFiles: 2, detectedProjects: 2, indexedProjects: 2, emptyProjects: 0 },
      languages: { java: 1, ts: 1, js: 0 },
    });
    expect(result.content[0].text).toContain('usable=yes');
    expect(result.content[0].text).toContain('monorepo=yes');
    expect(result.content[0].text).toContain('workspace_projects=back,front');
  });
});
