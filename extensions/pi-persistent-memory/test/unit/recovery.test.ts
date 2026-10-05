import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { withDatabase } from '../../src/storage/db.ts';
import { initSchema } from '../../src/storage/schema.ts';
import { activateSession } from '../../src/storage/session-store.ts';
import { createMemory, softDeleteMemory } from '../../src/storage/memory-store.ts';
import { E5Client } from '../../src/client/e5-client.ts';
import { reindexMemories } from '../../src/indexing/service.ts';

function createTempDb(): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-mini-002-recovery-'));
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

test('M2-A05: Explicit ID reindex, scope pending, and all-project authorization', async () => {
  const { dbPath, cleanup } = createTempDb();

  const mock = await createMockServer((req, res) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c.toString(); });
    req.on('end', () => {
      const parsed = JSON.parse(data);
      const input = parsed.input;
      const codePoints = Array.from(input);
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
            text: input,
            start: 0,
            end: codePoints.length,
            token_count: 2,
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
      activateSession(db, 'sess-2', '["project","p1"]', 'normal');

      createMemory(db, { scopeKey: '["global"]', title: 'G1', content: 'G1', type: 'fact', sessionId: 'sess-1' });
      const m2 = createMemory(db, { scopeKey: '["global"]', title: 'G2', content: 'G2', type: 'fact', sessionId: 'sess-1' });
      softDeleteMemory(db, m2.id, '["global"]');
      createMemory(db, { scopeKey: '["project","p1"]', title: 'P1', content: 'P1', type: 'fact', sessionId: 'sess-2' });
    });

    const client = new E5Client(mock.url);

    // 1. Specific deleted ID rejects with target_deleted
    await assert.rejects(
      () => reindexMemories(dbPath, { target: 'id', id: 2, scopeKey: '["global"]' }, { client }),
      /target_deleted/,
    );

    // 2. All-project recovery without explicitAllProjects flag rejects
    await assert.rejects(
      () => reindexMemories(dbPath, { target: 'all_pending', scopeKey: '["global"]' }, { client }),
      /explicit_all_projects_required/,
    );

    // 3. Specific active ID reindexes
    const resId = await reindexMemories(dbPath, { target: 'id', id: 1, scopeKey: '["global"]' }, { client });
    assert.equal(resId.processed, 1);
    assert.equal(resId.succeeded, 1);
    assert.equal(resId.outcomes[0].id, 1);
    assert.equal(resId.outcomes[0].status, 'indexed');

    // 4. Specific ID rejects cursor
    await assert.rejects(
      () => reindexMemories(dbPath, { target: 'id', id: 1, scopeKey: '["global"]', cursor: 'any-cursor' }, { client }),
      /cursor_not_supported_for_id/,
    );
  } finally {
    await mock.close();
    cleanup();
  }
});

test('M2-A05 & M2-A06: Sequential batching limit <= 5, continuation cursor, and size <= 6KiB', async () => {
  const { dbPath, cleanup } = createTempDb();

  const mock = await createMockServer((req, res) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c.toString(); });
    req.on('end', () => {
      const parsed = JSON.parse(data);
      const input = parsed.input;
      const codePoints = Array.from(input);
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
            text: input,
            start: 0,
            end: codePoints.length,
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
      for (let i = 1; i <= 7; i++) {
        createMemory(db, { scopeKey: '["global"]', title: `Title ${i}`, content: `Content ${i}`, type: 'fact', sessionId: 'sess-1' });
      }
    });

    const client = new E5Client(mock.url);

    // Batch 1: should process exactly 5 memories (IDs 1..5)
    const batch1 = await reindexMemories(dbPath, { target: 'scope_pending', scopeKey: '["global"]' }, { client });
    assert.equal(batch1.processed, 5);
    assert.equal(batch1.succeeded, 5);
    assert.equal(batch1.failed, 0);
    assert.equal(batch1.remaining, 2);
    assert.equal(batch1.has_more, true);
    assert.ok(batch1.next_cursor);

    // Envelope size <= 6 KiB
    const jsonBytes = Buffer.byteLength(JSON.stringify(batch1), 'utf8');
    assert.ok(jsonBytes <= 6144, `Serialized result ${jsonBytes} exceeded 6144 bytes`);

    // Batch 2 with cursor: should process remaining 2 memories (IDs 6..7)
    const batch2 = await reindexMemories(dbPath, { target: 'scope_pending', scopeKey: '["global"]', cursor: batch1.next_cursor ?? undefined }, { client });
    assert.equal(batch2.processed, 2);
    assert.equal(batch2.succeeded, 2);
    assert.equal(batch2.remaining, 0);
    assert.equal(batch2.has_more, false);
    assert.equal(batch2.next_cursor, null);
  } finally {
    await mock.close();
    cleanup();
  }
});

