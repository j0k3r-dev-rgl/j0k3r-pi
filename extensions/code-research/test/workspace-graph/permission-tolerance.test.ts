import { describe, expect, it } from 'vitest';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceGraph } from '../../src/core/workspace-graph.js';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-graph-perms-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return rootDir;
}

describe('workspace graph permission tolerance', () => {
  it('skips unreadable directories and reports them in coverage', async () => {
    const rootDir = await createProject({
      'package.json': '{"name":"fixture"}\n',
      'src/app.ts': 'export function ok() { return 1; }\n',
      'blocked/package.json': '{"name":"blocked"}\n',
      'blocked/src/secret.ts': 'export const hidden = true;\n',
    });
    const blockedDir = join(rootDir, 'blocked');
    await chmod(blockedDir, 0o000);

    try {
      const result = await buildWorkspaceGraph(rootDir);

      expect(result.state.status).toBe('fresh');
      expect(result.state.coverage.unreadableDirectories).toContain('blocked');
      expect(result.state.subprojects.some((subproject) => subproject.root === '.')).toBe(true);
    } finally {
      await chmod(blockedDir, 0o755);
    }
  });
});
