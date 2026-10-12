import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface SubagentMonitorOptions {
  dbPath?: string;
  events?: {
    on(channel: string, fn: (payload: any) => void): () => void;
  };
}

export interface FenceResult {
  satisfied: boolean;
  activeCount: number;
  reason?: string;
}

export class SubagentMonitor {
  private readonly configuredDbPath?: string;
  private readonly inMemoryActiveTasks = new Map<string, Set<string>>(); // sessionId -> Set of taskIds
  private readonly inFlightToolCalls = new Map<string, Set<string>>(); // sessionId -> Set of toolCallIds
  private readonly pendingCompletionDeliveries = new Map<string, Set<string>>(); // sessionId -> Set of taskIds
  private delegatedLaunchCount = 0;
  private unsubscribeEvents?: () => void;

  constructor(options?: SubagentMonitorOptions) {
    this.configuredDbPath = options?.dbPath;
    if (options?.events) {
      this.attachEvents(options.events);
    }
  }

  recordToolCallStart(sessionId: string, toolCallId: string, toolName: string): void {
    if (!toolName.startsWith('subagent')) return;
    this.delegatedLaunchCount++;
    if (!this.inFlightToolCalls.has(sessionId)) {
      this.inFlightToolCalls.set(sessionId, new Set());
    }
    this.inFlightToolCalls.get(sessionId)!.add(toolCallId);
  }

  recordToolCallEnd(sessionId: string, toolCallId: string): void {
    this.inFlightToolCalls.get(sessionId)?.delete(toolCallId);
  }

  expectCompletionDelivery(sessionId: string, taskId: string): void {
    this.delegatedLaunchCount++;
    if (!this.pendingCompletionDeliveries.has(sessionId)) {
      this.pendingCompletionDeliveries.set(sessionId, new Set());
    }
    this.pendingCompletionDeliveries.get(sessionId)!.add(taskId);
  }

  recordCompletionDelivery(sessionId: string, taskId?: string): void {
    const set = this.pendingCompletionDeliveries.get(sessionId);
    if (!set) return;
    if (taskId) {
      set.delete(taskId);
    } else {
      set.clear();
    }
  }

  private resolveDbPath(): string {
    if (this.configuredDbPath) {
      return this.configuredDbPath;
    }
    const env = process.env;
    if (env.PI_SUBAGENTS_HISTORY_DB_PATH) {
      return env.PI_SUBAGENTS_HISTORY_DB_PATH;
    }
    if (env.PI_SUBAGENTS_HISTORY_HOME) {
      return join(env.PI_SUBAGENTS_HISTORY_HOME, 'subagents-history.sqlite');
    }
    const xdg = env.XDG_DATA_HOME;
    if (xdg) {
      return join(xdg, 'pi', 'subagents', 'subagents-history.sqlite');
    }
    return join(homedir(), '.local', 'share', 'pi', 'subagents', 'subagents-history.sqlite');
  }

  private attachEvents(events: { on(channel: string, fn: (payload: any) => void): () => void }): void {
    const unsubs: Array<() => void> = [];

    const unalloc = events.on('subagents:task:allocate', (payload: any) => {
      const sessionId = payload?.parentSessionId ?? payload?.sessionId;
      const taskId = payload?.taskId ?? payload?.id;
      if (sessionId && taskId) {
        this.delegatedLaunchCount++;
        if (!this.inMemoryActiveTasks.has(sessionId)) {
          this.inMemoryActiveTasks.set(sessionId, new Set());
        }
        this.inMemoryActiveTasks.get(sessionId)!.add(taskId);
        if (payload?.expectCompletionDelivery === true) {
          this.expectCompletionDelivery(sessionId, taskId);
        }
      }
    });
    unsubs.push(unalloc);

    const unterm = events.on('subagents:task:terminal', (payload: any) => {
      const sessionId = payload?.parentSessionId ?? payload?.sessionId;
      const taskId = payload?.taskId ?? payload?.id;
      if (sessionId && taskId) {
        this.inMemoryActiveTasks.get(sessionId)?.delete(taskId);
        if (payload?.expectCompletionDelivery === true) {
          this.expectCompletionDelivery(sessionId, taskId);
        }
      } else if (taskId) {
        for (const set of this.inMemoryActiveTasks.values()) {
          set.delete(taskId);
        }
      }
    });
    unsubs.push(unterm);

    this.unsubscribeEvents = () => {
      for (const u of unsubs) {
        try { u(); } catch {}
      }
    };
  }

  dispose(): void {
    this.unsubscribeEvents?.();
  }

  checkFence(sessionId: string, cwd: string): FenceResult {
    // 1. In-flight subagent tool calls and in-memory event tracking
    const inFlightSet = this.inFlightToolCalls.get(sessionId);
    const inFlightCount = inFlightSet ? inFlightSet.size : 0;

    const memorySet = this.inMemoryActiveTasks.get(sessionId);
    const memoryCount = memorySet ? memorySet.size : 0;

    const pendingDeliverySet = this.pendingCompletionDeliveries.get(sessionId);
    const pendingDeliveryCount = pendingDeliverySet ? pendingDeliverySet.size : 0;

    // 2. Query SQLite history store
    const dbPath = this.resolveDbPath();
    let dbActiveCount = 0;

    if (!existsSync(dbPath)) {
      if (this.delegatedLaunchCount > 0) {
        return {
          satisfied: false,
          activeCount: Math.max(1, inFlightCount, memoryCount, pendingDeliveryCount),
          reason: 'subagent_db_missing: Cannot verify subagent completion after delegated launch',
        };
      }
    } else {
      try {
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const totalRows = db.prepare(`
            SELECT count(*) as count
            FROM subagent_tasks
            WHERE cwd = ? AND session_id = ?
          `).all(cwd, sessionId) as Array<{ count: number }>;
          const observedTotal = Number(totalRows[0]?.count ?? 0);
          if (observedTotal > 0) {
            this.delegatedLaunchCount = Math.max(this.delegatedLaunchCount, observedTotal);
          }

          const rows = db.prepare(`
            SELECT count(*) as count
            FROM subagent_tasks
            WHERE cwd = ? AND session_id = ? AND status IN ('queued', 'running', 'stopping')
          `).all(cwd, sessionId) as Array<{ count: number }>;
          dbActiveCount = Number(rows[0]?.count ?? 0);
        } finally {
          db.close();
        }
      } catch (err: any) {
        if (this.delegatedLaunchCount > 0) {
          return {
            satisfied: false,
            activeCount: 1,
            reason: `subagent_db_read_error: Cannot verify subagent completion (${err.message})`,
          };
        }
      }
    }

    const totalActive = Math.max(inFlightCount, memoryCount, dbActiveCount, pendingDeliveryCount);
    if (totalActive > 0) {
      return {
        satisfied: false,
        activeCount: totalActive,
        reason: `Holding for ${totalActive} active subagent(s) to settle cleanly`,
      };
    }

    return {
      satisfied: true,
      activeCount: 0,
    };
  }
}
