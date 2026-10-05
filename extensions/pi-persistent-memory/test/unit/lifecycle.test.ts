import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withDatabase } from '../../src/storage/db.ts';
import { initSchema } from '../../src/storage/schema.ts';
import { getSession } from '../../src/storage/session-store.ts';
import { createMemory } from '../../src/storage/memory-store.ts';
import { InvocationLease } from '../../src/lease.ts';
import { MemoryLifecycle } from '../../src/lifecycle.ts';
import type { InvocationIdentityV1 } from '../../src/protocol.ts';

function createTempDb(): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-mini-001-lifecycle-'));
  const dbPath = join(dir, 'memories.db');
  return {
    dir,
    dbPath,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

test('M1-A03: First-message activation — no DB on load/start/selection, creates/reopens on first user message, closes on shutdown', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const lifecycle = new MemoryLifecycle(dbPath);

    // 1. Initial state: DB file must NOT even be created yet
    assert.equal(existsSync(dbPath), false);

    // 2. Activity like 'orchestrator prompt prepared' or historical message does not activate
    await lifecycle.handleActivity('orchestrator prompt prepared');
    assert.equal(existsSync(dbPath), false);

    await lifecycle.handleMessageStart({
      message: { role: 'assistant', content: 'hello' },
    }, { sessionId: 'session-norm-1', cwd: '/tmp', isProjectTrusted: () => true });
    assert.equal(existsSync(dbPath), false);

    // 3. First user message activates session
    await lifecycle.handleMessageStart({
      message: { role: 'user', content: 'hi' },
    }, { sessionId: 'session-norm-1', cwd: '/tmp', isProjectTrusted: () => true });

    assert.equal(existsSync(dbPath), true);
    withDatabase(dbPath, (db) => {
      const sess = getSession(db, 'session-norm-1');
      assert.ok(sess);
      assert.equal(sess.status, 'open');
      assert.equal(sess.kind, 'normal');
    });

    // 4. Reload does NOT close parent session
    await lifecycle.handleSessionShutdown('reload', 'session-norm-1');
    withDatabase(dbPath, (db) => {
      const sess = getSession(db, 'session-norm-1');
      assert.ok(sess);
      assert.equal(sess.status, 'open'); // Still open!
    });

    // 5. Quit or new closes the session
    await lifecycle.handleSessionShutdown('quit', 'session-norm-1');
    withDatabase(dbPath, (db) => {
      const sess = getSession(db, 'session-norm-1');
      assert.ok(sess);
      assert.equal(sess.status, 'closed');
      assert.ok(sess.closed_at !== null);
    });
  } finally {
    cleanup();
  }
});

test('M1-A03: Normal session without user messages leaves zero DB records on shutdown', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const lifecycle = new MemoryLifecycle(dbPath);
    await lifecycle.handleSessionShutdown('quit', 'session-untouched');
    // DB was never created or touched
    assert.equal(existsSync(dbPath), false);
  } finally {
    cleanup();
  }
});

test('M1-A04 & M1-A05: Child lease isolation, terminal closure, and empty-record deletion', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const identityA: InvocationIdentityV1 = {
      version: 1,
      invocationId: 'inv-1',
      childSessionId: 'child-sess-A',
      invokingParentSessionId: 'parent-sess-1',
      taskId: 'task-1',
      attempt: 1,
    };

    const leaseA = new InvocationLease(identityA, dbPath, {
      cwd: '/tmp',
      isProjectTrusted: () => true,
    });

    // Before activation: no DB work
    assert.equal(existsSync(dbPath), false);

    // Activate lease A
    await leaseA.activate();
    assert.equal(existsSync(dbPath), true);

    withDatabase(dbPath, (db) => {
      const row = getSession(db, 'child-sess-A');
      assert.ok(row);
      assert.equal(row.status, 'open');
      assert.equal(row.kind, 'child');
    });

    // Brother subagent B is isolated
    const identityB: InvocationIdentityV1 = {
      version: 1,
      invocationId: 'inv-2',
      childSessionId: 'child-sess-B',
      invokingParentSessionId: 'parent-sess-1',
      taskId: 'task-2',
      attempt: 1,
    };
    const leaseB = new InvocationLease(identityB, dbPath, {
      cwd: '/tmp',
      isProjectTrusted: () => true,
    });
    await leaseB.activate();

    // Terminate lease A with outcome completed: child A has no memories, so it must be deleted!
    await leaseA.terminate('completed');
    withDatabase(dbPath, (db) => {
      const rowA = getSession(db, 'child-sess-A');
      assert.equal(rowA, undefined); // deleted!
      const rowB = getSession(db, 'child-sess-B');
      assert.ok(rowB); // brother B remains open!
    });

    // Save a memory in child B before terminating
    withDatabase(dbPath, (db) => {
      createMemory(db, {
        scopeKey: '["project","test"]',
        title: 'Child knowledge',
        content: 'Preserved knowledge',
        type: 'observation',
        sessionId: 'child-sess-B',
        invokingParentSessionId: 'parent-sess-1',
        invocationId: 'inv-2',
      });
    });

    // Terminate lease B: since it has knowledge, child record must be retained closed!
    await leaseB.terminate('completed');
    withDatabase(dbPath, (db) => {
      const rowB = getSession(db, 'child-sess-B');
      assert.ok(rowB);
      assert.equal(rowB.status, 'closed');
      assert.ok(rowB.closed_at !== null);
    });
  } finally {
    cleanup();
  }
});

