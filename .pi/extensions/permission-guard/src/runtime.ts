import { loadPermissionConfig, type PermissionConfigLoadResult } from './config.js';
import { addProjectBashApproval } from './project-approval.js';
import { evaluatePermission } from './policy.js';
import { resolveApproval, type ApprovalPrompt } from './approval.js';
import { recordAuditDecision } from './audit.js';
import {
  consumeMainThreadApproval,
  createSessionApprovalCache,
  mergeApprovalSnapshots,
  snapshotMainThreadApprovals,
  type SessionApprovalCache,
} from './session-cache.js';
import { mapBuiltinToolInput, type BuiltinPermissionTool } from './tool-map.js';
import { publishPermissionRequest } from './permission-channel.js';
import type { ApprovalChoice, PermissionDecisionResult, PermissionRequest, PermissionRequiredPayload, RequestOrigin } from './types.js';

export interface RuntimePiLike {
  on(event: 'tool_call' | 'user_bash' | string, handler: (event: unknown, ctx: RuntimeContextLike) => Promise<unknown> | unknown): void;
}

export interface RuntimeContextLike {
  cwd?: string;
  mode?: string;
  hasUI?: boolean;
  ui?: {
    select?: (message: string, choices: ApprovalChoice[]) => Promise<ApprovalChoice | undefined> | ApprovalChoice | undefined;
    notify?: (message: string, level?: 'info' | 'warning' | 'error') => void;
  };
  sessionManager?: {
    getSessionFile?: () => string | undefined;
    getSessionId?: () => string | undefined;
  };
  origin?: string;
  requester?: PermissionRequest['requester'];
}

interface ToolCallEventLike {
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  origin?: string;
  requester?: PermissionRequest['requester'];
}

interface UserBashEventLike {
  command?: string;
  cwd?: string;
  origin?: string;
  requester?: PermissionRequest['requester'];
}

interface RuntimeState {
  sessionCache?: SessionApprovalCache;
}

interface SubagentSessionMetadata {
  origin?: string;
  requester?: PermissionRequest['requester'];
}

const supportedToolCallTools = new Set<BuiltinPermissionTool>(['read', 'write', 'edit', 'grep', 'find', 'ls', 'bash']);
const permissionRequiredMarker = 'permission_required:';
const subagentSessionRegistryKey = Symbol.for('pi.permissionGuard.subagentSessions');

function isSupportedTool(toolName: string | undefined): toolName is Exclude<BuiltinPermissionTool, 'user_bash'> {
  return supportedToolCallTools.has(toolName as BuiltinPermissionTool);
}

function sessionIdFor(ctx: RuntimeContextLike): string {
  return ctx.sessionManager?.getSessionFile?.() ?? `permission-guard:${ctx.cwd ?? process.cwd()}`;
}

function sessionCacheFor(state: RuntimeState, ctx: RuntimeContextLike): SessionApprovalCache {
  const sessionId = sessionIdFor(ctx);
  if (!state.sessionCache || state.sessionCache.sessionId !== sessionId) {
    state.sessionCache = createSessionApprovalCache({ sessionId });
  }
  return state.sessionCache;
}

function modeFor(ctx: RuntimeContextLike): string {
  return ctx.mode ?? 'tui';
}

function hasUIFor(ctx: RuntimeContextLike): boolean {
  return ctx.hasUI ?? (modeFor(ctx) === 'tui' || modeFor(ctx) === 'rpc');
}

function isSubagentLike(value: string | undefined): boolean {
  return value === 'subagent' || value === 'nested';
}

function subagentSessionMetadata(ctx: RuntimeContextLike): SubagentSessionMetadata | undefined {
  const sessionId = ctx.sessionManager?.getSessionId?.();
  if (!sessionId) return undefined;
  const registry = (globalThis as Record<symbol, unknown>)[subagentSessionRegistryKey];
  if (!(registry instanceof Map)) return undefined;
  return registry.get(sessionId) as SubagentSessionMetadata | undefined;
}

function originFor(event: ToolCallEventLike | UserBashEventLike, ctx: RuntimeContextLike): RequestOrigin {
  const sessionMetadata = subagentSessionMetadata(ctx);
  if (isSubagentLike(event.origin) || isSubagentLike(ctx.origin) || isSubagentLike(sessionMetadata?.origin)) return 'subagent';
  if (
    event.requester?.subagentId ||
    event.requester?.subagentName ||
    ctx.requester?.subagentId ||
    ctx.requester?.subagentName ||
    sessionMetadata?.requester?.subagentId ||
    sessionMetadata?.requester?.subagentName
  ) return 'subagent';
  if (event.origin === 'main' || ctx.origin === 'main') return 'main';
  return 'main';
}

function requesterFor(event: ToolCallEventLike | UserBashEventLike, ctx: RuntimeContextLike): PermissionRequest['requester'] | undefined {
  return event.requester ?? ctx.requester ?? subagentSessionMetadata(ctx)?.requester;
}

function policyIdentityFor(loadResult: PermissionConfigLoadResult): string {
  const sources = loadResult.loadedConfigPaths.length > 0 ? loadResult.loadedConfigPaths.join('|') : 'built-in-defaults';
  return `permission-guard:${sources}`;
}

function promptMessage(prompt: ApprovalPrompt): string {
  const lines = [prompt.title, '', prompt.message];
  if (prompt.safeTarget) lines.push('', `Target: ${prompt.safeTarget}`);
  if (prompt.safeCommandSummary) lines.push('', `Command: ${prompt.safeCommandSummary}`);
  if (prompt.workspaceRoot) lines.push('', `Workspace: ${prompt.workspaceRoot}`);
  if (prompt.limitations?.length) lines.push('', ...prompt.limitations);
  return lines.join('\n');
}

