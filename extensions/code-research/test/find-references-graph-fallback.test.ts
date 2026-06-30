import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findReferences } from '../src/core/find-references-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import { loadWorkspaceGraphState, writeWorkspaceGraphState } from '../src/core/workspace-state.js';

async function createProject(files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `pi-find-references-graph-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('findReferences graph fallback', () => {
  it('falls back to direct lookup when the graph is stale', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function oldHelper(): void {}\nexport function useOld(): void { oldHelper(); }\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await writeFile(
      join(rootDir, 'src/service.ts'),
      `export function freshHelper(): void {}\nexport function useFresh(): void { freshHelper(); }\n`,
      'utf8'
    );

    const state = await loadWorkspaceGraphState(rootDir);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    await writeWorkspaceGraphState(rootDir, { ...state.data, status: 'stale' });

    const results = await findReferences(rootDir, {
      path: 'src/service.ts',
      symbol: 'freshHelper',
      language: 'ts',
      kind: 'function',
    });

    expect(results).toHaveLength(1);
    expect(results[0].context_symbol).toBe('useFresh');
    expect(results[0].reference_kind).toBe('call');
  });

  it('falls back to direct lookup for normal public calls because graph coverage is incomplete', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/main/java/ports/Service.java': `package ports;\n\npublic interface Service {}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport ports.Service;\n\npublic class AppService implements Service {}\n`,
      'src/main/java/ports/ExtendedService.java': `package ports;\n\npublic interface ExtendedService extends Service {}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport ports.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findReferences(rootDir, {
      path: 'src/main/java/ports/Service.java',
      symbol: 'Service',
      language: 'java',
      kind: 'interface',
    });

    expect(new Set(results.map((item) => item.reference_kind))).toEqual(
      new Set(['extends', 'implements', 'import', 'type_reference'])
    );
  });
});
