import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { withDatabase, openDatabase } from '../../src/storage/db.ts';
import { initSchema, SchemaVersionMismatchError } from '../../src/storage/schema.ts';
import {
  createMemory,
  replaceMemory,
  softDeleteMemory,
  restoreMemory,
  publishSyntheticVectors,
  createEntity,
  createRelation,
  createMemoryEntityLink,
} from '../../src/storage/memory-store.ts';
import {
  activateSession,
  closeSession,
  countAssociatedKnowledge,
  cleanupTerminalChildSession,
} from '../../src/storage/session-store.ts';

function createTempDb(): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-mini-001-storage-'));
  const dbPath = join(dir, 'memories.db');
  return {
    dir,
    dbPath,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

test('M1-A01: DatabaseSync opens with WAL, foreign keys, busy timeout, and loads sqlite-vec with extension loading disabled after load', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      const journal = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
      assert.equal(journal.journal_mode, 'wal');
      const fk = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
      assert.equal(fk.foreign_keys, 1);
      const busy = db.prepare('PRAGMA busy_timeout;').get() as { timeout: number };
      assert.equal(busy.timeout, 5000);

      // Verify sqlite-vec loaded: vec_version() function exists
      const vecVersion = db.prepare('SELECT vec_version() AS version;').get() as { version: string };
      assert.ok(typeof vecVersion.version === 'string' && vecVersion.version.length > 0);

      // Verify extension loading is disabled
      assert.throws(() => {
        db.loadExtension('non_existent_extension');
      });
    });
  } finally {
    cleanup();
  }
});

test('M1-A01: withDatabase guarantees connection closure even when callback throws', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    assert.throws(() => {
      withDatabase(dbPath, (db) => {
        throw new Error('deliberate failure');
      });
    }, /deliberate failure/);

    // Can reopen and lock immediately because previous connection was closed in finally
    withDatabase(dbPath, (db) => {
      const journal = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
      assert.equal(journal.journal_mode, 'wal');
    });
  } finally {
    cleanup();
  }
});

test('M1-A01: initSchema creates versioned schema idempotently and reports version mismatch', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      // Run second time — must be idempotent
      initSchema(db);

      const meta = db.prepare('SELECT version FROM schema_meta;').get() as { version: number };
      assert.equal(meta.version, 2);
    });

    // Incompatible version mismatch
    withDatabase(dbPath, (db) => {
      db.prepare('UPDATE schema_meta SET version = 99;').run();
      assert.throws(() => {
        initSchema(db);
      }, (err) => err instanceof SchemaVersionMismatchError);
    });
  } finally {
    cleanup();
  }
});

test('MINI-001: initSchema upgrades v1 schema to v2 additively preserving existing data', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    // 1. Manually create v1 schema with data
    withDatabase(dbPath, (db) => {
      db.exec(`
        CREATE TABLE schema_meta (
          version INTEGER PRIMARY KEY,
          updated_at TEXT NOT NULL
        );
        INSERT INTO schema_meta (version, updated_at) VALUES (1, datetime('now'));

        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          scope_key TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          closed_at TEXT
        );

        CREATE TABLE memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope_key TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT NOT NULL,
          topic_key TEXT,
          content_version INTEGER NOT NULL DEFAULT 1,
          deleted_at TEXT,
          indexing_status TEXT NOT NULL DEFAULT 'pending',
          pending_reason TEXT,
          session_id TEXT NOT NULL,
          invoking_parent_session_id TEXT,
          invocation_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        INSERT INTO sessions (id, scope_key, kind, status, created_at, updated_at)
        VALUES ('sess-v1', '["project","p1"]', 'normal', 'open', datetime('now'), datetime('now'));

        INSERT INTO memories (scope_key, title, content, type, session_id, created_at, updated_at)
        VALUES ('["project","p1"]', 'Pre-existing Memory', 'Important v1 knowledge', 'note', 'sess-v1', datetime('now'), datetime('now'));
      `);
    });

    // 2. Run initSchema which must migrate to v2
    withDatabase(dbPath, (db) => {
      initSchema(db);

      const meta = db.prepare('SELECT version FROM schema_meta;').get() as { version: number };
      assert.equal(meta.version, 2);

      // Verify existing memory is intact
      const mem = db.prepare('SELECT * FROM memories WHERE id = 1;').get() as any;
      assert.equal(mem.title, 'Pre-existing Memory');
      assert.equal(mem.content, 'Important v1 knowledge');

      // Verify user_messages table exists
      const msgTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_messages';").get() as any;
      assert.ok(msgTable, 'user_messages table must exist');

      // Verify user_messages_fts exists
      const ftsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_messages_fts';").get() as any;
      assert.ok(ftsTable, 'user_messages_fts virtual table must exist');
    });
  } finally {
    cleanup();
  }
});

