import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWorkSettled,
  verifiedCheckpoint,
  SubagentTaskRegistry,
  SUPERVISOR_CHECKPOINT_CHANNEL,
  saveMemoryCheckpoint,
  getMemoryCheckpoint,
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

  const { events, ...toolContext } = ctx;
  const checkpoint = (params: { summary?: string; memory_id?: number }) => verifiedCheckpoint(toolContext, params, events);
  const res = await checkpoint({ summary: '- Active goal\n- Next step' });
  assert.equal(res.id, 50);
  assert.equal(res.content, '- Active goal\n- Next step');

  // Query existing memory_id
  const readRes = await checkpoint({ memory_id: 50 });
  assert.equal(readRes.id, 50);
  assert.equal(readRes.content, '- Active goal\n- Next step');

  // Mismatch or non-existent rejects
  await assert.rejects(checkpoint({ memory_id: 999 }), /Failed to read checkpoint/);
  await assert.rejects(checkpoint({ memory_id: 0 }), /positive/);
  await assert.rejects(checkpoint({ summary: '' }), /1–12000 characters/);
});

test('Checkpoint fails closed without a memory bridge and never falls back to tool execution', async () => {
  let calls = 0;
  const ctx = { cwd: '/test/cwd', sessionId: 'session-one', executeTool: async () => { calls++; } };
  for (const events of [undefined, {}, { emit: () => { calls++; }, listenerCount: () => 0 }]) {
    await assert.rejects(verifiedCheckpoint(ctx, { summary: 'Approved work pending' }, events), /bridge unavailable/);
    await assert.rejects(verifiedCheckpoint(ctx, { memory_id: 7 }, events), /bridge unavailable/);
  }
  assert.equal(calls, 0);
});

test('Checkpoint requires verified persistence and exact session-summary readback before handover', async () => {
  const ctx = { cwd: '/test/cwd', sessionManager: { getSessionId: () => 'session-one' } };
  const summary = 'Approved work pending';
  const cases = [
    { save: { ok: false, error: 'storage_unavailable' }, get: {}, error: /storage_unavailable/ },
    { save: { ok: true, id: 7, readbackVerified: false }, get: {}, error: /readback verification failed/ },
    { save: { ok: true, id: 7, readbackVerified: true }, get: { ok: false, error: 'not_found' }, error: /not_found/ },
    { save: { ok: true, id: 7, readbackVerified: true }, get: { ok: true, id: 7, content: 'Other work', type: 'session_summary' }, error: /readback mismatch/ },
    { save: { ok: true, id: 7, readbackVerified: true }, get: { ok: true, id: 7, content: summary, type: 'note' }, error: /must be a session_summary/ },
  ];
  for (const fixture of cases) {
    const events = { emit: (channel: string, payload: any) => {
      assert.equal(channel, SUPERVISOR_CHECKPOINT_CHANNEL);
      assert.equal(payload.cwd, ctx.cwd);
      assert.equal(payload.sessionId, 'session-one');
      assert.equal('capture_prompt' in payload, false);
      payload.respond(payload.action === 'save' ? fixture.save : fixture.get);
    } };
    await assert.rejects(verifiedCheckpoint(ctx, { summary }, events), fixture.error);
  }
});

test('Checkpoint verifies all readback pages, preserving exact text for summaries larger than one page', async () => {
  const chunks = ['Approved work\n', 'Next step 🚀'];
  const readCursors: Array<string | undefined> = [];
  const events = { emit: (_channel: string, payload: any) => {
    if (payload.action === 'save') {
      payload.respond({ ok: true, id: 7, readbackVerified: true });
    } else {
      readCursors.push(payload.cursor);
      const page = payload.cursor ? 1 : 0;
      payload.respond({ ok: true, id: 7, type: 'session_summary', content: chunks[page],
        has_more: page === 0, next_cursor: page === 0 ? 'exact-cursor' : null });
    }
  } };
  const result = await verifiedCheckpoint({ cwd: '/test', sessionId: 'one' }, { summary: chunks.join('') }, events);
  assert.equal(result.content, chunks.join(''));
  assert.deepEqual(readCursors, [undefined, 'exact-cursor']);
});

test('Checkpoint rejects wrong IDs, missing/repeated cursors and oversized readback', async () => {
  const fixtures = [
    { page: { id: 8, content: 'Wrong memory' }, error: /invalid readback/ },
    { page: { id: 7, content: 'Partial', has_more: true }, error: /invalid continuation cursor/ },
    { page: { id: 7, content: '', has_more: true, next_cursor: 'repeated' }, error: /invalid continuation cursor/ },
    { page: { id: 7, content: 'x'.repeat(12001) }, error: /empty or too large/ },
  ];
  for (const fixture of fixtures) {
    const events = { emit: (_channel: string, payload: any) => payload.respond({
      ok: true, type: 'session_summary', ...fixture.page,
    }) };
    await assert.rejects(verifiedCheckpoint({ cwd: '/test', sessionId: 'one' }, { memory_id: 7 }, events), fixture.error);
  }
});

test('Checkpoint bridge timeouts are explicit and do not execute fallback tools', async () => {
  const events = { emit: () => {} };
  assert.deepEqual(await saveMemoryCheckpoint(events, { cwd: '/test', title: 'Checkpoint', content: 'Pending' }, 1),
    { ok: false, error: 'save_checkpoint_timeout' });
  assert.deepEqual(await getMemoryCheckpoint(events, { cwd: '/test', id: 7 }, 1),
    { ok: false, error: 'get_checkpoint_timeout' });
});
