import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { withDatabase } from '../../src/storage/db.ts';
import { initSchema } from '../../src/storage/schema.ts';
import { activateSession } from '../../src/storage/session-store.ts';
import { softDeleteMemory } from '../../src/storage/memory-store.ts';
import { E5Client } from '../../src/client/e5-client.ts';
import { saveAndIndexMemory } from '../../src/indexing/service.ts';

function createTempDb(): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-mini-002-indexing-'));
  const dbPath = join(dir, 'memories.db');
  return {
    dir,
    dbPath,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

function createMockServer(handler: (req: any, res: any) => void): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        url,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function makeUnitVector(dim = 384): number[] {
  const vec = new Array(dim).fill(0);
  vec[0] = 1.0;
  return vec;
}

const CANONICAL_MODEL = 'intfloat/e5-small-v2';
const CANONICAL_REVISION = 'ffb93f3bd4047442299a41ebb6fa998a38507c52';

test('M2-A03: Target validation enforces target_not_found, target_deleted, and target_conflict', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      activateSession(db, 'sess-1', '["global"]', 'normal');
    });

    // 1. target_not_found
    await assert.rejects(
      () => saveAndIndexMemory(dbPath, '["global"]', {
        id: 9999,
        title: 'T',
        content: 'C',
        type: 'fact',
      }, { sessionId: 'sess-1' }),
      /target_not_found/,
    );

    // Save initial memory
    const saved = await saveAndIndexMemory(dbPath, '["global"]', {
      title: 'Active Title',
      content: 'Active Content',
      type: 'fact',
      topicKey: 'topic-alpha',
    }, { sessionId: 'sess-1' });

    assert.equal(saved.committed, true);
    const memId = saved.memory.id;

    // Soft delete it
    withDatabase(dbPath, (db) => {
      softDeleteMemory(db, memId, '["global"]');
    });

    // 2. target_deleted on deleted id
    await assert.rejects(
      () => saveAndIndexMemory(dbPath, '["global"]', {
        id: memId,
        title: 'New Title',
        content: 'New Content',
        type: 'fact',
      }, { sessionId: 'sess-1' }),
      /target_deleted/,
    );

    // 3. target_deleted on deleted topicKey
    await assert.rejects(
      () => saveAndIndexMemory(dbPath, '["global"]', {
        title: 'New Title',
        content: 'New Content',
        type: 'fact',
        topicKey: 'topic-alpha',
      }, { sessionId: 'sess-1' }),
      /target_deleted/,
    );

    // Save another memory
    const mem2 = await saveAndIndexMemory(dbPath, '["global"]', {
      title: 'Mem 2',
      content: 'Content 2',
      type: 'fact',
      topicKey: 'topic-beta',
    }, { sessionId: 'sess-1' });

    const mem3 = await saveAndIndexMemory(dbPath, '["global"]', {
      title: 'Mem 3',
      content: 'Content 3',
      type: 'fact',
    }, { sessionId: 'sess-1' });

    // 4. target_conflict when updating mem3 with mem2's topicKey
    await assert.rejects(
      () => saveAndIndexMemory(dbPath, '["global"]', {
        id: mem3.memory.id,
        title: 'Mem 3 updated',
        content: 'Content 3',
        type: 'fact',
        topicKey: 'topic-beta',
      }, { sessionId: 'sess-1' }),
      /target_conflict/,
    );
  } finally {
    cleanup();
  }
});

