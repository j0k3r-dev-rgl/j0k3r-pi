import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProjectIndex } from '../src/core/project-index.js';
import { executeFunctionCallTree } from '../src/core/function-call-tree-resolver.js';
import { buildCallTree } from '../src/languages/java/function-call-tree.js';

async function createProject(files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `pi-function-call-tree-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('function_call_tree Java', () => {
  it('follows dependency-injected interface fields recursively through the application implementation', async () => {
    const rootDir = await createProject({
      'api/Service.java': `package api;\npublic interface Service {\n  void run();\n}\n`,
      'app/AppService.java': `package app;\n\nimport api.Service;\n\npublic class AppService implements Service {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {\n    System.out.println("help");\n  }\n}\n`,
      'web/Controller.java': `package web;\n\nimport api.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
    });

    const index = await buildProjectIndex(rootDir);
    const rootMethod = index.methods.find((m) => m.className === 'Controller' && m.symbol === 'handle');
    expect(rootMethod).toBeDefined();
    expect(rootMethod?.package).toBe('web');
    expect(index.imports.get(rootMethod!.file)?.imports.get('Service')).toBe('api.Service');

    const result = buildCallTree({
      rootFile: rootMethod!.file,
      rootMethod: rootMethod!,
      index,
      maxDepth: 5,
      includeExternal: true,
    });

    expect(result.root.symbol).toBe('handle');
    expect(result.root.class).toBe('Controller');
    expect(result.root.owner_kind).toBe('class');
    expect(result.root.signature).toContain('public void handle()');
    expect(result.root.start_line).toBeDefined();
    expect(result.root.end_line).toBeDefined();
    expect(result.root.children).toBeDefined();
    expect(result.root.children).toHaveLength(1);
    expect(result.root.children?.[0].class).toBe('AppService');
    expect(result.root.children?.[0].symbol).toBe('run');
    expect(result.root.children?.[0].is_application).toBe(true);
    expect(result.root.children?.[0].called_as).toBe('service.run()');
    expect(result.root.children?.[0].receiver_name).toBe('service');
    expect(result.root.children?.[0].receiver_type).toBe('Service');
    expect(result.root.children?.[0].owner_kind).toBe('class');
    expect(result.root.children?.[0].signature).toContain('public void run()');
    expect(result.root.children?.[0].children?.[0].symbol).toBe('helper');
    expect(result.root.children?.[0].children?.[0].class).toBe('AppService');
    expect(result.root.children?.[0].children?.[0].called_as).toBe('helper()');
    expect(result.root.children?.[0].children?.[0].signature).toContain('private void helper()');
    expect(result.stats.application_nodes).toBe(3);
  });

  it('ignores framework and language calls by default', async () => {
    const rootDir = await createProject({
      'Main.java': `public class Main {\n  public void run() {\n    String s = "hello";\n    s.split(" ");\n  }\n}\n`,
    });

    const index = await buildProjectIndex(rootDir);
    const rootMethod = index.methods.find((m) => m.className === 'Main' && m.symbol === 'run');
    expect(rootMethod).toBeDefined();

    const result = buildCallTree({
      rootFile: rootMethod!.file,
      rootMethod: rootMethod!,
      index,
      maxDepth: 5,
      includeExternal: false,
    });

    expect(result.root.children).toBeUndefined();
    expect(result.stats.application_nodes).toBe(1);
    expect(result.stats.external_nodes).toBe(0);
  });

  it('executes function_call_tree from a nested java file path', async () => {
    const rootDir = await createProject({
      'src/main/java/ports/Service.java': `package ports;\npublic interface Service {\n  void run();\n}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport ports.Service;\n\npublic class AppService implements Service {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport ports.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
    });

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'src/main/java/web/Controller.java',
      symbol: 'handle',
      language: 'java',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;
    expect(execution.rootClassName).toBe('Controller');
    expect(execution.result.root.children?.[0].class).toBe('AppService');
    expect(execution.result.root.children?.[0].called_as).toBe('service.run()');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
    expect(execution.result.root.children?.[0].children?.[0].called_as).toBe('helper()');
  });

  it('infers string receiver type for chained external calls from known request methods', async () => {
    const rootDir = await createProject({
      'Controller.java': `import jakarta.servlet.http.HttpServletRequest;\n\npublic class Controller {\n  public void handle(HttpServletRequest request) {\n    request.getHeader("Authorization").replace("Bearer ", "");\n  }\n}\n`,
    });

    const index = await buildProjectIndex(rootDir);
    const rootMethod = index.methods.find((m) => m.className === 'Controller' && m.symbol === 'handle');
    expect(rootMethod).toBeDefined();

    const result = buildCallTree({
      rootFile: rootMethod!.file,
      rootMethod: rootMethod!,
      index,
      maxDepth: 5,
      includeExternal: true,
    });

    expect(result.root.children?.[0].symbol).toBe('replace');
    expect(result.root.children?.[0].receiver_type).toBe('String');
    expect(result.root.children?.[0].source).toBe('language');
  });

  it('infers fluent receiver type for builder chains', async () => {
    const rootDir = await createProject({
      'BuilderExample.java': `import org.springframework.data.mongodb.core.query.Update;\n\npublic class BuilderExample {\n  public void handle() {\n    new Update().set("a", 1).set("b", 2);\n  }\n}\n`,
    });

    const index = await buildProjectIndex(rootDir);
    const rootMethod = index.methods.find((m) => m.className === 'BuilderExample' && m.symbol === 'handle');
    expect(rootMethod).toBeDefined();

    const result = buildCallTree({
      rootFile: rootMethod!.file,
      rootMethod: rootMethod!,
      index,
      maxDepth: 5,
      includeExternal: true,
    });

    expect(result.root.children?.[0].symbol).toBe('set');
    expect(result.root.children?.[0].receiver_type).toBe('Update');
  });

  it('marks chained external calls that contain lambdas without splitting the chain', async () => {
    const rootDir = await createProject({
      'Example.java': `import java.util.Optional;\n\npublic class Example {\n  public void run(Optional<String> value) {\n    value.orElseThrow(() -> new RuntimeException("missing"));\n  }\n}\n`,
    });

    const index = await buildProjectIndex(rootDir);
    const rootMethod = index.methods.find((m) => m.className === 'Example' && m.symbol === 'run');
    expect(rootMethod).toBeDefined();

    const result = buildCallTree({
      rootFile: rootMethod!.file,
      rootMethod: rootMethod!,
      index,
      maxDepth: 5,
      includeExternal: true,
    });

    expect(result.root.children?.[0].symbol).toBe('orElseThrow');
    expect(result.root.children?.[0].called_as).toContain('orElseThrow');
    expect(result.root.children?.[0].has_callback).toBe(true);
    expect(result.root.children?.[0].callback_kind).toBe('lambda');
  });
});
