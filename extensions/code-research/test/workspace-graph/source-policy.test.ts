import { describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MAX_GRAPH_SOURCE_BYTES,
  collectWorkspaceSourceFiles,
  isExcludedPath,
  isPathWithinRoot,
  shouldIndexSourceFile,
} from '../../src/core/source-policy.js';

async function createProject(files: Record<string, string>) {
  const rootDir = join(tmpdir(), `pi-source-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('workspace graph source policy', () => {
  it('enforces project-root containment', () => {
    expect(isPathWithinRoot('/repo', '/repo/src/app.ts')).toBe(true);
    expect(isPathWithinRoot('/repo', '/repo/../etc/passwd')).toBe(false);
  });

  it('excludes hidden, generated, vendor, and oversized files', async () => {
    const rootDir = await createProject({
      'src/app.ts': 'export const ok = true;\n',
      'node_modules/pkg/index.js': 'export const bad = true;\n',
      '.next/server/index.js': 'export const bad = true;\n',
      'dist/bundle.js': 'export const bad = true;\n',
      'target/generated-sources/app.java': 'class Generated {}\n',
      'src/large.ts': `export const big = "${'x'.repeat(MAX_GRAPH_SOURCE_BYTES + 64)}";\n`,
    });

    expect(isExcludedPath(rootDir, join(rootDir, 'node_modules/pkg/index.js'))).toBe(true);
    expect(isExcludedPath(rootDir, join(rootDir, '.next/server/index.js'))).toBe(true);
    expect(isExcludedPath(rootDir, join(rootDir, 'dist/bundle.js'))).toBe(true);
    expect(isExcludedPath(rootDir, join(rootDir, 'target/generated-sources/app.java'))).toBe(true);
    expect(await shouldIndexSourceFile(rootDir, join(rootDir, 'src/app.ts'))).toBe(true);
    expect(await shouldIndexSourceFile(rootDir, join(rootDir, 'src/large.ts'))).toBe(false);
  });

  it('collects only supported source files under the workspace root', async () => {
    const rootDir = await createProject({
      'src/app.ts': 'export function run() {}\n',
      'src/feature.java': 'class Feature {}\n',
      'src/util.js': 'export const util = () => {};\n',
      '.cache/temp.ts': 'export const skipped = true;\n',
      'coverage/index.js': 'export const skipped = true;\n',
      'target/generated-sources/app.java': 'class Generated {}\n',
    });

    const files = await collectWorkspaceSourceFiles(rootDir);
    expect(files.map((file) => file.slice(rootDir.length + 1)).sort()).toEqual([
      'src/app.ts',
      'src/feature.java',
      'src/util.js',
    ]);
  });

  it('treats files deleted during indexing as non-indexable', async () => {
    const rootDir = await createProject({
      'src/app.ts': 'export const ok = true;\n',
    });
    const file = join(rootDir, 'src/app.ts');
    await rm(file);

    await expect(shouldIndexSourceFile(rootDir, file)).resolves.toBe(false);
  });
});
