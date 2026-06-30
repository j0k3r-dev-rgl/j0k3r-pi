import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findSymbol } from '../src/core/find-symbol-resolver.js';
import { buildWorkspaceGraph } from '../src/core/workspace-graph.js';
import { loadWorkspaceGraphState, writeWorkspaceGraphState } from '../src/core/workspace-state.js';

async function createProject(files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `pi-find-symbol-graph-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('findSymbol graph fallback', () => {
  it('falls back to direct lookup when the graph is stale', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function oldHelper(): void {}\n`,
    });

    await buildWorkspaceGraph(rootDir);
    await writeFile(join(rootDir, 'src/service.ts'), `export function freshHelper(): void {}\n`, 'utf8');

    const state = await loadWorkspaceGraphState(rootDir);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    await writeWorkspaceGraphState(rootDir, { ...state.data, status: 'stale' });

    const results = await findSymbol(rootDir, {
      path: 'src/service.ts',
      symbol: 'freshHelper',
      language: 'ts',
      include_signature: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('freshHelper');
    expect(results[0].signature).toContain('freshHelper');
  });

  it('uses the graph when it is fresh and usable', async () => {
    const rootDir = await createProject({
      '.pi/code-research.json': `{"graph":{"enable":true}}\n`,
      'src/service.ts': `export function runService(): void { helper(); }\nfunction helper(): void {}\n`,
    });

    await buildWorkspaceGraph(rootDir);

    const results = await findSymbol(rootDir, {
      path: 'src/service.ts',
      symbol: 'runService',
      language: 'ts',
      include_code: true,
      include_signature: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('runService');
    expect(results[0].signature).toContain('runService');
    expect(results[0].code).toContain('helper();');
  });
});
