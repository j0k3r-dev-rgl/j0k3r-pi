import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { minimatch } from 'minimatch';
import {
  detectLanguage as detectTypeScriptLanguage,
  isSupportedFile as isSupportedTypeScriptFile,
} from '../languages/typescript/shared.js';
import { isSupportedFile as isSupportedJavaFile } from '../languages/java/shared.js';
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
  return isSupportedTypeScriptFile(filePath) || isSupportedJavaFile(filePath);
}

export function detectLanguage(filePath: string, explicit: SupportedLanguage): Exclude<SupportedLanguage, 'auto'> {
  if (explicit !== 'auto') return explicit;
  if (isSupportedJavaFile(filePath)) return 'java';
  return detectTypeScriptLanguage(filePath, explicit);
}

async function collectSupportedFiles(dir: string, glob?: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      files.push(...(await collectSupportedFiles(fullPath, glob)));
    } else if (entry.isFile() && isSupportedFile(fullPath)) {
      if (glob && !minimatch(fullPath, glob) && !minimatch(entry.name, glob)) continue;
      files.push(fullPath);
    }
  }

  return files;
}