test('M2-A03 & M2-A04: Save and index succeeds, text committed before HTTP, passage mapped to title\\ncontent', async () => {
  const { dbPath, cleanup } = createTempDb();
  let capturedPassage: any = null;

  const mock = await createMockServer((req, res) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c.toString(); });
    req.on('end', () => {
      const parsed = JSON.parse(data);
      capturedPassage = parsed.input;
      const codePoints = Array.from(capturedPassage);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: 384,
        normalization: 'l2',
        max_input_tokens: 512,
        data: [{
          input_index: 0,
          chunks: [{
            chunk_index: 0,
            text: capturedPassage,
            start: 0,
            end: codePoints.length,
            token_count: 8,
            embedding: makeUnitVector(),
          }],
        }],
      }));
    });
  });

  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      activateSession(db, 'sess-1', '["global"]', 'normal');
    });

    const client = new E5Client(mock.url);
    const result = await saveAndIndexMemory(dbPath, '["global"]', {
      title: 'Hello Title',
      content: 'World Content',
      type: 'fact',
    }, { sessionId: 'sess-1' }, { client });

    assert.equal(result.committed, true);
    assert.equal(result.indexed, true);
    assert.equal(capturedPassage, 'Hello Title\nWorld Content');

    // Verify SQLite state
    withDatabase(dbPath, (db) => {
      const mem = db.prepare('SELECT * FROM memories WHERE id = ?;').get(result.memory.id) as any;
      assert.equal(mem.indexing_status, 'indexed');
      assert.equal(mem.pending_reason, null);

      const chunks = db.prepare('SELECT * FROM chunks WHERE memory_id = ?;').all(result.memory.id) as any[];
      assert.equal(chunks.length, 1);
      assert.equal(chunks[0].model_id, CANONICAL_MODEL);
      assert.equal(chunks[0].model_revision, CANONICAL_REVISION);
      assert.equal(chunks[0].start_char, 0);
      assert.equal(chunks[0].end_char, Array.from('Hello Title\nWorld Content').length);

      const vec = db.prepare('SELECT count(*) as count FROM memory_vectors WHERE rowid = ?;').get(chunks[0].id) as any;
      assert.equal(vec.count, 1);
    });
  } finally {
    await mock.close();
    cleanup();
  }
});

test('M2-A03: Embedding failure preserves committed text/FTS and leaves status pending with sanitized reason', async () => {
  const { dbPath, cleanup } = createTempDb();

  const mock = await createMockServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'internal_error', message: 'backend failed' } }));
  });

  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      activateSession(db, 'sess-1', '["global"]', 'normal');
    });

    const client = new E5Client(mock.url);
    const result = await saveAndIndexMemory(dbPath, '["global"]', {
      title: 'Pending Searchable Title',
      content: 'Pending unique content 12345',
      type: 'note',
    }, { sessionId: 'sess-1' }, { client });

    assert.equal(result.committed, true);
    assert.equal(result.indexed, false);
    assert.ok(result.error);
    assert.equal(result.error.category, 'unavailable');

    // Verify memory in DB is pending (NOT failed) and has sanitized pending_reason
    withDatabase(dbPath, (db) => {
      const mem = db.prepare('SELECT * FROM memories WHERE id = ?;').get(result.memory.id) as any;
      assert.equal(mem.indexing_status, 'pending');
      assert.ok(mem.pending_reason?.includes('unavailable'));

      // FTS search still finds the text immediately!
      const ftsMatches = db.prepare(`
        SELECT m.id, m.title
        FROM memory_fts f
        JOIN memories m ON m.id = f.rowid
        WHERE memory_fts MATCH '12345';
      `).all() as any[];

      assert.equal(ftsMatches.length, 1);
      assert.equal(ftsMatches[0].id, result.memory.id);
    });
  } finally {
    await mock.close();
    cleanup();
  }
});

