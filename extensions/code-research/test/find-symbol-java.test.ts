import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { findSymbol } from '../src/core/find-symbol-resolver.js';
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

    const results = await findSymbol(tmpDir, {
      path: projectRoot,
      symbol: 'Service',
      language: 'java',
      kind: 'interface',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('interface');
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

  it('parses a specific large real-world java file when buffer size is increased', async () => {
    const realFile = '/home/j0k3r/sias/app/back/src/main/java/com/sistemasias/ar/modules/user/infrastructure/persistence/dao/UserQueryMongoSupport.java';

    const results = await findSymbol(tmpDir, {
      path: realFile,
      symbol: 'UserQueryMongoSupport',
      language: 'java',
      kind: 'class',
      include_signature: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('UserQueryMongoSupport');
    expect(results[0].kind).toBe('class');
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
  });
});