test('MINI-001: history-store createUserMessage, getUserMessage and searchUserMessages with keyset pagination', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const { createUserMessage, getUserMessage, searchUserMessages } = await import('../../src/storage/history-store.ts');
    withDatabase(dbPath, (db) => {
      initSchema(db);

      // Need active sessions for foreign keys
      activateSession(db, 'sess-1', '["project","p1"]', 'normal');
      activateSession(db, 'sess-2', '["project","p2"]', 'normal');

      // Create messages in project 1
      const m1 = createUserMessage(db, { sessionId: 'sess-1', projectKey: 'git:/repo1', content: 'First message: deploy kubernetes cluster' });
      const m2 = createUserMessage(db, { sessionId: 'sess-1', projectKey: 'git:/repo1', content: 'Second message: configure ingress nginx' });
      const m3 = createUserMessage(db, { sessionId: 'sess-1', projectKey: 'git:/repo1', content: 'Third message: deploy redis cache' });

      // Create message in project 2
      const mOther = createUserMessage(db, { sessionId: 'sess-2', projectKey: 'git:/repo2', content: 'Foreign message: deploy secret in repo2' });

      assert.ok(m1.id > 0);
      assert.ok(m2.id > m1.id);
      assert.ok(m3.id > m2.id);

      // Test getUserMessage
      const fetched1 = getUserMessage(db, m1.id, 'git:/repo1');
      assert.ok(fetched1);
      assert.equal(fetched1.content, 'First message: deploy kubernetes cluster');

      // Cross-project fail-closed: querying m1 with project 2 returns null
      const fetchedCross1 = getUserMessage(db, m1.id, 'git:/repo2');
      assert.equal(fetchedCross1, null, 'Must not disclose message from different project');

      // Cross-project fail-closed: querying foreign message from project 1 returns null
      const fetchedCross2 = getUserMessage(db, mOther.id, 'git:/repo1');
      assert.equal(fetchedCross2, null, 'Must not disclose foreign project message');

      // Non-existent id returns null
      const fetchedNonExistent = getUserMessage(db, 99999, 'git:/repo1');
      assert.equal(fetchedNonExistent, null);

      // Search all messages in project 1 (descending)
      const listAll = searchUserMessages(db, { projectKey: 'git:/repo1', limit: 10 });
      assert.equal(listAll.length, 3);
      assert.deepEqual(listAll.map((m) => m.id), [m3.id, m2.id, m1.id]);

      // Keyset pagination: beforeId
      const page1 = searchUserMessages(db, { projectKey: 'git:/repo1', limit: 2 });
      assert.equal(page1.length, 2);
      assert.deepEqual(page1.map((m) => m.id), [m3.id, m2.id]);

      // Next page using beforeId = m2.id
      const page2 = searchUserMessages(db, { projectKey: 'git:/repo1', beforeId: m2.id, limit: 2 });
      assert.equal(page2.length, 1);
      assert.equal(page2[0].id, m1.id);

      // Append-safe check: inserting a new message before fetching page 2 does not disrupt page 2
      const m4 = createUserMessage(db, { sessionId: 'sess-1', projectKey: 'git:/repo1', content: 'Fourth message: new arrival' });
      assert.ok(m4.id > m3.id);
      const page2Again = searchUserMessages(db, { projectKey: 'git:/repo1', beforeId: m2.id, limit: 2 });
      assert.equal(page2Again.length, 1);
      assert.equal(page2Again[0].id, m1.id);

      // Lexical FTS search: 'deploy' matches m1 and m3 in project 1, but NOT mOther in project 2
      const searchDeploy = searchUserMessages(db, { projectKey: 'git:/repo1', query: 'deploy', limit: 10 });
      assert.equal(searchDeploy.length, 2);
      assert.deepEqual(searchDeploy.map((m) => m.id), [m3.id, m1.id]);

      // Lexical FTS search with session filter
      const searchSession = searchUserMessages(db, { projectKey: 'git:/repo1', sessionId: 'sess-1', query: 'ingress', limit: 10 });
      assert.equal(searchSession.length, 1);
      assert.equal(searchSession[0].id, m2.id);
    });
  } finally {
    cleanup();
  }
});


