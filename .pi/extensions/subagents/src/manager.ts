import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { getSubagent, loadSubagents, readSubagentsConfig } from './config.js';
import { sdkSubagentRunner } from './runner.js';
import { SubagentHistoryStore } from './history.js';
import { sanitizePermissionTransportText } from './permission-channel.js';
import { resolveEffectiveSubagentProfile } from './profile-resolver.js';
import type { PermissionRequiredPayload } from './permission-channel.js';
import type { ModelRef, SubagentRunInput, SubagentRunner, SubagentTask } from './types.js';

function nowIso(): string { return new Date().toISOString(); }
function taskId(agent: string): string { return `subtask_${agent}_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`; }
function subagentAuditLog(cwd: string | undefined, event: string, data: Record<string, unknown>): void {
  try {
    const root = cwd ?? process.cwd();
    const file = join(root, '.pi', 'subagents-debug.log');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    appendFileSync(file, `${new Date().toISOString()} ${event} ${JSON.stringify(data, (_key, value) => value instanceof Error ? { name: value.name, message: value.message } : value).slice(0, 4000)}\n`);
  } catch {}
}

function permissionLogFields(payload: PermissionRequiredPayload | undefined): Record<string, unknown> {
  if (!payload) return { hasPermissionRequest: false };
  return {
    hasPermissionRequest: true,
    requestId: payload.requestId,
    tool: payload.tool,
    action: payload.action,
    origin: payload.origin,
    reasonCode: payload.reasonCode,
    riskLevel: payload.riskLevel,
    requester: payload.requester,
    hasSessionScope: Boolean(payload.sessionScope),
    hasProjectScope: Boolean(payload.projectScope),
    hasSafeTarget: Boolean(payload.prompt?.safeTarget),
    hasSafeCommandSummary: Boolean(payload.prompt?.safeCommandSummary),
  };
}

function compactOutput(text: string, limit = 800): string {
  const normalized = sanitizePermissionTransportText(text).replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `…${normalized.slice(-limit)}` : normalized;
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

const MAIN_THREAD_APPROVAL_REGISTRY_KEY = Symbol.for('pi.permissionGuard.mainThreadApprovals');
const APPROVAL_CHOICES = ['Allow once', 'Allow for session', 'Allow for project', 'Deny'] as const;
type ApprovalChoice = typeof APPROVAL_CHOICES[number];

function sanitizeUnknown<T>(value: T): T {
  if (typeof value === 'string') return sanitizePermissionTransportText(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sanitizeUnknown(entry)])) as T;
}

function mainThreadApprovalRegistry(): Map<string, unknown> {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[MAIN_THREAD_APPROVAL_REGISTRY_KEY];
  if (existing instanceof Map) return existing;
  const registry = new Map<string, unknown>();
  holder[MAIN_THREAD_APPROVAL_REGISTRY_KEY] = registry;
  return registry;
}

function approvalPromptMessage(payload: PermissionRequiredPayload): string {
  const prompt = payload.prompt ?? {};
  const lines = [prompt.title ?? 'Permission required', '', prompt.message ?? payload.reason ?? 'A subagent requested permission.'];
  const requester = payload.requester?.subagentName ?? payload.requester?.subagentId;
  if (requester) lines.push('', `Requested by: ${requester}`);
  if (prompt.safeTarget) lines.push('', `Target: ${prompt.safeTarget}`);
  if (prompt.safeCommandSummary) lines.push('', `Command: ${prompt.safeCommandSummary}`);
  if (prompt.workspaceRoot) lines.push('', `Workspace: ${prompt.workspaceRoot}`);
  if (payload.projectScope?.safeCommandPattern) lines.push('', `Project safe pattern: ${payload.projectScope.safeCommandPattern}`);
  if (prompt.limitations?.length) lines.push('', ...prompt.limitations);
  return lines.join('\n');
}

async function promptMainThreadForPermission(ctx: any, payload: PermissionRequiredPayload): Promise<ApprovalChoice> {
  const select = ctx?.ui?.select;
  if (typeof select !== 'function') throw new Error('Subagent permission requires main-thread approval, but no interactive UI is available.');
  const choice = await select(approvalPromptMessage(payload), [...APPROVAL_CHOICES]);
  return APPROVAL_CHOICES.includes(choice) ? choice : 'Deny';
}

