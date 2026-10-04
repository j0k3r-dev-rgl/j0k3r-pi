import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { loadSubagents, parseEffort, parseModel, readSubagentsConfig, resolveEffectiveSubagentMode } from './config.js';
import { resolveContinuationEffectiveMode } from './continuation-mode.js';
import { writeSubagentsDebugLog } from './debug.js';
import { sdkSubagentRunner } from './runner.js';
import { SubagentHistoryStore } from './history.js';
import { publishInteractionResponse, sanitizeInteractionTransportText } from './interaction-channel.js';
import { classifyThrownError, deriveErrorString, enrichErrorMetadata, normalizeErrorMetadata, SubagentStructuredError } from './error-metadata.js';
import { profileSourceLabel, resolveEffectiveSubagentProfile } from './profile-resolver.js';
import type { SubagentInteractionRequest, SubagentInteractionResponse } from './interaction-channel.js';
import type { EffectiveSubagentProfile, LiveSteeringBridge, ModelRef, SendMessageResult, SubagentContinueInput, SubagentDefinition, SubagentErrorMetadata, SubagentRunInput, SubagentRunResult, SubagentsConfig, SubagentRunner, SubagentTask, SubagentTaskAllocationClaim, SubagentTaskAllocationEvent, SubagentTaskTerminalEvent } from './types.js';

type StopDisposition = {
  status: Extract<SubagentTask['status'], 'failed' | 'cancelled' | 'interrupted'>;
  metadata: Partial<SubagentErrorMetadata> & { category: SubagentErrorMetadata['category'] };
  fallbackError?: string;
};

function nowIso(): string { return new Date().toISOString(); }
function taskId(agent: string): string { return `subtask_${agent}_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`; }
function taskActivityTime(task: SubagentTask): string { return task.last_activity_at ?? task.started_at ?? task.created_at; }
function compareBinaryTextDesc(a: string, b: string): number { return Buffer.compare(Buffer.from(b, 'utf8'), Buffer.from(a, 'utf8')); }
function compareTasksByRecentActivity(a: SubagentTask, b: SubagentTask): number {
  return compareBinaryTextDesc(taskActivityTime(a), taskActivityTime(b))
    || compareBinaryTextDesc(a.created_at, b.created_at)
    || compareBinaryTextDesc(a.id, b.id);
}
function subagentAuditLog(cwd: string | undefined, event: string, data: Record<string, unknown>): void {
  writeSubagentsDebugLog(cwd, event, data);
}

function interactionLogFields(request: SubagentInteractionRequest | undefined): Record<string, unknown> {
  if (!request) return { hasInteractionRequest: false };
  return {
    hasInteractionRequest: true,
    requestId: request.requestId,
    kind: request.kind,
    origin: request.origin,
    reasonCode: request.reasonCode,
    riskLevel: request.riskLevel,
    requester: request.requester,
    hasPrompt: Boolean(request.prompt),
    hasPayload: request.payload !== undefined,
  };
}

function compactOutput(text: string, limit = 800): string {
  const normalized = sanitizeInteractionTransportText(text).replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `…${normalized.slice(-limit)}` : normalized;
}

const MAX_DISPLAY_NAME_LENGTH = 80;

function normalizeDisplayName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const sanitized = sanitizeInteractionTransportText(raw).replace(/\s+/g, ' ').trim();
  if (!sanitized) return undefined;
  return sanitized.slice(0, MAX_DISPLAY_NAME_LENGTH);
}

function resolveDisplayNameInput(displayNameRaw?: unknown, nameRaw?: unknown): string | undefined {
  const displayCandidate = normalizeDisplayName(displayNameRaw);
  if (displayCandidate) return displayCandidate;
  return normalizeDisplayName(nameRaw);
}

function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; errcode?: unknown; errstr?: unknown; message?: unknown };
  return candidate.code === 'ERR_SQLITE_ERROR'
    && (candidate.errcode === 5 || candidate.errstr === 'database is locked' || candidate.message === 'database is locked');
}

function modelRefLabel(model: ModelRef | undefined): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

function sessionIdFromContext(ctx: any): string | undefined {
  const direct = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const file = ctx?.sessionManager?.getSessionFile?.();
  return typeof file === 'string' && file.length > 0 ? file : undefined;
}

function sanitizeUnknown<T>(value: T): T {
  if (typeof value === 'string') return sanitizeInteractionTransportText(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sanitizeUnknown(entry)])) as T;
}

function hasPartialResult(task: SubagentTask): boolean {
  return Boolean(task.output_preview || task.result || task.thread_snapshot);
}

function enrichTerminalMetadata(task: SubagentTask, parentSessionId: string | undefined, metadata: SubagentErrorMetadata): SubagentErrorMetadata {
  return enrichErrorMetadata(metadata, {
    usage_at_failure: task.usage,
    last_activity: task.last_activity,
    partial_result_available: hasPartialResult(task),
    task_id: task.id,
    parent_session_id: parentSessionId,
  });
}

