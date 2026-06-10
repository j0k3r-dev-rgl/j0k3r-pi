import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { PermissionDecisionResult, PermissionRequest, ScopedBashApproval } from './types.js';

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function signatureFor(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function buildScopedBashApproval(request: PermissionRequest, decision?: PermissionDecisionResult): ScopedBashApproval | undefined {
  if (request.action !== 'bash' || !request.command || !decision?.details.shellAnalysis) return undefined;
  const workspaceRoot = request.executionContext?.workspaceRoot ?? decision.details.workspaceRoot ?? process.cwd();
  const resolvedRoot = request.executionContext?.workspaceRoot ?? decision.details.workspaceRoot ?? workspaceRoot;
  const allowedRoots = decision.details.approvalScope?.allowedRoots?.length
    ? decision.details.approvalScope.allowedRoots.map((root) => ({
        kind: root.kind,
        raw: root.raw,
        normalizedAbsolute: resolve(root.normalizedAbsolute),
        resolvedRealpath: resolve(root.resolvedRealpath ?? root.normalizedAbsolute),
      }))
    : [{
        kind: 'workspace' as const,
        raw: workspaceRoot,
        normalizedAbsolute: resolve(workspaceRoot),
        resolvedRealpath: resolve(resolvedRoot),
      }];
  return {
    version: 1,
    id: `bash_approval_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    normalizedCommand: decision.details.safeCommandSummary ?? normalizeCommand(request.command.raw),
    commandSignature: decision.details.shellAnalysis.commandSignature,
    effectSignature: decision.details.shellAnalysis.effectSignature,
    allowedRoots,
    reasonCode: decision.reasonCode,
    source: request.origin === 'subagent' ? 'subagent' : 'project',
  };
}

export function projectSafeCommandPatternFor(request: PermissionRequest, decision?: PermissionDecisionResult): string | undefined {
  return buildScopedBashApproval(request, decision)?.normalizedCommand;
}

function isSameOrInside(target: string, root: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function approvalIsWorkspaceOnly(cwd: string, approval: ScopedBashApproval): boolean {
  const workspaceRoot = resolve(cwd);
  return approval.allowedRoots.every((root) => {
    if (root.kind === 'workspace') return true;
    const candidate = resolve(root.resolvedRealpath ?? root.normalizedAbsolute);
    return isSameOrInside(candidate, workspaceRoot);
  });
}

function splitCommandSegments(command: string): string[] {
  return command
    .split(/\s*(?:&&|;|\|\||\n)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function npmPrefixPattern(prefix: string): string | undefined {
  if (prefix.startsWith('/') || prefix.startsWith('~') || prefix === '..' || prefix.startsWith('../') || prefix.includes('/../')) return undefined;
  if (!/^[A-Za-z0-9._/@+-]+$/.test(prefix)) return undefined;
  return '(?!/|~|\\.\\.(?:/|$)|.*\\/\\.\\.(?:/|$))[A-Za-z0-9._/@+-]+';
}

function reusableSafeCommandPattern(segment: string): string | undefined {
  const normalized = normalizeCommand(segment);
  if (/^cd(?:\s|$)/.test(normalized)) return undefined;

  if (/^npm\s+run\s+typecheck(?:\s|$)/.test(normalized)) {
    return 'regex:^npm\\s+run\\s+typecheck(?:\\s+--\\s+.*)?$';
  }
  if (/^npm\s+test(?:\s|$)/.test(normalized)) {
    return 'regex:^npm\\s+test(?:\\s+.*)?$';
  }
  const npmPrefix = /^npm\s+--prefix\s+(\S+)\s+(run\s+typecheck|test)(?:\s|$)/.exec(normalized);
  if (npmPrefix) {
    const prefix = npmPrefixPattern(npmPrefix[1]!);
    if (!prefix) return undefined;
    const command = npmPrefix[2] === 'run typecheck'
      ? 'run\\s+typecheck(?:\\s+--\\s+.*)?'
      : 'test(?:\\s+--\\s+.*)?';
    return `regex:^npm\\s+--prefix\\s+${prefix}\\s+${command}$`;
  }
  if (/^git\s+status(?:\s+--short)?$/.test(normalized)) {
    return 'regex:^git\\s+status(?:\\s+--short)?$';
  }
  return normalized;
}

function workspaceSafeCommandPatterns(command: string): string[] {
  const seen = new Set<string>();
  const patterns: string[] = [];
  for (const segment of splitCommandSegments(command)) {
    const pattern = reusableSafeCommandPattern(segment);
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);
    patterns.push(pattern);
  }
  return patterns;
}

export async function addProjectBashApproval(cwd: string, approval: ScopedBashApproval): Promise<string> {
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

  if (approvalIsWorkspaceOnly(cwd, approval)) {
    const safeCommands = Array.isArray(bash.safeCommands) && bash.safeCommands.every((item) => typeof item === 'string')
      ? [...bash.safeCommands]
      : [];
    for (const pattern of workspaceSafeCommandPatterns(approval.normalizedCommand)) {
      if (!safeCommands.includes(pattern)) safeCommands.push(pattern);
    }
    root.bash = { ...bash, safeCommands, scopedApprovals: Array.isArray(bash.scopedApprovals) ? bash.scopedApprovals : [] };
  } else {
    const scopedApprovals = Array.isArray(bash.scopedApprovals) ? [...bash.scopedApprovals] : [];
    const existingIndex = scopedApprovals.findIndex((entry) => isPlainObject(entry) && entry.commandSignature === approval.commandSignature && entry.effectSignature === approval.effectSignature);
    if (existingIndex >= 0 && isPlainObject(scopedApprovals[existingIndex])) {
      const existing = scopedApprovals[existingIndex] as Record<string, unknown>;
      const existingRoots = Array.isArray(existing.allowedRoots) ? existing.allowedRoots : [];
      const mergedRoots = [...existingRoots];
      for (const root of approval.allowedRoots) {
        if (!mergedRoots.some((candidate) => isPlainObject(candidate) && (candidate.resolvedRealpath ?? candidate.normalizedAbsolute) === (root.resolvedRealpath ?? root.normalizedAbsolute))) {
          mergedRoots.push(root);
        }
      }
      scopedApprovals[existingIndex] = { ...existing, allowedRoots: mergedRoots };
    } else {
      scopedApprovals.push(approval);
    }

    root.bash = { ...bash, scopedApprovals };
  }
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8');
  return configPath;
}
