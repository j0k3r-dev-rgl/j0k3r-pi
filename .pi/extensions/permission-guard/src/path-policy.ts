import { constants, existsSync, lstatSync, realpathSync } from 'node:fs';
import { access, lstat, realpath as fsRealpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { PermissionPolicyConfig, PermissionRequest } from './types.js';

export interface ResolveWorkspaceRootOptions {
  cwd: string;
  config: PermissionPolicyConfig;
}

export interface ClassifyPathTargetOptions extends ResolveWorkspaceRootOptions {
  forCreate?: boolean;
}

export type ClassifiedPathTarget = NonNullable<PermissionRequest['target']>;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

export function isPathContainedByRoot(target: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isSameOrInside(target: string, root: string): boolean {
  return isPathContainedByRoot(target, root);
}

export function resolveWorkspaceRoot({ cwd, config }: ResolveWorkspaceRootOptions): string {
  const root = config.workspace.root;
  if (!root) return resolve(cwd);
  return isAbsolute(root) ? resolve(root) : resolve(cwd, root);
}

async function realpathIfPossible(path: string): Promise<string | undefined> {
  try {
    return await fsRealpath(path);
  } catch {
    return undefined;
  }
}

function realpathIfPossibleSync(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

async function findNearestExistingParent(path: string): Promise<string | undefined> {
  let current = path;
  while (true) {
    if (await exists(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findNearestExistingParentSync(path: string): string | undefined {
  let current = path;
  while (true) {
    if (existsSync(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function classifyTargetKind(normalizedAbsolute: string): Promise<ClassifiedPathTarget['kind']> {
  try {
    const stats = await lstat(normalizedAbsolute);
    if (stats.isFile()) return 'file';
    if (stats.isDirectory()) return 'directory';
    return 'other';
  } catch {
    return 'missing';
  }
}

function classifyTargetKindSync(normalizedAbsolute: string): ClassifiedPathTarget['kind'] {
  try {
    const stats = lstatSync(normalizedAbsolute);
    if (stats.isFile()) return 'file';
    if (stats.isDirectory()) return 'directory';
    return 'other';
  } catch {
    return 'missing';
  }
}

async function resolveEffectiveRealpath(normalizedAbsolute: string): Promise<{
  exists: boolean;
  resolvedRealpath?: string;
  nearestExistingParent?: string;
}> {
  const existingTargetRealpath = await realpathIfPossible(normalizedAbsolute);
  if (existingTargetRealpath) {
    return { exists: true, resolvedRealpath: existingTargetRealpath };
  }

  const nearestExistingParent = await findNearestExistingParent(dirname(normalizedAbsolute));
  if (!nearestExistingParent) return { exists: false };

  const parentRealpath = await realpathIfPossible(nearestExistingParent);
  if (!parentRealpath) return { exists: false, nearestExistingParent };

  const missingPath = relative(nearestExistingParent, normalizedAbsolute);
  return {
    exists: false,
    nearestExistingParent,
    resolvedRealpath: resolve(parentRealpath, missingPath),
  };
}

function resolveEffectiveRealpathSync(normalizedAbsolute: string): {
  exists: boolean;
  resolvedRealpath?: string;
  nearestExistingParent?: string;
} {
  const existingTargetRealpath = realpathIfPossibleSync(normalizedAbsolute);
  if (existingTargetRealpath) {
    return { exists: true, resolvedRealpath: existingTargetRealpath };
  }

  const nearestExistingParent = findNearestExistingParentSync(dirname(normalizedAbsolute));
  if (!nearestExistingParent) return { exists: false };

  const parentRealpath = realpathIfPossibleSync(nearestExistingParent);
  if (!parentRealpath) return { exists: false, nearestExistingParent };

  const missingPath = relative(nearestExistingParent, normalizedAbsolute);
  return {
    exists: false,
    nearestExistingParent,
    resolvedRealpath: resolve(parentRealpath, missingPath),
  };
}

export function isRequestPathCoveredByApproval(
  approval: { normalizedAbsolute: string; resolvedRealpath?: string },
  request: Pick<ClassifiedPathTarget, 'normalizedAbsolute' | 'resolvedRealpath'>,
): boolean {
  if (!isPathContainedByRoot(request.normalizedAbsolute, approval.normalizedAbsolute)) return false;
  if (approval.resolvedRealpath && request.resolvedRealpath) {
    return isPathContainedByRoot(request.resolvedRealpath, approval.resolvedRealpath);
  }
  return true;
}

export async function classifyPathTarget(rawPath: string, options: ClassifyPathTargetOptions): Promise<ClassifiedPathTarget> {
  const workspaceRoot = resolveWorkspaceRoot(options);
  const normalizedAbsolute = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspaceRoot, rawPath);
  const lexicalInsideWorkspace = isSameOrInside(normalizedAbsolute, workspaceRoot);
  const followSymlinks = options.config.workspace.followSymlinks ?? 'realpath';

  const targetResolution = await resolveEffectiveRealpath(normalizedAbsolute);
  const kind = await classifyTargetKind(normalizedAbsolute);
  const workspaceRootRealpath = (await realpathIfPossible(workspaceRoot)) ?? workspaceRoot;
  const resolvedRealpath = targetResolution.resolvedRealpath;
  const effectiveTarget = followSymlinks === 'realpath' && resolvedRealpath ? resolvedRealpath : normalizedAbsolute;
  const effectiveRoot = followSymlinks === 'realpath' ? workspaceRootRealpath : workspaceRoot;
  const insideWorkspace = isSameOrInside(effectiveTarget, effectiveRoot);
  const symlinkEscapesWorkspace = lexicalInsideWorkspace && !insideWorkspace;
  const workspaceRelative = insideWorkspace ? toPosixPath(relative(workspaceRoot, normalizedAbsolute)) || '.' : undefined;

  return {
    raw: rawPath,
    normalizedAbsolute,
    resolvedRealpath,
    exists: targetResolution.exists,
    nearestExistingParent: targetResolution.nearestExistingParent,
    workspaceRoot,
    insideWorkspace,
    symlinkEscapesWorkspace,
    workspaceRelative,
    kind,
  };
}

export function classifyResolvedPathTargetSync(rawPath: string, options: ClassifyPathTargetOptions): ClassifiedPathTarget {
  const workspaceRoot = resolveWorkspaceRoot(options);
  const normalizedAbsolute = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspaceRoot, rawPath);
  const lexicalInsideWorkspace = isSameOrInside(normalizedAbsolute, workspaceRoot);
  const followSymlinks = options.config.workspace.followSymlinks ?? 'realpath';

  const targetResolution = resolveEffectiveRealpathSync(normalizedAbsolute);
  const kind = classifyTargetKindSync(normalizedAbsolute);
  const workspaceRootRealpath = realpathIfPossibleSync(workspaceRoot) ?? workspaceRoot;
  const resolvedRealpath = targetResolution.resolvedRealpath;
  const effectiveTarget = followSymlinks === 'realpath' && resolvedRealpath ? resolvedRealpath : normalizedAbsolute;
  const effectiveRoot = followSymlinks === 'realpath' ? workspaceRootRealpath : workspaceRoot;
  const insideWorkspace = isSameOrInside(effectiveTarget, effectiveRoot);
  const symlinkEscapesWorkspace = lexicalInsideWorkspace && !insideWorkspace;
  const workspaceRelative = insideWorkspace ? toPosixPath(relative(workspaceRoot, normalizedAbsolute)) || '.' : undefined;

  return {
    raw: rawPath,
    normalizedAbsolute,
    resolvedRealpath,
    exists: targetResolution.exists,
    nearestExistingParent: targetResolution.nearestExistingParent,
    workspaceRoot,
    insideWorkspace,
    symlinkEscapesWorkspace,
    workspaceRelative,
    kind,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function expandBraceAlternatives(pattern: string): string[] {
  const match = /^(.*)\{([^{}]+)\}(.*)$/.exec(pattern);
  if (!match) return [pattern];
  const [, before, alternatives, after] = match;
  return alternatives.split(',').flatMap((alternative) => expandBraceAlternatives(`${before}${alternative}${after}`));
}

function globToRegExp(pattern: string): RegExp {
  let source = '';
  const normalized = toPosixPath(pattern).replace(/^\.\//, '');

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    const afterNext = normalized[index + 2];

    if (char === '*' && next === '*' && afterNext === '/') {
      source += '(?:.*/)?';
      index += 2;
    } else if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`^${source}$`);
}

export function matchesWorkspaceGlob(target: ClassifiedPathTarget, patterns: string[]): boolean {
  if (!target.workspaceRelative) return false;
  const relativePath = target.workspaceRelative === '.' ? '' : target.workspaceRelative;
  return patterns.some((pattern) => expandBraceAlternatives(pattern).some((expanded) => globToRegExp(expanded).test(relativePath)));
}
