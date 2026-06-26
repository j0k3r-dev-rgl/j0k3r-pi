import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph } from '../../src/core/workspace-graph.js';

describe('workspace graph privacy', () => {
  it('does not persist source literals that look like secrets', async () => {
    const rootDir = join(tmpdir(), `pi-graph-secret-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, 'src'), { recursive: true });
    await writeFile(
      join(rootDir, 'src/app.ts'),
      `export function login() {\n  const token = "SECRET_TOKEN_123";\n  helper();\n}\nfunction helper() {}\n`,
      'utf8'
    );

    const result = await buildWorkspaceGraph(rootDir);
    expect(result.state.status === 'fresh' || result.state.status === 'partial').toBe(true);

    const stateRaw = await readFile(join(rootDir, '.pi/workspace-code-graph/workspace-state.json'), 'utf8');
    const manifestRaw = await readFile(join(rootDir, '.pi/workspace-code-graph/graph-manifest.json'), 'utf8');
    const shardPath = join(rootDir, '.pi/workspace-code-graph', result.state.subprojects[0].shardPath);
    const shardRaw = await readFile(shardPath, 'utf8');

    expect(stateRaw).not.toContain('SECRET_TOKEN_123');
    expect(manifestRaw).not.toContain('SECRET_TOKEN_123');
    expect(shardRaw).not.toContain('SECRET_TOKEN_123');
  });
});
