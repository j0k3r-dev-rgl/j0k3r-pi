import { getActiveSubagentCandidateIds, loadSubagentConfig } from './subagent-config.ts';
import { acquireSubagentModel, releaseSubagentModel, type SubagentPoolOwner, type SubagentPoolLeaseRef } from './subagent-pool.ts';

export type AcquireSubagentModel = (cwd: string, candidateIds: string[], owner: SubagentPoolOwner) => SubagentPoolLeaseRef;
export type ReleaseSubagentModel = (cwd: string, lease: SubagentPoolLeaseRef, owner: SubagentPoolOwner) => void;

export interface SubagentAssignmentDeps {
  acquire?: AcquireSubagentModel;
  release?: ReleaseSubagentModel;
  pid?: number;
}

export interface SubagentAllocationClaim {
  model: { provider: string; id: string };
  effort?: string;
}

export interface SubagentTaskAllocationEvent {
  taskId: string;
  attempt?: number;
  parentSessionId?: string;
  agent: string;
  cwd: string;
  signal: AbortSignal;
  claimModel: (allocator: (signal: AbortSignal) => Promise<SubagentAllocationClaim | undefined>) => void;
}

export interface SubagentTaskTerminalEvent {
  taskId: string;
  attempt?: number;
  parentSessionId?: string;
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  error?: string;
  registerCleanup: (cleanup: () => Promise<void>) => void;
}

export function splitCandidateId(id: string): { provider: string; modelId: string } | undefined {
  const separator = id.indexOf('/');
  if (separator <= 0) return undefined;
  const provider = id.slice(0, separator);
  const modelId = id.slice(separator + 1);
  if (!provider || !modelId) return undefined;
  return { provider, modelId };
}

interface ActiveTaskLease {
  lease: SubagentPoolLeaseRef;
  owner: SubagentPoolOwner;
  cwd: string;
}

/**
 * Registers subagent model allocation with local Pi event bus (`pi.events`).
 *
 * Listens to:
 * - `subagents:task:allocate`: calls `event.claimModel(async (signal) => ...)` to acquire
 *   the least-loaded candidate from `subagent-pool.ts` and return `{ model, effort }`.
 * - `subagents:task:terminal`: calls `event.registerCleanup(async () => ...)` to release
 *   the acquired lease deterministically.
 */
export function registerSubagentAssignment(
  pi: { events?: { on?: (channel: string, handler: (event: any) => void) => () => void } },
  deps?: SubagentAssignmentDeps,
): () => void {
  const acquire = deps?.acquire ?? acquireSubagentModel;
  const release = deps?.release ?? releaseSubagentModel;
  const pid = deps?.pid ?? process.pid;

  const activeTaskLeases = new Map<string, ActiveTaskLease>();

  if (!pi?.events?.on) return () => {};

  const unsubs: Array<() => void> = [];

  const unsubAllocate = pi.events.on('subagents:task:allocate', (event: SubagentTaskAllocationEvent) => {
    if (!event || typeof event.claimModel !== 'function') return;

    event.claimModel(async (signal: AbortSignal) => {
      if (signal?.aborted) return undefined;

      try {
        const load = loadSubagentConfig(event.cwd);
        if (!load.config.enabled) return undefined;

        const candidates = getActiveSubagentCandidateIds(load.config);
        if (candidates.length === 0) return undefined;

        const owner: SubagentPoolOwner = { pid, sessionId: event.taskId };
        const acquired = acquire(event.cwd, candidates, owner);
        const split = splitCandidateId(acquired.modelId);
        if (!split) {
          try { release(event.cwd, acquired, owner); } catch {}
          return undefined;
        }

        const leaseRecord: ActiveTaskLease = { lease: acquired, owner, cwd: event.cwd };
        activeTaskLeases.set(event.taskId, leaseRecord);

        // Attach abort listener for immediate cleanup on task abortion
        const onAbort = () => {
          const rec = activeTaskLeases.get(event.taskId);
          if (rec) {
            activeTaskLeases.delete(event.taskId);
            try { release(rec.cwd, rec.lease, rec.owner); } catch {}
          }
        };

        if (signal?.aborted) {
          onAbort();
          return undefined;
        }

        signal?.addEventListener?.('abort', onAbort, { once: true });

        const effort = load.config.modelEfforts?.[acquired.modelId];
        return {
          model: { provider: split.provider, id: split.modelId },
          ...(effort ? { effort } : {}),
        };
      } catch {
        return undefined;
      }
    });
  });

  if (typeof unsubAllocate === 'function') unsubs.push(unsubAllocate);

  const unsubTerminal = pi.events.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
    if (!event || !event.taskId) return;

    const cleanup = async () => {
      const rec = activeTaskLeases.get(event.taskId);
      if (rec) {
        activeTaskLeases.delete(event.taskId);
        try { release(rec.cwd, rec.lease, rec.owner); } catch {}
      }
    };

    if (typeof event.registerCleanup === 'function') {
      event.registerCleanup(cleanup);
    } else {
      void cleanup();
    }
  });

  if (typeof unsubTerminal === 'function') unsubs.push(unsubTerminal);

  return () => {
    for (const unsub of unsubs) {
      try { unsub(); } catch {}
    }
  };
}