test('M1-A05 & M1-A08: cleanupTerminalChildSession deletes empty child session and retains child with knowledge', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      const scopeKey = '["project","test-project"]';

      // Child 1: activated but no memories/entities/relations/links saved
      activateSession(db, 'child-empty', scopeKey, 'child');
      const resEmpty = cleanupTerminalChildSession(db, 'child-empty');
      assert.equal(resEmpty.retained, false);
      const rowEmpty = db.prepare('SELECT * FROM sessions WHERE id = ?;').get('child-empty');
      assert.equal(rowEmpty, undefined);

      // Child 2: saved a memory, then soft-deleted it
      activateSession(db, 'child-with-deleted-memory', scopeKey, 'child');
      const mem = createMemory(db, {
        scopeKey,
        title: 'Draft note',
        content: 'Soft deleted note',
        type: 'note',
        sessionId: 'child-with-deleted-memory',
      });
      softDeleteMemory(db, mem.id, scopeKey);

      // Even with only soft-deleted memory, the knowledge count is > 0, so child must be retained closed!
      const resDeleted = cleanupTerminalChildSession(db, 'child-with-deleted-memory');
      assert.equal(resDeleted.retained, true);
      const rowDeleted = db.prepare('SELECT * FROM sessions WHERE id = ?;').get('child-with-deleted-memory') as { status: string; closed_at: string | null };
      assert.equal(rowDeleted.status, 'closed');
      assert.ok(rowDeleted.closed_at !== null);

      // Child 3: saved an entity
      activateSession(db, 'child-with-entity', scopeKey, 'child');
      createEntity(db, {
        id: 'child-ent-1',
        type: 'concept',
        canonicalName: 'subagent',
        scopeKey,
        displayName: 'Subagent Concept',
        sessionId: 'child-with-entity',
      });
      const resEnt = cleanupTerminalChildSession(db, 'child-with-entity');
      assert.equal(resEnt.retained, true);
      const rowEnt = db.prepare('SELECT * FROM sessions WHERE id = ?;').get('child-with-entity') as { status: string };
      assert.equal(rowEnt.status, 'closed');
    });
  } finally {
    cleanup();
  }
});

test('M1-A01 & M1-A08: SQLite contention and busy timeout handling', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db1) => {
      initSchema(db1);
      // Open second connection
      withDatabase(dbPath, (db2) => {
        // Start transaction in db1
        db1.exec('BEGIN IMMEDIATE;');
        db1.prepare("INSERT INTO sessions (id, scope_key, kind, status, created_at, updated_at) VALUES ('s1', '[\"global\"]', 'normal', 'open', datetime('now'), datetime('now'));").run();

        // db2 reading works under WAL!
        const readResult = db2.prepare('SELECT COUNT(*) AS c FROM sessions;').get() as { c: number };
        assert.equal(readResult.c, 0); // WAL snapshot isolation

        // Commit in db1
        db1.exec('COMMIT;');

        // Now db2 sees committed row
        const afterCommit = db2.prepare('SELECT COUNT(*) AS c FROM sessions;').get() as { c: number };
        assert.equal(afterCommit.c, 1);
      });
    });
  } finally {
    cleanup();
  }
});