test('M2-A05: Unavailability stops batch immediately without retrying remaining memories', async () => {
  const { dbPath, cleanup } = createTempDb();
  let callCount = 0;

  const mock = await createMockServer((_req, res) => {
    callCount++;
    if (callCount === 1) {
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
            text: 'Title 1\nContent 1',
            start: 0,
            end: 17,
            token_count: 5,
            embedding: makeUnitVector(),
          }],
        }],
      }));
    } else {
      // Fail on memory 2 with 503
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'model_not_ready', message: 'not ready' } }));
    }
  });

  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      activateSession(db, 'sess-1', '["global"]', 'normal');
      for (let i = 1; i <= 4; i++) {
        createMemory(db, { scopeKey: '["global"]', title: `Title ${i}`, content: `Content ${i}`, type: 'fact', sessionId: 'sess-1' });
      }
    });

    const client = new E5Client(mock.url);
    const result = await reindexMemories(dbPath, { target: 'scope_pending', scopeKey: '["global"]' }, { client });

    assert.equal(result.processed, 2);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 1);
    assert.equal(callCount, 2); // Exactly 2 calls, stopped immediately on 503!

    // Memory 1 is indexed
    withDatabase(dbPath, (db) => {
      const m1 = db.prepare('SELECT indexing_status FROM memories WHERE id = 1;').get() as any;
      assert.equal(m1.indexing_status, 'indexed');

      // Memory 2 is still pending with pending_reason
      const m2 = db.prepare('SELECT indexing_status, pending_reason FROM memories WHERE id = 2;').get() as any;
      assert.equal(m2.indexing_status, 'pending');
      assert.ok(m2.pending_reason?.includes('unavailable'));

      // Memories 3 and 4 are still pending and untouched
      const m3 = db.prepare('SELECT indexing_status FROM memories WHERE id = 3;').get() as any;
      assert.equal(m3.indexing_status, 'pending');
    });
  } finally {
    await mock.close();
    cleanup();
  }
});

test('M2-A06: Modified dataset expires cursor and prevents silent skip/duplication', async () => {
  const { dbPath, cleanup } = createTempDb();

  const mock = await createMockServer((req, res) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c.toString(); });
    req.on('end', () => {
      const parsed = JSON.parse(data);
      const input = parsed.input;
      const codePoints = Array.from(input);
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
            text: input,
            start: 0,
            end: codePoints.length,
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
      for (let i = 1; i <= 6; i++) {
        createMemory(db, { scopeKey: '["global"]', title: `Title ${i}`, content: `Content ${i}`, type: 'fact', sessionId: 'sess-1' });
      }
    });

    const client = new E5Client(mock.url);

    // Batch 1
    const batch1 = await reindexMemories(dbPath, { target: 'scope_pending', scopeKey: '["global"]' }, { client });
    assert.equal(batch1.processed, 5);
    assert.ok(batch1.next_cursor);

    // Mutate memory 6 in DB before batch 2 runs (e.g. content_version bumped)
    withDatabase(dbPath, (db) => {
      db.prepare(`
        UPDATE memories
        SET content_version = content_version + 1
        WHERE id = 6;
      `).run();
    });

    // Batch 2 with old cursor should reject due to dataset modification
    await assert.rejects(
      () => reindexMemories(dbPath, { target: 'scope_pending', scopeKey: '["global"]', cursor: batch1.next_cursor ?? undefined }, { client }),
      /cursor_dataset_modified/,
    );
  } finally {
    await mock.close();
    cleanup();
  }
});
