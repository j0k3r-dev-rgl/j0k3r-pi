import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findSymbol } from '../src/core/find-symbol-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import type { FindSymbolInput, SymbolLocation } from '../src/types.js';

describe('findSymbol', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = join(tmpdir(), `pi-find-symbol-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  async function writeTestFile(name: string, content: string) {
    const path = join(tmpDir, name);
    await writeFile(path, content, 'utf8');
    return path;
  }

  it('finds a simple function declaration', async () => {
    const file = await writeTestFile(
      'simple.ts',
      `function greet(name: string): string {\n  return \`Hello, \${name}\`;\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'greet',
      language: 'ts',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject<Partial<SymbolLocation>>({
      file,
      symbol: 'greet',
      kind: 'function',
      start_line: 1,
      is_definition: true,
      is_implementation: true,
    });
  });

  it('finds a class method', async () => {
    const file = await writeTestFile(
      'class.ts',
      `class Greeter {\n  greet(name: string): string {\n    return \`Hello, \${name}\`;\n  }\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'greet',
      language: 'ts',
      kind: 'method',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject<Partial<SymbolLocation>>({
      file,
      symbol: 'greet',
      kind: 'method',
      start_line: 2,
      is_definition: true,
      is_implementation: true,
    });
  });

  it('finds an interface and its implementation', async () => {
    const ifaceFile = await writeTestFile(
      'greeter.ts',
      `export interface Greeter {\n  greet(name: string): string;\n}\n`
    );
    await writeTestFile(
      'console-greeter.ts',
      `import { Greeter } from './greeter';\n\nexport class ConsoleGreeter implements Greeter {\n  greet(name: string): string {\n    return \`Hello, \${name}\`;\n  }\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: tmpDir,
      symbol: 'Greeter',
      language: 'ts',
      kind: 'interface',
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    const definition = results.find((r) => r.kind === 'interface');
    expect(definition).toBeDefined();
    expect(definition?.is_definition).toBe(true);
    expect(definition?.file).toBe(ifaceFile);
    expect(definition?.implementation_locations?.length).toBeGreaterThanOrEqual(1);
  });

  it('returns code content when include_code is true', async () => {
    const file = await writeTestFile(
      'with-code.ts',
      `function add(a: number, b: number): number {\n  return a + b;\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'add',
      language: 'ts',
      include_code: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].code).toContain('function add');
    expect(results[0].code).toContain('return a + b;');
  });

  it('supports JavaScript files', async () => {
    const file = await writeTestFile(
      'script.js',
      `function multiply(a, b) {\n  return a * b;\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'multiply',
      language: 'js',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('function');
    expect(results[0].start_line).toBe(1);
  });

  it('auto-detects language from file extension', async () => {
    const file = await writeTestFile(
      'auto.ts',
      `const foo = () => {\n  return 1;\n};\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'foo',
      language: 'auto',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('function');
    expect(results[0].declaration_kind).toBe('callable_variable');
  });

  it('marks arrow-function variables as definition and implementation', async () => {
    const file = await writeTestFile(
      'arrow.ts',
      `const multiply = (a: number, b: number): number => a * b;\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'multiply',
      language: 'ts',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('function');
    expect(results[0].declaration_kind).toBe('callable_variable');
    expect(results[0].is_definition).toBe(true);
    expect(results[0].is_implementation).toBe(true);
  });

  it('treats a class that implements an interface as both definition and implementation', async () => {
    const file = await writeTestFile(
      'impl-class.ts',
      `interface Greeter {\n  greet(): string;\n}\n\nclass ConsoleGreeter implements Greeter {\n  greet(): string {\n    return 'hi';\n  }\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'ConsoleGreeter',
      language: 'ts',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('class');
    expect(results[0].is_definition).toBe(true);
    expect(results[0].is_implementation).toBe(true);
  });

  it('returns signature when include_signature is true', async () => {
    const file = await writeTestFile(
      'signature.ts',
      `function add(a: number, b: number): number {\n  return a + b;\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'add',
      language: 'ts',
      include_signature: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].signature).toContain('function add');
    expect(results[0].signature).toContain('a: number');
    expect(results[0].signature).not.toContain('return a + b');
  });

  it('ignores include_code for non-function/method kinds', async () => {
    const file = await writeTestFile(
      'no-code-class.ts',
      `class BigClass {\n  one() {}\n  two() {}\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'BigClass',
      language: 'ts',
      kind: 'class',
      include_code: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].code).toBeUndefined();
  });

  it('filters files by glob', async () => {
    await writeTestFile('a.service.ts', `export function serviceA() {}\n`);
    await writeTestFile('b.helper.ts', `export function helperB() {}\n`);

    const results = await findSymbol(tmpDir, {
      path: tmpDir,
      symbol: 'serviceA',
      language: 'ts',
      glob: '*.service.ts',
    });

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('serviceA');
  });

  it('supports prefix search mode', async () => {
    const file = await writeTestFile(
      'prefix.ts',
      `function fetchUsers() {}\nfunction fetchPosts() {}\nfunction deleteUser() {}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'fetch',
      language: 'ts',
      search_mode: 'prefix',
    });

    expect(results.length).toBe(2);
    expect(results.map((r) => r.symbol).sort()).toEqual(['fetchPosts', 'fetchUsers']);
  });

  it('supports contains search mode', async () => {
    const file = await writeTestFile(
      'contains.ts',
      `function loadUserData() {}\nfunction saveUserData() {}\nfunction reset() {}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'User',
      language: 'ts',
      search_mode: 'contains',
    });

    expect(results.length).toBe(2);
    expect(results.map((r) => r.symbol).sort()).toEqual(['loadUserData', 'saveUserData']);
  });

  it('ignores include_code when search_mode is not exact', async () => {
    const file = await writeTestFile(
      'no-code-prefix.ts',
      `function fetchOne() { return 1; }\nfunction fetchTwo() { return 2; }\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'fetch',
      language: 'ts',
      search_mode: 'prefix',
      include_code: true,
    });

    expect(results.length).toBe(2);
    expect(results.every((r) => r.code === undefined)).toBe(true);
  });

  it('finds private class members', async () => {
    const file = await writeTestFile(
      'private.ts',
      `class Vault {\n  private secret: string;\n  #hash: string;\n\n  private getSecret(): string {\n    return this.secret;\n  }\n\n  #getHash(): string {\n    return this.hash;\n  }\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'getSecret',
      language: 'ts',
      kind: 'method',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('method');
    expect(results[0].is_definition).toBe(true);
  });

  it('finds hash-private class members', async () => {
    const file = await writeTestFile(
      'hash-private.ts',
      `class Vault {\n  #getHash(): string {\n    return this.hash;\n  }\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'getHash',
      language: 'ts',
      kind: 'method',
      include_code: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('method');
    expect(results[0].is_definition).toBe(true);
    expect(results[0].code).toContain('#getHash');
  });

  it('preserves private-name source spelling and modifiers in direct mode', async () => {
    const file = await writeTestFile(
      'hash-private-metadata.ts',
      `class Vault {\n  #secret = 1;\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'secret',
      language: 'ts',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      symbol: 'secret',
      declaration_kind: 'field',
      source_name: '#secret',
      modifiers: ['private'],
    });
  });

  it('finds type aliases', async () => {
    const file = await writeTestFile(
      'type-alias.ts',
      `type UserID = string;\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'UserID',
      language: 'ts',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('variable');
    expect(results[0].declaration_kind).toBe('type_alias');
    expect(results[0].is_definition).toBe(true);

    const narrowed = await findSymbol(tmpDir, {
      path: file,
      symbol: 'UserID',
      language: 'ts',
      declaration_kind: 'type_alias',
    });
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0].declaration_kind).toBe('type_alias');
  });

  it('finds exported ReviewAnalysisStatus-style type aliases by declaration kind', async () => {
    const file = await writeTestFile(
      'review-analysis-status.ts',
      `export type ReviewAnalysisStatus = 'pending' | 'complete';\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'ReviewAnalysisStatus',
      language: 'ts',
      declaration_kind: 'type_alias',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: 'variable',
      declaration_kind: 'type_alias',
      symbol: 'ReviewAnalysisStatus',
      is_definition: true,
    });
  });

  it('treats nested function declarations as definitions', async () => {
    const file = await writeTestFile(
      'nested.ts',
      `function outer() {\n  function inner() {\n    return 1;\n  }\n  return inner();\n}\n`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'inner',
      language: 'ts',
    });

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('function');
    expect(results[0].is_definition).toBe(true);
    expect(results[0].is_implementation).toBe(true);
  });

  it('uses the graph for typescript symbol lookup and extracts code from file ranges', async () => {
    const projectDir = join(tmpDir, `graph-ts-${Date.now()}`);
    await mkdir(join(projectDir, '.pi'), { recursive: true });
    await writeFile(join(projectDir, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
    const file = join(projectDir, 'src', 'service.ts');
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, `export function runService(): void {\n  helper();\n}\n\nfunction helper(): void {}\n`, 'utf8');
    await buildWorkspaceGraph(projectDir);

    const results = await findSymbol(projectDir, {
      path: file,
      symbol: 'runService',
      language: 'ts',
      include_signature: true,
      include_code: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].file).toBe(file);
    expect(results[0].symbol).toBe('runService');
    expect(results[0].signature).toContain('function runService');
    expect(results[0].code).toContain('helper();');
  });

  it('finds destructured exported function bindings in typescript files', async () => {
    const file = await writeTestFile(
      'destructured-export.ts',
      `const authSessionStorage = {
  getSession: async function getSession(cookieHeader: string | null) {
    return { cookieHeader };
  },
};

export const { getSession, commitSession } = authSessionStorage;
`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'getSession',
      language: 'ts',
      include_signature: true,
      include_code: true,
    });

    expect(results.filter((result) => result.symbol === 'getSession' && result.kind === 'function').length).toBeGreaterThanOrEqual(1);
    const binding = results.find((result) => result.symbol === 'getSession' && !result.owner);
    const callable = results.find((result) => result.symbol === 'getSession' && Boolean(result.signature?.includes('async function getSession')));
    expect(binding?.is_definition).toBe(true);
    expect(binding?.is_implementation).toBe(true);
    expect(callable?.signature).toContain('async function getSession');
  });

  it('finds destructured exported function bindings in javascript files', async () => {
    const file = await writeTestFile(
      'destructured-export.js',
      `const authSessionStorage = {
  getSession: async function getSession(cookieHeader) {
    return { cookieHeader };
  },
};

export const { getSession, commitSession } = authSessionStorage;
`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'getSession',
      language: 'js',
      include_signature: true,
      include_code: true,
    });

    expect(results.filter((result) => result.symbol === 'getSession' && result.kind === 'function').length).toBeGreaterThanOrEqual(1);
    const binding = results.find((result) => result.symbol === 'getSession' && !result.owner);
    const callable = results.find((result) => result.symbol === 'getSession' && Boolean(result.signature?.includes('async function getSession')));
    expect(binding?.is_definition).toBe(true);
    expect(binding?.is_implementation).toBe(true);
    expect(callable?.signature).toContain('async function getSession');
  });

  it('finds destructured exported bindings from factory results as variables', async () => {
    const file = await writeTestFile(
      'destructured-factory.ts',
      `declare function createCookieSessionStorage(): {
  getSession(cookieHeader: string | null): Promise<unknown>;
  commitSession(): Promise<void>;
};

export const authSessionStorage = createCookieSessionStorage();
export const { getSession, commitSession } = authSessionStorage;
`
    );

    const results = await findSymbol(tmpDir, {
      path: file,
      symbol: 'getSession',
      language: 'ts',
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    const exportedBinding = results.find((result) => result.kind === 'variable');
    expect(exportedBinding).toBeDefined();
    expect(exportedBinding?.symbol).toBe('getSession');
    expect(exportedBinding?.is_definition).toBe(true);
  });

  it('finds abstract classes and abstract methods', async () => {
    const file = await writeTestFile(
      'abstract.ts',
      `export abstract class Animal {\n  abstract speak(): string;\n}\n\nexport class Dog extends Animal {\n  speak(): string {\n    return 'woof';\n  }\n}\n`
    );

    const animal = await findSymbol(tmpDir, {
      path: file,
      symbol: 'Animal',
      language: 'ts',
      kind: 'class',
    });

    expect(animal).toHaveLength(1);
    expect(animal[0].kind).toBe('class');
    expect(animal[0].is_definition).toBe(true);

    const speak = await findSymbol(tmpDir, {
      path: file,
      symbol: 'speak',
      language: 'ts',
      kind: 'method',
    });

    expect(speak.length).toBeGreaterThanOrEqual(1);
    expect(speak.some((r) => r.kind === 'method')).toBe(true);
  });

  it('throws a clear error when path does not exist', async () => {
    await expect(
      findSymbol(tmpDir, {
        path: join(tmpDir, 'does-not-exist.ts'),
        symbol: 'foo',
        language: 'ts',
      })
    ).rejects.toThrow('Path not found');
  });

  it('finds constructors, getters, setters, and static methods', async () => {
    const file = await writeTestFile(
      'accessors.ts',
      `class Person {\n  private _name: string;\n\n  constructor(name: string) {\n    this._name = name;\n  }\n\n  static create(name: string): Person {\n    return new Person(name);\n  }\n\n  get name(): string {\n    return this._name;\n  }\n\n  set name(value: string) {\n    this._name = value;\n  }\n}\n`
    );

    const ctor = await findSymbol(tmpDir, {
      path: file,
      symbol: 'constructor',
      language: 'ts',
      kind: 'method',
    });
    expect(ctor).toHaveLength(1);
    expect(ctor[0].kind).toBe('method');

    const create = await findSymbol(tmpDir, {
      path: file,
      symbol: 'create',
      language: 'ts',
      kind: 'method',
    });
    expect(create).toHaveLength(1);

    const nameGetter = await findSymbol(tmpDir, {
      path: file,
      symbol: 'name',
      language: 'ts',
      kind: 'method',
    });
    expect(nameGetter.length).toBeGreaterThanOrEqual(2);
  });
});