function registerMainThreadApproval(payload: PermissionRequiredPayload, choice: Exclude<ApprovalChoice, 'Deny' | 'Allow for project'>): void {
  const scope = payload.sessionScope;
  if (!scope) throw new Error('Subagent permission approval cannot be retried because the request did not include a session scope.');
  const mode = choice === 'Allow once' ? 'once' : 'session';
  const cacheKey = `external:${mode}:${scope.cacheKey}`;
  mainThreadApprovalRegistry().set(cacheKey, {
    cacheKey,
    mode,
    sourceCacheKey: scope.cacheKey,
    action: scope.action,
    tool: scope.tool,
    targetPattern: scope.targetPattern,
    commandPattern: scope.commandPattern,
    policyIdentity: scope.policyIdentity,
    createdAt: nowIso(),
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function addProjectSafeCommandPattern(cwd: string, pattern: string): Promise<void> {
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
}

async function registerProjectApproval(cwd: string, payload: PermissionRequiredPayload): Promise<void> {
  const pattern = payload.projectScope?.safeCommandPattern;
  if (!pattern) throw new Error('Subagent permission approval cannot be saved for the project because no safe project command pattern was provided.');
  await addProjectSafeCommandPattern(cwd, pattern);
  if (payload.sessionScope) registerMainThreadApproval(payload, 'Allow once');
}

function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return {
    async acquire() {
      if (active < max) {
        active += 1;
        return;
      }
      await new Promise<void>((resolve) => queue.push(resolve));
      active += 1;
    },
    release() {
      active = Math.max(0, active - 1);
      queue.shift()?.();
    },
  };
}

export class SubagentManager {
  private tasks = new Map<string, SubagentTask>();
  private taskCwds = new Map<string, string>();
  private controllers = new Map<string, AbortController>();
  private limiters = new Map<string, ReturnType<typeof createLimiter>>();

  constructor(
    private runner: SubagentRunner = sdkSubagentRunner,
    private history = new SubagentHistoryStore(),
    private onTerminalBackgroundTask?: (task: SubagentTask) => void,
  ) {}

  listAgents(cwd: string) {
    return loadSubagents(cwd).map((a) => ({ name: a.name, description: a.description, filePath: a.filePath, tools: a.tools, model: a.model, effort: a.effort }));
  }

  listTasks(cwd?: string) {
    const active = [...this.tasks.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (!cwd) return active;
    const activeIds = new Set(active.map((task) => task.id));
    const persisted = this.history.listTasks(cwd).filter((task) => !activeIds.has(task.id));
    return [...active, ...persisted].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  listSessionTasks(cwd?: string, sessionId?: string) {
    const active = [...this.tasks.values()]
      .filter((task) => (!cwd || this.taskCwds.get(task.id) === cwd) && (!sessionId || task.session_id === sessionId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (!cwd || !sessionId) return active;
    const activeIds = new Set(active.map((task) => task.id));
    const persisted = this.history.listSessionTasks(cwd, sessionId).filter((task) => !activeIds.has(task.id));
    return [...active, ...persisted].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  getTask(id: string, cwd?: string) {
    return this.tasks.get(id) ?? (cwd ? this.history.getTask(cwd, id) : undefined);
  }

  cancelRunning(reason = 'cancelled'): SubagentTask[] {
    return [...this.tasks.values()]
      .filter((task) => task.status === 'queued' || task.status === 'running')
      .map((task) => this.cancel(task.id, reason));
  }

  hasRunning(): boolean {
    return [...this.tasks.values()].some((task) => task.status === 'queued' || task.status === 'running');
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
  ): Promise<{ mode: 'task' | 'background'; task_ids: string[]; results?: SubagentTask[] }> {
    const cwd = ctx?.cwd ?? process.cwd();
    const agents = input.agents?.length ? input.agents : input.agent ? [input.agent] : [];
    if (!agents.length) throw new Error('subagent_run requires agent or agents.');
    const mode = input.mode ?? 'task';
    const config = readSubagentsConfig(cwd);
    const limiter = this.limiter(cwd, config.max_concurrency);
    let ids: string[] = [];
    const notifyUpdate = () => onTaskUpdate?.(ids.map((id) => this.tasks.get(id)!).filter(Boolean));
    ids = agents.map((agent) => this.startOne(agent, input.task, input.context, mode, ctx, parentSignal, notifyUpdate, limiter));
    notifyUpdate();
    if (mode === 'background') return { mode, task_ids: ids };
    await Promise.all(ids.map((id) => this.wait(id)));
    if (parentSignal?.aborted) throw new Error('Subagent run aborted');
    return { mode, task_ids: ids, results: ids.map((id) => this.tasks.get(id)!) };
  }

  cancel(id: string, reason = 'cancelled'): SubagentTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Subagent task not found: ${id}`);
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return task;
    this.controllers.get(id)?.abort();
    task.status = 'cancelled';
    task.last_activity = task.output_preview ? `${reason}; partial output preserved` : reason;
    task.last_activity_at = nowIso();
    task.ended_at = task.last_activity_at;
    const cwd = this.taskCwds.get(id);
    if (cwd) this.record(cwd, task, task.last_activity);
    return task;
  }

  private startOne(
    agentName: string,
    taskText: string,
    context: string | undefined,
    mode: 'task' | 'background',
    ctx: any,
    parentSignal?: AbortSignal,
    onTaskUpdate?: () => void,
    limiter = createLimiter(1),
  ): string {
    const cwd = ctx?.cwd ?? process.cwd();
    const session_id = sessionIdFromContext(ctx);
    const definition = getSubagent(cwd, agentName);
    if (!definition) throw new Error(`Subagent not found: ${agentName}`);
    const config = readSubagentsConfig(cwd);
    const effectiveProfile = resolveEffectiveSubagentProfile({ agentName: definition.name, definition, config, ctx });
    const id = taskId(definition.name);
    const controller = new AbortController();
    const task: SubagentTask = {
      id,
      agent: definition.name,
      mode,
      status: 'queued',
      task: taskText,
      context,
      model: modelRefLabel(effectiveProfile.model.value),
      effort: effectiveProfile.effort.value,
      model_source: effectiveProfile.model.source,
      effort_source: effectiveProfile.effort.source,
      created_at: nowIso(),
      session_id,
      last_activity_at: nowIso(),
      last_activity: 'queued',
    };
    this.tasks.set(id, task);
    this.taskCwds.set(id, cwd);
    this.controllers.set(id, controller);
    const abortFromParent = () => this.cancel(id, 'cancelled by parent abort');
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    this.record(cwd, task, 'queued');
    onTaskUpdate?.();

    const run = async () => {
      let timeout: NodeJS.Timeout | undefined;
      let timedOut = false;
      let acquired = false;
      try {
        await limiter.acquire();
        acquired = true;
        if (controller.signal.aborted) return;
        task.status = 'running';
        task.started_at = nowIso();
        task.last_activity_at = task.started_at;
        task.last_activity = 'started';
        this.record(cwd, task, 'started');
        onTaskUpdate?.();
        let approvalsHandled = 0;
        let result: Awaited<ReturnType<SubagentRunner>> | undefined;
        while (true) {
          const runnerPromise = this.runner({
            definition,
            task: taskText,
            context,
            cwd,
            ctx,
            config,
            signal: controller.signal,
            effectiveProfile,
            onActivity: (activity) => {
              task.last_activity_at = nowIso();
              task.last_activity = activity.message;
              if (activity.output) task.output_preview = compactOutput(activity.output);
              if (activity.prompt) task.prompt = sanitizePermissionTransportText(activity.prompt);
              if (activity.transcript) task.transcript = sanitizePermissionTransportText(activity.transcript);
              if (activity.usage) task.usage = activity.usage;
              if (activity.effort) task.effort = activity.effort;
              if (activity.thread_snapshot) task.thread_snapshot = sanitizeUnknown(activity.thread_snapshot);
              if (activity.permission_request) task.permission_request = activity.permission_request;
              this.record(cwd, task, activity.message);
              onTaskUpdate?.();
            },
          });
          runnerPromise.catch(() => {});
          const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              timedOut = true;
              controller.abort();
              reject(new Error(`timed out after ${config.timeout_ms}ms`));
            }, config.timeout_ms);
          });
          const abortPromise = new Promise<never>((_resolve, reject) => {
            if (controller.signal.aborted) reject(new Error('Subagent was aborted'));
            else controller.signal.addEventListener('abort', () => reject(new Error('Subagent was aborted')), { once: true });
          });
          result = await Promise.race([runnerPromise, timeoutPromise, abortPromise]);
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
          if ((task as SubagentTask).status === 'cancelled') return;

          const permissionRequired = result.permission_request;
          if (!permissionRequired) {
            if (/Permission approval must be collected by the main thread|permission_required:/i.test(result.result ?? '')) {
              subagentAuditLog(cwd, 'permission_bridge_payload_missing', { taskId: id, agent: definition.name, attempts: approvalsHandled, resultHasText: Boolean(result.result) });
            }
            break;
          }
          subagentAuditLog(cwd, 'permission_bridge_request_detected', { taskId: id, agent: definition.name, ...permissionLogFields(permissionRequired) });
          if (mode === 'background') {
            subagentAuditLog(cwd, 'permission_bridge_background_blocked', { taskId: id, agent: definition.name, ...permissionLogFields(permissionRequired) });
            throw new Error('Subagent permission requires main-thread approval; rerun in task mode to approve or deny it.');
          }
          approvalsHandled += 1;
          if (approvalsHandled > 5) throw new Error('Subagent permission approval retry limit exceeded.');

          task.result = sanitizePermissionTransportText(result.result);
          task.output_preview = compactOutput(result.result);
          task.transcript = sanitizePermissionTransportText(`${task.transcript ?? ''}\n\n# permission request surfaced to orchestrator\n\n${result.result}`.trim());
          task.last_activity = 'permission required; awaiting main-thread decision';
          task.last_activity_at = nowIso();
          task.usage = result.usage ?? task.usage;
          task.model = result.model;
          task.effort = result.effort ?? task.effort;
          task.fallback_used = result.fallback_used;
          if (result.thread_snapshot) task.thread_snapshot = sanitizeUnknown(result.thread_snapshot);
          task.permission_request = permissionRequired;
          this.record(cwd, task, task.last_activity);
          onTaskUpdate?.();

          subagentAuditLog(cwd, 'permission_bridge_prompt_main_thread', { taskId: id, agent: definition.name, ...permissionLogFields(permissionRequired) });
          const choice = await promptMainThreadForPermission(ctx, permissionRequired);
          subagentAuditLog(cwd, 'permission_bridge_user_choice', { taskId: id, agent: definition.name, choice, requestId: permissionRequired.requestId, reasonCode: permissionRequired.reasonCode });
          if (choice === 'Deny') throw new Error(`Subagent permission denied by main user: ${permissionRequired.reasonCode ?? permissionRequired.reason ?? 'permission_required'}`);
          if (choice === 'Allow for project') await registerProjectApproval(cwd, permissionRequired);
          else registerMainThreadApproval(permissionRequired, choice);
          task.last_activity = `${choice} approved by main user; retrying subagent`;
          delete task.permission_request;
          task.last_activity_at = nowIso();
          this.record(cwd, task, task.last_activity);
          onTaskUpdate?.();
        }

        if (!result) throw new Error('Subagent finished without a result.');
        task.status = 'completed';
        task.result = sanitizePermissionTransportText(result.result);
        task.output_preview = compactOutput(result.result);
        task.transcript = sanitizePermissionTransportText(`${task.transcript ?? ''}\n\n# response sent to orchestrator\n\n${result.result}`.trim());
        task.last_activity = 'completed';
        task.last_activity_at = nowIso();
        task.usage = result.usage ?? task.usage;
        task.model = result.model;
        task.effort = result.effort ?? task.effort;
        task.fallback_used = result.fallback_used;
        if (result.thread_snapshot) task.thread_snapshot = sanitizeUnknown(result.thread_snapshot);
        delete task.permission_request;
        task.ended_at = task.last_activity_at;
        this.record(cwd, task, 'completed');
        onTaskUpdate?.();
        if (mode === 'background') {
          ctx?.ui?.notify?.(`Subagent ${definition.name} completed: ${id}`, 'info');
          this.onTerminalBackgroundTask?.(task);
        }
      } catch (error) {
        if ((task as SubagentTask).status === 'cancelled') return;
        task.status = 'failed';
        task.error = timedOut ? `timed out after ${config.timeout_ms}ms` : error instanceof Error ? error.message : String(error);
        task.last_activity = `failed: ${task.error}`;
        task.last_activity_at = nowIso();
        task.ended_at = task.last_activity_at;
        this.record(cwd, task, task.last_activity);
        onTaskUpdate?.();
        ctx?.ui?.notify?.(`Subagent ${definition.name} failed: ${task.error}`, 'warning');
        if (mode === 'background') this.onTerminalBackgroundTask?.(task);
      } finally {
        if (timeout) clearTimeout(timeout);
        if (acquired) limiter.release();
        parentSignal?.removeEventListener('abort', abortFromParent);
        this.controllers.delete(id);
      }
    };
    void run();
    return id;
  }

  private record(cwd: string, task: SubagentTask, activity: string): void {
    try {
      this.history.upsertTask(cwd, task);
      this.history.addEvent(cwd, task, activity);
    } catch {
      // History should never break delegation.
    }
  }

  private async wait(id: string): Promise<void> {
    while (true) {
      const task = this.tasks.get(id);
      if (!task) throw new Error(`Subagent task not found: ${id}`);
      if (['completed', 'failed', 'cancelled'].includes(task.status)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