test('M1-A08: Storage invariants — topic_key uniqueness, soft-delete, restore, FTS5 sync, and atomic vector publication', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      const scopeKey = '["project","test-project"]';

      // 1. Create a session first for foreign key reference
      activateSession(db, 'session-1', scopeKey, 'normal');

      // 2. Create memory
      const mem = createMemory(db, {
        scopeKey,
        title: 'Architecture Decision',
        content: 'We use SQLite with WAL mode.',
        type: 'decision',
        topicKey: 'storage-arch',
        sessionId: 'session-1',
      });
      assert.equal(mem.id, 1);
      assert.equal(mem.content_version, 1);

      // Verify lexical visibility in FTS5
      const ftsResults = db.prepare('SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?;').all('SQLite') as Array<{ rowid: number }>;
      assert.equal(ftsResults.length, 1);
      assert.equal(ftsResults[0].rowid, mem.id);

      // 3. Topic key uniqueness across all rows
      assert.throws(() => {
        createMemory(db, {
          scopeKey,
          title: 'Duplicate Topic',
          content: 'Conflicting content',
          type: 'decision',
          topicKey: 'storage-arch',
          sessionId: 'session-1',
        });
      }, /UNIQUE constraint failed/);

      // 4. Soft-delete memory
      softDeleteMemory(db, mem.id, scopeKey);

      // Verify removed from FTS5 lexical visibility
      const ftsAfterDelete = db.prepare('SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?;').all('SQLite');
      assert.equal(ftsAfterDelete.length, 0);

      // Verify topic_key is STILL unique even when soft-deleted!
      assert.throws(() => {
        createMemory(db, {
          scopeKey,
          title: 'Another with same topic',
          content: 'Should conflict with soft-deleted',
          type: 'decision',
          topicKey: 'storage-arch',
          sessionId: 'session-1',
        });
      }, /UNIQUE constraint failed/);

      // 5. Restore memory
      const restored = restoreMemory(db, mem.id, scopeKey);
      assert.equal(restored.deleted_at, null);

      // Lexical visibility restored in FTS5
      const ftsAfterRestore = db.prepare('SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?;').all('SQLite') as Array<{ rowid: number }>;
      assert.equal(ftsAfterRestore.length, 1);

      // 6. Replace memory bumps version and clears old chunks/vectors
      const replaced = replaceMemory(db, mem.id, {
        scopeKey,
        title: 'Updated Architecture',
        content: 'We use SQLite with vec0 and FTS5.',
        type: 'decision',
        topicKey: 'storage-arch',
        sessionId: 'session-1',
      });
      assert.equal(replaced.content_version, 2);

      // 7. Atomic vector publication checks version and deletion inside transaction
      const dummyVec = Array(384).fill(0.01);
      // Fails if published for obsolete version 1
      assert.throws(() => {
        publishSyntheticVectors(db, mem.id, 1, [
          { chunk_text: 'Obsolete chunk', start_char: 0, end_char: 14, token_count: 3, vector: dummyVec },
        ]);
      }, /version mismatch/i);

      // Succeeds for current version 2
      publishSyntheticVectors(db, mem.id, 2, [
        { chunk_text: 'Current chunk', start_char: 0, end_char: 13, token_count: 3, vector: dummyVec },
      ]);

      const chunkCount = db.prepare('SELECT COUNT(*) AS c FROM chunks WHERE memory_id = ?;').get(mem.id) as { c: number };
      assert.equal(chunkCount.c, 1);
      const vecCount = db.prepare('SELECT COUNT(*) AS c FROM memory_vectors;').get() as { c: number };
      assert.equal(vecCount.c, 1);

      // 8. Entities, relations, memory_entity_links and associated knowledge counting
      createEntity(db, {
        id: 'ent-1',
        type: 'module',
        canonicalName: 'storage',
        scopeKey,
        displayName: 'Storage Engine',
        sessionId: 'session-1',
        memoryId: mem.id,
      });

      createEntity(db, {
        id: 'ent-2',
        type: 'concept',
        canonicalName: 'sqlite',
        scopeKey,
        displayName: 'SQLite DB',
        sessionId: 'session-1',
      });

      createRelation(db, {
        id: 'rel-1',
        sourceEntityId: 'ent-1',
        targetEntityId: 'ent-2',
        relationType: 'uses',
        scopeKey,
        sessionId: 'session-1',
      });

      createMemoryEntityLink(db, {
        id: 'link-1',
        memoryId: mem.id,
        entityId: 'ent-2',
        scopeKey,
        sessionId: 'session-1',
      });

      const knowledgeCount = countAssociatedKnowledge(db, 'session-1');
      // 1 memory + 2 entities + 1 relation + 1 link = 5
      assert.equal(knowledgeCount, 5);

      // Non-existent session has 0
      assert.equal(countAssociatedKnowledge(db, 'non-existent-session'), 0);
    });
  } finally {
    cleanup();
  }
});