test('M1-A06: In-flight operations cancelled and awaited on terminal, late callbacks reject', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const identity: InvocationIdentityV1 = {
      version: 1,
      invocationId: 'inv-flight',
      childSessionId: 'child-sess-flight',
      invokingParentSessionId: 'parent-1',
    };
    const lease = new InvocationLease(identity, dbPath, {
      cwd: '/tmp',
      isProjectTrusted: () => true,
    });
    await lease.activate();

    let opStarted = false;
    let opCancelled = false;

    // Start an in-flight operation
    const opPromise = lease.perform(undefined, async (cap) => {
      opStarted = true;
      // Wait for abort signal
      await new Promise<void>((resolve, reject) => {
        cap.signal.addEventListener('abort', () => {
          opCancelled = true;
          reject(new Error('aborted'));
        });
      });
    });

    assert.equal(opStarted, true);

    // Terminate lease while operation is in flight
    await lease.terminate('cancelled');

    assert.equal(opCancelled, true);
    await assert.rejects(opPromise, /aborted/);

    // Late calls on closed lease reject immediately
    await assert.rejects(async () => {
      await lease.perform(undefined, async () => {
        return 'too-late';
      });
    }, /invocation_terminated/);
  } finally {
    cleanup();
  }
});

test('M1-A07: Reload handler ordering resilience — both orders complete child cleanup without deadlock or timeout', async () => {
  // Order 1: Subagents runner terminates child lease first, then memory session_shutdown runs
  {
    const { dbPath, cleanup } = createTempDb();
    try {
      const lifecycle = new MemoryLifecycle(dbPath);
      const identity: InvocationIdentityV1 = {
        version: 1,
        invocationId: 'inv-order1',
        childSessionId: 'child-sess-order1',
        invokingParentSessionId: 'parent-1',
      };
      const lease = new InvocationLease(identity, dbPath, {
        cwd: '/tmp',
        isProjectTrusted: () => true,
      });
      await lease.activate();

      // Runner terminates child lease
      await lease.terminate('cancelled');

      // Then memory shutdown runs
      await lifecycle.handleSessionShutdown('reload', 'parent-1');

      // Empty child was removed, parent unaffected
      withDatabase(dbPath, (db) => {
        assert.equal(getSession(db, 'child-sess-order1'), undefined);
      });
    } finally {
      cleanup();
    }
  }

  // Order 2: Memory session_shutdown runs first (withdraws listener), then subagent runner terminates child lease
  {
    const { dbPath, cleanup } = createTempDb();
    try {
      const lifecycle = new MemoryLifecycle(dbPath);
      const identity: InvocationIdentityV1 = {
        version: 1,
        invocationId: 'inv-order2',
        childSessionId: 'child-sess-order2',
        invokingParentSessionId: 'parent-2',
      };
      const lease = new InvocationLease(identity, dbPath, {
        cwd: '/tmp',
        isProjectTrusted: () => true,
      });
      await lease.activate();

      // Memory extension shuts down first
      await lifecycle.handleSessionShutdown('reload', 'parent-2');

      // Then subagent runner drains and terminates captured child lease
      // Captured lease still functions because it holds direct dbPath and identity, not stale ctx
      await lease.terminate('cancelled');

      withDatabase(dbPath, (db) => {
        assert.equal(getSession(db, 'child-sess-order2'), undefined);
      });
    } finally {
      cleanup();
    }
  }
});

