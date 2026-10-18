import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWorkSettled,
  verifiedCheckpoint,
  SubagentTaskRegistry,
  SUPERVISOR_CHECKPOINT_CHANNEL,
} from '../src/bridge.ts';

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
    emit: (channel: string, payload: any) => {
      const list = listeners.get(channel) ?? [];
      for (const handler of list) handler(payload);
    },
  };
}

test('BRIDGE-001: SubagentTaskRegistry tracks allocate and terminal events scoped to parentSessionId', () => {
  const bus = createMockEventBus();
  const registry = new SubagentTaskRegistry();
  const detach = registry.attach(bus);

  try {
    bus.emit('subagents:task:allocate', {
      taskId: 'task-1',
      attempt: 1,
      parentSessionId: 'session-A',
      agent: 'tester',
    });
    bus.emit('subagents:task:allocate', {
      taskId: 'task-2',
      attempt: 1,
      parentSessionId: 'session-B',
      agent: 'worker',
    });

    assert.equal(registry.hasActiveTasksForSession('session-A'), true);
    assert.equal(registry.hasActiveTasksForSession('session-B'), true);
    assert.equal(registry.hasActiveTasksForSession('session-C'), false);

    assert.deepEqual(registry.getActiveTasksForSession('session-A').map(t => t.taskId), ['task-1']);
    assert.deepEqual(registry.getActiveTasksForSession('session-B').map(t => t.taskId), ['task-2']);

    // Terminal for task-1 removes it from session-A
    bus.emit('subagents:task:terminal', {
      taskId: 'task-1',
      parentSessionId: 'session-A',
      status: 'completed',
    });

    assert.equal(registry.hasActiveTasksForSession('session-A'), false);
    assert.equal(registry.hasActiveTasksForSession('session-B'), true, 'session-B task remains active');
  } finally {
    detach();
    registry.dispose();
  }
});

test('BRIDGE-002: assertWorkSettled defers rotation while task allocated-but-not-terminal for this session', async () => {
  const bus = createMockEventBus();
  const registry = new SubagentTaskRegistry();
  registry.attach(bus);

  try {
    bus.emit('subagents:task:allocate', {
      taskId: 'task-active-1',
      attempt: 1,
      parentSessionId: 'parent-sess-1',
      agent: 'coder',
    });

    const ctx = {
      sessionId: 'parent-sess-1',
      taskRegistry: registry,
    };

    await assert.rejects(
      assertWorkSettled(ctx, registry),
      /Rotation deferred: active tasks \(task-active-1\)/,
    );

    // Terminal event settles work
    bus.emit('subagents:task:terminal', {
      taskId: 'task-active-1',
      parentSessionId: 'parent-sess-1',
      status: 'completed',
    });

    await assert.doesNotReject(assertWorkSettled(ctx, registry));
  } finally {
    registry.dispose();
  }
});

test('BRIDGE-003: assertWorkSettled ignores active tasks of another parentSessionId', async () => {
  const bus = createMockEventBus();
  const registry = new SubagentTaskRegistry();
  registry.attach(bus);

  try {
    // Task belonging to another parent session
    bus.emit('subagents:task:allocate', {
      taskId: 'task-other-session',
      attempt: 1,
      parentSessionId: 'other-parent-session',
      agent: 'researcher',
    });

    const currentSessionCtx = {
      sessionId: 'my-current-session',
      taskRegistry: registry,
    };

    // Current session has no tasks, so rotation must NOT be deferred
    await assert.doesNotReject(assertWorkSettled(currentSessionCtx, registry));
  } finally {
    registry.dispose();
  }
});

test('BRIDGE-004: assertWorkSettled fails closed if session identity or registry is unknown', async () => {
  const registry = new SubagentTaskRegistry();

  try {
    // Missing session identity
    await assert.rejects(
      assertWorkSettled({ sessionId: '' }, registry),
      /cannot verify active tasks \(unknown session identity\)/,
    );

    // Missing registry
    await assert.rejects(
      assertWorkSettled({ sessionId: 'session-xyz', taskRegistry: null }, null as any),
      /cannot verify active tasks \(subagent task registry unavailable\)/,
    );
  } finally {
    registry.dispose();
  }
});

test('BRIDGE-005: verifiedCheckpoint via memory:supervisor:checkpoint:v1 channel saves and verifies exact readback', async () => {
  const store = new Map<number, { title: string; content: string; type: string }>();
  let nextId = 50;

  const ctx = {
    sessionId: 'session-test-checkpoint',
    cwd: '/test/cwd',
    events: {
      emit: (channel: string, payload: any) => {
        if (channel !== SUPERVISOR_CHECKPOINT_CHANNEL) return;
        if (payload.action === 'save') {
          const id = payload.id ?? nextId++;
          store.set(id, { title: payload.title, content: payload.content, type: payload.type });
          payload.respond({ ok: true, id, readbackVerified: true });
        } else if (payload.action === 'get') {
          const item = store.get(payload.id);
          if (!item) {
            payload.respond({ ok: false, error: 'not_found' });
          } else {
            payload.respond({ ok: true, id: payload.id, content: item.content, type: item.type, title: item.title });
          }
        }
      },
    },
  };

  const res = await verifiedCheckpoint(ctx, { summary: '- Active goal\n- Next step' });
  assert.equal(res.id, 50);
  assert.equal(res.content, '- Active goal\n- Next step');

  // Query existing memory_id
  const readRes = await verifiedCheckpoint(ctx, { memory_id: 50 });
  assert.equal(readRes.id, 50);
  assert.equal(readRes.content, '- Active goal\n- Next step');

  // Mismatch or non-existent rejects
  await assert.rejects(verifiedCheckpoint(ctx, { memory_id: 999 }), /Failed to read checkpoint/);
  await assert.rejects(verifiedCheckpoint(ctx, { memory_id: 0 }), /positive/);
  await assert.rejects(verifiedCheckpoint(ctx, { summary: '' }), /1–12000 characters/);
});
