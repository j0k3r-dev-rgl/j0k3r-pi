export const SUPERVISOR_CHECKPOINT_CHANNEL = 'memory:supervisor:checkpoint:v1';

export interface ActiveTaskEntry {
  taskId: string;
  attempt?: number;
  parentSessionId: string;
  agent?: string;
  cwd?: string;
  startedAt: number;
}

/**
 * In-process registry tracking active subagent tasks fed by `pi.events`.
 *
 * Scoped to the parent session via `parentSessionId`.
 * - `subagents:task:allocate` adds task (taskId + attempt).
 * - `subagents:task:terminal` removes task.
 */
export class SubagentTaskRegistry {
  private activeTasks = new Map<string, ActiveTaskEntry>(); // taskId -> ActiveTaskEntry
  private unsubs: Array<() => void> = [];

  attach(events: any): () => void {
    if (!events || typeof events.on !== 'function') {
      return () => {};
    }

    const unsubAllocate = events.on('subagents:task:allocate', (event: any) => {
      if (!event || !event.taskId) return;
      const parentSessionId = event.parentSessionId;
      if (typeof parentSessionId !== 'string' || parentSessionId.length === 0) return;

      this.activeTasks.set(event.taskId, {
        taskId: event.taskId,
        attempt: event.attempt ?? 1,
        parentSessionId,
        agent: event.agent,
        cwd: event.cwd,
        startedAt: Date.now(),
      });
    });

    const unsubTerminal = events.on('subagents:task:terminal', (event: any) => {
      if (!event || !event.taskId) return;
      this.activeTasks.delete(event.taskId);
    });

    const cleanup = () => {
      try { unsubAllocate?.(); } catch {}
      try { unsubTerminal?.(); } catch {}
    };
    this.unsubs.push(cleanup);
    return cleanup;
  }

  getActiveTasksForSession(parentSessionId: string): ActiveTaskEntry[] {
    const results: ActiveTaskEntry[] = [];
    for (const task of this.activeTasks.values()) {
      if (task.parentSessionId === parentSessionId) {
        results.push({ ...task });
      }
    }
    return results;
  }

  hasActiveTasksForSession(parentSessionId: string): boolean {
    for (const task of this.activeTasks.values()) {
      if (task.parentSessionId === parentSessionId) {
        return true;
      }
    }
    return false;
  }

  recordTask(entry: ActiveTaskEntry): void {
    this.activeTasks.set(entry.taskId, { ...entry });
  }

  retireTask(taskId: string): void {
    this.activeTasks.delete(taskId);
  }

  clear(): void {
    this.activeTasks.clear();
  }

  dispose(): void {
    for (const u of this.unsubs) {
      try { u(); } catch {}
    }
    this.unsubs = [];
    this.activeTasks.clear();
  }
}

export const defaultSubagentTaskRegistry = new SubagentTaskRegistry();

export function toolText(result: any): string {
  return (result?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
}

export function toolData(result: any): any {
  if (result?.isError) throw new Error(toolText(result) || 'Existing tool failed');
  if (result?.details?.data) return result.details.data;
  try { return JSON.parse(toolText(result)); }
  catch { throw new Error('Existing memory tool returned an unsupported response'); }
}

export async function existingTool(ctx: any, name: string, args: any): Promise<any> {
  if (!ctx.tools?.some((t: any) => t.name === name) || typeof ctx.executeTool !== 'function') {
    throw new Error(`Required existing tool is unavailable: ${name}`);
  }
  const outcome = await ctx.executeTool(name, args);
  if (outcome.isError) throw new Error(toolText(outcome.result) || `${name} failed`);
  if (!outcome.result || !Array.isArray(outcome.result.content)) throw new Error(`${name} returned an unsupported execution outcome`);
  return outcome.result;
}

export async function saveMemoryCheckpoint(
  events: any,
  options: { cwd: string; sessionId?: string; title: string; content: string; type?: string; id?: number },
  timeoutMs = 10000,
): Promise<{ ok: boolean; id?: number; readbackVerified?: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'save_checkpoint_timeout' });
      }
    }, timeoutMs);

    const respond = (res: any) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(res);
      }
    };

    try {
      events.emit(SUPERVISOR_CHECKPOINT_CHANNEL, {
        action: 'save',
        cwd: options.cwd,
        sessionId: options.sessionId ?? '',
        title: options.title,
        content: options.content,
        type: options.type ?? 'session_summary',
        id: options.id,
        respond,
      });
    } catch (err: any) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      }
    }
  });
}

