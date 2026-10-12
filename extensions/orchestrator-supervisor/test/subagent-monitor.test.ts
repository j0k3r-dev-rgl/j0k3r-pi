import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SubagentMonitor } from '../src/subagent-monitor.ts';

test('MINI-001: SubagentMonitor satisfies fence when no subagents exist', () => {
  const monitor = new SubagentMonitor({ dbPath: '/non/existent/path.sqlite' });
  const result = monitor.checkFence('session-1', '/fake/cwd');
  assert.equal(result.satisfied, true);
  assert.equal(result.activeCount, 0);
});

test('MINI-001: SubagentMonitor holds fence when tasks are queued, running, or stopping', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-subagent-test-'));
  const dbPath = join(tmpDir, 'subagents-history.sqlite');

  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE subagent_tasks (
        id TEXT PRIMARY KEY,
        cwd TEXT,
        session_id TEXT,
        status TEXT
      );
    `);
    db.prepare('INSERT INTO subagent_tasks VALUES (?, ?, ?, ?)').run(
      'task-1',
      '/test/cwd',
      'session-active',
      'running',
    );
    db.close();

    const monitor = new SubagentMonitor({ dbPath });
    const result = monitor.checkFence('session-active', '/test/cwd');
    assert.equal(result.satisfied, false);
    assert.equal(result.activeCount, 1);
    assert.match(result.reason ?? '', /1 active subagent/);

    // Update to completed
    const db2 = new DatabaseSync(dbPath);
    db2.prepare('UPDATE subagent_tasks SET status = ? WHERE id = ?').run('completed', 'task-1');
    db2.close();

    const resultSettled = monitor.checkFence('session-active', '/test/cwd');
    assert.equal(resultSettled.satisfied, true);
    assert.equal(resultSettled.activeCount, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-001: SubagentMonitor tracks allocated and terminal events via pi.events using parentSessionId and holds when DB missing/unreadable after launch', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-subagent-evt-'));
  const dbPath = join(tmpDir, 'subagents-history.sqlite');

  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE subagent_tasks (
        id TEXT PRIMARY KEY,
        cwd TEXT,
        session_id TEXT,
        status TEXT
      );
    `);
    db.close();

    const handlers = new Map<string, Array<(payload: any) => void>>();
    const mockEvents = {
      on(channel: string, fn: (payload: any) => void) {
        if (!handlers.has(channel)) handlers.set(channel, []);
        handlers.get(channel)!.push(fn);
        return () => {};
      },
      emit(channel: string, payload: any) {
        handlers.get(channel)?.forEach((fn) => fn(payload));
      },
    };

    const monitor = new SubagentMonitor({ dbPath, events: mockEvents });

    // Emit using parentSessionId (actual extensions/subagents payload field)
    mockEvents.emit('subagents:task:allocate', {
      taskId: 'task-evt-1',
      parentSessionId: 'session-e1',
      cwd: '/cwd',
    });

    const check1 = monitor.checkFence('session-e1', '/cwd');
    assert.equal(check1.satisfied, false);
    assert.equal(check1.activeCount, 1);

    mockEvents.emit('subagents:task:terminal', {
      taskId: 'task-evt-1',
      parentSessionId: 'session-e1',
      status: 'completed',
    });

    const check2 = monitor.checkFence('session-e1', '/cwd');
    assert.equal(check2.satisfied, true);
    assert.equal(check2.activeCount, 0);

    // Track in-flight subagent tool call and completion delivery notification
    (monitor as any).recordToolCallStart('session-e1', 'call-sub-1', 'subagent_run');
    assert.equal(monitor.checkFence('session-e1', '/cwd').satisfied, false);
    (monitor as any).recordToolCallEnd('session-e1', 'call-sub-1');
    assert.equal(monitor.checkFence('session-e1', '/cwd').satisfied, true);

    (monitor as any).expectCompletionDelivery('session-e1', 'bg-task-1');
    assert.equal(monitor.checkFence('session-e1', '/cwd').satisfied, false);
    (monitor as any).recordCompletionDelivery('session-e1', 'bg-task-1');
    assert.equal(monitor.checkFence('session-e1', '/cwd').satisfied, true);

    // Missing DB after delegatedLaunchCount > 0 conservatively holds fence
    rmSync(dbPath, { force: true });
    const checkMissingDb = monitor.checkFence('session-e1', '/cwd');
    assert.equal(checkMissingDb.satisfied, false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