test('M2-A04: Version race: concurrent replace during HTTP rejects stale publication without overwriting', async () => {
  const { dbPath, cleanup } = createTempDb();
  let serverResolve: () => void;
  const serverGate = new Promise<void>((r) => { serverResolve = r; });

  const mock = await createMockServer((_req, res) => {
    serverGate.then(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: 384,
        normalization: 'l2',
        max_input_tokens: 512,
        data: [{
          input_index: 0,
          chunks: [{
            chunk_index: 0,
            text: 'Old Title\nOld Content',
            start: 0,
            end: 21,
            token_count: 5,
            embedding: makeUnitVector(),
          }],
        }],
      }));
    });
  });

  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      activateSession(db, 'sess-1', '["global"]', 'normal');
    });

    const client = new E5Client(mock.url);

    // Start save 1
    const savePromise = saveAndIndexMemory(dbPath, '["global"]', {
      title: 'Old Title',
      content: 'Old Content',
      type: 'fact',
    }, { sessionId: 'sess-1' }, { client });

    // Wait small tick for text to commit in save 1
    await new Promise((r) => setTimeout(r, 20));

    // Get memory ID
    let memId = 1;
    withDatabase(dbPath, (db) => {
      const row = db.prepare('SELECT id FROM memories LIMIT 1;').get() as any;
      memId = row.id;

      // Bump version via replaceMemory directly in DB
      db.prepare(`
        UPDATE memories
        SET content_version = content_version + 1,
            title = 'Newer Title',
            updated_at = datetime('now')
        WHERE id = ?;
      `).run(memId);
    });

    // Release server to respond to save 1
    serverResolve!();
    const result1 = await savePromise;

    // Result should indicate committed, but stale publication rejected!
    assert.equal(result1.committed, true);
    assert.equal(result1.indexed, false);
    assert.equal(result1.stale, true);

    // Verify DB still has Newer Title and 0 chunks/vectors from the old request
    withDatabase(dbPath, (db) => {
      const mem = db.prepare('SELECT * FROM memories WHERE id = ?;').get(memId) as any;
      assert.equal(mem.title, 'Newer Title');
      assert.equal(mem.content_version, 2);

      const chunkCount = db.prepare('SELECT count(*) as count FROM chunks WHERE memory_id = ?;').get(memId) as any;
      assert.equal(chunkCount.count, 0);
    });
  } finally {
    await mock.close();
    cleanup();
  }
});

test('M2-A03: Target prevalidation is atomic in ONE BEGIN IMMEDIATE transaction preventing soft-delete resurrection race', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      activateSession(db, 'sess-race', '["global"]', 'normal');
    });

    // Save initial memory
    const saved = await saveAndIndexMemory(dbPath, '["global"]', {
      title: 'Initial Title',
      content: 'Initial Content',
      type: 'fact',
    }, { sessionId: 'sess-race' });

    assert.equal(saved.committed, true);
    const memId = saved.memory.id;

    let racingDeleteAttempted = false;
    let racingDeleteFailedWithBusy = false;

    const racingInput = {
      id: memId,
      get title() {
        if (!racingDeleteAttempted) {
          racingDeleteAttempted = true;
          try {
            // Concurrent connection attempts to soft-delete the memory while input is being processed
            withDatabase(dbPath, (racingDb) => {
              softDeleteMemory(racingDb, memId, '["global"]');
            }, 50);
          } catch (err: any) {
            // If the main connection holds BEGIN IMMEDIATE, SQLite throws busy/locked
            if (err?.message?.includes('busy') || err?.message?.includes('locked') || err?.code === 'SQLITE_BUSY') {
              racingDeleteFailedWithBusy = true;
            } else {
              throw err;
            }
          }
        }
        return 'Updated Title Under Race';
      },
      content: 'Updated Content Under Race',
      type: 'fact',
    };

    try {
      await saveAndIndexMemory(dbPath, '["global"]', racingInput, { sessionId: 'sess-race' });
    } catch (err: any) {
      assert.ok(err.message.includes('target_deleted'), `Expected target_deleted, got ${err.message}`);
    }

    // Crucial assertion: the memory must NEVER have been resurrected with deleted_at = null!
    // If racingDelete attempted and succeeded on another connection, it must NOT have been resurrected!
    if (racingDeleteAttempted && !racingDeleteFailedWithBusy) {
      withDatabase(dbPath, (db) => {
        const mem = db.prepare('SELECT deleted_at FROM memories WHERE id = ?;').get(memId) as { deleted_at: string | null };
        assert.notEqual(mem.deleted_at, null, 'Defect: memory was resurrected (deleted_at reset to null) by racing replace');
      });
    } else {
      // BEGIN IMMEDIATE successfully blocked concurrent write during transaction
      assert.equal(racingDeleteFailedWithBusy, true, 'Expected BEGIN IMMEDIATE to lock DB against concurrent soft-delete');
    }
  } finally {
    cleanup();
  }
});