test('M1-A02 & M1-A04: Untrusted child cwd rejects activation with project_not_trusted and transitions lease to failed state', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const identity: InvocationIdentityV1 = {
      version: 1,
      invocationId: 'inv-untrusted',
      childSessionId: 'child-untrusted',
      invokingParentSessionId: 'parent-1',
    };
    const lease = new InvocationLease(identity, dbPath, {
      cwd: '/workspace/untrusted',
      isProjectTrusted: () => false,
    });

    await assert.rejects(async () => {
      await lease.activate();
    }, /project_not_trusted/);

    // Subsequent activate also rejects
    await assert.rejects(async () => {
      await lease.activate();
    }, /lease_activation_failed/);

    // perform on failed lease rejects
    await assert.rejects(async () => {
      await lease.perform(undefined, async () => 'test');
    }, /invocation_terminated/);

    // Database file was not created or modified
    assert.equal(existsSync(dbPath), false);
  } finally {
    cleanup();
  }
});

test('M1-A04: Continuation from another parent preserves child ID and attributes new writes to new parent while preserving prior attribution', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scopeKey = '["project","continuation-project"]';

    // Attempt 1 from parent 1
    const identity1: InvocationIdentityV1 = {
      version: 1,
      invocationId: 'inv-attempt-1',
      childSessionId: 'child-shared-sess',
      invokingParentSessionId: 'parent-sess-1',
      taskId: 'task-cont',
      attempt: 1,
    };
    const lease1 = new InvocationLease(identity1, dbPath, {
      cwd: '/tmp',
      isProjectTrusted: () => true,
    });
    await lease1.activate();

    withDatabase(dbPath, (db) => {
      createMemory(db, {
        scopeKey,
        title: 'First Attempt Memory',
        content: 'Created under parent 1',
        type: 'observation',
        sessionId: 'child-shared-sess',
        invokingParentSessionId: 'parent-sess-1',
        invocationId: 'inv-attempt-1',
      });
    });
    await lease1.terminate('completed');

    // Attempt 2 (continuation) from parent 2
    const identity2: InvocationIdentityV1 = {
      version: 1,
      invocationId: 'inv-attempt-2',
      childSessionId: 'child-shared-sess', // Identical child session ID preserved!
      invokingParentSessionId: 'parent-sess-2', // New parent session!
      taskId: 'task-cont',
      attempt: 2,
    };
    const lease2 = new InvocationLease(identity2, dbPath, {
      cwd: '/tmp',
      isProjectTrusted: () => true,
    });
    await lease2.activate();

    withDatabase(dbPath, (db) => {
      createMemory(db, {
        scopeKey,
        title: 'Second Attempt Memory',
        content: 'Created under parent 2',
        type: 'observation',
        sessionId: 'child-shared-sess',
        invokingParentSessionId: 'parent-sess-2',
        invocationId: 'inv-attempt-2',
      });
    });
    await lease2.terminate('completed');

    // In DB: Single child session row, retained closed
    withDatabase(dbPath, (db) => {
      const sess = getSession(db, 'child-shared-sess');
      assert.ok(sess);
      assert.equal(sess.status, 'closed');

      // Both memories are preserved with their exact respective attributions
      const mems = db.prepare('SELECT id, title, invoking_parent_session_id, invocation_id FROM memories WHERE session_id = ? ORDER BY id ASC;').all('child-shared-sess') as Array<{
        id: number;
        title: string;
        invoking_parent_session_id: string;
        invocation_id: string;
      }>;
      assert.equal(mems.length, 2);
      assert.equal(mems[0].title, 'First Attempt Memory');
      assert.equal(mems[0].invoking_parent_session_id, 'parent-sess-1');
      assert.equal(mems[0].invocation_id, 'inv-attempt-1');

      assert.equal(mems[1].title, 'Second Attempt Memory');
      assert.equal(mems[1].invoking_parent_session_id, 'parent-sess-2');
      assert.equal(mems[1].invocation_id, 'inv-attempt-2');
    });
  } finally {
    cleanup();
  }
});