function blockReason(result: PermissionDecisionResult, auditError?: string): string {
  const parts = [`${result.reasonCode}: ${result.reason}`];
  if (auditError) parts.push(`Audit warning: ${auditError}`);
  return parts.join('\n');
}

function permissionRequiredReason(payload: PermissionRequiredPayload): string {
  return `${permissionRequiredMarker}${JSON.stringify(payload)}`;
}

function publishPermissionDetails(payload: PermissionRequiredPayload): { permissionRequest: ReturnType<typeof publishPermissionRequest> } {
  return { permissionRequest: publishPermissionRequest(payload) };
}

function userBashBlockResult(result: PermissionDecisionResult, auditError?: string): { result: { output: string; exitCode: number; cancelled: boolean; truncated: boolean } } {
  return {
    result: {
      output: blockReason(result, auditError),
      exitCode: 1,
      cancelled: false,
      truncated: false,
    },
  };
}

async function loadRuntimeConfig(cwd: string): Promise<PermissionConfigLoadResult> {
  return loadPermissionConfig({ cwd });
}

async function resolveRuntimeDecision(
  loadResult: PermissionConfigLoadResult,
  request: PermissionRequest,
  ctx: RuntimeContextLike,
  state: RuntimeState,
): Promise<{ result: PermissionDecisionResult; permissionRequired?: PermissionRequiredPayload; auditError?: string }> {
  const config = loadResult.config;
  const sessionCache = sessionCacheFor(state, ctx);
  const initial = evaluatePermission(config, request, mergeApprovalSnapshots(sessionCache.snapshot(), snapshotMainThreadApprovals()));
  const approval = await resolveApproval(config, request, initial, {
    sessionCache,
    prompt: hasUIFor(ctx) && ctx.ui?.select
      ? async (prompt) => {
          const choice = await ctx.ui!.select!(promptMessage(prompt), prompt.choices);
          return choice ?? 'Deny';
        }
      : undefined,
    projectApproval: async (approval) => {
      if (typeof approval !== 'string') {
        await addProjectBashApproval(ctx.cwd ?? process.cwd(), approval as any);
      }
    },
  });

  consumeMainThreadApproval(approval.result.reasonCode === 'session_approval_allowed' ? approval.result.cacheKey : undefined);
  const recorded = await recordAuditDecision(config, request, approval.result);
  return { result: recorded.result, permissionRequired: approval.permissionRequired, auditError: recorded.auditError };
}

async function buildToolRequest(event: ToolCallEventLike, ctx: RuntimeContextLike, loadResult: PermissionConfigLoadResult): Promise<PermissionRequest | undefined> {
  if (!isSupportedTool(event.toolName)) return undefined;
  const cwd = ctx.cwd ?? process.cwd();
  return mapBuiltinToolInput({
    tool: event.toolName,
    input: event.input,
    cwd,
    config: loadResult.config,
    mode: modeFor(ctx),
    hasUI: hasUIFor(ctx),
    policyIdentity: policyIdentityFor(loadResult),
    origin: originFor(event, ctx),
    requester: requesterFor(event, ctx),
  });
}

async function buildUserBashRequest(event: UserBashEventLike, ctx: RuntimeContextLike, loadResult: PermissionConfigLoadResult): Promise<PermissionRequest | undefined> {
  if (typeof event.command !== 'string' || event.command.length === 0) return undefined;
  const cwd = event.cwd ?? ctx.cwd ?? process.cwd();
  return mapBuiltinToolInput({
    tool: 'user_bash',
    input: event.command,
    cwd,
    config: loadResult.config,
    mode: modeFor(ctx),
    hasUI: hasUIFor(ctx),
    policyIdentity: policyIdentityFor(loadResult),
    origin: originFor(event, ctx),
    requester: requesterFor(event, ctx),
  });
}

export function registerPermissionGuardRuntime(pi: RuntimePiLike): void {
  const state: RuntimeState = {};

  pi.on('tool_call', async (rawEvent, ctx) => {
    const event = rawEvent as ToolCallEventLike;
    if (!isSupportedTool(event.toolName)) return undefined;

    const loadResult = await loadRuntimeConfig(ctx.cwd ?? process.cwd());
    const request = await buildToolRequest(event, ctx, loadResult);
    if (!request) return undefined;

    const resolved = await resolveRuntimeDecision(loadResult, request, ctx, state);
    if (resolved.permissionRequired) {
      return {
        block: true,
        reason: 'Permission approval must be collected by the main thread.',
        details: publishPermissionDetails(resolved.permissionRequired),
      };
    }
    if (resolved.result.finalDecision === 'deny') {
      return { block: true, reason: blockReason(resolved.result, resolved.auditError) };
    }

    return undefined;
  });

  pi.on('user_bash', async (rawEvent, ctx) => {
    const event = rawEvent as UserBashEventLike;
    if (typeof event.command !== 'string' || event.command.length === 0) return undefined;

    const loadResult = await loadRuntimeConfig(event.cwd ?? ctx.cwd ?? process.cwd());
    const request = await buildUserBashRequest(event, ctx, loadResult);
    if (!request) return undefined;

    const resolved = await resolveRuntimeDecision(loadResult, request, ctx, state);
    if (resolved.permissionRequired) {
      return { result: { output: permissionRequiredReason(resolved.permissionRequired), exitCode: 1, cancelled: false, truncated: false } };
    }
    if (resolved.result.finalDecision === 'deny') {
      return userBashBlockResult(resolved.result, resolved.auditError);
    }

    return undefined;
  });
}