test('M1-A01 & M1-A08: openDatabase sets PRAGMA busy_timeout before WAL and waits for concurrent worker lock release', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    // Initialize DB to WAL mode
    withDatabase(dbPath, (db) => {
      initSchema(db);
    });

    // Worker holds write transaction for 80ms
    const workerScript = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { openDatabase } from './src/storage/db.ts';

    const db = openDatabase(workerData.dbPath);
    db.exec('BEGIN IMMEDIATE;');
    parentPort.postMessage({ locked: true });

    setTimeout(() => {
      db.exec('COMMIT;');
      db.close();
      parentPort.postMessage({ released: true });
    }, 80);
    `;

    const worker = new Worker(workerScript, { eval: true, workerData: { dbPath } });

    await new Promise<void>((resolve, reject) => {
      worker.on('message', (msg) => {
        if (msg.locked) {
          try {
            // Main thread opens connection via withDatabase.
            // Because busy_timeout is set before WAL and subsequent statements,
            // it waits up to 5000ms and acquires the lock when worker releases it.
            const t0 = Date.now();
            withDatabase(dbPath, (db2) => {
              db2.exec('BEGIN IMMEDIATE;');
              db2.exec('COMMIT;');
            });
            const elapsed = Date.now() - t0;
            assert.ok(elapsed >= 50, `Expected wait time >= 50ms but was ${elapsed}ms`);
            resolve();
          } catch (err) {
            reject(err);
          }
        }
      });
      worker.on('error', reject);
    });

    await worker.terminate();
  } finally {
    cleanup();
  }
});

test('M1-A01: Concurrent fresh database initialization across multiple workers succeeds without lock failure', async () => {
  const workerScript = `
  import { parentPort, workerData } from 'node:worker_threads';
  import { openDatabase } from './src/storage/db.ts';
  import { initSchema } from './src/storage/schema.ts';

  const barrier = new Int32Array(workerData.sharedBuffer);
  Atomics.add(barrier, 0, 1);
  Atomics.wait(barrier, 1, 0);

  try {
    const db = openDatabase(workerData.dbPath);
    try {
      initSchema(db);
      parentPort.postMessage({ success: true, id: workerData.id });
    } finally {
      db.close();
    }
  } catch (err) {
    parentPort.postMessage({ success: false, id: workerData.id, error: err.message, stack: err.stack });
  }
  `;

  const numWorkers = 6;
  for (let iter = 0; iter < 5; iter++) {
    const { dbPath, cleanup } = createTempDb();
    try {
      const sharedBuffer = new SharedArrayBuffer(8);
      const barrier = new Int32Array(sharedBuffer);
      const workers: Worker[] = [];
      const results: Array<{ success: boolean; id: number; error?: string; stack?: string }> = [];

      for (let i = 0; i < numWorkers; i++) {
        const w = new Worker(workerScript, { eval: true, workerData: { id: i, dbPath, sharedBuffer } });
        workers.push(w);
        w.on('message', (msg) => results.push(msg));
      }

      while (Atomics.load(barrier, 0) < numWorkers) {
        await new Promise((r) => setTimeout(r, 2));
      }

      Atomics.store(barrier, 1, 1);
      Atomics.notify(barrier, 1, numWorkers);

      await Promise.all(workers.map((w) => new Promise((resolve) => w.on('exit', resolve))));

      const failures = results.filter((r) => !r.success);
      assert.equal(failures.length, 0, `Iteration ${iter} failed with: ${failures.map((f) => f.error).join(', ')}`);

      withDatabase(dbPath, (db) => {
        const journal = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
        assert.equal(journal.journal_mode, 'wal');
        const meta = db.prepare('SELECT version FROM schema_meta;').get() as { version: number };
        assert.equal(meta.version, 2);
      });
    } finally {
      cleanup();
    }
  }
});

test('M1-A01: openDatabase respects total deadline budget and throws when lock is held beyond budget without sleeping five seconds', async () => {
  const { dbPath, cleanup } = createTempDb();
  let worker: Worker | undefined;
  try {
    const workerScript = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { DatabaseSync } from 'node:sqlite';

    const db = new DatabaseSync(workerData.dbPath);
    db.exec('BEGIN EXCLUSIVE;');
    parentPort.postMessage({ locked: true });

    parentPort.on('message', (msg) => {
      if (msg.unlock) {
        try { db.exec('ROLLBACK;'); } catch {}
        db.close();
        parentPort.postMessage({ closed: true });
      }
    });
    `;

    worker = new Worker(workerScript, { eval: true, workerData: { dbPath } });

    await new Promise<void>((resolve, reject) => {
      worker!.on('message', (msg) => {
        if (msg.locked) {
          try {
            const start = performance.now();
            assert.throws(() => {
              openDatabase(dbPath, { busyTimeoutMs: 60 });
            }, (err: any) => {
              const msg = String(err?.message ?? '');
              return msg.includes('database is locked') || msg.includes('busy');
            });
            const elapsed = performance.now() - start;
            assert.ok(
              elapsed >= 45 && elapsed <= 90,
              `Expected elapsed around 60ms (between 45ms and 90ms, well below 2x=120ms), got ${elapsed}ms`
            );
            worker!.postMessage({ unlock: true });
          } catch (e) {
            reject(e);
          }
        } else if (msg.closed) {
          resolve();
        }
      });
      worker!.on('error', reject);
    });
  } finally {
    if (worker) {
      await worker.terminate();
    }
    cleanup();
  }
});

