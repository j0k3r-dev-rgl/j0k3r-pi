import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectWorkspaceSubprojects } from '../../src/core/project-detector.js';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-subprojects-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('workspace subproject detection', () => {
  it('detects a single project root from markers', async () => {
    const rootDir = await createProject({ 'package.json': '{"name":"app"}\n' });
    const subprojects = await detectWorkspaceSubprojects(rootDir);
    expect(subprojects).toHaveLength(1);
    expect(subprojects[0].root).toBe('.');
  });

  it('detects monorepo subprojects and dedupes nested markers', async () => {
    const rootDir = await createProject({
      'apps/web/package.json': '{"name":"web"}\n',
      'apps/web/tsconfig.json': '{"compilerOptions":{}}\n',
      'services/api/pom.xml': '<project />\n',
      'packages/shared/jsconfig.json': '{"compilerOptions":{}}\n',
    });

    const subprojects = await detectWorkspaceSubprojects(rootDir);
    expect(subprojects.map((item) => item.root).sort()).toEqual(['apps/web', 'packages/shared', 'services/api']);
  });

  it('falls back to an implicit workspace root when no markers exist', async () => {
    const rootDir = await createProject({ 'src/app.ts': 'export const ok = true;\n' });
    const subprojects = await detectWorkspaceSubprojects(rootDir);
    expect(subprojects).toHaveLength(1);
    expect(subprojects[0].root).toBe('.');
    expect(subprojects[0].implicit).toBe(true);
  });
});
