import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { sha256 } from './hashes.js';
import { parseMarkdownStatus } from './parseMarkdown.js';
import type { ArtifactState } from '../types.js';

export const ARTIFACT_NAMES = ['mini-sdd.md', 'proposal.md', 'spec.md', 'design.md', 'tasks.md', 'apply.md', 'verify.md'] as const;

export async function openspecRoot(cwd: string): Promise<string> {
  return resolve(cwd, 'openspec');
}

export function assertInside(base: string, target: string): void {
  const rel = relative(resolve(base), resolve(target));
  if (rel.startsWith('..') || rel === '..' || rel.startsWith('/') || rel.startsWith('..\\')) {
    throw new Error(`Refusing to access path outside ${base}: ${target}`);
  }
}

export async function discoverActiveSlugs(cwd: string): Promise<string[]> {
  const changesDir = resolve(cwd, 'openspec', 'changes');
  try {
    const entries = await readdir(changesDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort();
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function readArtifacts(cwd: string, slug: string, generatedAt: string): Promise<Record<string, ArtifactState>> {
  const base = resolve(cwd, 'openspec');
  const changeDir = resolve(cwd, 'openspec', 'changes', slug);
  assertInside(base, changeDir);
  const result: Record<string, ArtifactState> = {};
  for (const name of ARTIFACT_NAMES) {
    const path = join(changeDir, name);
    assertInside(changeDir, path);
    try {
      const [content, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
      const parsed = parseMarkdownStatus(content);
      result[name] = {
        exists: true,
        status: parsed.status,
        blockers: parsed.blockers,
        warnings: parsed.warnings,
        sha256: sha256(content),
        ids: parsed.ids,
        updated_at: info.mtime.toISOString(),
        verification_result: parsed.verification_result,
      };
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        result[name] = { exists: false, status: 'UNKNOWN', blockers: [`Unable to read ${name}: ${error.message}`], warnings: [], ids: [], updated_at: generatedAt };
      } else {
        result[name] = { exists: false, status: 'UNKNOWN', blockers: [], warnings: [], ids: [] };
      }
    }
  }
  return result;
}