test('M1-A01: openDatabase respects total deadline budget around 400ms under lock contention and does not double timeout', async () => {
  const { dbPath, cleanup } = createTempDb();
  let worker: Worker | undefined;
  try {
    const workerScript = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { DatabaseSync } from 'node:sqlite';

    const db = new DatabaseSync(workerData.dbPath);
    db.exec('BEGIN EXCLUSIVE;');
    parentPort.postMessage({ locked: true });

    parentPort.on('message', (msg) => {
      if (msg.unlock) {
        try { db.exec('ROLLBACK;'); } catch {}
        db.close();
        parentPort.postMessage({ closed: true });
      }
    });
    `;

    worker = new Worker(workerScript, { eval: true, workerData: { dbPath } });

    await new Promise<void>((resolve, reject) => {
      worker!.on('message', (msg) => {
        if (msg.locked) {
          try {
            const start = performance.now();
            assert.throws(() => {
              openDatabase(dbPath, { busyTimeoutMs: 400 });
            }, (err: any) => {
              const msg = String(err?.message ?? '');
              return msg.includes('database is locked') || msg.includes('busy');
            });
            const elapsed = performance.now() - start;
            assert.ok(
              elapsed >= 350 && elapsed <= 550,
              `Expected elapsed around 400ms (between 350ms and 550ms, well below 2x=800ms), got ${elapsed}ms`
            );
            worker!.postMessage({ unlock: true });
          } catch (e) {
            reject(e);
          }
        } else if (msg.closed) {
          resolve();
        }
      });
      worker!.on('error', reject);
    });
  } finally {
    if (worker) {
      await worker.terminate();
    }
    cleanup();
  }
});

test('M1-A01: openDatabase under contention never executes PRAGMA journal_mode = WAL when journal_mode read exhausts deadline', async () => {
  const { dbPath, cleanup } = createTempDb();
  let worker: Worker | undefined;
  try {
    const workerScript = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { DatabaseSync } from 'node:sqlite';

    const db = new DatabaseSync(workerData.dbPath);
    db.exec('BEGIN EXCLUSIVE;');
    parentPort.postMessage({ locked: true });

    parentPort.on('message', (msg) => {
      if (msg.unlock) {
        try { db.exec('ROLLBACK;'); } catch {}
        db.close();
        parentPort.postMessage({ closed: true });
      }
    });
    `;

    worker = new Worker(workerScript, { eval: true, workerData: { dbPath } });

    await new Promise<void>((resolve, reject) => {
      worker!.on('message', (msg) => {
        if (msg.locked) {
          const origPrepare = DatabaseSync.prototype.prepare;
          const traces: Array<{ sql: string; time: number }> = [];
          DatabaseSync.prototype.prepare = function (this: DatabaseSync, sql: string) {
            traces.push({ sql, time: performance.now() });
            return origPrepare.call(this, sql);
          };

          try {
            assert.throws(() => {
              openDatabase(dbPath, { busyTimeoutMs: 60 });
            }, (err: any) => {
              const msg = String(err?.message ?? '');
              return msg.includes('database is locked') || msg.includes('busy');
            });

            const walAttempts = traces.filter((t) => t.sql.includes('PRAGMA journal_mode = WAL'));
            assert.equal(
              walAttempts.length,
              0,
              `Expected 0 WAL transition attempts after deadline expired during read, got ${walAttempts.length}`
            );
            worker!.postMessage({ unlock: true });
          } catch (e) {
            reject(e);
          } finally {
            DatabaseSync.prototype.prepare = origPrepare;
          }
        } else if (msg.closed) {
          resolve();
        }
      });
      worker!.on('error', reject);
    });
  } finally {
    if (worker) {
      await worker.terminate();
    }
    cleanup();
  }
});

