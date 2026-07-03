import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SCREENSHOT_SUBDIR, ensureDefaultScreenshotGitIgnored, resolveScreenshotOutputPath } from '../src/config.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('output path and gitignore behavior', () => {
  it('defaults screenshots under .pi/browser-screenshots within cwd', () => {
    const cwd = '/workspace/project';
    const result = resolveScreenshotOutputPath(cwd, undefined, () => new Date('2026-07-03T12:34:56.789Z'));
    expect(result.usedDefaultPath).toBe(true);
    expect(result.outputPath).toBe('/workspace/project/.pi/browser-screenshots/browser-screenshot-2026-07-03T12-34-56-789Z.png');
  });

  it('appends the default screenshot directory to .git/info/exclude idempotently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-browser-screenshot-git-'));
    cleanup.push(root);
    await mkdir(join(root, '.git', 'info'), { recursive: true });
    await writeFile(join(root, '.git', 'info', 'exclude'), '# existing\n', 'utf8');
    const cwd = join(root, 'nested', 'workspace');
    await mkdir(cwd, { recursive: true });

    expect(await ensureDefaultScreenshotGitIgnored(cwd)).toBe(true);
    expect(await ensureDefaultScreenshotGitIgnored(cwd)).toBe(true);

    const content = await readFile(join(root, '.git', 'info', 'exclude'), 'utf8');
    expect(content).toContain(`${DEFAULT_SCREENSHOT_SUBDIR}/`);
    expect(content.match(/\.pi\/browser-screenshots\//g)).toHaveLength(1);
  });
});
