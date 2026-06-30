import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

export const WORKSPACE_GRAPH_DIR = '.pi/workspace-code-graph';
export const MAX_GRAPH_SOURCE_BYTES = 100 * 1024;
export const SUPPORTED_GRAPH_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.java', '.py']);
export const EXCLUDED_DIRECTORY_NAMES = new Set([
  'node_modules',
  'build',
  'dist',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.react-router',
  '.turbo',
  '.vite',
  '.cache',
  'out',
  'vendor',
  'venv',
  'env',
  'virtualenv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nox',
]);

export function isPathWithinRoot(projectRoot: string, candidatePath: string): boolean {
  const root = resolve(projectRoot);
  const candidate = resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

export function toProjectRelativePath(projectRoot: string, candidatePath: string): string {
  const root = resolve(projectRoot);
  const candidate = resolve(candidatePath);
  if (!isPathWithinRoot(root, candidate)) {
    throw new Error(`Path escapes project root: ${candidatePath}`);
  }
  const rel = relative(root, candidate);
  return rel === '' ? '.' : rel.split(sep).join('/');
}

export function detectGraphLanguage(filePath: string): 'ts' | 'js' | 'java' | 'py' | undefined {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.java') return 'java';
  if (ext === '.py') return 'py';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'js';
  if (ext === '.ts' || ext === '.tsx') return 'ts';
  return undefined;
}

export function isSupportedGraphSourceFile(filePath: string): boolean {
  return SUPPORTED_GRAPH_SOURCE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

export function isExcludedPath(projectRoot: string, candidatePath: string): boolean {
  if (!isPathWithinRoot(projectRoot, candidatePath)) return true;
  const relativePath = toProjectRelativePath(projectRoot, candidatePath);
  if (relativePath === '.') return false;
  const segments = relativePath.split('/');
  return segments.some((segment, index) => {
    if (!segment) return false;
    if (index === 0 && segment === '.pi') return true;
    if (EXCLUDED_DIRECTORY_NAMES.has(segment)) return true;
    return segment.startsWith('.');
  });
}

export async function shouldIndexSourceFile(projectRoot: string, filePath: string): Promise<boolean> {
  if (!isSupportedGraphSourceFile(filePath)) return false;
  if (isExcludedPath(projectRoot, filePath)) return false;
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return false;
  return fileStat.size <= MAX_GRAPH_SOURCE_BYTES;
}

export async function collectWorkspaceSourceFiles(
  rootDir: string,
  options?: { onUnreadableDirectory?: (dir: string, error: NodeJS.ErrnoException) => void }
): Promise<string[]> {
  const files: string[] = [];
  await walk(rootDir, async (fullPath) => {
    if (await shouldIndexSourceFile(rootDir, fullPath)) {
      files.push(fullPath);
    }
  }, options);
  return files;
}

export async function walkWorkspaceSourceFiles(
  rootDir: string,
  onFile: (fullPath: string) => Promise<void> | void,
  options?: { onUnreadableDirectory?: (dir: string, error: NodeJS.ErrnoException) => void }
): Promise<void> {
  await walk(rootDir, async (fullPath) => {
    if (await shouldIndexSourceFile(rootDir, fullPath)) {
      await onFile(fullPath);
    }
  }, options);
}

async function walk(
  dir: string,
  onFile: (fullPath: string) => Promise<void> | void,
  options?: { onUnreadableDirectory?: (dir: string, error: NodeJS.ErrnoException) => void }
): Promise<void> {
  await walkWithRoot(dir, dir, onFile, options);
}

async function walkWithRoot(
  projectRoot: string,
  dir: string,
  onFile: (fullPath: string) => Promise<void> | void,
  options?: { onUnreadableDirectory?: (dir: string, error: NodeJS.ErrnoException) => void }
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'ENOENT') {
      options?.onUnreadableDirectory?.(dir, error as NodeJS.ErrnoException);
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isExcludedPath(projectRoot, fullPath)) continue;
      await walkWithRoot(projectRoot, fullPath, onFile, options);
      continue;
    }
    if (entry.isFile()) {
      await onFile(fullPath);
    }
  }
}
