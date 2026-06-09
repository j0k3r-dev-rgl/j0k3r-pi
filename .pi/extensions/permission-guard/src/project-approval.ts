import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { PermissionDecisionResult, PermissionRequest } from './types.js';

const SAFE_RELATIVE_PATH = String.raw`(?!/|~|\.\.(?:/|$)|.*\/\.\.(?:/|$))[A-Za-z0-9._/@+-]+`;

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function simpleCdInnerCommand(command: string): string | undefined {
  const match = normalizeCommand(command).match(/^cd\s+([A-Za-z0-9._/@+-]+)\s+&&\s+(.+)$/);
  if (!match) return undefined;
  const cdTarget = match[1]!;
  if (cdTarget === '..' || cdTarget.startsWith('../') || cdTarget === '~' || cdTarget.startsWith('~/') || cdTarget.startsWith('/')) return undefined;
  if (cdTarget.split('/').includes('..')) return undefined;
  return match[2]!;
}

function npmPrefixPattern(command: string): string | undefined {
  const normalized = normalizeCommand(command);
  let match = normalized.match(/^npm\s+--prefix\s+([^\s]+)\s+test\s+--\s+--run$/);
  if (match) {
    const prefix = match[1]!;
    if (prefix.startsWith('/') || prefix.startsWith('~') || prefix.split('/').includes('..')) return undefined;
    return `regex:^npm\\s+--prefix\\s+${SAFE_RELATIVE_PATH}\\s+test\\s+--\\s+--run$`;
  }

  match = normalized.match(/^npm\s+--prefix\s+([^\s]+)\s+run\s+typecheck$/);
  if (match) {
    const prefix = match[1]!;
    if (prefix.startsWith('/') || prefix.startsWith('~') || prefix.split('/').includes('..')) return undefined;
    return `regex:^npm\\s+--prefix\\s+${SAFE_RELATIVE_PATH}\\s+run\\s+typecheck$`;
  }

  return undefined;
}

export function projectSafeCommandPatternFor(request: PermissionRequest, _decision?: PermissionDecisionResult): string | undefined {
  if (request.action !== 'bash' || !request.command) return undefined;
  const command = normalizeCommand(request.command.raw);
  const inner = simpleCdInnerCommand(command) ?? command;
  const normalizedInner = normalizeCommand(inner);

  if (normalizedInner === 'npm test') return 'npm test';
  if (normalizedInner === 'npm test -- --run') return 'npm test -- --run';
  if (normalizedInner === 'npm run typecheck') return 'npm run typecheck';

  return npmPrefixPattern(normalizedInner);
}

export async function addProjectSafeCommandPattern(cwd: string, pattern: string): Promise<string> {
  const configPath = join(resolve(cwd), '.pi', 'permissions.json');
  let root: Record<string, unknown> = {};
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (isPlainObject(parsed)) root = parsed;
  } catch (error: unknown) {
    if (!(typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  const bash = isPlainObject(root.bash) ? root.bash : {};
  const safeCommands = Array.isArray(bash.safeCommands) && bash.safeCommands.every((item) => typeof item === 'string')
    ? [...bash.safeCommands]
    : [];
  if (!safeCommands.includes(pattern)) safeCommands.push(pattern);

  root.bash = { ...bash, safeCommands };
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8');
  return configPath;
}
