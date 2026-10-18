import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateSubagentConfig } from '../src/subagent-config.ts';
import {
  registerSubagentAssignment,
  splitCandidateId,
  type SubagentTaskAllocationEvent,
  type SubagentTaskTerminalEvent,
} from '../src/subagent-assignment.ts';
import { resolveSubagentPoolPath } from '../src/subagent-pool.ts';

function createMockEventBus() {
  const listeners = new Map<string, Array<(event: any) => void>>();
  return {
    on: (channel: string, handler: (event: any) => void) => {
      const list = listeners.get(channel) ?? [];
      list.push(handler);
      listeners.set(channel, list);
      return () => {
        const current = listeners.get(channel) ?? [];
        const index = current.indexOf(handler);
        if (index >= 0) current.splice(index, 1);
      };
    },
    emit: (channel: string, event: any) => {
      const list = listeners.get(channel) ?? [];
      for (const handler of list) handler(event);
    },
    listenerCount: (channel: string) => (listeners.get(channel) ?? []).length,
  };
}

test('ASSIGN-001: splitCandidateId parses valid provider and model ID, preserving nested slashes', () => {
  assert.deepEqual(splitCandidateId('anthropic/claude-sonnet-4'), { provider: 'anthropic', modelId: 'claude-sonnet-4' });
  assert.deepEqual(splitCandidateId('cliproxyapi/main/gpt-6.1-sol'), { provider: 'cliproxyapi', modelId: 'main/gpt-6.1-sol' });
  assert.deepEqual(splitCandidateId('openrouter/meta-llama/llama-3-70b'), { provider: 'openrouter', modelId: 'meta-llama/llama-3-70b' });
  assert.equal(splitCandidateId('invalid'), undefined);
  assert.equal(splitCandidateId('/model'), undefined);
  assert.equal(splitCandidateId('provider/'), undefined);
});

