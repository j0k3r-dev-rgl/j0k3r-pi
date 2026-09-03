import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProjectIndex } from '../src/core/project-index.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
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
    expect(result.root.node_type).toBe('application');
    expect(result.root.class).toBe('Controller');
    expect(result.root.owner_kind).toBe('class');
    expect(result.root.signature).toContain('public void handle()');
    expect(result.root.start_line).toBeDefined();
    expect(result.root.end_line).toBeDefined();
    expect(result.root.children).toBeDefined();
    expect(result.root.children).toHaveLength(1);
    expect(result.root.children?.[0].class).toBe('AppService');
    expect(result.root.children?.[0].symbol).toBe('run');
    expect(result.root.children?.[0].node_type).toBe('application');
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
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/ports/Service.java': `package ports;\npublic interface Service {\n  void run();\n}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport ports.Service;\n\npublic class AppService implements Service {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport ports.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
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
    expect(execution.rootClassName).toBe('Controller');
    expect(execution.result.root.children?.[0].class).toBe('AppService');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
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
    expect(result.root.children?.[0].node_type).toBe('fluent_chain');
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
    expect(result.root.children?.[0].node_type).toBe('external');
    expect(result.root.children?.[0].called_as).toContain('orElseThrow');
    expect(result.root.children?.[0].has_callback).toBe(true);
    expect(result.root.children?.[0].callback_kind).toBe('lambda');
  });

  it('expands application calls inside callback lambdas', async () => {
    const rootDir = await createProject({
      'Example.java': `import java.util.List;\n\npublic class Example {\n  public void run(List<String> items) {\n    items.stream().map(item -> helper(item)).toList();\n  }\n\n  private String helper(String item) {\n    return item.trim();\n  }\n}\n`,
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

    const mapCall = result.root.children?.[0];
    expect(mapCall?.symbol).toBe('toList');
    expect(mapCall?.node_type).toBe('fluent_chain');
    expect(mapCall?.has_callback).toBe(true);
    expect(mapCall?.children?.[0].symbol).toBe('<callback>');
    expect(mapCall?.children?.[0].node_type).toBe('callback');
    expect(mapCall?.children?.[0].children?.[0].symbol).toBe('helper');
    expect(mapCall?.children?.[0].children?.[0].class).toBe('Example');
    expect(mapCall?.children?.[0].children?.[0].node_type).toBe('application');
  });

  it('surfaces relevant callbacks inside application call arguments without adding unrelated noise', async () => {
    const rootDir = await createProject({
      'Example.java': `import java.util.List;\n\npublic class Example {\n  public void run(List<String> items) {\n    execute(items.stream().map(item -> helper(item)).toList());\n  }\n\n  private void execute(List<String> values) {}\n\n  private String helper(String item) {\n    return item.trim();\n  }\n}\n`,
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

    const executeCall = result.root.children?.[0];
    expect(executeCall?.symbol).toBe('execute');
    expect(executeCall?.node_type).toBe('application');
    expect(executeCall?.class).toBe('Example');
    expect(executeCall?.children).toHaveLength(1);
    expect(executeCall?.children?.[0].symbol).toBe('<callback>');
    expect(executeCall?.children?.[0].node_type).toBe('callback');
    expect(executeCall?.children?.[0].called_as).toContain('item -> helper(item)');
    expect(executeCall?.children?.[0].children).toHaveLength(1);
    expect(executeCall?.children?.[0].children?.[0].symbol).toBe('helper');
    expect(executeCall?.children?.[0].children?.[0].class).toBe('Example');
    expect(executeCall?.children?.[0].children?.[0].node_type).toBe('application');
  });

  it('compacts sibling data access nodes without removing callback structure', async () => {
    const rootDir = await createProject({
      'Example.java': `import java.util.List;\n\npublic class Example {\n  public void run(List<String> items) {\n    execute(items.stream().map(item -> dto(item)).toList());\n  }\n\n  private void execute(List<String> values) {}\n\n  private String dto(String item) {\n    return item.trim();\n  }\n}\n`,
    });

    const index = await buildProjectIndex(rootDir);
    const rootMethod = index.methods.find((m) => m.className === 'Example' && m.symbol === 'run');
    expect(rootMethod).toBeDefined();

    const full = buildCallTree({
      rootFile: rootMethod!.file,
      rootMethod: rootMethod!,
      index,
      maxDepth: 5,
      includeExternal: true,
      compacted: false,
    });

    const compact = buildCallTree({
      rootFile: rootMethod!.file,
      rootMethod: rootMethod!,
      index,
      maxDepth: 5,
      includeExternal: true,
      compacted: true,
    });

    expect(full.root.children?.[0].children?.[0].symbol).toBe('<callback>');
    expect(compact.root.children?.[0].children?.[0].symbol).toBe('<callback>');

    const fullCallback = full.root.children?.[0].children?.[0];
    const compactCallback = compact.root.children?.[0].children?.[0];

    expect(fullCallback?.children?.some((node) => node.node_type === 'data_access')).toBe(false);
    expect(compactCallback?.children?.some((node) => node.symbol === '<data_access_group>')).toBe(false);
  });

  it('compacts trivial accessor siblings into one data access group', async () => {
    const rootDir = await createProject({
      'Example.java': `import java.util.List;\n\npublic class Example {\n  public void run(List<String> items) {\n    execute(items.stream().map(item -> new Pair(item.trim(), item.isBlank())).toList());\n  }\n\n  private void execute(List<Pair> values) {}\n\n  record Pair(String value, boolean blank) {}\n}\n`,
    });

    const index = await buildProjectIndex(rootDir);
    const rootMethod = index.methods.find((m) => m.className === 'Example' && m.symbol === 'run');
    expect(rootMethod).toBeDefined();

    const full = buildCallTree({
      rootFile: rootMethod!.file,
      rootMethod: rootMethod!,
      index,
      maxDepth: 5,
      includeExternal: true,
      compacted: false,
    });

    const compact = buildCallTree({
      rootFile: rootMethod!.file,
      rootMethod: rootMethod!,
      index,
      maxDepth: 5,
      includeExternal: true,
      compacted: true,
    });

    const fullCallback = full.root.children?.[0].children?.[0];
    const compactCallback = compact.root.children?.[0].children?.[0];

    expect(fullCallback?.children).toHaveLength(2);
    expect(fullCallback?.children?.every((node) => node.node_type === 'data_access')).toBe(true);
    expect(compactCallback?.children).toHaveLength(1);
    expect(compactCallback?.children?.[0].symbol).toBe('<data_access_group>');
    expect(compactCallback?.children?.[0].node_type).toBe('data_access');
    expect(compactCallback?.children?.[0].called_as).toContain('item.trim()');
    expect(compactCallback?.children?.[0].called_as).toContain('item.isBlank()');
  });

  it('resolves overloaded application methods by argument shape instead of picking the first declaration', async () => {
    const rootDir = await createProject({
      'Example.java': `public class Example {\n  public void run() {\n    process(1);\n    process("x");\n  }\n\n  private void process(int value) {}\n\n  private void process(String value) {}\n}\n`,
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

    expect(result.root.children).toHaveLength(2);
    expect(result.root.children?.map((child) => child.called_as)).toEqual(['process(1)', 'process("x")']);
    expect(result.root.children?.map((child) => child.signature)).toEqual([
      'private void process(int value) ...',
      'private void process(String value) ...',
    ]);
  });

  it('uses object-creation syntax only as a conservative overload discriminator', async () => {
    const rootDir = await createProject({
      'Example.java': `public class Example {\n  public void run() {\n    process(new String("x"));\n  }\n\n  private void process(String value) {}\n  private void process(Integer value) {}\n}\n`,
    });

    const index = await buildProjectIndex(rootDir);
    const rootMethod = index.methods.find((method) => method.className === 'Example' && method.symbol === 'run');
    expect(rootMethod).toBeDefined();

    const result = buildCallTree({
      rootFile: rootMethod!.file,
      rootMethod: rootMethod!,
      index,
      maxDepth: 5,
      includeExternal: true,
    });

    expect(result.root.children).toHaveLength(1);
    expect(result.root.children?.[0]).toMatchObject({
      symbol: 'process',
      called_as: 'process(new String("x"))',
      signature: 'private void process(String value) ...',
      is_application: true,
      is_external: false,
    });
  });

  it('extracts Mockito verification chains and assertion lambdas without duplicate child calls', async () => {
    const rootDir = await createProject({
      'Example.java': `public class Example {
  private final AppService service = new AppService();

  public void mockito() {
    verify(service).method();
    verify(service, never()).method();
    verify(service, times(1)).method();
    doAnswer(invocation -> null).when(service).method();
    doThrow(new RuntimeException()).doNothing().when(service).method();
  }

  public void assertion() {
    assertThatThrownBy(() -> service.method());
  }
}

class AppService {
  public void method() {}
}
`,
    });

    const index = await buildProjectIndex(rootDir);
    const mockito = index.methods.find((method) => method.className === 'Example' && method.symbol === 'mockito');
    const assertion = index.methods.find((method) => method.className === 'Example' && method.symbol === 'assertion');
    expect(mockito).toBeDefined();
    expect(assertion).toBeDefined();

    const mockitoTree = buildCallTree({
      rootFile: mockito!.file,
      rootMethod: mockito!,
      index,
      maxDepth: 5,
      includeExternal: true,
    });
    expect(mockitoTree.root.children?.filter((child) => child.symbol === 'method').map((child) => child.called_as)).toEqual([
      'verify(service).method()',
      'verify(service, never()).method()',
      'verify(service, times(1)).method()',
      'doAnswer(invocation -> null).when(service).method()',
      'doThrow(new RuntimeException()).doNothing().when(service).method()',
    ]);
    expect(mockitoTree.root.children?.filter((child) => child.symbol === 'method').every((child) => child.is_application)).toBe(true);

    const assertionTree = buildCallTree({
      rootFile: assertion!.file,
      rootMethod: assertion!,
      index,
      maxDepth: 5,
      includeExternal: true,
    });
    const callbackChildren = assertionTree.root.children?.[0].children?.[0].children ?? [];
    expect(callbackChildren.map((child) => child.called_as)).toEqual(['service.method()']);
  });

  it('preserves nested owner identity when simple class names collide', async () => {
    const rootDir = await createProject({
      'Example.java': `public class Example {\n  static class OuterA {\n    static class Inner {\n      void run() {\n        helperA();\n      }\n\n      void helperA() {}\n    }\n  }\n\n  static class OuterB {\n    static class Inner {\n      void run() {\n        helperB();\n      }\n\n      void helperB() {}\n    }\n  }\n\n  public void start() {\n    new OuterB.Inner().run();\n  }\n}\n`,
    });

    const index = await buildProjectIndex(rootDir);
    const rootMethod = index.methods.find((m) => m.className === 'Example' && m.symbol === 'start');
    expect(rootMethod).toBeDefined();

    const result = buildCallTree({
      rootFile: rootMethod!.file,
      rootMethod: rootMethod!,
      index,
      maxDepth: 5,
      includeExternal: true,
    });

    expect(result.root.children?.[0].called_as).toBe('new OuterB.Inner().run()');
    expect(result.root.children?.[0].children?.[0].symbol).toBe('helperB');
    expect(result.root.children?.[0].children?.[0].signature).toBe('void helperB() ...');
  });
});
