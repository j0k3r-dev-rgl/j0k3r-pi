import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SubagentManager } from '../src/manager.js';
import type { SubagentRunner, SubagentTaskAllocationEvent, SubagentTaskTerminalEvent } from '../src/types.js';
import { createExtensionRuntime } from '@earendil-works/pi-coding-agent';
import { createEventBus } from '@earendil-works/pi-coding-agent';

let tmp: string;
let oldAgentDir: string | undefined;
let oldHistoryDbPath: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagents-lifecycle-test-'));
  oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  oldHistoryDbPath = process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
  process.env.PI_CODING_AGENT_DIR = path.join(tmp, 'isolated-agent');
  process.env.PI_SUBAGENTS_HISTORY_DB_PATH = path.join(tmp, 'global-agent', 'subagents-history.sqlite');
  fs.mkdirSync(path.join(tmp, '.pi', 'subagents'), { recursive: true });
});

afterEach(() => {
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  if (oldHistoryDbPath === undefined) delete process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
  else process.env.PI_SUBAGENTS_HISTORY_DB_PATH = oldHistoryDbPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeAgent(name: string) {
  fs.writeFileSync(
    path.join(tmp, '.pi', 'subagents', `${name}.md`),
    `---\nname: ${name}\ndescription: ${name} agent\ntools:\n  - read\n---\n# Agent\nhello`,
  );
}

class SimpleEventBus {
  private handlers = new Map<string, Array<(data: any) => void>>();

  on(channel: string, handler: (data: any) => void): () => void {
    const list = this.handlers.get(channel) ?? [];
    list.push(handler);
    this.handlers.set(channel, list);
    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  emit(channel: string, data: any): void {
    const list = this.handlers.get(channel) ?? [];
    for (const handler of list) {
      handler(data);
    }
  }
}

describe('SubagentManager lifecycle events and cleanups', () => {
  it('emits subagents:task:allocate before runner start and applies claimed model and effort', async () => {
    writeAgent('planner');
    const bus = new SimpleEventBus();
    let allocationFired = false;
    let runnerCalledWithProfile: any;

    bus.on('subagents:task:allocate', (event: SubagentTaskAllocationEvent) => {
      allocationFired = true;
      expect(event.agent).toBe('planner');
      expect(event.attempt).toBe(1);
      expect(event.signal).toBeDefined();
      event.claimModel(async (_signal) => {
        return {
          model: { provider: 'cliproxyapi', id: 'pdas/gemini-3.8-flash-high' },
          effort: 'high',
        };
      });
    });

    const runner: SubagentRunner = async ({ effectiveProfile }) => {
      runnerCalledWithProfile = effectiveProfile;
      return { result: 'planner done', model: 'cliproxyapi/pdas/gemini-3.8-flash-high', effort: 'high' };
    };

    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);
    const result = await manager.run({ agent: 'planner', task: 'plan feature' }, { cwd: tmp });

    expect(allocationFired).toBe(true);
    expect(result.results?.[0].model).toBe('cliproxyapi/pdas/gemini-3.8-flash-high');
    expect(result.results?.[0].effort).toBe('high');
    expect(runnerCalledWithProfile?.model?.value).toEqual({ provider: 'cliproxyapi', id: 'pdas/gemini-3.8-flash-high' });
    expect(runnerCalledWithProfile?.effort?.value).toBe('high');
  });

  it('falls back cleanly to standard profile resolution when allocation is unclaimed', async () => {
    writeAgent('researcher');
    const bus = new SimpleEventBus();
    let runnerCalledWithProfile: any;

    const runner: SubagentRunner = async ({ effectiveProfile }) => {
      runnerCalledWithProfile = effectiveProfile;
      return { result: 'research done' };
    };

    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);
    const result = await manager.run({ agent: 'researcher', task: 'research topic' }, { cwd: tmp });

    expect(result.results?.[0].status).toBe('completed');
    expect(runnerCalledWithProfile).toBeDefined();
  });

  it('emits subagents:task:terminal and awaits registered cleanups before runner settlement completes', async () => {
    writeAgent('executor');
    const bus = new SimpleEventBus();
    let cleanupAwaited = false;
    let cleanupCompletedBeforeWaitReturns = false;

    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      expect(event.status).toBe('completed');
      expect(event.attempt).toBe(1);
      event.registerCleanup(async () => {
        await new Promise((r) => setTimeout(r, 50));
        cleanupAwaited = true;
      });
    });

    const runner: SubagentRunner = async () => {
      return { result: 'done' };
    };

    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);
    await manager.run({ agent: 'executor', task: 'execute code' }, { cwd: tmp });

    cleanupCompletedBeforeWaitReturns = cleanupAwaited;
    expect(cleanupCompletedBeforeWaitReturns).toBe(true);
  });

  it('emits subagents:task:terminal on task failure and awaits cleanup', async () => {
    writeAgent('failing-agent');
    const bus = new SimpleEventBus();
    let cleanupRan = false;
    let terminalStatus: string | undefined;

    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      terminalStatus = event.status;
      event.registerCleanup(async () => {
        cleanupRan = true;
      });
    });

    const runner: SubagentRunner = async () => {
      throw new Error('Explosion');
    };

    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);
    const result = await manager.run({ agent: 'failing-agent', task: 'fail hard' }, { cwd: tmp });

    expect(result.results?.[0].status).toBe('failed');
    expect(terminalStatus).toBe('failed');
    expect(cleanupRan).toBe(true);
  });

  it('emits subagents:task:terminal on background task completion and awaits cleanup', async () => {
    writeAgent('bg-worker');
    const bus = new SimpleEventBus();
    let cleanupRan = false;

    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      event.registerCleanup(async () => {
        cleanupRan = true;
      });
    });

    let completeRunner: () => void;
    const runner: SubagentRunner = async () => {
      await new Promise<void>((resolve) => { completeRunner = resolve; });
      return { result: 'bg finished' };
    };

    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);
    const runResult = await manager.run({ agent: 'bg-worker', task: 'do in bg', mode: 'background' }, { cwd: tmp });
    const bgTaskId = runResult.task_ids[0];

    expect(cleanupRan).toBe(false);
    completeRunner!();

    // Poll until cleanup completes
    for (let i = 0; i < 50; i++) {
      if (cleanupRan) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(cleanupRan).toBe(true);
  });

  it('drainOwnerSession cancels only active tasks of that session and awaits their cleanups', async () => {
    writeAgent('drain-agent');
    const bus = new SimpleEventBus();
    const cleanupsRan: string[] = [];

    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      event.registerCleanup(async () => {
        cleanupsRan.push(event.taskId);
      });
    });

    let task1Unblock: () => void;
    let task2Unblock: () => void;
    const runner: SubagentRunner = async ({ taskId, signal }) => {
      if (taskId?.includes('drain-agent')) {
        await new Promise<void>((resolve) => {
          if (cleanupsRan.length === 0 && !task1Unblock) task1Unblock = resolve;
          else task2Unblock = resolve;
          signal.addEventListener('abort', () => resolve());
        });
      }
      if (signal.aborted) throw new Error('Aborted by drain');
      return { result: 'finished' };
    };

    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);

    // Launch task in session-A
    const resA = await manager.run(
      { agent: 'drain-agent', task: 'task in session A', mode: 'background' },
      { cwd: tmp, sessionId: 'session-A' },
    );
    const taskIdA = resA.task_ids[0];

    // Launch task in session-B
    const resB = await manager.run(
      { agent: 'drain-agent', task: 'task in session B', mode: 'background' },
      { cwd: tmp, sessionId: 'session-B' },
    );
    const taskIdB = resB.task_ids[0];

    // Drain session-A
    await manager.drainOwnerSession('session-A', 'Pi session shutdown');

    expect(cleanupsRan).toContain(taskIdA);
    expect(cleanupsRan).not.toContain(taskIdB);
    const taskA = manager.getTask(taskIdA);
    const taskB = manager.getTask(taskIdB);
    expect(taskA?.status).toBe('interrupted');
    expect(taskB?.status).toBe('running');

    // Unblock session B
    task2Unblock!();
    await manager.drainOwnerSession('session-B', 'Pi session shutdown');
    expect(cleanupsRan).toContain(taskIdB);
  });

  it('drains a cancelled queued owner before sibling release, awaits cleanup, and preserves survivor FIFO/capacity', async () => {
    writeAgent('queued-owner');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ max_concurrency: 1 }));
    const bus = new SimpleEventBus();
    const allocated: string[] = [];
    const started: string[] = [];
    const signals = new Map<string, AbortSignal>();
    const finish = new Map<string, () => void>();
    let releaseCleanup!: () => void;
    let cleanupStarted!: () => void;
    const cleaning = new Promise<void>((resolve) => { cleanupStarted = resolve; });
    let cleaned = false;
    const terminalOwners: string[] = [];
    bus.on('subagents:task:allocate', (event: SubagentTaskAllocationEvent) => {
      allocated.push(event.parentSessionId!);
      event.claimModel(async () => ({ model: { provider: 'mock', id: 'allocated' } }));
    });
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      terminalOwners.push(event.parentSessionId!);
      if (event.parentSessionId === 'A') event.registerCleanup(async () => {
        cleanupStarted();
        await new Promise<void>((resolve) => { releaseCleanup = resolve; });
        cleaned = true;
      });
    });
    const manager = new SubagentManager(async ({ parentPiSessionId, signal }) => {
      const owner = parentPiSessionId!;
      started.push(owner);
      signals.set(owner, signal);
      await new Promise<void>((resolve) => { finish.set(owner, resolve); });
      return { result: `${owner} done` };
    }, undefined, undefined, undefined, bus);
    const launch = (owner: string) => manager.run(
      { agent: 'queued-owner', task: owner, mode: 'background' }, { cwd: tmp, sessionId: owner },
    );
    const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
    await launch('B');
    const a = await launch('A');
    const c = await launch('C');
    const d = await launch('D');
    const aSignal = (manager as any).controllers.get(a.task_ids[0]).signal as AbortSignal;
    const removeAbortListener = vi.spyOn(aSignal, 'removeEventListener');
    let drained = false;
    const drain = manager.drainOwnerSession('A').then(() => { drained = true; });
    try {
      await cleaning;
      await turn();
      expect(drained).toBe(false);
      expect(cleaned).toBe(false);
      expect(started).toEqual(['B']);
      releaseCleanup();
      await turn();
      expect(cleaned).toBe(true);
      expect(drained).toBe(true); // B is still gated: no dependency on its capacity.
      expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(manager.getTask(a.task_ids[0])?.status).toBe('interrupted');
      expect(allocated).toEqual(['B']);
      expect(signals.get('B')?.aborted).toBe(false);
      expect(manager.getTask(c.task_ids[0])?.status).toBe('queued');
      expect(manager.getTask(d.task_ids[0])?.status).toBe('queued');
      const e = await launch('E'); // Cancelled A must not have released an unacquired slot.
      expect(started).toEqual(['B']);
      finish.get('B')!();
      await turn();
      expect(started).toEqual(['B', 'C']);
      expect(manager.getTask(e.task_ids[0])?.status).toBe('queued');
      finish.get('C')!();
      await turn();
      expect(started).toEqual(['B', 'C', 'D']);
      finish.get('D')!();
      await turn();
      expect(started).toEqual(['B', 'C', 'D', 'E']);
      finish.get('E')!();
      await turn();
      expect(allocated).toEqual(started);
      expect(terminalOwners.filter((owner) => owner === 'A')).toEqual(['A']);
    } finally {
      releaseCleanup?.();
      // Release gates even on RED so no pending runner/timer escapes the fixture.
      for (const owner of ['B', 'C', 'D', 'E']) { finish.get(owner)?.(); await turn(); }
      await drain;
      await Promise.all(['B', 'C', 'D', 'E'].map((owner) => manager.drainOwnerSession(owner)));
    }
  });

  it.each([false, true])('already-aborted acquisition never starts or releases capacity (holder present: %s)', async (held) => {
    writeAgent('pre-aborted');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ max_concurrency: 1 }));
    const bus = new SimpleEventBus();
    const allocated: string[] = [];
    const started: string[] = [];
    const finish = new Map<string, () => void>();
    const cleaned: string[] = [];
    bus.on('subagents:task:allocate', (event: SubagentTaskAllocationEvent) => { allocated.push(event.parentSessionId!); });
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => event.registerCleanup(async () => { cleaned.push(event.parentSessionId!); }));
    const manager = new SubagentManager(async ({ parentPiSessionId }) => {
      started.push(parentPiSessionId!);
      await new Promise<void>((resolve) => { finish.set(parentPiSessionId!, resolve); });
      return { result: 'done' };
    }, undefined, undefined, undefined, bus);
    const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
    const launch = (owner: string, signal?: AbortSignal) => manager.run(
      { agent: 'pre-aborted', task: owner, mode: 'background' }, { cwd: tmp, sessionId: owner }, signal,
    );
    if (held) await launch('B');
    const parent = new AbortController();
    parent.abort();
    const a = await launch('A', parent.signal);
    let drained = false;
    const drain = manager.drainOwnerSession('A').then(() => { drained = true; });
    try {
      await turn();
      expect(drained).toBe(true);
      expect(cleaned).toEqual(['A']);
      expect(manager.getTask(a.task_ids[0])?.status).toBe('cancelled');
      await launch('C');
      await turn();
      expect(started).toEqual(held ? ['B'] : ['C']);
      if (held) { finish.get('B')!(); await turn(); }
      expect(started).toEqual(held ? ['B', 'C'] : ['C']);
      expect(allocated).toEqual(started);
    } finally {
      for (const owner of ['B', 'C']) { finish.get(owner)?.(); await turn(); }
      await drain;
      await Promise.all(['B', 'C'].map((owner) => manager.drainOwnerSession(owner)));
    }
  });

  it('returns an immediately acquired slot when cancelled before allocation or runner start', async () => {
    writeAgent('immediate-cancel');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ max_concurrency: 1 }));
    const bus = new SimpleEventBus();
    const allocated: string[] = [];
    const cleaned: string[] = [];
    bus.on('subagents:task:allocate', (event: SubagentTaskAllocationEvent) => { allocated.push(event.parentSessionId!); });
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => event.registerCleanup(async () => { cleaned.push(event.parentSessionId!); }));
    const runner = vi.fn(async () => ({ result: 'done' }));
    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);
    await manager.run(
      { agent: 'immediate-cancel', task: 'cancel', mode: 'background' }, { cwd: tmp, sessionId: 'A' }, undefined,
      (tasks) => {
        // This notification occurs after synchronous immediate acquisition but before its await resumes.
        if (tasks[0]?.status === 'queued') manager.cancel(tasks[0].id);
      },
    );
    await manager.drainOwnerSession('A');
    expect(cleaned).toEqual(['A']);
    expect(allocated).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
    await manager.run({ agent: 'immediate-cancel', task: 'next' }, { cwd: tmp, sessionId: 'B' });
    expect(allocated).toEqual(['B']);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('returns a granted slot exactly once when cancellation wins before the queued run resumes', async () => {
    writeAgent('grant-race');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ max_concurrency: 1 }));
    const bus = new SimpleEventBus();
    const allocated: string[] = [];
    const started: string[] = [];
    const finish = new Map<string, () => void>();
    bus.on('subagents:task:allocate', (event: SubagentTaskAllocationEvent) => { allocated.push(event.parentSessionId!); });
    const manager = new SubagentManager(async ({ parentPiSessionId }) => {
      started.push(parentPiSessionId!);
      await new Promise<void>((resolve) => { finish.set(parentPiSessionId!, resolve); });
      return { result: 'done' };
    }, undefined, undefined, undefined, bus);
    const launch = (owner: string) => manager.run(
      { agent: 'grant-race', task: owner, mode: 'background' }, { cwd: tmp, sessionId: owner },
    );
    const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
    await launch('B');
    const a = await launch('A');
    await launch('C');
    await launch('D');
    const aSignal = (manager as any).controllers.get(a.task_ids[0]).signal as AbortSignal;
    const removeAbortListener = vi.spyOn(aSignal, 'removeEventListener');
    // Synchronize at the real limiter's handoff, without copying its algorithm.
    const limiter = (manager as any).limiter(tmp, 1);
    const release = limiter.release.bind(limiter);
    let arrival!: ReturnType<typeof launch>;
    const handoff = vi.spyOn(limiter, 'release').mockImplementationOnce(() => {
      release();
      arrival = launch('E'); // Arrive during handoff: A's slot must already be reserved.
      manager.cancel(a.task_ids[0]);
    });
    try {
      finish.get('B')!();
      await turn();
      await manager.drainOwnerSession('A');
      expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(started).toEqual(['B', 'C']);
      expect(allocated).toEqual(['B', 'C']);
      await arrival;
      expect(started).toEqual(['B', 'C']); // No barging/extra slot/double release while C holds it.
      finish.get('C')!();
      await turn();
      expect(started).toEqual(['B', 'C', 'D']);
      finish.get('D')!();
      await turn();
      expect(started).toEqual(['B', 'C', 'D', 'E']);
    } finally {
      handoff.mockRestore();
      for (const owner of ['B', 'C', 'D', 'E']) { finish.get(owner)?.(); await turn(); }
      await Promise.all(['A', 'B', 'C', 'D', 'E'].map((owner) => manager.drainOwnerSession(owner)));
    }
  });

  it('drains completed runners whose terminal cleanup is still pending, without draining sibling or unknown owners', async () => {
    writeAgent('settling');
    const bus = new SimpleEventBus();
    let release!: () => void;
    let cleanupStarted!: () => void;
    const started = new Promise<void>((resolve) => { cleanupStarted = resolve; });
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => event.registerCleanup(async () => {
      cleanupStarted();
      await new Promise<void>((resolve) => { release = resolve; });
    }));
    const manager = new SubagentManager(async () => ({ result: 'done' }), undefined, undefined, undefined, bus);
    const result = await manager.run({ agent: 'settling', task: 'complete', mode: 'background' }, { cwd: tmp, sessionId: 'A' });
    await started;
    expect(manager.getTask(result.task_ids[0])?.status).toBe('completed');
    let drained = false;
    const drain = manager.drainOwnerSession('A').then(() => { drained = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drained).toBe(false);
    release();
    await drain;
  });

  it('unknown shutdown identity never cancels a known sibling session', async () => {
    writeAgent('unknown-owner');
    let finish!: () => void;
    const runner: SubagentRunner = async ({ signal }) => {
      await new Promise<void>((resolve) => { finish = resolve; signal.addEventListener('abort', resolve as any); });
      return { result: 'done' };
    };
    const manager = new SubagentManager(runner);
    const result = await manager.run({ agent: 'unknown-owner', task: 'work', mode: 'background' }, { cwd: tmp, sessionId: 'known' });
    await manager.drainOwnerSession(undefined);
    expect(manager.getTask(result.task_ids[0])?.status).toBe('running');
    finish();
    await manager.drainOwnerSession('known');
  });

  it('cancellation during claimed allocation awaits cleanup and never starts the runner', async () => {
    writeAgent('allocating');
    const bus = new SimpleEventBus();
    let allocated!: () => void;
    const started = new Promise<void>((resolve) => { allocated = resolve; });
    let cleaned = false;
    bus.on('subagents:task:allocate', (event: SubagentTaskAllocationEvent) => event.claimModel(async (signal) => {
      allocated();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      return { model: { provider: 'cliproxyapi', id: 'a/gemini-3.8-flash-high' }, effort: 'high' };
    }));
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => event.registerCleanup(async () => { await new Promise((r) => setTimeout(r, 10)); cleaned = true; }));
    const runner = vi.fn(async () => ({ result: 'must not run' }));
    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);
    await manager.run({ agent: 'allocating', task: 'allocate', mode: 'background' }, { cwd: tmp, sessionId: 'A' });
    await started;
    await manager.drainOwnerSession('A');
    expect(cleaned).toBe(true);
    expect(runner).not.toHaveBeenCalled();
  });

  it('holds lease cleanup until the cancelled runner actually settles', async () => {
    writeAgent('slow-stop');
    const bus = new SimpleEventBus();
    let finish!: () => void;
    let abortSeen!: () => void;
    const aborted = new Promise<void>((resolve) => { abortSeen = resolve; });
    let cleaned = false;
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => event.registerCleanup(async () => { cleaned = true; }));
    const manager = new SubagentManager(async ({ signal }) => {
      signal.addEventListener('abort', abortSeen, { once: true });
      await new Promise<void>((resolve) => { finish = resolve; });
      return { result: 'done' };
    }, undefined, undefined, undefined, bus);
    await manager.run({ agent: 'slow-stop', task: 'work', mode: 'background' }, { cwd: tmp, sessionId: 'A' });
    const drain = manager.drainOwnerSession('A');
    await aborted;
    expect(cleaned).toBe(false);
    finish();
    await drain;
    expect(cleaned).toBe(true);
  });

  it('awaits interrupted orphan cleanups before reconciliation completes', async () => {
    writeAgent('orphan');
    let finish!: () => void;
    const first = new SubagentManager(async () => { await new Promise<void>((resolve) => { finish = resolve; }); return { result: 'done' }; });
    await first.run({ agent: 'orphan', task: 'work', mode: 'background' }, { cwd: tmp, sessionId: 'A' });
    const bus = new SimpleEventBus();
    let cleaned = false;
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      expect(event.status).toBe('interrupted');
      event.registerCleanup(async () => { await new Promise((r) => setTimeout(r, 20)); cleaned = true; });
    });
    const restarted = new SubagentManager(undefined, undefined, undefined, undefined, bus);
    await restarted.reconcileOrphanedTasks(tmp);
    expect(cleaned).toBe(true);
    finish();
    await first.drainOwnerSession('A');
  });

  it('installed Pi runtime removes only its owned bus listeners on reload without factory cleanup', async () => {
    const bus = createEventBus();
    const old = createExtensionRuntime();
    const fresh = createExtensionRuntime();
    let oldCalls = 0;
    let newCalls = 0;
    // Installed loader wraps pi.events.on this way; test its public runtime ownership contract.
    old.trackEventBusSubscription(bus.on('subagents:task:allocate', () => { oldCalls++; }));
    fresh.trackEventBusSubscription(bus.on('subagents:task:allocate', () => { newCalls++; }));
    old.invalidate();
    bus.emit('subagents:task:allocate', {});
    expect(oldCalls).toBe(0);
    expect(newCalls).toBe(1);
    old.invalidate();
    bus.emit('subagents:task:allocate', {});
    expect(newCalls).toBe(2);
    fresh.invalidate();
  });

  it('user cancellation emits cancelled and awaits cleanup before foreground return', async () => {
    writeAgent('user-cancel');
    const bus = new SimpleEventBus();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let id = '';
    let cleaned = false;
    bus.on('subagents:task:allocate', (event: SubagentTaskAllocationEvent) => { id = event.taskId; });
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      expect(event.status).toBe('cancelled');
      event.registerCleanup(async () => { await new Promise((r) => setTimeout(r, 10)); cleaned = true; });
    });
    const manager = new SubagentManager(async ({ signal }) => {
      started();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('cancelled by user');
    }, undefined, undefined, undefined, bus);
    const run = manager.run({ agent: 'user-cancel', task: 'work' }, { cwd: tmp, sessionId: 'A' });
    await ready;
    manager.cancel(id, 'user request');
    await run;
    expect(cleaned).toBe(true);
  });

  it.each([401, 429])('settles provider HTTP %s errors with terminal cleanup', async (status) => {
    writeAgent('provider-error');
    const bus = new SimpleEventBus();
    let cleaned = false;
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      expect(event.status).toBe('failed');
      event.registerCleanup(async () => { cleaned = true; });
    });
    const manager = new SubagentManager(async () => { throw new Error(`provider HTTP ${status}`); }, undefined, undefined, undefined, bus);
    const result = await manager.run({ agent: 'provider-error', task: 'fail' }, { cwd: tmp });
    expect(result.results?.[0].error).toContain(String(status));
    expect(cleaned).toBe(true);
  });

  it('total timeout waits for actual runner settlement and terminal cleanup', async () => {
    writeAgent('timed');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ timeout_ms: 20 }));
    const bus = new SimpleEventBus();
    let settled = false;
    let cleaned = false;
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      expect(event.status).toBe('failed');
      expect(settled).toBe(true);
      event.registerCleanup(async () => { cleaned = true; });
    });
    const manager = new SubagentManager(async ({ signal }) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => setTimeout(resolve, 10), { once: true }));
      settled = true;
      return { result: 'late' };
    }, undefined, undefined, undefined, bus);
    await manager.run({ agent: 'timed', task: 'timeout' }, { cwd: tmp });
    expect(cleaned).toBe(true);
  });

  it('continuation attempt increments attempt number and emits attempt-specific events', async () => {
    writeAgent('continuer');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true }));
    const bus = new SimpleEventBus();
    const attemptsAllocated: number[] = [];
    const attemptsCleaned: number[] = [];

    bus.on('subagents:task:allocate', (event: SubagentTaskAllocationEvent) => {
      attemptsAllocated.push(event.attempt ?? 1);
    });

    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      attemptsCleaned.push(event.attempt ?? 1);
    });

    const fakeSessionFile = path.join(tmp, 'nested.jsonl');
    fs.writeFileSync(fakeSessionFile, '{"type":"session"}\n');

    let attemptCount = 0;
    const runner: SubagentRunner = async () => {
      attemptCount++;
      return { result: `attempt ${attemptCount} done`, nested_session_path: fakeSessionFile };
    };

    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);
    const initialRun = await manager.run({ agent: 'continuer', task: 'initial' }, { cwd: tmp });
    const taskId = initialRun.task_ids[0];

    expect(attemptsAllocated).toEqual([1]);
    expect(attemptsCleaned).toEqual([1]);

    await manager.continueTask({ task_id: taskId, prompt: 'continue please' }, { cwd: tmp });

    expect(attemptsAllocated).toEqual([1, 2]);
    expect(attemptsCleaned).toEqual([1, 2]);
  });

  it('quit/reload drains all tracked tasks across sessions, cwds, and undefined-owner, leaving sibling managers untouched (ISSUE-004)', async () => {
    writeAgent('bg-worker');
    const bus = new SimpleEventBus();
    const cleanupsSeen: string[] = [];
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      event.registerCleanup(async () => {
        cleanupsSeen.push(event.taskId);
      });
    });

    const cwd1 = tmp;
    const cwd2 = path.join(tmp, 'sub-cwd');
    fs.mkdirSync(cwd2, { recursive: true });
    fs.mkdirSync(path.join(cwd2, '.pi', 'subagents'), { recursive: true });
    fs.copyFileSync(
      path.join(tmp, '.pi', 'subagents', 'bg-worker.md'),
      path.join(cwd2, '.pi', 'subagents', 'bg-worker.md'),
    );

    let finishA!: () => void;
    let finishB!: () => void;
    let releaseCleanupD!: () => void;
    let finishE!: () => void;
    let finishSibling!: () => void;

    fs.writeFileSync(path.join(cwd1, '.pi', 'subagents.json'), JSON.stringify({ max_concurrency: 1 }));

    const manager = new SubagentManager(
      async ({ task, signal }) => {
        if (task.includes('work A')) {
          await new Promise<void>((resolve) => {
            finishA = resolve;
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          if (signal.aborted) throw new Error('aborted');
          return { result: 'done A' };
        }
        if (task.includes('work B')) {
          await new Promise<void>((resolve) => {
            finishB = resolve;
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          if (signal.aborted) throw new Error('aborted');
          return { result: 'done B' };
        }
        if (task.includes('work C')) {
          return { result: 'done C' };
        }
        if (task.includes('work D')) {
          return { result: 'done D' };
        }
        if (task.includes('work E')) {
          await new Promise<void>((resolve) => {
            finishE = resolve;
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          if (signal.aborted) throw new Error('aborted');
          return { result: 'done E' };
        }
        return { result: 'default' };
      },
      undefined,
      undefined,
      undefined,
      bus,
    );

    const siblingManager = new SubagentManager(
      async ({ signal }) => {
        await new Promise<void>((resolve) => {
          finishSibling = resolve;
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { result: 'sibling done' };
      },
      undefined,
      undefined,
      undefined,
      bus,
    );

    const siblingRun = await siblingManager.run({ agent: 'bg-worker', task: 'sibling work', mode: 'background' }, { cwd: cwd1, sessionId: 'sibling-session' });
    const siblingTaskId = siblingRun.task_ids[0];

    const runA = await manager.run({ agent: 'bg-worker', task: 'work A', mode: 'background' }, { cwd: cwd1, sessionId: 'session-A' });
    const taskAId = runA.task_ids[0];

    const runC = await manager.run({ agent: 'bg-worker', task: 'work C', mode: 'background' }, { cwd: cwd1, sessionId: 'session-A' });
    const taskCId = runC.task_ids[0];
    expect(manager.getTask(taskCId)?.status).toBe('queued');

    const runB = await manager.run({ agent: 'bg-worker', task: 'work B', mode: 'background' }, { cwd: cwd2, sessionId: 'session-B' });
    const taskBId = runB.task_ids[0];

    const runE = await manager.run({ agent: 'bg-worker', task: 'work E', mode: 'background' }, { cwd: cwd2, sessionId: undefined });
    const taskEId = runE.task_ids[0];

    let holdCleanupD = true;
    let cleanupDStarted!: () => void;
    const cleanupDPromise = new Promise<void>((resolve) => { cleanupDStarted = resolve; });
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      if (holdCleanupD && event.status === 'completed') {
        holdCleanupD = false;
        event.registerCleanup(async () => {
          cleanupDStarted();
          await new Promise<void>((resolve) => { releaseCleanupD = resolve; });
        });
      }
    });

    await manager.run({ agent: 'bg-worker', task: 'work D', mode: 'background' }, { cwd: cwd2, sessionId: 'session-D' });
    await cleanupDPromise;

    await manager.drainOwnerSession('session-B', 'Pi session shutdown');
    expect(manager.getTask(taskBId)?.status).toBe('interrupted');
    expect(manager.getTask(taskAId)?.status).toBe('running');
    expect(manager.getTask(taskCId)?.status).toBe('queued');
    expect(manager.getTask(taskEId)?.status).toBe('running');
    expect(siblingManager.getTask(siblingTaskId)?.status).toBe('running');

    let shutdownDone = false;
    const shutdownPromise = (manager as any).drainAllTasks('Pi quit').then(() => { shutdownDone = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(shutdownDone).toBe(false);

    releaseCleanupD();
    await shutdownPromise;
    expect(shutdownDone).toBe(true);

    expect(manager.getTask(taskAId)?.status).toBe('interrupted');
    expect(manager.getTask(taskCId)?.status).toBe('interrupted');
    expect(manager.getTask(taskEId)?.status).toBe('interrupted');
    expect(cleanupsSeen).toContain(taskAId);
    expect(cleanupsSeen).toContain(taskBId);
    expect(cleanupsSeen).toContain(taskCId);
    expect(cleanupsSeen).toContain(taskEId);

    expect(siblingManager.getTask(siblingTaskId)?.status).toBe('running');
    finishSibling();
    await siblingManager.drainOwnerSession('sibling-session');
  });

  it('reconcileOrphanedTasks skips active/pending in-memory jobs and only reconciles dead persisted startup tasks (ISSUE-004)', async () => {
    writeAgent('recon-worker');
    const bus = new SimpleEventBus();
    const cleanupsFired: string[] = [];
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      cleanupsFired.push(event.taskId);
    });

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ max_concurrency: 1 }));

    let finishRunning!: () => void;
    const history = new (await import('../src/history.js')).SubagentHistoryStore();
    const manager = new SubagentManager(
      async ({ task, signal }) => {
        if (task.includes('active-run')) {
          await new Promise<void>((resolve) => {
            finishRunning = resolve;
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return { result: 'done active' };
        }
        return { result: 'done queued' };
      },
      history,
      undefined,
      undefined,
      bus,
    );

    const activeRun = await manager.run({ agent: 'recon-worker', task: 'active-run work', mode: 'background' }, { cwd: tmp, sessionId: 'session-1' });
    const activeTaskId = activeRun.task_ids[0];
    expect(manager.getTask(activeTaskId)?.status).toBe('running');

    const queuedRun = await manager.run({ agent: 'recon-worker', task: 'queued work', mode: 'background' }, { cwd: tmp, sessionId: 'session-1' });
    const queuedTaskId = queuedRun.task_ids[0];
    expect(manager.getTask(queuedTaskId)?.status).toBe('queued');

    const deadTaskId = 'subtask_dead_startup_task_12345';
    const now = new Date().toISOString();
    history.upsertTask(tmp, {
      id: deadTaskId,
      agent: 'recon-worker',
      mode: 'background',
      status: 'running',
      task: 'dead work from crashed process',
      context: '',
      created_at: now,
      attempt: 1,
      session_id: 'crashed-session',
    } as any);

    const reconciled = await manager.reconcileOrphanedTasks(tmp);

    expect(reconciled.map((t) => t.id)).toEqual([deadTaskId]);
    expect(reconciled[0].status).toBe('interrupted');

    expect(manager.getTask(activeTaskId)?.status).toBe('running');
    expect(manager.getTask(queuedTaskId)?.status).toBe('queued');

    expect(cleanupsFired).toContain(deadTaskId);
    expect(cleanupsFired).not.toContain(activeTaskId);
    expect(cleanupsFired).not.toContain(queuedTaskId);

    finishRunning();
    await manager.drainOwnerSession('session-1');
  });

  it('terminal cleanup rejection surfaces through error metadata, task error, history, and diagnostics without unhandled rejection (ISSUE-004)', async () => {
    writeAgent('cleanup-fail');
    const bus = new SimpleEventBus();
    let siblingCleaned = false;

    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      event.registerCleanup(async () => {
        siblingCleaned = true;
      });
      event.registerCleanup(async () => {
        throw new Error('EACCES: permission denied, disk write failed');
      });
    });

    const history = new (await import('../src/history.js')).SubagentHistoryStore();
    const manager = new SubagentManager(
      async () => ({ result: 'successful execution' }),
      history,
      undefined,
      undefined,
      bus,
    );

    const runResult = await manager.run({ agent: 'cleanup-fail', task: 'work' }, { cwd: tmp, sessionId: 'session-clean' });
    const task = runResult.results?.[0];
    expect(task).toBeDefined();

    expect(siblingCleaned).toBe(true);

    expect(task?.error).toBeDefined();
    expect(task?.error).toContain('EACCES: permission denied');
    expect(task?.error_metadata).toBeDefined();
    expect(task?.error_metadata?.details?.cleanup_error).toContain('EACCES: permission denied');

    const persisted = history.getTask(tmp, task!.id);
    expect(persisted).toBeDefined();
    expect(persisted?.error).toBeDefined();
    expect(persisted?.error).toContain('EACCES: permission denied');
    expect(persisted?.error_metadata?.details?.cleanup_error).toContain('EACCES: permission denied');
  });

  it('retains original provider/cancel error when terminal cleanup also fails (ISSUE-004)', async () => {
    writeAgent('provider-fail');
    const bus = new SimpleEventBus();
    bus.on('subagents:task:terminal', (event: SubagentTaskTerminalEvent) => {
      event.registerCleanup(async () => {
        throw new Error('Disk full during lease removal');
      });
    });

    const manager = new SubagentManager(
      async () => { throw new Error('Provider rate limit: 429 Too Many Requests'); },
      undefined,
      undefined,
      undefined,
      bus,
    );

    const runResult = await manager.run({ agent: 'provider-fail', task: 'fail' }, { cwd: tmp, sessionId: 'session-clean' });
    const task = runResult.results?.[0];
    expect(task).toBeDefined();
    expect(task?.status).toBe('failed');

    expect(task?.error).toContain('429 Too Many Requests');
    expect(task?.error_metadata?.details?.cleanup_error).toContain('Disk full during lease removal');
  });
});
