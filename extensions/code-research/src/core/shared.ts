import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { minimatch } from 'minimatch';
import { detectGraphLanguage, isSupportedGraphSourceFile, walkWorkspaceSourceFiles } from './source-policy.js';
import type { SupportedLanguage } from '../types.js';

export interface ResolvedTargetFiles {
  targetPath: string;
  isDirectory: boolean;
  filesToScan: string[];
}

export async function resolveTargetFiles(
  cwd: string,
  inputPath: string,
  glob?: string
): Promise<ResolvedTargetFiles> {
  const targetPath = resolve(cwd, inputPath);

  let targetStat;
  try {
    targetStat = await stat(targetPath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`Path not found: ${inputPath}`);
    }
    throw err;
  }

  const isDirectory = targetStat.isDirectory();
  const filesToScan = isDirectory ? await collectSupportedFiles(targetPath, glob) : [targetPath];

  return {
    targetPath,
    isDirectory,
    filesToScan,
  };
}

export function isSupportedFile(filePath: string): boolean {
  return isSupportedGraphSourceFile(filePath);
}

export function detectLanguage(filePath: string, explicit: SupportedLanguage): Exclude<SupportedLanguage, 'auto'> {
  if (explicit !== 'auto') return explicit;
  return detectGraphLanguage(filePath) ?? 'ts';
}

async function collectSupportedFiles(dir: string, glob?: string): Promise<string[]> {
  const files: string[] = [];
  await walkWorkspaceSourceFiles(dir, async (fullPath) => {
    if (glob && !minimatch(fullPath, glob) && !minimatch(fullPath.split('/').pop() ?? fullPath, glob)) return;
    files.push(fullPath);
  });
  return files;
}
