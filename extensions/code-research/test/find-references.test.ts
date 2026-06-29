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

  it('prefers graph-backed references when graph is enabled and available', async () => {
    const rootDir = await createProject('pi-find-references-graph', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function helper(): void {}\n\nexport function runService(): void {\n  helper();\n}\n\nexport function warmupService(): void {\n  helper();\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src/service.ts',
      symbol: 'helper',
      language: 'ts',
      kind: 'function',
    });

    expect(results).toHaveLength(2);
    expect(results.map((item) => item.context_symbol).sort()).toEqual(['runService', 'warmupService']);
  });
});
