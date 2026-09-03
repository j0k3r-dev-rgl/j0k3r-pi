import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { minimatch } from 'minimatch';
import { detectGraphLanguage, isSupportedGraphSourceFile, walkWorkspaceSourceFiles } from './source-policy.js';
import type { SearchScope, SupportedLanguage } from '../types.js';

export interface ResolvedTargetFiles {
  targetPath: string;
  isDirectory: boolean;
  filesToScan: string[];
}

export async function resolveTargetFiles(
  cwd: string,
  inputPath: string,
  glob?: string,
  scope?: SearchScope,
  language?: SupportedLanguage
): Promise<ResolvedTargetFiles> {
  const workspaceRealPath = await realpath(cwd).catch(() => resolve(cwd));
  const targetPath = resolve(cwd, inputPath);

  let targetStat;
  try {
    targetStat = await stat(targetPath);
  } catch (err: any) {
    if (err.code === 'ENOENT') throw new Error(`Path not found: ${inputPath}`);
    throw err;
  }

  const targetRealPath = await realpath(targetPath).catch(() => targetPath);
  const normalizedWorkspace = `${workspaceRealPath.replace(/\\/g, '/')}/`;
  const normalizedTarget = targetRealPath.replace(/\\/g, '/');
  if (normalizedTarget !== workspaceRealPath.replace(/\\/g, '/') && !normalizedTarget.startsWith(normalizedWorkspace)) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }

  const isDirectory = targetStat.isDirectory();
  if (scope === 'file' && isDirectory) throw new Error(`Expected file path for scope=file: ${inputPath}`);
  if (scope === 'directory' && !isDirectory) throw new Error(`Expected directory path for scope=directory: ${inputPath}`);

  const filesToScan = isDirectory
    ? await collectSupportedFiles(targetRealPath, workspaceRealPath, glob, language)
    : [targetRealPath].filter((filePath) => isSupportedFile(filePath) && matchesLanguage(filePath, language ?? 'auto'));

  return {
    targetPath: targetRealPath,
    isDirectory,
    filesToScan,
  };
}

export function isSupportedFile(filePath: string): boolean {
  return isSupportedGraphSourceFile(filePath);
}

export function compareCanonicalPathStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function detectLanguage(filePath: string, explicit: SupportedLanguage): Exclude<SupportedLanguage, 'auto'> {
  if (explicit !== 'auto') return explicit;
  return detectGraphLanguage(filePath) ?? 'ts';
}

async function collectSupportedFiles(dir: string, workspaceRoot: string, glob?: string, language: SupportedLanguage = 'auto'): Promise<string[]> {
  const files: string[] = [];
  const normalizedWorkspaceRoot = workspaceRoot.replace(/\\/g, '/');
  const normalizedSearchRoot = dir.replace(/\\/g, '/');
  await walkWorkspaceSourceFiles(dir, async (fullPath) => {
    if (!matchesLanguage(fullPath, language)) return;
    const normalizedFile = fullPath.replace(/\\/g, '/');
    const workspaceRelative = normalizedFile.startsWith(normalizedWorkspaceRoot)
      ? normalizedFile.slice(normalizedWorkspaceRoot.length + 1)
      : normalizedFile;
    const searchRootRelative = normalizedFile.startsWith(normalizedSearchRoot)
      ? normalizedFile.slice(normalizedSearchRoot.length + 1)
      : workspaceRelative;
    const base = workspaceRelative.split('/').pop() ?? workspaceRelative;
    if (glob && !minimatch(workspaceRelative, glob) && !minimatch(searchRootRelative, glob) && !minimatch(base, glob)) return;
    files.push(fullPath);
  });
  return files.sort((a, b) => a.localeCompare(b));
}

function matchesLanguage(filePath: string, language: SupportedLanguage): boolean {
  if (language === 'auto') return true;
  return detectLanguage(filePath, 'auto') === language;
}
