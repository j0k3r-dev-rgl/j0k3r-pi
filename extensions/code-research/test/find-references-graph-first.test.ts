import { describe, it, expect, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';

vi.mock('../src/languages/java/find-references.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/languages/java/find-references.js')>();
  return {
    ...actual,
    findJavaReferences: vi.fn(async () => {
      throw new Error('direct Java reference fallback should not run when graph answers');
    }),
  };
});

const { resolveFindReferences } = await import('../src/core/find-references-resolver.js');

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

describe('find_references graph-first policy', () => {
  it('does not run direct Java fallback when a fresh graph answers the query', async () => {
    const rootDir = await createProject('pi-find-references-java-graph-first', {
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/app/AppService.java': `package app;\n\npublic class AppService {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
    });
    await buildWorkspaceGraph(rootDir);

    const resolution = await resolveFindReferences(rootDir, {
      path: 'src/main/java/app/AppService.java',
      symbol: 'helper',
      language: 'java',
      kind: 'method',
      reference_kinds: ['call'],
    });

    expect(resolution.diagnostics).toMatchObject({ source_mode: 'graph', graph_status: 'fresh', completeness: 'complete', fallback_reason: null });
    expect(resolution.results.map((item) => item.context_symbol)).toEqual(['run']);
  });
});
