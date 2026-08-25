import { describe, expect, it } from 'vitest';
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compareSubprojectSnapshot, createSubprojectSnapshot } from '../../src/core/freshness.js';

describe('workspace graph freshness', () => {
  it('creates snapshots and short-circuits when nothing changed', async () => {
    const rootDir = join(tmpdir(), `pi-freshness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, 'src'), { recursive: true });
    const file = join(rootDir, 'src/app.ts');
    await writeFile(file, 'export const ok = true;\n', 'utf8');

    const first = await createSubprojectSnapshot(rootDir, [file]);
    const second = await createSubprojectSnapshot(rootDir, [file]);
    expect(compareSubprojectSnapshot(first, second).stale).toBe(false);
  });

  it('marks snapshot stale when file mtime or size changes', async () => {
    const rootDir = join(tmpdir(), `pi-freshness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, 'src'), { recursive: true });
    const file = join(rootDir, 'src/app.ts');
    await writeFile(file, 'export const ok = true;\n', 'utf8');
    const before = await createSubprojectSnapshot(rootDir, [file]);

    await writeFile(file, 'export const ok = false;\n', 'utf8');
    const now = new Date();
    await utimes(file, now, new Date(now.getTime() + 1000));
    const after = await createSubprojectSnapshot(rootDir, [file]);
    const diff = compareSubprojectSnapshot(before, after);
    expect(diff.stale).toBe(true);
    expect(diff.changedFiles).toEqual(['src/app.ts']);
  });

  it('skips files deleted during snapshot creation', async () => {
    const rootDir = join(tmpdir(), `pi-freshness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, 'src'), { recursive: true });
    const file = join(rootDir, 'src/app.ts');
    await writeFile(file, 'export const ok = true;\n', 'utf8');
    await rm(file);

    await expect(createSubprojectSnapshot(rootDir, [file])).resolves.toEqual({});
  });
});
