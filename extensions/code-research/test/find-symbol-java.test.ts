import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { findSymbol } from '../src/core/find-symbol-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import type { SymbolLocation } from '../src/types.js';

describe('findSymbol Java', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = join(tmpdir(), `pi-find-symbol-java-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  async function writeTestFile(name: string, content: string) {
    const path = join(tmpDir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    return path;
  }

  it('finds a Java class', async () => {
    const file = await writeTestFile(
      'Hello.java',
      `public class Hello {\n  public void greet(String name) {\n    System.out.println("Hello, " + name);\n  }\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'Hello',
      language: 'java',
      kind: 'class',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject<Partial<SymbolLocation>>({
      file,
      symbol: 'Hello',
      kind: 'class',
      start_line: 1,
      is_definition: true,
      is_implementation: true,
    });
  });

  it('finds a Java method', async () => {
    const file = await writeTestFile(
      'Greeter.java',
      `public class Greeter {\n  public String greet(String name) {\n    return "Hello, " + name;\n  }\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'greet',
      language: 'java',
      kind: 'method',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('method');
    expect(results[0].is_definition).toBe(true);
    expect(results[0].is_implementation).toBe(true);
  });

  it('finds a Java interface and its implementation in the same file', async () => {
    const file = await writeTestFile(
      'Service.java',
      `public interface Service {\n  String run();\n}\n\nclass LocalService implements Service {\n  public String run() {\n    return "local";\n  }\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'Service',
      language: 'java',
      kind: 'interface',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('interface');
    expect(results[0].is_definition).toBe(true);
    expect(results[0].implementation_locations?.length).toBe(1);
    expect(results[0].implementation_locations?.[0].symbol).toBe('LocalService');
  });

  it('finds Java interface method implementations from a file-scoped interface method', async () => {
    const projectRoot = join(tmpDir, `method-implementation-project-${Date.now()}`);
    await mkdir(projectRoot, { recursive: true });
    await writeTestFile(
      `${projectRoot.slice(tmpDir.length + 1)}/src/main/java/ports/Worker.java`,
      `package ports;\npublic interface Worker {\n  void run(String id);\n}\n`
    );
    await writeTestFile(
      `${projectRoot.slice(tmpDir.length + 1)}/src/main/java/impl/WorkerUseCase.java`,
      `package impl;\n\nimport ports.Worker;\n\npublic class WorkerUseCase implements Worker {\n  public void run(String id) {}\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: join(projectRoot, 'src/main/java/ports/Worker.java'),
      symbol: 'run',
      language: 'java',
      kind: 'method',
    });

    expect(results).toHaveLength(1);
    expect(results[0].implementation_locations?.map((location) => location.qualified_name)).toEqual(['impl.WorkerUseCase.run']);
  });

  it('finds Java interface implementations across a directory', async () => {
    const projectRoot = join(tmpDir, 'cross-file-project');
    await mkdir(projectRoot, { recursive: true });
    await writeTestFile(
      'cross-file-project/ports/Service.java',
      `package ports;\npublic interface Service {\n  String run();\n}\n`
    );
    await writeTestFile(
      'cross-file-project/impl/LocalService.java',
      `package impl;\n\nimport ports.Service;\n\npublic class LocalService implements Service {\n  public String run() {\n    return "local";\n  }\n}\n`
    );
    await writeTestFile(
      'cross-file-project/impl/LocalServiceExtra.java',
      `package impl;\n\npublic interface ServiceExtra {}\n\npublic class LocalServiceExtra implements ServiceExtra {}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: projectRoot,
      symbol: 'Service',
      language: 'java',
      kind: 'interface',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('interface');
    expect(results[0].implementation_locations?.map((location) => location.symbol)).toEqual(['LocalService']);
  });

  it('uses the graph for Java interface lookup and returns implementation locations', async () => {
    const slug = `graph-java-${Date.now()}`;
    const projectRoot = join(tmpDir, slug);
    await mkdir(join(projectRoot, '.pi'), { recursive: true });
    await writeFile(join(projectRoot, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
    await writeTestFile(
      `${slug}/ports/Service.java`,
      `package ports;\npublic interface Service {\n  String run();\n}\n`
    );
    await writeTestFile(
      `${slug}/impl/LocalService.java`,
      `package impl;\n\nimport ports.Service;\n\npublic class LocalService implements Service {\n  public String run() {\n    return "local";\n  }\n}\n`
    );

    await buildWorkspaceGraph(projectRoot);

    const results = await findSymbol(projectRoot, {
      path: projectRoot,
      symbol: 'Service',
      language: 'java',
      kind: 'interface',
    });

    expect(results).toHaveLength(1);
    expect(results[0].implementation_locations?.some((location) => location.symbol === 'LocalService')).toBe(true);
  });

  it('finds a Java constructor', async () => {
    const file = await writeTestFile(
      'Person.java',
      `public class Person {\n  private final String name;\n\n  public Person(String name) {\n    this.name = name;\n  }\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'Person',
      language: 'java',
      kind: 'method',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('method');
    expect(results[0].start_line).toBe(4);
  });

  it('returns signature when include_signature is true', async () => {
    const file = await writeTestFile(
      'Signature.java',
      `public class Signature {\n  public int add(int a, int b) {\n    return a + b;\n  }\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'add',
      language: 'java',
      kind: 'method',
      include_signature: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].signature).toContain('public int add');
    expect(results[0].signature).toContain('int a, int b');
    expect(results[0].signature).not.toContain('return a + b');
  });

  it('auto-detects Java from file extension', async () => {
    const file = await writeTestFile(
      'Auto.java',
      `public class Auto {\n  public void run() {}\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'Auto',
      language: 'auto',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('class');
  });

  it('does not duplicate private fields', async () => {
    const file = await writeTestFile(
      'Fields.java',
      `public class Fields {\n  private final String name;\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'name',
      language: 'java',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('variable');
  });

  it('rejects explicit file paths that escape the workspace', async () => {
    const realFile = '/home/j0k3r/sias/app/back/src/main/java/com/sistemasias/ar/modules/user/infrastructure/persistence/dao/UserQueryMongoSupport.java';

    await expect(findSymbol(tmpDir, {
      path: realFile,
      symbol: 'UserQueryMongoSupport',
      language: 'java',
      kind: 'class',
      include_signature: true,
    })).rejects.toThrow('Path escapes workspace');
  });

  it('finds symbols during real project directory scans including large java files', async () => {
    const results = await findSymbol('/home/j0k3r/sias/app/back', {
      path: 'src/main/java',
      symbol: 'NotificationCommandInputPort',
      language: 'java',
      kind: 'interface',
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((result) => result.symbol === 'NotificationCommandInputPort')).toBe(true);
  }, 15_000);

  it('covers java declaration kinds across examples and inline bindings', async () => {
    const adapter = await findSymbol('/home/j0k3r/.pi/agent', {
      path: 'examples/java',
      symbol: 'Adapter',
      language: 'java',
      kind: 'class',
    });
    const draft = await findSymbol('/home/j0k3r/.pi/agent', {
      path: 'examples/java',
      symbol: 'UserDraft',
      language: 'java',
      kind: 'class',
    });
    const userKind = await findSymbol('/home/j0k3r/.pi/agent', {
      path: 'examples/java',
      symbol: 'UserKind',
      language: 'java',
      kind: 'class',
    });

    expect(adapter[0]).toMatchObject({ declaration_kind: 'annotation', kind: 'class', qualified_name: 'app.annotations.Adapter' });
    expect(draft[0]).toMatchObject({ declaration_kind: 'record', kind: 'class', qualified_name: 'app.domain.UserDraft' });
    expect(userKind[0]).toMatchObject({ declaration_kind: 'enum', kind: 'class', qualified_name: 'app.domain.UserKind' });
  });

  it('extracts instanceof pattern variables in direct and fresh graph modes', async () => {
    const slug = `graph-java-pattern-${Date.now()}`;
    const projectRoot = join(tmpDir, slug);
    await mkdir(join(projectRoot, '.pi'), { recursive: true });
    await writeFile(join(projectRoot, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
    await writeTestFile(
      `${slug}/app/PatternExample.java`,
      `package app;\n\npublic class PatternExample {\n  boolean isNumber(Object value) {\n    return value instanceof Number matched;\n  }\n}\n`
    );

    const file = join(projectRoot, 'app/PatternExample.java');

    const direct = await findSymbol(projectRoot, {
      path: file,
      symbol: 'matched',
      language: 'java',
      declaration_kind: 'pattern_variable',
    });

    await buildWorkspaceGraph(projectRoot);
    const graph = await findSymbol(projectRoot, {
      path: file,
      symbol: 'matched',
      language: 'java',
      declaration_kind: 'pattern_variable',
    });

    expect(direct).toHaveLength(1);
    expect(graph).toHaveLength(1);
    expect(graph[0]).toMatchObject({ declaration_kind: 'pattern_variable', kind: 'variable', owner: 'isNumber' });
    expect(graph[0].symbol_id).toBe(direct[0].symbol_id);
  });

  it('extracts single unparenthesized lambda parameters in direct and fresh graph modes', async () => {
    const slug = `graph-java-lambda-${Date.now()}`;
    const projectRoot = join(tmpDir, slug);
    await mkdir(join(projectRoot, '.pi'), { recursive: true });
    await writeFile(join(projectRoot, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
    await writeTestFile(
      `${slug}/app/LambdaExample.java`,
      `package app;\n\nimport java.util.function.Function;\n\npublic class LambdaExample {\n  Function<Integer, Integer> plusOne() {\n    return lambdaArg -> lambdaArg + 1;\n  }\n}\n`
    );

    const file = join(projectRoot, 'app/LambdaExample.java');

    const direct = await findSymbol(projectRoot, {
      path: file,
      symbol: 'lambdaArg',
      language: 'java',
      declaration_kind: 'lambda_parameter',
    });

    await buildWorkspaceGraph(projectRoot);
    const graph = await findSymbol(projectRoot, {
      path: file,
      symbol: 'lambdaArg',
      language: 'java',
      declaration_kind: 'lambda_parameter',
    });

    expect(direct).toHaveLength(1);
    expect(graph).toHaveLength(1);
    expect(direct[0]).toMatchObject({ declaration_kind: 'lambda_parameter', kind: 'variable' });
    expect(direct[0].owner).toContain('<lambda@');
    expect(graph[0].owner).toBe(direct[0].owner);
    expect(graph[0].symbol_id).toBe(direct[0].symbol_id);
  });

  it('returns individual declarators, bindings, and package/module declarations with inclusion rules', async () => {
    const projectRoot = join(tmpDir, `java-parity-${Date.now()}`);
    await mkdir(projectRoot, { recursive: true });
    await writeTestFile(
      `${projectRoot.replace(`${tmpDir}/`, '')}/pkg/package-info.java`,
      `package pkg.demo;\n`
    );
    await writeTestFile(
      `${projectRoot.replace(`${tmpDir}/`, '')}/module-info.java`,
      `module demo.module { }\n`
    );
    const file = await writeTestFile(
      `${projectRoot.replace(`${tmpDir}/`, '')}/pkg/Example.java`,
      `package pkg.demo;\npublic class Example<T> {\n  private int first = 1, second, third = 3;\n  public Example(String name) {\n    int localA = 1, localB = 2;\n    Runnable lambda = () -> { int lambdaValue = localA; };\n    for (String item : java.util.List.of(name)) {\n      System.out.println(item);\n    }\n    try (var reader = new java.io.StringReader(name)) {\n      System.out.println(reader);\n    } catch (Exception ex) {\n      System.out.println(ex.getMessage());\n    }\n  }\n}\n`
    );

    const fields = await findSymbol(projectRoot, { path: file, symbol: 'first', language: 'java' });
    const second = await findSymbol(projectRoot, { path: file, symbol: 'second', language: 'java' });
    const local = await findSymbol(projectRoot, { path: file, symbol: 'localB', language: 'java' });
    const lambda = await findSymbol(projectRoot, { path: file, symbol: 'lambdaValue', language: 'java' });
    const pkg = await findSymbol(projectRoot, { path: projectRoot, symbol: 'pkg.demo', language: 'java' });
    const moduleDecl = await findSymbol(projectRoot, { path: projectRoot, symbol: 'demo.module', language: 'java', declaration_kind: 'module' });
    const hiddenBindings = await findSymbol(projectRoot, { path: projectRoot, symbol: 'local', language: 'java', search_mode: 'contains' });
    const visibleBindings = await findSymbol(projectRoot, { path: projectRoot, symbol: 'local', language: 'java', search_mode: 'contains', declaration_kind: 'local_variable' });

    expect(fields[0]).toMatchObject({ declaration_kind: 'field', start_line: 3, kind: 'variable' });
    expect(second[0]).toMatchObject({ declaration_kind: 'field', start_line: 3, kind: 'variable' });
    expect(local[0]).toMatchObject({ declaration_kind: 'local_variable', kind: 'variable' });
    expect(lambda[0]).toMatchObject({ declaration_kind: 'local_variable', kind: 'variable' });
    expect(pkg[0]).toMatchObject({ declaration_kind: 'package', kind: 'variable' });
    expect(moduleDecl[0]).toMatchObject({ declaration_kind: 'module', kind: 'variable' });
    expect(hiddenBindings).toEqual([]);
    expect(visibleBindings.some((result) => result.symbol === 'localA')).toBe(true);
    expect(visibleBindings.some((result) => result.symbol === 'localB')).toBe(true);
  });

  it('applies java include_code allowlist per result', async () => {
    const file = await writeTestFile(
      'Payload.java',
      `public class Payload {\n  private final String value = \"secret\";\n  public String value() {\n    return value;\n  }\n}\n`
    );

    const method = await findSymbol(tmpDir, { path: file, symbol: 'value', language: 'java', kind: 'method', include_code: true, include_signature: true });
    const field = await findSymbol(tmpDir, { path: file, symbol: 'value', language: 'java', kind: 'variable', include_code: true, include_signature: true });
    const clazz = await findSymbol(tmpDir, { path: file, symbol: 'Payload', language: 'java', kind: 'class', include_code: true, include_signature: true });

    expect(method[0].code).toContain('return value;');
    expect(method[0].signature).toContain('public String value()');
    expect(field[0].code).toBeUndefined();
    expect(clazz[0].code).toBeUndefined();
  });

  it('keeps directory-scoped binding queries gated even for adversarial local-binding counts', async () => {
    const projectRoot = join(tmpDir, `java-adversarial-bindings-${Date.now()}`);
    await mkdir(projectRoot, { recursive: true });
    const localDeclarations = Array.from({ length: 250 }, (_, index) => `    String value${index} = input + ${index};`).join('\n');
    const file = await writeTestFile(
      `${projectRoot.replace(`${tmpDir}/`, '')}/Adversarial.java`,
      `public class Adversarial {\n  public void run(String input) {\n${localDeclarations}\n  }\n}\n`
    );

    const hidden = await findSymbol(projectRoot, { path: projectRoot, symbol: 'value', language: 'java', search_mode: 'contains', scope: 'directory' });
    const visible = await findSymbol(projectRoot, { path: file, symbol: 'value', language: 'java', search_mode: 'contains', declaration_kind: 'local_variable' });

    expect(hidden).toEqual([]);
    expect(visible.length).toBe(250);
    expect(visible[0]).toMatchObject({ declaration_kind: 'local_variable', kind: 'variable' });
  });
});