export async function getMemoryCheckpoint(
  events: any,
  options: { cwd: string; sessionId?: string; id: number },
  timeoutMs = 10000,
): Promise<{ ok: boolean; id?: number; content?: string; type?: string; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'get_checkpoint_timeout' });
      }
    }, timeoutMs);

    const respond = (res: any) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(res);
      }
    };

    try {
      events.emit(SUPERVISOR_CHECKPOINT_CHANNEL, {
        action: 'get',
        cwd: options.cwd,
        sessionId: options.sessionId ?? '',
        id: options.id,
        respond,
      });
    } catch (err: any) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      }
    }
  });
}

/**
 * Asserts that all delegated subagent tasks for the current parent session are settled.
 * Scoped to `parentSessionId`.
 * Fails closed if session identity or registry is unavailable.
 */
export async function assertWorkSettled(ctx: any, registry?: SubagentTaskRegistry): Promise<void> {
  const reg = registry !== undefined ? registry : (ctx?.taskRegistry !== undefined ? ctx.taskRegistry : defaultSubagentTaskRegistry);
  const sessionId = typeof ctx === 'string' ? ctx : (ctx?.sessionId ?? ctx?.sessionManager?.getSessionId?.());

  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Rotation deferred: cannot verify active tasks (unknown session identity)');
  }
  if (!reg || typeof reg.hasActiveTasksForSession !== 'function') {
    throw new Error('Rotation deferred: cannot verify active tasks (subagent task registry unavailable)');
  }

  if (reg.hasActiveTasksForSession(sessionId)) {
    const active = reg.getActiveTasksForSession(sessionId).map((t: ActiveTaskEntry) => t.taskId);
    throw new Error(`Rotation deferred: active tasks (${active.join(', ')})`);
  }
}

export async function verifiedCheckpoint(
  ctx: any,
  params: { summary?: string; memory_id?: number },
): Promise<{ id: number; content: string }> {
  let id = params.memory_id;
  const events = ctx?.events || ctx?.pi?.events;
  const cwd = ctx?.cwd ?? process.cwd();
  const sessionId = ctx?.sessionId ?? ctx?.sessionManager?.getSessionId?.() ?? '';
  const hasEventListener = Boolean(events && typeof events.emit === 'function' &&
    (typeof events.listenerCount !== 'function' || events.listenerCount(SUPERVISOR_CHECKPOINT_CHANNEL) > 0));

  if (params.summary !== undefined) {
    const summary = params.summary.trim();
    if (!summary || summary.length > 12000) {
      throw new Error('Checkpoint summary must contain 1–12000 characters');
    }

    if (hasEventListener) {
      const saveRes = await saveMemoryCheckpoint(events, {
        cwd,
        sessionId,
        title: 'Supervisor continuity checkpoint',
        content: summary,
        type: 'session_summary',
      });
      if (!saveRes.ok || !saveRes.readbackVerified || !saveRes.id) {
        throw new Error(`Failed to save checkpoint: ${saveRes.error || 'readback verification failed'}`);
      }
      id = saveRes.id;
    } else if (typeof ctx?.executeTool === 'function') {
      const toolName = ctx.tools?.some((t: any) => t.name === 'memory_save') ? 'memory_save' : 'memory_save';
      const saved = toolData(await existingTool(ctx, toolName, {
        title: 'Supervisor continuity checkpoint', content: summary, type: 'session_summary', capture_prompt: false,
      }));
      id = saved.id;
    } else {
      throw new Error('Cannot save checkpoint: event bus and memory tools unavailable');
    }
  }

  if (!Number.isSafeInteger(id) || id! <= 0) {
    throw new Error('Checkpoint requires a positive memory_id or a summary');
  }

  let content: string;
  let type: string | undefined;

  if (hasEventListener) {
    const getRes = await getMemoryCheckpoint(events, { cwd, sessionId, id: id! });
    if (!getRes.ok || typeof getRes.content !== 'string') {
      throw new Error(`Failed to read checkpoint: ${getRes.error || 'empty content'}`);
    }
    content = getRes.content;
    type = getRes.type;
  } else if (typeof ctx?.executeTool === 'function') {
    const data = toolData(await existingTool(ctx, 'memory_get', { id }));
    content = data.content;
    type = data.type;
  } else {
    throw new Error('Cannot verify checkpoint: event bus and memory tools unavailable');
  }

  if (typeof content !== 'string' || !content.trim() || content.length > 12000) {
    throw new Error('Checkpoint readback is empty or too large');
  }
  if (type !== 'session_summary') {
    throw new Error('Checkpoint must be a session_summary observation');
  }
  if (params.summary !== undefined && content !== params.summary.trim()) {
    throw new Error('Checkpoint readback mismatch');
  }

  return { id: id!, content };
}