test('ASSIGN-002: registers claimModel on allocate and returns undefined when subagent config is disabled', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sup-assign-disabled-'));
  const oldRuntime = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(tmp, 'runtime');

  try {
    updateSubagentConfig(tmp, { enabled: false, priorityCandidateIds: ['anthropic/claude-sonnet-4'] });

    const bus = createMockEventBus();
    const unsub = registerSubagentAssignment({ events: bus });

    let claimedAllocator: any = null;
    const allocateEvent: SubagentTaskAllocationEvent = {
      taskId: 'task-1',
      agent: 'worker',
      cwd: tmp,
      signal: new AbortController().signal,
      claimModel: (allocator) => {
        claimedAllocator = allocator;
      },
    };

    bus.emit('subagents:task:allocate', allocateEvent);
    assert.ok(claimedAllocator, 'claimModel must be called synchronously');

    const result = await claimedAllocator(allocateEvent.signal);
    assert.equal(result, undefined, 'disabled subagent config must return undefined to allow orchestrator fallback');

    unsub();
  } finally {
    if (oldRuntime === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
    else process.env.PI_SUPERVISOR_RUNTIME_DIR = oldRuntime;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('ASSIGN-003: acquires least-loaded model from pool and attaches reasoning effort', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sup-assign-acquire-'));
  const oldRuntime = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(tmp, 'runtime');

  try {
    updateSubagentConfig(tmp, {
      enabled: true,
      modelCount: 2,
      priorityCandidateIds: ['openai/gpt-5-codex', 'anthropic/claude-sonnet-4'],
      modelEfforts: { 'openai/gpt-5-codex': 'high' },
    });

    const bus = createMockEventBus();
    const acquiredLeases: any[] = [];
    const releasedLeases: any[] = [];

    const unsub = registerSubagentAssignment(
      { events: bus },
      {
        acquire: (cwd, candidates, owner) => {
          const lease = { token: 'lease-tok-1', modelId: candidates[0] };
          acquiredLeases.push({ cwd, candidates, owner, lease });
          return lease;
        },
        release: (cwd, lease, owner) => {
          releasedLeases.push({ cwd, lease, owner });
        },
      },
    );

    let claimedAllocator: any = null;
    const allocateEvent: SubagentTaskAllocationEvent = {
      taskId: 'task-101',
      agent: 'tester',
      cwd: tmp,
      signal: new AbortController().signal,
      claimModel: (allocator) => {
        claimedAllocator = allocator;
      },
    };

    bus.emit('subagents:task:allocate', allocateEvent);
    const claimed = await claimedAllocator(allocateEvent.signal);

    assert.ok(claimed);
    assert.deepEqual(claimed.model, { provider: 'openai', id: 'gpt-5-codex' });
    assert.equal(claimed.effort, 'high');
    assert.equal(acquiredLeases.length, 1);
    assert.equal(acquiredLeases[0].owner.sessionId, 'task-101');

    // Emit terminal event to verify cleanup release
    let cleanupFn: any = null;
    const terminalEvent: SubagentTaskTerminalEvent = {
      taskId: 'task-101',
      status: 'completed',
      registerCleanup: (fn) => {
        cleanupFn = fn;
      },
    };

    bus.emit('subagents:task:terminal', terminalEvent);
    assert.ok(cleanupFn, 'registerCleanup must be called on terminal event');

    await cleanupFn();
    assert.equal(releasedLeases.length, 1);
    assert.equal(releasedLeases[0].lease.token, 'lease-tok-1');

    unsub();
  } finally {
    if (oldRuntime === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
    else process.env.PI_SUPERVISOR_RUNTIME_DIR = oldRuntime;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('ASSIGN-004: signal abortion releases lease immediately and returns undefined', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sup-assign-abort-'));
  const oldRuntime = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(tmp, 'runtime');

  try {
    updateSubagentConfig(tmp, {
      enabled: true,
      modelCount: 2,
      priorityCandidateIds: ['openai/gpt-5-codex'],
    });

    const bus = createMockEventBus();
    const releasedLeases: any[] = [];

    const unsub = registerSubagentAssignment(
      { events: bus },
      {
        release: (cwd, lease, owner) => {
          releasedLeases.push({ cwd, lease, owner });
        },
      },
    );

    const controller = new AbortController();
    let claimedAllocator: any = null;

    bus.emit('subagents:task:allocate', {
      taskId: 'task-abort-1',
      agent: 'tester',
      cwd: tmp,
      signal: controller.signal,
      claimModel: (allocator: any) => {
        claimedAllocator = allocator;
      },
    });

    // Abort controller prior to allocator resolution
    controller.abort();
    const result = await claimedAllocator(controller.signal);
    assert.equal(result, undefined);
    assert.equal(releasedLeases.length, 0, 'already aborted before acquisition');

    // Now test aborting after allocation
    const controller2 = new AbortController();
    let claimedAllocator2: any = null;
    bus.emit('subagents:task:allocate', {
      taskId: 'task-abort-2',
      agent: 'tester',
      cwd: tmp,
      signal: controller2.signal,
      claimModel: (allocator: any) => {
        claimedAllocator2 = allocator;
      },
    });

    const result2 = await claimedAllocator2(controller2.signal);
    assert.ok(result2);

    // Abort after acquisition -> triggers abort event listener
    controller2.abort();
    assert.equal(releasedLeases.length, 1);
    assert.equal(releasedLeases[0].owner.sessionId, 'task-abort-2');

    unsub();
  } finally {
    if (oldRuntime === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
    else process.env.PI_SUPERVISOR_RUNTIME_DIR = oldRuntime;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('ASSIGN-005: unregister removes listeners from pi.events', () => {
  const bus = createMockEventBus();
  const unsub = registerSubagentAssignment({ events: bus });

  assert.equal(bus.listenerCount('subagents:task:allocate'), 1);
  assert.equal(bus.listenerCount('subagents:task:terminal'), 1);

  unsub();
  assert.equal(bus.listenerCount('subagents:task:allocate'), 0);
  assert.equal(bus.listenerCount('subagents:task:terminal'), 0);
});
