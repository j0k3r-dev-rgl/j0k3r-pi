import { statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';

export const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
export const DEFAULT_MAX_INLINE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_SCREENSHOT_SUBDIR = '.pi/browser-screenshots';

export interface FileOps {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, content: string, encoding: BufferEncoding): Promise<unknown>;
}

const defaultFileOps: FileOps = {
  mkdir,
  readFile,
  writeFile,
};

export function normalizeCdpUrl(value?: string): string {
  const raw = value?.trim() || DEFAULT_CDP_URL;
  const url = new URL(raw);
  if (!/^https?:$/u.test(url.protocol)) throw new Error('cdpUrl must use http or https');
  return url.toString().replace(/\/$/u, '');
}

export function resolveScreenshotOutputPath(cwd: string, outputPath?: string, now: () => Date = () => new Date()): { outputPath: string; usedDefaultPath: boolean } {
  const rawPath = outputPath?.trim();
  if (rawPath) {
    const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
    validatePngPath(resolved);
    return { outputPath: resolved, usedDefaultPath: false };
  }

  const output = resolve(cwd, DEFAULT_SCREENSHOT_SUBDIR, `browser-screenshot-${formatTimestamp(now())}.png`);
  validatePngPath(output);
  return { outputPath: output, usedDefaultPath: true };
}

export async function ensureDefaultScreenshotGitIgnored(cwd: string, fileOps: FileOps = defaultFileOps): Promise<boolean> {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) return false;

  const excludePath = join(gitRoot, '.git', 'info', 'exclude');
  await fileOps.mkdir(dirname(excludePath), { recursive: true });
  const existing = await fileOps.readFile(excludePath, 'utf8').catch(() => '');
  const entry = `${DEFAULT_SCREENSHOT_SUBDIR}/`;
  const lines = existing.split(/\r?\n/u).map((line) => line.trim());
  if (lines.includes(entry)) return true;
  const next = existing.endsWith('\n') || existing.length === 0 ? `${existing}${entry}\n` : `${existing}\n${entry}\n`;
  await fileOps.writeFile(excludePath, next, 'utf8');
  return true;
}

export function modelCanAcceptImages(ctx: { model?: { input?: string[] } } | undefined): boolean {
  return !ctx?.model?.input || ctx.model.input.includes('image');
}

export function normalizeMaxInlineBytes(value?: number): number {
  if (value === undefined) return DEFAULT_MAX_INLINE_BYTES;
  if (!Number.isFinite(value)) throw new Error('maxInlineBytes must be a finite number');
  if (value < 1024 || value > 50 * 1024 * 1024) throw new Error('maxInlineBytes must be between 1024 and 52428800');
  return Math.round(value);
}

function validatePngPath(outputPath: string): void {
  if (extname(outputPath).toLowerCase() !== '.png') throw new Error('outputPath must end with .png');
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/gu, '-');
}

function findGitRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (current === dirname(current)) return null;
    const gitDir = join(current, '.git');
    try {
      const stat = statSync(gitDir);
      if (stat.isDirectory()) return current;
    } catch {
      // continue upward
    }
    current = dirname(current);
  }
}