test('M1-A01: openDatabase rejects invalid, negative, nonfinite, or unsafe integer busyTimeoutMs before filesystem work', () => {
  const nonExistentDir = join(tmpdir(), 'pi-memory-invalid-timeout-' + Date.now());
  const dbPath = join(nonExistentDir, 'memories.db');

  try {
    assert.throws(() => openDatabase(dbPath, -1), TypeError);
    assert.throws(() => openDatabase(dbPath, { busyTimeoutMs: -100 }), TypeError);
    assert.throws(() => openDatabase(dbPath, { busyTimeoutMs: Infinity }), TypeError);
    assert.throws(() => openDatabase(dbPath, { busyTimeoutMs: -Infinity }), TypeError);
    assert.throws(() => openDatabase(dbPath, { busyTimeoutMs: NaN }), TypeError);
    assert.throws(() => openDatabase(dbPath, { busyTimeoutMs: 1.5 }), TypeError);
    assert.throws(() => openDatabase(dbPath, { busyTimeoutMs: Number.MAX_SAFE_INTEGER + 10 }), TypeError);
    assert.throws(() => openDatabase(dbPath, { busyTimeoutMs: '5000' as any }), TypeError);

    assert.equal(
      existsSync(nonExistentDir),
      false,
      'Directory must not be created when timeout parameter is invalid'
    );
  } finally {
    try { rmSync(nonExistentDir, { recursive: true, force: true }); } catch {}
  }
});

test('M1-A01: openDatabase with busyTimeoutMs: 0 succeeds on uncontended idle database and transitions to WAL', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const db1 = openDatabase(dbPath, { busyTimeoutMs: 0 });
    try {
      const journal1 = db1.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
      assert.equal(journal1.journal_mode, 'wal');
    } finally {
      db1.close();
    }

    const { dbPath: dbPath2, cleanup: cleanup2 } = createTempDb();
    try {
      const db2 = openDatabase(dbPath2, 0);
      try {
        const journal2 = db2.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
        assert.equal(journal2.journal_mode, 'wal');
      } finally {
        db2.close();
      }
    } finally {
      cleanup2();
    }
  } finally {
    cleanup();
  }
});

test('M1-A01: openDatabase with busyTimeoutMs: 0 under lock contention fails immediately without retrying or waiting', async () => {
  const { dbPath, cleanup } = createTempDb();
  let worker: Worker | undefined;
  try {
    const workerScript = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { DatabaseSync } from 'node:sqlite';

    const db = new DatabaseSync(workerData.dbPath);
    db.exec('BEGIN EXCLUSIVE;');
    parentPort.postMessage({ locked: true });

    parentPort.on('message', (msg) => {
      if (msg.unlock) {
        try { db.exec('ROLLBACK;'); } catch {}
        db.close();
        parentPort.postMessage({ closed: true });
      }
    });
    `;

    worker = new Worker(workerScript, { eval: true, workerData: { dbPath } });

    await new Promise<void>((resolve, reject) => {
      worker!.on('message', (msg) => {
        if (msg.locked) {
          try {
            const start = performance.now();
            assert.throws(() => {
              openDatabase(dbPath, { busyTimeoutMs: 0 });
            }, (err: any) => {
              const msg = String(err?.message ?? '');
              return msg.includes('database is locked') || msg.includes('busy');
            });
            const elapsed = performance.now() - start;
            assert.ok(elapsed < 100, `Expected immediate failure < 100ms with zero timeout, got ${elapsed}ms`);
            worker!.postMessage({ unlock: true });
          } catch (e) {
            reject(e);
          }
        } else if (msg.closed) {
          resolve();
        }
      });
      worker!.on('error', reject);
    });
  } finally {
    if (worker) {
      await worker.terminate();
    }
    cleanup();
  }
});

test('M1-A01: openDatabase propagates noncontention errors immediately without retrying', () => {
  const invalidPath = '/dev/null/impossible-path/memories.db';
  const start = Date.now();
  assert.throws(() => {
    openDatabase(invalidPath);
  });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `Expected fast failure for noncontention error, got ${elapsed}ms`);
});


