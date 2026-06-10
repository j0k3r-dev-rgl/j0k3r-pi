import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8');
  return configPath;
}