function isTerminalStatus(status: SubagentTask['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted';
}

function stopDispositionFromReason(reason: string): StopDisposition {
  if (reason.startsWith('Pi ') || reason === 'Pi session shutdown') {
    return {
      status: 'interrupted',
      metadata: {
        category: 'interrupted',
        message: `Subagent interrupted: ${reason}`,
        phase: 'manager',
        retryable: false,
        partial_result_available: false,
        details: { interrupt_reason: reason },
      },
      fallbackError: `Subagent interrupted: ${reason}`,
    };
  }
  const phase = reason === 'parent abort' ? 'manager' : 'user';
  return {
    status: 'cancelled',
    metadata: {
      category: 'cancelled',
      message: `Subagent cancelled: ${reason}`,
      phase,
      retryable: false,
      partial_result_available: false,
      details: { cancel_reason: reason },
    },
    fallbackError: `Subagent cancelled: ${reason}`,
  };
}

function resolveContinuationProfile(definition: SubagentDefinition, config: SubagentsConfig, ctx: any, input: SubagentContinueInput): EffectiveSubagentProfile {
  const resolved = resolveEffectiveSubagentProfile({ agentName: definition.name, definition, config, ctx });
  const model = input.model === undefined
    ? resolved.model
    : (() => {
        const parsed = parseModel(input.model);
        if (!parsed) throw new Error(`Invalid model override for continuation: ${input.model}`);
        return { value: parsed, source: 'orchestrator' as const, label: profileSourceLabel('orchestrator', parsed, (value) => `${value.provider}/${value.id}`) };
      })();
  const effort = input.effort === undefined
    ? resolved.effort
    : (() => {
        const parsed = parseEffort(input.effort);
        if (!parsed) throw new Error(`Invalid effort override for continuation: ${input.effort}`);
        return { value: parsed, source: 'orchestrator' as const, label: profileSourceLabel('orchestrator', parsed, String) };
      })();
  return { ...resolved, model, effort };
}

function interactionPromptMessage(request: SubagentInteractionRequest): string {
  const prompt = request.prompt ?? {};
  const lines = [prompt.title ?? `Subagent interaction: ${request.kind}`, '', prompt.message ?? request.reason ?? 'A subagent requested main-thread interaction.'];
  const requester = request.requester?.subagentName ?? request.requester?.subagentId;
  if (requester) lines.push('', `Requested by: ${requester}`);
  if (prompt.safeTarget) lines.push('', `Target: ${prompt.safeTarget}`);
  if (prompt.safeCommandSummary) lines.push('', `Command: ${prompt.safeCommandSummary}`);
  if (prompt.workspaceRoot) lines.push('', `Workspace: ${prompt.workspaceRoot}`);
  if (prompt.limitations?.length) lines.push('', ...prompt.limitations);
  if (request.payload !== undefined) lines.push('', 'Payload:', JSON.stringify(request.payload, null, 2));
  if (request.response?.instructions) lines.push('', 'Expected response:', request.response.instructions);
  return lines.join('\n');
}

function editorInitialValue(request: SubagentInteractionRequest): string {
  return JSON.stringify({
    kind: request.kind,
    prompt: request.prompt,
    payload: request.payload,
    response: request.response,
  }, null, 2);
}

function parseEditorResponse(raw: string, request: SubagentInteractionRequest): unknown {
  if (request.response?.expected === 'json') return JSON.parse(raw);
  return raw;
}

async function promptMainThreadForInteraction(ctx: any, request: SubagentInteractionRequest): Promise<SubagentInteractionResponse> {
  const prompt = request.prompt ?? {};
  const message = interactionPromptMessage(request);
  const choices = Array.isArray(prompt.choices) ? prompt.choices.filter((choice): choice is string => typeof choice === 'string') : [];

  if (choices.length && typeof ctx?.ui?.select === 'function') {
    const value = await ctx.ui.select(message, choices);
    return { type: 'interaction_response', requestId: request.requestId, status: value === undefined ? 'cancelled' : 'answered', value };
  }

  if (request.kind === 'confirm' && typeof ctx?.ui?.confirm === 'function') {
    const value = await ctx.ui.confirm(prompt.title ?? 'Subagent interaction', message);
    return { type: 'interaction_response', requestId: request.requestId, status: 'answered', value: Boolean(value) };
  }

  if (request.kind === 'input' && typeof ctx?.ui?.input === 'function') {
    const value = await ctx.ui.input(message, prompt.placeholder ?? prompt.defaultValue ?? '');
    return { type: 'interaction_response', requestId: request.requestId, status: value === undefined ? 'cancelled' : 'answered', value };
  }

  if (typeof ctx?.ui?.editor === 'function') {
    try {
      const value = await ctx.ui.editor(message, editorInitialValue(request));
      if (value === undefined) return { type: 'interaction_response', requestId: request.requestId, status: 'cancelled' };
      return { type: 'interaction_response', requestId: request.requestId, status: 'answered', value: parseEditorResponse(value, request) };
    } catch (error) {
      return { type: 'interaction_response', requestId: request.requestId, status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }

  throw new Error(`Subagent interaction ${request.requestId} (${request.kind}) requires main-thread UI support for select, confirm, input, or editor.`);
}

function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return {
    async acquire(signal: AbortSignal): Promise<boolean> {
      if (signal.aborted) return false;
      if (active < max) {
        active += 1;
        return true;
      }
      return new Promise<boolean>((resolve) => {
        const grant = () => {
          signal.removeEventListener('abort', abort);
          // Reserve the slot before resuming the waiter, so new arrivals cannot take it.
          active += 1;
          resolve(true);
        };
        const abort = () => {
          const index = queue.indexOf(grant);
          if (index < 0) return;
          queue.splice(index, 1);
          signal.removeEventListener('abort', abort);
          resolve(false);
        };
        queue.push(grant);
        signal.addEventListener('abort', abort, { once: true });
      });
    },
    release() {
      active = Math.max(0, active - 1);
      queue.shift()?.();
    },
  };
}

const ACTIVITY_RECORD_FLUSH_MS = 250;
const ACTIVITY_UPDATE_FLUSH_MS = 150;
const SESSION_TASK_CACHE_MS = 1500;
const MAX_PENDING_MESSAGES = 16;
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_PENDING_MESSAGE_BYTES = 64 * 1024;

function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

type PendingRecord = { cwd: string; task: SubagentTask; activity: string; timer: NodeJS.Timeout };

type PendingMessageEntry = {
  message: string;
  bytes: number;
  forwarded: boolean;
};

type LiveTaskState = {
  parentSessionId?: string;
  attempt: number;
  bridgeReady: boolean;
  bridge?: LiveSteeringBridge;
  pendingMessages: PendingMessageEntry[];
  pendingBytes: number;
};

function closeLiveState(task: SubagentTask, state: LiveTaskState | undefined): void {
  const pendingCount = state?.pendingMessages.length ?? task.pending_message_count ?? 0;
  task.pending_message_count = 0;
  task.undelivered_message_count = (task.undelivered_message_count ?? 0) + pendingCount;
  if (!state) return;
  state.pendingMessages = [];
  state.pendingBytes = 0;
  state.bridgeReady = true;
  delete state.bridge;
}

type SendMessageInput = {
  task_id: string;
  message: string;
  session_id?: string;
};

type LaunchAttemptInput = {
  definition: SubagentDefinition;
  taskText: string;
  context: string | undefined;
  task: SubagentTask;
  ctx: any;
  config: SubagentsConfig;
  effectiveProfile: EffectiveSubagentProfile;
  parentSessionId: string | undefined;
  nestedSessionPath?: string;
  previousSnapshot?: SubagentTask['thread_snapshot'];
  continuationPrompt?: string;
  parentSignal?: AbortSignal;
  onTaskUpdate?: () => void;
  limiter: ReturnType<typeof createLimiter>;
};

export class SubagentManager {
  private tasks = new Map<string, SubagentTask>();
  private taskCwds = new Map<string, string>();
  private controllers = new Map<string, AbortController>();
  private limiters = new Map<string, ReturnType<typeof createLimiter>>();
  private pendingRecords = new Map<string, PendingRecord>();
  private pendingUpdates = new Map<string, NodeJS.Timeout>();
  private sessionTaskCache = new Map<string, { expiresAt: number; tasks: SubagentTask[] }>();
  private runnerSettlements = new Map<string, Promise<void>>();
  private stopDispositions = new Map<string, StopDisposition>();
  private liveStates = new Map<string, LiveTaskState>();
  private taskUpdateListeners = new Set<() => void>();
  private terminalCleanups = new Map<string, Promise<void>>();

  constructor(
    private runner: SubagentRunner = sdkSubagentRunner,
    private history = new SubagentHistoryStore(),
    private onTerminalBackgroundTask?: (task: SubagentTask, cwd: string) => void,
    private onInteractionPromptActive?: (active: boolean) => void,
    private events?: any,
  ) {}

  async drainOwnerSession(sessionId?: string, reason = 'Pi session shutdown'): Promise<void> {
    return this.drainTasks((task) => task.session_id === sessionId, reason);
  }

  async drainAllTasks(reason = 'Pi session shutdown'): Promise<void> {
    return this.drainTasks(() => true, reason);
  }

  private async drainTasks(predicate: (task: SubagentTask) => boolean, reason: string): Promise<void> {
    const activeTasks = [...this.tasks.values()].filter((task) => {
      return predicate(task) && this.runnerSettlements.has(task.id);
    });
    for (const task of activeTasks) {
      if (!isTerminalStatus(task.status)) this.cancel(task.id, reason);
    }
    const settlementPromises = activeTasks
      .map((task) => this.runnerSettlements.get(task.id))
      .filter(Boolean) as Promise<void>[];
    await Promise.allSettled(settlementPromises);
  }

  private emitEvent(channel: string, data: unknown, ctx?: any): void {
    try {
      const bus = this.events ?? ctx?.events ?? ctx?.pi?.events;
      bus?.emit?.(channel, data);
    } catch {
      // Event emission must never crash the manager
    }
  }

  private async runTerminalCleanups(task: SubagentTask, parentSessionId: string | undefined, ctx?: any): Promise<void> {
    const attempt = task.attempt ?? 1;
    const key = `${task.id}:${attempt}`;
    const pending = this.terminalCleanups.get(key);
    if (pending) return pending;
    const cleanups: Array<() => Promise<void>> = [];
    const terminalEvent: SubagentTaskTerminalEvent = {
      taskId: task.id,
      attempt,
      parentSessionId,
      status: (isTerminalStatus(task.status) ? task.status : 'cancelled') as SubagentTaskTerminalEvent['status'],
      error: task.error,
      registerCleanup: (cleanup) => {
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      },
    };
    this.emitEvent('subagents:task:terminal', terminalEvent, ctx);
    const settlement = Promise.allSettled(cleanups.map((fn) => Promise.resolve().then(fn))).then((results) => {
      const rejections = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (rejections.length > 0) {
        const cwd = this.taskCwds.get(task.id) ?? ctx?.cwd ?? process.cwd();
        const rawMessages = rejections.map((r) => {
          const err = r.reason;
          return err instanceof Error ? err.message : String(err ?? 'Unknown cleanup error');
        });
        const sanitizedCleanupError = sanitizeInteractionTransportText(rawMessages.join('; ')).slice(0, 1024);

        subagentAuditLog(cwd, 'terminal_cleanup_failed', {
          taskId: task.id,
          attempt,
          parentSessionId,
          error: sanitizedCleanupError,
        });

        ctx?.ui?.notify?.(`Subagent ${task.id} cleanup failed: ${sanitizedCleanupError}`, 'warning');

        if (task.error_metadata) {
          task.error_metadata = enrichTerminalMetadata(task, parentSessionId, normalizeErrorMetadata({
            ...task.error_metadata,
            details: {
              ...task.error_metadata.details,
              cleanup_error: sanitizedCleanupError,
            },
          }));
        } else {
          task.error_metadata = enrichTerminalMetadata(task, parentSessionId, normalizeErrorMetadata({
            category: 'unknown',
            message: `Terminal cleanup failed: ${sanitizedCleanupError}`,
            phase: 'manager',
            retryable: false,
            partial_result_available: hasPartialResult(task),
            details: { cleanup_error: sanitizedCleanupError },
          }));
        }

        if (!task.error) {
          task.error = deriveErrorString(task.error_metadata);
        }

        this.recordNow(cwd, task, task.last_activity ?? 'terminal cleanup failed');
        this.notifyTaskUpdate(task.id, undefined, true);
      }
    });
    this.terminalCleanups.set(key, settlement);
    await settlement;
  }

  listAgents(cwd: string, ctx: any = {}) {
    const config = readSubagentsConfig(cwd);
    return loadSubagents(cwd).map((definition) => {
      const profile = resolveEffectiveSubagentProfile({ agentName: definition.name, definition, config, ctx });
      return {
        name: definition.name,
        description: definition.description,
        filePath: definition.filePath,
        tools: definition.tools,
        model: profile.model.value,
        effort: profile.effort.value,
      };
    });
  }

  listTasks(cwd?: string) {
    const active = [...this.tasks.values()].sort(compareTasksByRecentActivity);
    if (!cwd) return active;
    const activeIds = new Set(active.map((task) => task.id));
    const persisted = this.history.listTasks(cwd).filter((task) => !activeIds.has(task.id));
    return [...active, ...persisted].sort(compareTasksByRecentActivity);
  }

  listActiveSessionTasks(cwd?: string, sessionId?: string) {
    return [...this.tasks.values()]
      .filter((task) => (!cwd || this.taskCwds.get(task.id) === cwd) && (!sessionId || task.session_id === sessionId))
      .sort(compareTasksByRecentActivity);
  }

  listSessionTasks(cwd?: string, sessionId?: string) {
    const active = this.listActiveSessionTasks(cwd, sessionId);
    if (!cwd || !sessionId) return active;
    const activeIds = new Set(active.map((task) => task.id));
    const persisted = this.cachedPersistedSessionTasks(cwd, sessionId).filter((task) => !activeIds.has(task.id));
    return [...active, ...persisted].sort(compareTasksByRecentActivity);
  }

  onTaskUpdate(listener: () => void): () => void {
    this.taskUpdateListeners.add(listener);
    return () => { this.taskUpdateListeners.delete(listener); };
  }

  getTask(id: string, cwd?: string) {
    return this.tasks.get(id) ?? (cwd ? this.history.getTask(cwd, id) : undefined);
  }

  private isTaskTrackedActive(taskId: string): boolean {
    return this.runnerSettlements.has(taskId) || this.tasks.has(taskId);
  }

  async reconcileOrphanedTasks(cwd: string): Promise<SubagentTask[]> {
    const orphaned = this.history.listTasksByStatus(cwd, ['queued', 'running']);
    const interruptedAt = nowIso();
    const reconciled: SubagentTask[] = [];
    for (const task of orphaned) {
      if (this.isTaskTrackedActive(task.id)) {
        continue;
      }
      const updated: SubagentTask = {
        ...task,
        status: 'interrupted',
        stop_reason: 'orphaned active state at startup',
        last_activity_at: interruptedAt,
        last_activity: 'interrupted at startup',
        ended_at: interruptedAt,
        pending_message_count: 0,
        undelivered_message_count: (task.undelivered_message_count ?? 0) + (task.pending_message_count ?? 0),
      };
      updated.error_metadata = enrichTerminalMetadata(updated, updated.session_id, normalizeErrorMetadata({
        category: 'interrupted',
        message: 'Subagent interrupted: orphaned active state at startup',
        phase: 'manager',
        retryable: false,
        partial_result_available: hasPartialResult(updated),
        details: { interrupt_reason: 'orphaned active state at startup' },
      }));
      updated.error = deriveErrorString(updated.error_metadata);
      this.recordNow(cwd, updated, updated.last_activity ?? 'interrupted at startup');
      await this.runTerminalCleanups(updated, updated.session_id, undefined);
      reconciled.push(updated);
    }
    return reconciled;
  }

  cancelRunning(reason = 'cancelled'): SubagentTask[] {
    return [...this.tasks.values()]
      .filter((task) => task.status === 'queued' || task.status === 'running' || task.status === 'stopping')
      .map((task) => this.cancel(task.id, reason));
  }

  sendToBackground(ids: string[]): SubagentTask[] {
    const changed: SubagentTask[] = [];
    for (const id of ids) {
      const task = this.tasks.get(id);
      const cwd = this.taskCwds.get(id);
      if (!task || !cwd) continue;
      if (task.mode === 'background') continue;
      if (task.status !== 'queued' && task.status !== 'running') continue;
      task.mode = 'background';
      task.effective_mode = 'background';
      this.record(cwd, task, task.last_activity ?? 'running', true);
      changed.push(task);
    }
    return changed;
  }

  hasRunning(): boolean {
    return [...this.tasks.values()].some((task) => task.status === 'queued' || task.status === 'running' || task.status === 'stopping');
  }

  registerLiveBridge(taskId: string, bridge: LiveSteeringBridge, parentSessionId: string | undefined, attempt: number): void {
    const task = this.tasks.get(taskId);
    const current = this.liveStates.get(taskId);
    if (current && current.attempt > attempt) return;
    const state = current && current.attempt === attempt
      ? current
      : { attempt, parentSessionId, bridgeReady: false, pendingMessages: [], pendingBytes: 0 };
    state.parentSessionId = parentSessionId;
    state.attempt = attempt;
    state.bridge = bridge;
    state.bridgeReady = true;
    this.liveStates.set(taskId, state);
    if (task) this.flushPendingLiveMessages(task, state);
  }

  clearLiveBridge(taskId: string, attempt?: number): void {
    const state = this.liveStates.get(taskId);
    if (!state) return;
    if (attempt !== undefined && state.attempt !== attempt) return;
    state.bridgeReady = true;
    delete state.bridge;
  }

  private closeTaskLiveState(task: SubagentTask): void {
    const state = this.liveStates.get(task.id);
    closeLiveState(task, state);
    this.liveStates.delete(task.id);
  }

  private flushPendingLiveMessages(task: SubagentTask, state: LiveTaskState): void {
    if (!state.bridgeReady || !state.bridge?.supported) return;
    for (const entry of state.pendingMessages) {
      if (entry.forwarded) continue;
      try {
        state.bridge.steer(entry.message);
        entry.forwarded = true;
      } catch {
        break;
      }
    }
    task.pending_message_count = state.pendingMessages.length;
  }

  consumeQueuedMessage(taskId: string): void {
    const task = this.tasks.get(taskId);
    const state = this.liveStates.get(taskId);
    if (!task || !state || !state.pendingMessages.length) return;
    const forwardedIndex = state.pendingMessages.findIndex((entry) => entry.forwarded);
    if (forwardedIndex < 0) return;
    const [entry] = state.pendingMessages.splice(forwardedIndex, 1);
    state.pendingBytes = Math.max(0, state.pendingBytes - (entry?.bytes ?? 0));
    task.pending_message_count = state.pendingMessages.length;
  }

  sendMessage(input: SendMessageInput): SendMessageResult {
    const task = this.tasks.get(input.task_id);
    if (!task) {
      return { status: 'rejected', task_id: input.task_id, reason: 'unknown_task', message: `Subagent task not found: ${input.task_id}` };
    }
    if (!input.session_id) {
      return { status: 'rejected', task_id: input.task_id, reason: 'caller_identity_unavailable', message: 'Unable to verify the calling Pi session for this live message request.' };
    }
    if (task.status !== 'running') {
      return { status: 'rejected', task_id: input.task_id, reason: 'not_running', message: `Subagent task ${input.task_id} is not currently running.` };
    }
    if ((task.effective_mode ?? task.mode) !== 'background') {
      return { status: 'rejected', task_id: input.task_id, reason: 'not_background', message: `Subagent task ${input.task_id} is not currently running in background mode.` };
    }
    const liveState = this.liveStates.get(input.task_id);
    if (!liveState || !liveState.parentSessionId || liveState.parentSessionId !== input.session_id) {
      return { status: 'rejected', task_id: input.task_id, reason: 'not_owner', message: 'Only the exact originating parent Pi session may message this live background task.' };
    }
    if (liveState.bridgeReady && !liveState.bridge) {
      return { status: 'rejected', task_id: input.task_id, reason: 'missing_live_session', message: `Subagent task ${input.task_id} has no live session available for steering.` };
    }
    if (liveState.bridgeReady && liveState.bridge && !liveState.bridge.supported) {
      return {
        status: 'rejected',
        task_id: input.task_id,
        reason: 'unsupported_runtime',
        required_pi_version: '>=0.82.1',
        detected_pi_version: liveState.bridge.detected_pi_version,
        message: `Live background messaging requires Pi runtime >=0.82.1; detected ${liveState.bridge.detected_pi_version}.`,
      };
    }
    const message = sanitizeInteractionTransportText(input.message ?? '');
    if (!message.trim()) {
      return { status: 'rejected', task_id: input.task_id, reason: 'empty_message', message: 'Live background messages must not be empty or whitespace-only.' };
    }
    const messageBytes = utf8ByteLength(message);
    if (messageBytes > MAX_MESSAGE_BYTES) {
      return { status: 'rejected', task_id: input.task_id, reason: 'message_too_large', message: 'Live background messages must be at most 16 KiB of UTF-8 text.' };
    }
    if (liveState.pendingMessages.length >= MAX_PENDING_MESSAGES) {
      return { status: 'rejected', task_id: input.task_id, reason: 'queue_count_limit', message: 'This subagent already has 16 pending live messages queued.' };
    }
    if (liveState.pendingBytes + messageBytes > MAX_PENDING_MESSAGE_BYTES) {
      return { status: 'rejected', task_id: input.task_id, reason: 'queue_bytes_limit', message: 'This subagent already has too much queued live-message text pending.' };
    }
    const entry: PendingMessageEntry = { message, bytes: messageBytes, forwarded: false };
    liveState.pendingMessages.push(entry);
    liveState.pendingBytes += messageBytes;
    task.pending_message_count = liveState.pendingMessages.length;
    if (liveState.bridgeReady && liveState.bridge?.supported) {
      try {
        liveState.bridge.steer(message);
        entry.forwarded = true;
      } catch {
        liveState.pendingMessages.pop();
        liveState.pendingBytes = Math.max(0, liveState.pendingBytes - messageBytes);
        task.pending_message_count = liveState.pendingMessages.length;
        return { status: 'rejected', task_id: input.task_id, reason: 'enqueue_failed', message: 'The live steering queue rejected this message before it could be accepted.' };
      }
    }
    return {
      status: 'queued',
      task_id: input.task_id,
      pending_message_count: liveState.pendingMessages.length,
      message: 'Message accepted into the steering queue; this does not prove model consumption.',
    };
  }

  private limiter(cwd: string, maxConcurrency: number): ReturnType<typeof createLimiter> {
    const key = `${cwd}:${maxConcurrency}`;
    let limiter = this.limiters.get(key);
    if (!limiter) {
      limiter = createLimiter(maxConcurrency);
      this.limiters.set(key, limiter);
    }
    return limiter;
  }

  async run(
    input: SubagentRunInput,
    ctx: any,
    parentSignal?: AbortSignal,
    onTaskUpdate?: (tasks: SubagentTask[]) => void,
  ): Promise<SubagentRunResult> {
    const cwd = ctx?.cwd ?? process.cwd();
    const agents = input.agents?.length ? input.agents : input.agent ? [input.agent] : [];
    if (!agents.length) throw new Error('subagent_run requires agent or agents.');
    const explicitMode = input.mode;
    const config = readSubagentsConfig(cwd);

    const definitions = new Map(loadSubagents(cwd).map((definition) => [definition.name, definition]));
    const limiter = this.limiter(cwd, config.max_concurrency);
    const displayName = resolveDisplayNameInput(input.display_name, input.name);
    let ids: string[] = [];
    const notifyUpdate = () => onTaskUpdate?.(ids.map((id) => this.tasks.get(id)!).filter(Boolean));
    ids = agents.map((agent) => {
      const definition = definitions.get(agent.toLowerCase());
      if (!definition) throw new Error(`Subagent not found: ${agent}`);
      return this.startOne(definition, input.task, input.context, explicitMode, ctx, config, parentSignal, notifyUpdate, limiter, displayName);
    });
    notifyUpdate();
    const launched = ids.map((id) => this.tasks.get(id)!).filter(Boolean);
    const waitedTaskIds = launched.filter((task) => task.effective_mode === 'task').map((task) => task.id);
    const backgroundTaskIds = launched.filter((task) => task.effective_mode === 'background').map((task) => task.id);
    const resolvedMode: SubagentRunResult['mode'] = explicitMode
      ?? (waitedTaskIds.length && backgroundTaskIds.length ? 'mixed' : backgroundTaskIds.length ? 'background' : 'task');
    if (resolvedMode === 'background' && explicitMode === 'background') {
      return { mode: resolvedMode, task_ids: ids, waited_task_ids: waitedTaskIds, background_task_ids: backgroundTaskIds };
    }
    await Promise.all(waitedTaskIds.map((id) => this.wait(id)));
    if (parentSignal?.aborted) throw new Error('Subagent run aborted');
    const results = ids.map((id) => this.tasks.get(id)!).filter(Boolean);
    return {
      mode: resolvedMode,
      task_ids: ids,
      waited_task_ids: waitedTaskIds,
      background_task_ids: backgroundTaskIds,
      members: results.map((task) => ({ task_id: task.id, agent: task.agent, effective_mode: task.effective_mode ?? task.mode, state: task.status })),
      results,
    };
  }

  async continueTask(
    input: SubagentContinueInput,
    ctx: any,
    parentSignal?: AbortSignal,
    onTaskUpdate?: (tasks: SubagentTask[]) => void,
  ): Promise<{ mode: 'task' | 'background'; task_ids: string[]; results?: SubagentTask[] }> {
    const cwd = ctx?.cwd ?? process.cwd();
    const taskCwd = this.taskCwds.get(input.task_id) ?? cwd;
    const existing = this.getTask(input.task_id, taskCwd);
    if (!existing) throw new Error(`Subagent task not found: ${input.task_id}`);
    if (!readSubagentsConfig(taskCwd).enable_continue) throw new Error('Subagent task is not available.');
    if (existing.status !== 'stopping' && !isTerminalStatus(existing.status)) throw new Error('Only completed, failed, or cancelled subagent tasks can continue.');
    await this.awaitRunnerCleanup(existing.id);
    const latest = this.getTask(input.task_id, taskCwd) ?? existing;
    if (!isTerminalStatus(latest.status)) throw new Error('Only completed, failed, or cancelled subagent tasks can continue.');
    if (!latest.nested_session_path || !fs.existsSync(latest.nested_session_path)) {
      throw new Error(`Subagent task ${input.task_id} is missing or unreadable nested session file: ${latest.nested_session_path ?? 'unknown'}`);
    }

    const config = readSubagentsConfig(taskCwd);
    const definitions = new Map(loadSubagents(taskCwd).map((definition) => [definition.name, definition]));
    const definition = definitions.get(latest.agent.toLowerCase());
    if (!definition) throw new Error(`Subagent definition not found for continuation: ${latest.agent}`);
    try { this.history.upsertTask(taskCwd, { ...latest, attempt: latest.attempt ?? 1 }); } catch {}
    const effectiveProfile = resolveContinuationProfile(definition, config, ctx, input);
    const effectiveMode = resolveContinuationEffectiveMode({ explicitMode: input.mode, previousTask: latest, config });
    const continuationPrompt = sanitizeInteractionTransportText(input.prompt);
    const continuationSessionId = sessionIdFromContext(ctx);
    this.liveStates.delete(latest.id);
    const task: SubagentTask = {
      ...latest,
      mode: effectiveMode,
      effective_mode: effectiveMode,
      status: 'queued',
      attempt: (latest.attempt ?? 1) + 1,
      session_id: continuationSessionId,
      last_activity_at: nowIso(),
      last_activity: 'queued',
      started_at: undefined,
      ended_at: undefined,
      output_preview: undefined,
      continuation_prompt: continuationPrompt,
      transcript: undefined,
      usage: undefined,
      model: modelRefLabel(effectiveProfile.model.value),
      effort: effectiveProfile.effort.value,
      model_source: effectiveProfile.model.source,
      effort_source: effectiveProfile.effort.source,
      fallback_used: undefined,
      error: undefined,
      error_metadata: undefined,
      result: undefined,
      interaction_request: undefined,
      pending_message_count: 0,
      undelivered_message_count: 0,
    };
    this.launchAttempt({
      definition,
      taskText: latest.task,
      context: latest.context,
      task,
      ctx: { ...ctx, cwd: taskCwd },
      config,
      effectiveProfile,
      parentSessionId: continuationSessionId,
      nestedSessionPath: latest.nested_session_path,
      previousSnapshot: latest.thread_snapshot,
      continuationPrompt,
      parentSignal,
      onTaskUpdate: () => onTaskUpdate?.([this.tasks.get(task.id)!].filter(Boolean)),
      limiter: this.limiter(taskCwd, config.max_concurrency),
    });
    if (effectiveMode === 'background') return { mode: effectiveMode, task_ids: [task.id] };
    await this.wait(task.id);
    if (parentSignal?.aborted) throw new Error('Subagent continuation aborted');
    return { mode: effectiveMode, task_ids: [task.id], results: [this.tasks.get(task.id)!] };
  }

  cancel(id: string, reason = 'cancelled'): SubagentTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Subagent task not found: ${id}`);
    if (isTerminalStatus(task.status)) return task;
    const disposition = stopDispositionFromReason(reason);
    const cwd = this.taskCwds.get(id);
    if (task.status === 'queued') {
      task.status = disposition.status;
      task.stop_reason = reason;
      task.last_activity = reason;
      task.last_activity_at = nowIso();
      task.ended_at = task.last_activity_at;
      task.error_metadata = enrichTerminalMetadata(task, task.session_id, normalizeErrorMetadata({
        ...disposition.metadata,
        partial_result_available: hasPartialResult(task),
      }));
      task.error = deriveErrorString(task.error_metadata);
      delete task.live_activity;
      task.pending_message_count = 0;
      task.undelivered_message_count = task.undelivered_message_count ?? 0;
      if (cwd) this.record(cwd, task, task.last_activity, true);
      this.controllers.get(id)?.abort();
      void this.runTerminalCleanups(task, task.session_id, undefined);
      return task;
    }
    if (task.status === 'stopping') return task;
    this.stopDispositions.set(id, disposition);
    this.transitionToStopping(task, reason, cwd);
    this.notifyTaskUpdate(id, undefined, true);
    this.controllers.get(id)?.abort();
    return task;
  }

  private transitionToStopping(task: SubagentTask, reason: string, cwd?: string): void {
    if (task.status === 'stopping' || isTerminalStatus(task.status)) return;
    this.closeTaskLiveState(task);
    task.status = 'stopping';
    task.stop_reason = reason;
    task.last_activity = reason;
    task.last_activity_at = nowIso();
    task.ended_at = undefined;
    delete task.interaction_request;
    if (cwd) this.record(cwd, task, reason, true);
  }

  private finalizeStop(task: SubagentTask, parentSessionId: string | undefined, cwd: string, onTaskUpdate?: () => void): void {
    const disposition = this.stopDispositions.get(task.id) ?? stopDispositionFromReason(task.stop_reason ?? 'cancelled');
    this.closeTaskLiveState(task);
    task.status = disposition.status;
    task.last_activity_at = nowIso();
    task.ended_at = task.last_activity_at;
    task.error_metadata = enrichTerminalMetadata(task, parentSessionId, normalizeErrorMetadata({
      ...disposition.metadata,
      partial_result_available: hasPartialResult(task),
    }));
    task.error = deriveErrorString(task.error_metadata);
    delete task.live_activity;
    task.last_activity = disposition.status === 'failed' ? `failed: ${task.error}` : task.stop_reason ?? task.error;
    delete task.interaction_request;
    this.stopDispositions.delete(task.id);
    this.record(cwd, task, task.last_activity, true);
    this.notifyTaskUpdate(task.id, onTaskUpdate, true);
  }

  private startOne(
    definition: SubagentDefinition,
    taskText: string,
    context: string | undefined,
    mode: 'task' | 'background' | undefined,
    ctx: any,
    config: SubagentsConfig,
    parentSignal?: AbortSignal,
    onTaskUpdate?: () => void,
    limiter = createLimiter(1),
    displayName?: string,
  ): string {
    const session_id = sessionIdFromContext(ctx);
    const effectiveProfile = resolveEffectiveSubagentProfile({ agentName: definition.name, definition, config, ctx });
    const effectiveMode = resolveEffectiveSubagentMode({ invocationMode: mode, definition, config });
    const task: SubagentTask = {
      id: taskId(definition.name),
      display_name: displayName,
      agent: definition.name,
      mode: effectiveMode,
      effective_mode: effectiveMode,
      status: 'queued',
      task: taskText,
      context,
      model: modelRefLabel(effectiveProfile.model.value),
      effort: effectiveProfile.effort.value,
      model_source: effectiveProfile.model.source,
      effort_source: effectiveProfile.effort.source,
      pending_message_count: 0,
      created_at: nowIso(),
      attempt: 1,
      session_id,
      last_activity_at: nowIso(),
      last_activity: 'queued',
    };
    this.launchAttempt({ definition, taskText, context, task, ctx, config, effectiveProfile, parentSessionId: session_id, parentSignal, onTaskUpdate, limiter });
    return task.id;
  }

  private launchAttempt(input: LaunchAttemptInput): void {
    const { definition, taskText, context, task, ctx, config, effectiveProfile: initialEffectiveProfile, parentSessionId, nestedSessionPath, previousSnapshot, continuationPrompt, parentSignal, onTaskUpdate, limiter } = input;
    let effectiveProfile = initialEffectiveProfile;
    const cwd = ctx?.cwd ?? process.cwd();
    const id = task.id;
    const controller = new AbortController();
    this.tasks.set(id, task);
    this.taskCwds.set(id, cwd);
    this.controllers.set(id, controller);
    this.liveStates.set(id, {
      attempt: task.attempt ?? 1,
      parentSessionId,
      bridgeReady: false,
      pendingMessages: [],
      pendingBytes: 0,
    });
    const abortFromParent = () => this.cancel(id, 'parent abort');
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    this.record(cwd, task, 'queued', true);
    this.notifyTaskUpdate(id, onTaskUpdate, true);

    const run = async () => {
      let timeout: NodeJS.Timeout | undefined;
      let timedOut = false;
      let acquired = false;
      let activeRunnerSettlement: Promise<void> | undefined;
      try {
        acquired = await limiter.acquire(controller.signal);
        if (!acquired || controller.signal.aborted) {
          await this.runTerminalCleanups(task, parentSessionId, ctx);
          return;
        }

        let claimModelAllocator: SubagentTaskAllocationClaim | undefined;
        const allocateEvent: SubagentTaskAllocationEvent = {
          taskId: id,
          attempt: task.attempt ?? 1,
          parentSessionId,
          agent: definition.name,
          cwd,
          signal: controller.signal,
          claimModel: (allocator) => {
            claimModelAllocator = allocator;
          },
        };
        this.emitEvent('subagents:task:allocate', allocateEvent, ctx);

        if (claimModelAllocator) {
          if (controller.signal.aborted) {
            await this.runTerminalCleanups(task, parentSessionId, ctx);
            return;
          }
          try {
            const claimed = await claimModelAllocator(controller.signal);
            if (controller.signal.aborted) {
              await this.runTerminalCleanups(task, parentSessionId, ctx);
              return;
            }
            if (claimed?.model) {
              effectiveProfile = {
                ...effectiveProfile,
                model: {
                  value: claimed.model,
                  source: 'allocated',
                  label: profileSourceLabel('allocated', claimed.model, (v) => `${v.provider}/${v.id}`),
                },
                effort: claimed.effort ? {
                  value: claimed.effort,
                  source: 'allocated',
                  label: profileSourceLabel('allocated', claimed.effort, String),
                } : effectiveProfile.effort,
              };
              task.model = modelRefLabel(effectiveProfile.model.value);
              task.model_source = effectiveProfile.model.source;
              if (claimed.effort) {
                task.effort = claimed.effort;
                task.effort_source = effectiveProfile.effort.source;
              }
            }
          } catch {
            if (controller.signal.aborted) {
              await this.runTerminalCleanups(task, parentSessionId, ctx);
              return;
            }
          }
        }

        task.status = 'running';
        task.started_at = nowIso();
        task.last_activity_at = task.started_at;
        task.last_activity = 'started';
        this.record(cwd, task, 'started', true);
        this.notifyTaskUpdate(id, onTaskUpdate, true);
        let interactionsHandled = 0;
        let result: Awaited<ReturnType<SubagentRunner>> | undefined;
        while (true) {
          const runnerPromise = this.runner({
            definition,
            task: taskText,
            taskId: id,
            parentPiSessionId: parentSessionId,
            context,
            cwd,
            ctx,
            config,
            signal: controller.signal,
            effectiveProfile,
            nested_session_path: nestedSessionPath,
            continuation: continuationPrompt ? { prompt: continuationPrompt, attempt: task.attempt ?? 1, previous_snapshot: previousSnapshot } : undefined,
            registerLiveBridge: (bridge) => this.registerLiveBridge(id, bridge, parentSessionId, task.attempt ?? 1),
            clearLiveBridge: () => this.clearLiveBridge(id, task.attempt ?? 1),
            onQueuedMessageStart: () => this.consumeQueuedMessage(id),
            onActivity: (activity) => {
              if (task.status === 'stopping' || isTerminalStatus(task.status)) return;
              task.last_activity_at = nowIso();
              if (activity.live_activity) task.live_activity = activity.live_activity;
              task.last_activity = activity.live_activity?.current?.label ?? activity.message;
              if (activity.output) task.output_preview = compactOutput(activity.output);
              if (activity.prompt) {
                if (continuationPrompt) task.continuation_prompt = sanitizeInteractionTransportText(activity.prompt);
                else task.prompt = sanitizeInteractionTransportText(activity.prompt);
              }
              if (activity.system_prompt) task.system_prompt = sanitizeInteractionTransportText(activity.system_prompt);
              if (activity.transcript) task.transcript = sanitizeInteractionTransportText(activity.transcript);
              if (activity.usage) task.usage = activity.usage;
              if (activity.effort) task.effort = activity.effort;
              if (activity.thread_snapshot) task.thread_snapshot = sanitizeUnknown(activity.thread_snapshot);
              if (activity.interaction_request) task.interaction_request = activity.interaction_request;
              if (activity.nested_session_path) task.nested_session_path = activity.nested_session_path;
              if (activity.pi_retry_attempts !== undefined) task.pi_retry_attempts = activity.pi_retry_attempts;
              const importantActivity = activity.message === 'interaction required'
                || Boolean(activity.interaction_request)
                || (Boolean(activity.thread_snapshot) && !activity.message.startsWith('streaming '));
              this.record(cwd, task, activity.message, importantActivity);
              this.notifyTaskUpdate(id, onTaskUpdate, importantActivity);
            },
          });
          runnerPromise.catch(() => {});
          activeRunnerSettlement = runnerPromise.then(() => undefined, () => undefined);
          const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              timedOut = true;
              this.stopDispositions.set(id, {
                status: 'failed',
                metadata: {
                  category: 'total_timeout',
                  message: `timed out after ${config.timeout_ms}ms`,
                  phase: 'manager',
                  retryable: false,
                  partial_result_available: false,
                  details: { timeout_ms: String(config.timeout_ms) },
                },
                fallbackError: `timed out after ${config.timeout_ms}ms`,
              });
              this.transitionToStopping(task, `timed out after ${config.timeout_ms}ms`, cwd);
              this.notifyTaskUpdate(id, onTaskUpdate, true);
              controller.abort();
              reject(new Error(`timed out after ${config.timeout_ms}ms`));
            }, config.timeout_ms);
          });
          const abortPromise = new Promise<never>((_resolve, reject) => {
            if (controller.signal.aborted) reject(new Error('Subagent was aborted'));
            else controller.signal.addEventListener('abort', () => reject(new Error('Subagent was aborted')), { once: true });
          });
          result = await Promise.race([runnerPromise, timeoutPromise, abortPromise]);
          await activeRunnerSettlement;
          activeRunnerSettlement = undefined;
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
          if ((task as SubagentTask).status === 'stopping') {
            this.finalizeStop(task, parentSessionId, cwd, onTaskUpdate);
            await this.runTerminalCleanups(task, parentSessionId, ctx);
            return;
          }
          if (isTerminalStatus(task.status)) {
            await this.runTerminalCleanups(task, parentSessionId, ctx);
            return;
          }

          const interactionRequest = result.interaction_request;
          if (!interactionRequest) break;
          subagentAuditLog(cwd, 'interaction_bridge_request_detected', { taskId: id, agent: definition.name, ...interactionLogFields(interactionRequest) });
          if (task.mode === 'background') {
            subagentAuditLog(cwd, 'interaction_bridge_background_blocked', { taskId: id, agent: definition.name, ...interactionLogFields(interactionRequest) });
            throw new Error('Subagent interaction requires main-thread handling; rerun in task mode to answer it.');
          }
          interactionsHandled += 1;
          if (interactionsHandled > 5) throw new Error('Subagent interaction retry limit exceeded.');

          task.result = sanitizeInteractionTransportText(result.result);
          task.output_preview = compactOutput(result.result);
          task.transcript = sanitizeInteractionTransportText(`${task.transcript ?? ''}\n\n# interaction request surfaced to orchestrator\n\n${result.result}`.trim());
          task.last_activity = 'interaction required; awaiting main-thread response';
          task.last_activity_at = nowIso();
          task.usage = result.usage ?? task.usage;
          if (result.system_prompt ?? task.system_prompt) task.system_prompt = sanitizeInteractionTransportText(result.system_prompt ?? task.system_prompt!);
          task.model = result.model;
          task.effort = result.effort ?? task.effort;
          task.fallback_used = result.fallback_used;
          if (result.thread_snapshot) task.thread_snapshot = sanitizeUnknown(result.thread_snapshot);
          if (result.nested_session_path) task.nested_session_path = result.nested_session_path;
          task.interaction_request = interactionRequest;
          this.record(cwd, task, task.last_activity, true);
          this.notifyTaskUpdate(id, onTaskUpdate, true);

          subagentAuditLog(cwd, 'interaction_bridge_prompt_main_thread', { taskId: id, agent: definition.name, ...interactionLogFields(interactionRequest) });
          this.onInteractionPromptActive?.(true);
          let response: ReturnType<typeof publishInteractionResponse>;
          try {
            response = publishInteractionResponse(await promptMainThreadForInteraction(ctx, interactionRequest));
          } finally {
            this.onInteractionPromptActive?.(false);
          }
          subagentAuditLog(cwd, 'interaction_bridge_user_response', { taskId: id, agent: definition.name, requestId: interactionRequest.requestId, status: response.status });
          if (response.status === 'cancelled') throw new Error(`Subagent interaction cancelled by main user: ${interactionRequest.requestId}`);
          if (response.status === 'failed') throw new Error(`Subagent interaction failed: ${response.error ?? interactionRequest.requestId}`);
          task.last_activity = 'interaction answered by main user; retrying subagent';
          delete task.interaction_request;
          task.last_activity_at = nowIso();
          this.record(cwd, task, task.last_activity, true);
          this.notifyTaskUpdate(id, onTaskUpdate, true);
        }

        if (!result) throw new Error('Subagent finished without a result.');
        const finalResult = sanitizeInteractionTransportText(result.result ?? '');
        if (!finalResult.trim()) throw new Error('Subagent finished without a final response.');
        this.stopDispositions.delete(id);
        this.closeTaskLiveState(task);
        task.status = 'completed';
        delete task.stop_reason;
        delete task.live_activity;
        task.result = finalResult;
        task.output_preview = compactOutput(finalResult);
        task.transcript = sanitizeInteractionTransportText(`${task.transcript ?? ''}\n\n# response sent to orchestrator\n\n${finalResult}`.trim());
        task.last_activity = 'completed';
        task.last_activity_at = nowIso();
        task.usage = result.usage ?? task.usage;
        if (result.system_prompt ?? task.system_prompt) task.system_prompt = sanitizeInteractionTransportText(result.system_prompt ?? task.system_prompt!);
        task.model = result.model;
        task.effort = result.effort ?? task.effort;
        task.fallback_used = result.fallback_used;
        if (result.thread_snapshot) task.thread_snapshot = sanitizeUnknown(result.thread_snapshot);
        if (result.nested_session_path) task.nested_session_path = result.nested_session_path;
        delete task.interaction_request;
        task.ended_at = task.last_activity_at;
        this.record(cwd, task, 'completed', true);
        this.notifyTaskUpdate(id, onTaskUpdate, true);
        await this.runTerminalCleanups(task, parentSessionId, ctx);
        if (task.mode === 'background') {
          ctx?.ui?.notify?.(`Subagent ${definition.name} completed: ${id}`, 'info');
          this.onTerminalBackgroundTask?.(task, cwd);
        }
      } catch (error) {
        if (task.status === 'stopping') {
          await activeRunnerSettlement?.catch(() => undefined);
          activeRunnerSettlement = undefined;
          this.finalizeStop(task, parentSessionId, cwd, onTaskUpdate);
          await this.runTerminalCleanups(task, parentSessionId, ctx);
          if (task.mode === 'background') this.onTerminalBackgroundTask?.(task, cwd);
          return;
        }
        if (isTerminalStatus(task.status)) {
          await this.runTerminalCleanups(task, parentSessionId, ctx);
          return;
        }
        this.stopDispositions.delete(id);
        task.status = 'failed';
        delete task.live_activity;
        delete task.stop_reason;
        const metadata = timedOut
          ? normalizeErrorMetadata({
              category: 'total_timeout',
              message: `timed out after ${config.timeout_ms}ms`,
              phase: 'manager',
              retryable: false,
              partial_result_available: hasPartialResult(task),
              details: { timeout_ms: String(config.timeout_ms) },
            })
          : error instanceof SubagentStructuredError
            ? error.error_metadata
            : classifyThrownError(error, { phase: 'manager' });
        task.error_metadata = enrichTerminalMetadata(task, parentSessionId, metadata);
        task.error = timedOut || error instanceof SubagentStructuredError
          ? deriveErrorString(task.error_metadata)
          : error instanceof Error ? error.message : String(error);
        this.closeTaskLiveState(task);
        task.last_activity = `failed: ${task.error}`;
        task.last_activity_at = nowIso();
        task.ended_at = task.last_activity_at;
        this.record(cwd, task, task.last_activity, true);
        this.notifyTaskUpdate(id, onTaskUpdate, true);
        await this.runTerminalCleanups(task, parentSessionId, ctx);
        ctx?.ui?.notify?.(`Subagent ${definition.name} failed: ${task.error}`, 'warning');
        if (task.mode === 'background') this.onTerminalBackgroundTask?.(task, cwd);
      } finally {
        if (timeout) clearTimeout(timeout);
        await activeRunnerSettlement?.catch(() => undefined);
        if (acquired) limiter.release();
        this.clearLiveBridge(id, task.attempt ?? 1);
        parentSignal?.removeEventListener('abort', abortFromParent);
        this.controllers.delete(id);
      }
    };
    const settlement = run().finally(() => this.runnerSettlements.delete(id));
    this.runnerSettlements.set(id, settlement);
    void settlement;
  }

  private async awaitRunnerCleanup(taskId: string): Promise<void> {
    const pending = this.runnerSettlements.get(taskId);
    if (!pending) return;
    await pending.catch(() => undefined);
  }

  private cachedPersistedSessionTasks(cwd: string, sessionId: string): SubagentTask[] {
    const key = `${cwd}\0${sessionId}`;
    const cached = this.sessionTaskCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.tasks;
    try {
      const listMetadata = (this.history as any).listSessionTaskMetadata as ((cwd: string, sessionId: string, limit?: number) => SubagentTask[]) | undefined;
      const tasks = typeof listMetadata === 'function'
        ? listMetadata.call(this.history, cwd, sessionId, 100)
        : this.history.listSessionTasks(cwd, sessionId, 100, { includeSnapshots: false });
      this.sessionTaskCache.set(key, { expiresAt: Date.now() + SESSION_TASK_CACHE_MS, tasks });
      return tasks;
    } catch (error) {
      if (isSqliteBusyError(error)) return cached?.tasks ?? [];
      throw error;
    }
  }

  private invalidateSessionTaskCache(cwd: string, task: SubagentTask): void {
    if (task.session_id) this.sessionTaskCache.delete(`${cwd}\0${task.session_id}`);
  }

  private record(cwd: string, task: SubagentTask, activity: string, immediate = false): void {
    if (!immediate && (task.status === 'stopping' || isTerminalStatus(task.status))) return;
    if (immediate) {
      this.flushRecord(task.id);
      this.recordNow(cwd, task, activity);
      return;
    }
    const pending = this.pendingRecords.get(task.id);
    if (pending) {
      pending.cwd = cwd;
      pending.task = task;
      pending.activity = activity;
      return;
    }
    const timer = setTimeout(() => this.flushRecord(task.id), ACTIVITY_RECORD_FLUSH_MS);
    timer.unref?.();
    this.pendingRecords.set(task.id, { cwd, task, activity, timer });
  }

  private flushRecord(taskId: string): void {
    const pending = this.pendingRecords.get(taskId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRecords.delete(taskId);
    this.recordNow(pending.cwd, pending.task, pending.activity);
  }

  private recordNow(cwd: string, task: SubagentTask, activity: string): void {
    try {
      this.invalidateSessionTaskCache(cwd, task);
      this.history.upsertTask(cwd, task);
      this.history.addEvent(cwd, task, activity);
    } catch {
      // History should never break delegation.
    }
  }

  private notifyTaskUpdate(taskId: string, onTaskUpdate: (() => void) | undefined, immediate = false): void {
    const notify = () => {
      onTaskUpdate?.();
      for (const listener of this.taskUpdateListeners) listener();
    };
    const task = this.tasks.get(taskId);
    if (!immediate && task && (task.status === 'stopping' || isTerminalStatus(task.status))) return;
    if (immediate) {
      const pending = this.pendingUpdates.get(taskId);
      if (pending) clearTimeout(pending);
      this.pendingUpdates.delete(taskId);
      notify();
      return;
    }
    if (!onTaskUpdate && !this.taskUpdateListeners.size) return;
    if (this.pendingUpdates.has(taskId)) return;
    const timer = setTimeout(() => {
      this.pendingUpdates.delete(taskId);
      notify();
    }, ACTIVITY_UPDATE_FLUSH_MS);
    timer.unref?.();
    this.pendingUpdates.set(taskId, timer);
  }

  private async wait(id: string): Promise<void> {
    await this.awaitRunnerCleanup(id);
    while (true) {
      const task = this.tasks.get(id);
      if (!task) throw new Error(`Subagent task not found: ${id}`);
      if (isTerminalStatus(task.status)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
