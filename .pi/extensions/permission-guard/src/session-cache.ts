import type { SessionApprovalEntry, SessionApprovalSnapshot } from './policy.js';
import type { PermissionDecisionResult, PermissionRequest } from './types.js';

export type MainThreadApprovalMode = 'once' | 'session';

export interface MainThreadApprovalEntry extends SessionApprovalEntry {
  mode: MainThreadApprovalMode;
  sourceCacheKey?: string;
  createdAt?: string;
}

const MAIN_THREAD_APPROVAL_REGISTRY_KEY = Symbol.for('pi.permissionGuard.mainThreadApprovals');

function mainThreadApprovalRegistry(): Map<string, MainThreadApprovalEntry> {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[MAIN_THREAD_APPROVAL_REGISTRY_KEY];
  if (existing instanceof Map) return existing as Map<string, MainThreadApprovalEntry>;
  const registry = new Map<string, MainThreadApprovalEntry>();
  holder[MAIN_THREAD_APPROVAL_REGISTRY_KEY] = registry;
  return registry;
}

export function snapshotMainThreadApprovals(): SessionApprovalSnapshot {
  return { entries: [...mainThreadApprovalRegistry().values()].map((entry) => ({ ...entry })) };
}

export function consumeMainThreadApproval(cacheKey: string | undefined): void {
  if (!cacheKey) return;
  const registry = mainThreadApprovalRegistry();
  const entry = registry.get(cacheKey);
  if (entry?.mode === 'once') registry.delete(cacheKey);
}

export function mergeApprovalSnapshots(...snapshots: Array<SessionApprovalSnapshot | undefined>): SessionApprovalSnapshot {
  return { entries: snapshots.flatMap((snapshot) => snapshot?.entries ?? []).map((entry) => ({ ...entry })) };
}

export interface SessionApprovalCacheOptions {
  sessionId: string;
}

export interface SessionApprovalCache {
  readonly sessionId: string;
  add(entry: SessionApprovalEntry): void;
  snapshot(): SessionApprovalSnapshot;
  clear(): void;
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

export function buildSessionApprovalEntry(
  request: PermissionRequest,
  decision: PermissionDecisionResult,
  sessionId: string,
): SessionApprovalEntry | undefined {
  if (!decision.cacheKey && !request.target && !request.command) return undefined;

  const targetPattern = request.target?.normalizedAbsolute;
  const commandPattern = request.command ? normalizeCommand(request.command.raw) : undefined;
  if (!targetPattern && !commandPattern) return undefined;

  return {
    cacheKey: `session:${sessionId}:${decision.cacheKey ?? `${request.policyIdentity}:${request.tool}:${request.action}:${targetPattern ?? commandPattern}`}`,
    action: request.action,
    tool: request.tool,
    targetPattern,
    commandPattern,
    policyIdentity: request.policyIdentity,
    bashApproval: request.action === 'bash' && decision.details.shellAnalysis
      ? {
          version: 1,
          id: `session-${sessionId}`,
          createdAt: new Date().toISOString(),
          normalizedCommand: decision.details.safeCommandSummary ?? commandPattern ?? request.command?.raw ?? '',
          commandSignature: decision.details.shellAnalysis.commandSignature,
          effectSignature: decision.details.shellAnalysis.effectSignature,
          allowedRoots: decision.details.approvalScope?.allowedRoots ?? (request.executionContext ? [{
            kind: 'workspace',
            raw: request.executionContext.workspaceRoot,
            normalizedAbsolute: request.executionContext.workspaceRoot,
            resolvedRealpath: request.executionContext.workspaceRoot,
          }] : []),
          reasonCode: decision.reasonCode,
          source: 'session',
        }
      : undefined,
  };
}

export function createSessionApprovalCache(options: SessionApprovalCacheOptions): SessionApprovalCache {
  const entries = new Map<string, SessionApprovalEntry>();

  return {
    sessionId: options.sessionId,
    add(entry) {
      entries.set(entry.cacheKey, { ...entry });
    },
    snapshot() {
      return { entries: [...entries.values()].map((entry) => ({ ...entry })) };
    },
    clear() {
      entries.clear();
    },
  };
}
