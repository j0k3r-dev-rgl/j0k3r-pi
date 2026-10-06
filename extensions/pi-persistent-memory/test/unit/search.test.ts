import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, withDatabase } from '../../src/storage/db.ts';
import { initSchema } from '../../src/storage/schema.ts';
import { activateSession } from '../../src/storage/session-store.ts';
import {
  createMemory,
  publishValidatedChunks,
  publishSyntheticVectors,
  softDeleteMemory,
} from '../../src/storage/memory-store.ts';
import { encodeScope } from '../../src/identity.ts';
import type { Scope, SearchMode } from '../../src/types.ts';
import {
  SearchService,
  searchMemories,
  decodeSearchCursor,
  encodeSearchCursor,
  computeSearchDatasetFingerprint,
  hashSearchQuery,
  RETRIEVAL_PROFILE_VERSION,
} from '../../src/search/index.ts';
import {
  E5Client,
  E5ClientError,
  CANONICAL_MODEL,
  CANONICAL_REVISION,
  CANONICAL_DIMENSIONS,
  CANONICAL_NORMALIZATION,
} from '../../src/client/e5-client.ts';

function createTempDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-mini-003-test-'));
  const dbPath = join(dir, 'test.db');
  withDatabase(dbPath, (db) => {
    initSchema(db);
    activateSession(db, 'session-test', '["global"]', 'normal');
  });
  return {
    dbPath,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

/**
 * Creates a normalized 384-dimensional vector with an exact cosine similarity
 * relative to the base query vector [1, 0, 0, ... 0].
 */
function makeVectorWithCosine(targetCosine: number): number[] {
  const vec = new Array(CANONICAL_DIMENSIONS).fill(0);
  const clamped = Math.max(-1, Math.min(1, targetCosine));
  vec[0] = clamped;
  vec[1] = Math.sqrt(Math.max(0, 1 - clamped * clamped));
  return vec;
}

const BASE_QUERY_VECTOR = makeVectorWithCosine(1.0);

function publishCanonicalVectors(
  db: DatabaseSync,
  memoryId: number,
  expectedVersion: number,
  chunks: Array<{
    chunk_text: string;
    start_char: number;
    end_char: number;
    token_count: number;
    vector: number[];
  }>,
): void {
  publishValidatedChunks(
    db,
    memoryId,
    expectedVersion,
    {
      model_id: CANONICAL_MODEL,
      model_revision: CANONICAL_REVISION,
      dimensions: CANONICAL_DIMENSIONS,
      normalized: 1,
    },
    chunks.map((c, idx) => ({
      chunk_index: idx,
      chunk_text: c.chunk_text,
      start_char: c.start_char,
      end_char: c.end_char,
      token_count: c.token_count,
      vector: c.vector,
    })),
  );
}

function mockClientWithVector(vector: number[]): E5Client {
  const client = new E5Client('http://127.0.0.1:9999');
  client.embedQuery = async () => ({
    model: CANONICAL_MODEL,
    model_revision: CANONICAL_REVISION,
    dimensions: CANONICAL_DIMENSIONS,
    normalization: 'l2',
    max_input_tokens: 512,
    chunks: [
      {
        chunk_index: 0,
        text: 'mock query',
        start: 0,
        end: 10,
        token_count: 3,
        embedding: vector,
      },
    ],
  });
  return client;
}

test('M3-A01: Scoped read selection and starvation prevention (>200 wrong-project chunks)', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const targetProject: Scope = { kind: 'project', project: 'my-app' };
    const otherProject: Scope = { kind: 'project', project: 'other-app' };
    const targetScopeKey = encodeScope(targetProject);
    const otherScopeKey = encodeScope(otherProject);

    withDatabase(dbPath, (db) => {
      // Create session for other project
      activateSession(db, 'sess-other', otherScopeKey, 'normal');
      activateSession(db, 'sess-target', targetScopeKey, 'normal');

      // Insert 220 wrong-project chunks with HIGH similarity (0.95) to the base query
      for (let i = 0; i < 22; i++) {
        const m = createMemory(db, {
          scopeKey: otherScopeKey,
          title: `Other App Memory ${i}`,
          content: `Content for other app ${i}`,
          type: 'fact',
          sessionId: 'sess-other',
        });
        const chunks = [];
        for (let j = 0; j < 10; j++) {
          chunks.push({
            chunk_text: `Other chunk ${j}`,
            start_char: 0,
            end_char: 10,
            token_count: 5,
            vector: makeVectorWithCosine(0.95),
          });
        }
        publishCanonicalVectors(db, m.id, 1, chunks);
      }

      // Insert target project memory with good similarity (0.88)
      const targetMem = createMemory(db, {
        scopeKey: targetScopeKey,
        title: 'Target App Core Architecture',
        content: 'Important target project documentation',
        type: 'fact',
        sessionId: 'sess-target',
      });
      publishCanonicalVectors(db, targetMem.id, 1, [
        {
          chunk_text: 'Important target project documentation',
          start_char: 0,
          end_char: 30,
          token_count: 8,
          vector: makeVectorWithCosine(0.88),
        },
      ]);
    });

    const client = mockClientWithVector(BASE_QUERY_VECTOR);
    const service = new SearchService(dbPath, client);

    // Search under targetProject (not explicit global): must NOT be starved by the 220 wrong-project chunks!
    const res = await service.search({
      query: 'architecture',
      mode: 'semantic',
      scope: targetProject,
      explicitGlobal: false,
    });

    assert.equal(res.status, 'ok');
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].title, 'Target App Core Architecture');
    assert.ok(res.results[0].score >= 0.86);

    // Search under otherProject: sees other project records
    const resOther = await service.search({
      query: 'other',
      mode: 'semantic',
      scope: otherProject,
      explicitGlobal: false,
    });
    assert.equal(resOther.results.length, 5); // Page max is 5

    // Explicit global search: sees records across projects
    const resGlobal = await service.search({
      query: 'documentation',
      mode: 'semantic',
      scope: targetProject,
      explicitGlobal: true,
    });
    assert.ok(resGlobal.results.length > 0);
  } finally {
    cleanup();
  }
});

test('M3-A02: Literal technical term distinction and starvation prevention (>100 near-matches)', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'coding' };
    const scopeKey = encodeScope(scope);

    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-coding', scopeKey, 'normal');

      // Insert 120 near-match memories containing "C" language (BM25 matches "C")
      for (let i = 0; i < 120; i++) {
        createMemory(db, {
          scopeKey,
          title: `C Programming Tutorial ${i}`,
          content: `In C language we use pointers and memory allocation ${i}`,
          type: 'fact',
          sessionId: 'sess-coding',
        });
      }

      // Insert 3 target memories containing "C++"
      for (let i = 0; i < 3; i++) {
        createMemory(db, {
          scopeKey,
          title: `C++ Standard Library ${i}`,
          content: `In C++ language we use templates and smart pointers ${i}`,
          type: 'fact',
          sessionId: 'sess-coding',
        });
      }
    });

    const service = new SearchService(dbPath);

    // Query for "C++" in FTS5:
    // If filtered after LIMIT 100, the 120 "C" records would starve the 3 "C++" records!
    // Coverage predicate BEFORE LIMIT 100 guarantees C++ records are returned!
    const res = await service.search({
      query: 'C++',
      mode: 'fts5',
      scope,
    });

    assert.equal(res.status, 'ok');
    assert.equal(res.results.length, 3);
    for (const r of res.results) {
      assert.ok(r.title.includes('C++'));
    }
  } finally {
    cleanup();
  }
});

test('M3-A03: Semantic exact cosine SQL, 0.86 floor, best-chunk dedup, and tie-breaks', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'vectors' };
    const scopeKey = encodeScope(scope);

    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-vec', scopeKey, 'normal');

      // Memory 1: 3 chunks, best chunk similarity = 0.90
      const m1 = createMemory(db, {
        scopeKey,
        title: 'Memory One',
        content: 'Long content with three chunks',
        type: 'fact',
        sessionId: 'sess-vec',
      });
      publishCanonicalVectors(db, m1.id, 1, [
        { chunk_text: 'Chunk 1', start_char: 0, end_char: 10, token_count: 3, vector: makeVectorWithCosine(0.70) },
        { chunk_text: 'Chunk 2', start_char: 11, end_char: 20, token_count: 3, vector: makeVectorWithCosine(0.90) },
        { chunk_text: 'Chunk 3', start_char: 21, end_char: 30, token_count: 3, vector: makeVectorWithCosine(0.80) },
      ]);

      // Memory 2: 1 chunk, similarity = 0.88
      const m2 = createMemory(db, {
        scopeKey,
        title: 'Memory Two',
        content: 'Short content with one chunk',
        type: 'fact',
        sessionId: 'sess-vec',
      });
      publishCanonicalVectors(db, m2.id, 1, [
        { chunk_text: 'Solo chunk', start_char: 0, end_char: 10, token_count: 3, vector: makeVectorWithCosine(0.88) },
      ]);

      // Memory 3: Below 0.86 floor (0.84) -> must be excluded!
      const m3 = createMemory(db, {
        scopeKey,
        title: 'Memory Below Floor',
        content: 'Not similar enough',
        type: 'fact',
        sessionId: 'sess-vec',
      });
      publishCanonicalVectors(db, m3.id, 1, [
        { chunk_text: 'Low chunk', start_char: 0, end_char: 10, token_count: 3, vector: makeVectorWithCosine(0.84) },
      ]);
    });

    const client = mockClientWithVector(BASE_QUERY_VECTOR);
    const service = new SearchService(dbPath, client);

    const res = await service.search({
      query: 'test query',
      mode: 'semantic',
      scope,
    });

    assert.equal(res.status, 'ok');
    assert.equal(res.results.length, 2);
    // Best-chunk dedup: Memory One appears only once, with best score around 0.90
    assert.equal(res.results[0].title, 'Memory One');
    assert.ok(Math.abs(res.results[0].score - 0.90) < 0.01);
    assert.equal(res.results[1].title, 'Memory Two');
    assert.ok(Math.abs(res.results[1].score - 0.88) < 0.01);
    // Excluded memory below 0.86
    assert.ok(!res.results.some((r) => r.title === 'Memory Below Floor'));
  } finally {
    cleanup();
  }
});

test('M3-A04: Pure FTS5 zero HTTP, hybrid lexical cosine >= 0.82 admission, and RRF 60 fusion', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'hybrid-app' };
    const scopeKey = encodeScope(scope);

    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-hybrid', scopeKey, 'normal');

      // Memory A: Matches semantic (0.90) and lexical (contains 'database')
      const mA = createMemory(db, {
        scopeKey,
        title: 'Memory A Database',
        content: 'Relational database storage engine',
        type: 'fact',
        sessionId: 'sess-hybrid',
      });
      publishCanonicalVectors(db, mA.id, 1, [
        { chunk_text: 'Relational database', start_char: 0, end_char: 15, token_count: 4, vector: makeVectorWithCosine(0.90) },
      ]);

      // Memory B: Matches semantic only (0.87, does not contain 'database')
      const mB = createMemory(db, {
        scopeKey,
        title: 'Memory B Vector Only',
        content: 'Information retrieval concepts',
        type: 'fact',
        sessionId: 'sess-hybrid',
      });
      publishCanonicalVectors(db, mB.id, 1, [
        { chunk_text: 'Information retrieval', start_char: 0, end_char: 15, token_count: 4, vector: makeVectorWithCosine(0.87) },
      ]);

      // Memory C: Matches lexical (contains 'database') and has valid chunk with cosine 0.83 (>= 0.82 floor)
      const mC = createMemory(db, {
        scopeKey,
        title: 'Memory C Lexical With Valid Vector',
        content: 'Database connection pooling and transactions',
        type: 'fact',
        sessionId: 'sess-hybrid',
      });
      publishCanonicalVectors(db, mC.id, 1, [
        { chunk_text: 'Database pooling', start_char: 0, end_char: 15, token_count: 4, vector: makeVectorWithCosine(0.83) },
      ]);

      // Memory D: Matches lexical (contains 'database') but has chunk with cosine 0.75 (< 0.82 floor) -> EXCLUDED from hybrid!
      const mD = createMemory(db, {
        scopeKey,
        title: 'Memory D Lexical With Low Vector',
        content: 'Database legacy notes',
        type: 'fact',
        sessionId: 'sess-hybrid',
      });
      publishCanonicalVectors(db, mD.id, 1, [
        { chunk_text: 'Database legacy', start_char: 0, end_char: 15, token_count: 4, vector: makeVectorWithCosine(0.75) },
      ]);
    });

    let clientCalls = 0;
    const client = new E5Client('http://127.0.0.1:9999');
    client.embedQuery = async () => {
      clientCalls++;
      return {
        model: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: CANONICAL_DIMENSIONS,
        normalization: 'l2',
        max_input_tokens: 512,
        chunks: [{ chunk_index: 0, text: 'query', start: 0, end: 5, token_count: 2, embedding: BASE_QUERY_VECTOR }],
      };
    };

    const service = new SearchService(dbPath, client);

    // 1. Pure FTS5 mode: must make ZERO HTTP calls!
    const ftsRes = await service.search({
      query: 'database',
      mode: 'fts5',
      scope,
    });
    assert.equal(ftsRes.status, 'ok');
    assert.equal(clientCalls, 0, 'fts5 search must make zero calls to E5 client');
    assert.ok(ftsRes.results.length >= 3);

    // 2. Hybrid mode: makes exactly 1 HTTP call, admits Memory A, B, C; excludes D
    const hybridRes = await service.search({
      query: 'database',
      mode: 'hybrid',
      scope,
    });
    assert.equal(clientCalls, 1, 'hybrid search makes exactly 1 call to embedQuery');
    assert.equal(hybridRes.status, 'ok');

    // Memory A (in both semantic and lexical) should rank highest due to RRF score fusion
    assert.equal(hybridRes.results[0].title, 'Memory A Database');
    // Memory D excluded because cosine 0.75 < 0.82
    assert.ok(!hybridRes.results.some((r) => r.title === 'Memory D Lexical With Low Vector'));
    // Memory B and C present
    assert.ok(hybridRes.results.some((r) => r.title === 'Memory B Vector Only'));
    assert.ok(hybridRes.results.some((r) => r.title === 'Memory C Lexical With Valid Vector'));
  } finally {
    cleanup();
  }
});

test('M3-A05: Only E5 unavailable triggers visible fts5 fallback; other errors propagate distinctly', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'fallback-app' };
    const scopeKey = encodeScope(scope);

    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-fb', scopeKey, 'normal');
      createMemory(db, {
        scopeKey,
        title: 'Fallback Memory',
        content: 'Searchable content for fallback test',
        type: 'fact',
        sessionId: 'sess-fb',
      });
    });

    // 1. E5 unavailable (503 / 500) -> triggers visible fallback to fts5 with warning
    const unavailClient = new E5Client('http://127.0.0.1:9999');
    unavailClient.embedQuery = async () => {
      throw new E5ClientError('unavailable', 'model_not_ready', 'E5 service is offline');
    };

    const serviceUnavail = new SearchService(dbPath, unavailClient);
    const fallbackRes = await serviceUnavail.search({
      query: 'searchable',
      mode: 'hybrid',
      scope,
    });

    assert.equal(fallbackRes.status, 'ok');
    assert.equal(fallbackRes.requested_mode, 'hybrid');
    assert.equal(fallbackRes.actual_mode, 'fts5');
    assert.ok(fallbackRes.warnings.includes('semantic_unavailable'));
    assert.equal(fallbackRes.results.length, 1);
    assert.equal(fallbackRes.results[0].title, 'Fallback Memory');

    // 2. E5 input_error (e.g. 422 query_too_long) -> NO fallback! Must throw input_error
    const inputErrClient = new E5Client('http://127.0.0.1:9999');
    inputErrClient.embedQuery = async () => {
      throw new E5ClientError('input_error', 'query_too_long', 'Query exceeds 512 tokens');
    };

    const serviceInputErr = new SearchService(dbPath, inputErrClient);
    await assert.rejects(
      async () => {
        await serviceInputErr.search({
          query: 'searchable',
          mode: 'hybrid',
          scope,
        });
      },
      (err: any) => err.category === 'input_error' && err.code === 'query_too_long',
    );

    // 3. Caller cancellation -> throws cancelled, NO fallback
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      async () => {
        await serviceUnavail.search({
          query: 'searchable',
          mode: 'hybrid',
          scope,
          signal: controller.signal,
        });
      },
      /cancelled|aborted/i,
    );
  } finally {
    cleanup();
  }
});

test('M3-A06: Cursor validation, tamper rejection, and dataset fingerprint consistency', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scopeA: Scope = { kind: 'project', project: 'proj-a' };
    const scopeB: Scope = { kind: 'project', project: 'proj-b' };
    const scopeAKey = encodeScope(scopeA);
    const scopeBKey = encodeScope(scopeB);

    let memAId = 0;
    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-a', scopeAKey, 'normal');
      activateSession(db, 'sess-b', scopeBKey, 'normal');

      for (let i = 0; i < 7; i++) {
        const m = createMemory(db, {
          scopeKey: scopeAKey,
          title: `Item A ${i}`,
          content: `Searchable item A ${i}`,
          type: 'fact',
          sessionId: 'sess-a',
        });
        if (i === 0) memAId = m.id;
      }
    });

    const service = new SearchService(dbPath);

    // Page 1
    const page1 = await service.search({
      query: 'searchable',
      mode: 'fts5',
      scope: scopeA,
    });

    assert.equal(page1.results.length, 5);
    assert.equal(page1.has_more, true);
    assert.ok(page1.next_cursor);

    const cursorStr = page1.next_cursor!;

    // Decode and verify cursor contents
    const decoded = decodeSearchCursor(cursorStr);
    assert.equal(decoded.op, 'search');
    assert.equal(decoded.scope_key, scopeAKey);
    assert.equal(decoded.offset, 5);

    // Page 2 using valid cursor succeeds
    const page2 = await service.search({
      query: 'searchable',
      mode: 'fts5',
      scope: scopeA,
      cursor: cursorStr,
    });
    assert.equal(page2.results.length, 2);
    assert.equal(page2.has_more, false);
    assert.equal(page2.next_cursor, null);

    // Negative: Cursor scope mismatch (using cursor from proj-a in proj-b)
    await assert.rejects(
      async () => {
        await service.search({
          query: 'searchable',
          mode: 'fts5',
          scope: scopeB,
          cursor: cursorStr,
        });
      },
      /cursor_scope_mismatch/,
    );

    // Negative: Tampered cursor payload
    await assert.rejects(
      async () => {
        await service.search({
          query: 'searchable',
          mode: 'fts5',
          scope: scopeA,
          cursor: 'not-a-valid-cursor',
        });
      },
      /invalid_cursor/,
    );

    // Positive invariant: Updating unrelated project (proj-b) does NOT invalidate proj-a cursor
    withDatabase(dbPath, (db) => {
      createMemory(db, {
        scopeKey: scopeBKey,
        title: 'Item B New',
        content: 'New content in proj B',
        type: 'fact',
        sessionId: 'sess-b',
      });
    });

    const page2AfterUnrelated = await service.search({
      query: 'searchable',
      mode: 'fts5',
      scope: scopeA,
      cursor: cursorStr,
    });
    assert.equal(page2AfterUnrelated.results.length, 2);

    // Negative invariant: Updating project A modifies dataset fingerprint and expires cursor
    withDatabase(dbPath, (db) => {
      softDeleteMemory(db, memAId, scopeAKey);
    });

    await assert.rejects(
      async () => {
        await service.search({
          query: 'searchable',
          mode: 'fts5',
          scope: scopeA,
          cursor: cursorStr,
        });
      },
      /cursor_dataset_modified|cursor_expired/,
    );
  } finally {
    cleanup();
  }
});

test('M3-A07: Result envelope byte budget <= 6144 bytes, <= 5 memories, Unicode safe excerpts, and display abbreviation', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'envelope-app' };
    const scopeKey = encodeScope(scope);

    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-env', scopeKey, 'normal');

      // Create memory with giant title and multibyte Unicode characters (emojis, accented characters)
      const giantTitle = '🚀'.repeat(500) + ' Giant Multibyte Title ' + 'ñ'.repeat(200);
      const giantContent = 'Content with special symbols 👨‍👩‍👧‍👦 '.repeat(50);
      createMemory(db, {
        scopeKey,
        title: giantTitle,
        content: giantContent,
        type: 'fact',
        sessionId: 'sess-env',
      });

      // Create 6 more memories
      for (let i = 0; i < 6; i++) {
        createMemory(db, {
          scopeKey,
          title: `Envelope test memory ${i}`,
          content: `Content for memory ${i}`,
          type: 'fact',
          sessionId: 'sess-env',
        });
      }
    });

    const service = new SearchService(dbPath);
    const page1 = await service.search({
      query: 'content',
      mode: 'fts5',
      scope,
    });

    // 1. Memories per page <= 5
    assert.ok(page1.results.length <= 5);

    // 2. Entire JSON serialized envelope strictly <= 6144 bytes
    const serialized = JSON.stringify(page1);
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    assert.ok(byteLength <= 6144, `Envelope size ${byteLength} exceeded 6144 bytes`);

    // 3. Giant title was abbreviated and includes guidance
    const giantItem = page1.results.find((r) => r.title.includes('🚀'));
    if (giantItem) {
      assert.equal(giantItem.abbreviated, true);
      assert.ok(giantItem.guidance);
    }

    // 4. Multibyte characters never corrupted into invalid Unicode
    assert.ok(!serialized.includes('\uFFFD'), 'Serialization must not split multibyte Unicode characters');
  } finally {
    cleanup();
  }
});

test('M3-A01 & M3-A03: Deleted memories, obsolete chunk versions, and incompatible models are excluded from search', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'filtering-app' };
    const scopeKey = encodeScope(scope);

    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-filt', scopeKey, 'normal');

      // 1. Soft-deleted memory (similarity 0.99)
      const mDel = createMemory(db, {
        scopeKey,
        title: 'Deleted memory',
        content: 'This memory has been deleted',
        type: 'fact',
        sessionId: 'sess-filt',
      });
      publishValidatedChunks(db, mDel.id, 1, {
        model_id: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: CANONICAL_DIMENSIONS,
        normalized: 1,
      }, [
        { chunk_index: 0, chunk_text: 'Deleted content', start_char: 0, end_char: 15, token_count: 3, vector: makeVectorWithCosine(0.99) },
      ]);
      softDeleteMemory(db, mDel.id, scopeKey);

      // 2. Memory with obsolete chunk version (content_version bumped, old chunks remaining)
      const mObs = createMemory(db, {
        scopeKey,
        title: 'Obsolete chunk memory',
        content: 'Updated content version 2',
        type: 'fact',
        sessionId: 'sess-filt',
      });
      publishValidatedChunks(db, mObs.id, 1, {
        model_id: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: CANONICAL_DIMENSIONS,
        normalized: 1,
      }, [
        { chunk_index: 0, chunk_text: 'Old version 1 chunk', start_char: 0, end_char: 20, token_count: 4, vector: makeVectorWithCosine(0.98) },
      ]);
      // Bump content_version to 2 directly in DB without republishing chunks
      db.prepare('UPDATE memories SET content_version = 2, indexing_status = \'pending\' WHERE id = ?;').run(mObs.id);

      // 3. Memory with incompatible model
      const mIncomp = createMemory(db, {
        scopeKey,
        title: 'Incompatible model memory',
        content: 'Vectors from different model',
        type: 'fact',
        sessionId: 'sess-filt',
      });
      publishValidatedChunks(db, mIncomp.id, 1, {
        model_id: 'other-vendor/incompatible-model',
        model_revision: 'v1',
        dimensions: 384,
        normalized: 1,
      }, [
        { chunk_index: 0, chunk_text: 'Incompatible chunk', start_char: 0, end_char: 18, token_count: 3, vector: makeVectorWithCosine(0.97) },
      ]);

      // 4. Valid active memory
      const mValid = createMemory(db, {
        scopeKey,
        title: 'Valid Active Memory',
        content: 'This is the only valid active record',
        type: 'fact',
        sessionId: 'sess-filt',
      });
      publishValidatedChunks(db, mValid.id, 1, {
        model_id: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: CANONICAL_DIMENSIONS,
        normalized: 1,
      }, [
        { chunk_index: 0, chunk_text: 'Valid active record', start_char: 0, end_char: 19, token_count: 3, vector: makeVectorWithCosine(0.91) },
      ]);
    });

    const client = mockClientWithVector(BASE_QUERY_VECTOR);
    const service = new SearchService(dbPath, client);

    const res = await service.search({
      query: 'record',
      mode: 'semantic',
      scope,
    });

    assert.equal(res.status, 'ok');
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].title, 'Valid Active Memory');
  } finally {
    cleanup();
  }
});

test('M3-A02 & M3-A05: Input validation and empty meaningful terms after stopwords', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'input-app' };
    const scopeKey = encodeScope(scope);

    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-input', scopeKey, 'normal');
      createMemory(db, {
        scopeKey,
        title: 'Some memory',
        content: 'Knowledge text',
        type: 'fact',
        sessionId: 'sess-input',
      });
    });

    const service = new SearchService(dbPath);

    // 1. Empty or whitespace query rejects before any DB / network work
    await assert.rejects(
      async () => {
        await service.search({ query: '', mode: 'fts5', scope });
      },
      /invalid_input/,
    );
    await assert.rejects(
      async () => {
        await service.search({ query: '   \t\n  ', mode: 'fts5', scope });
      },
      /invalid_input/,
    );

    // 2. Query with only stopwords ("the and or in")
    // Lexical returns zero results without error and without constructing empty MATCH expression
    const ftsRes = await service.search({
      query: 'the and or in',
      mode: 'fts5',
      scope,
    });
    assert.equal(ftsRes.status, 'ok');
    assert.equal(ftsRes.results.length, 0);
  } finally {
    cleanup();
  }
});

test('M3-A06: Same-content reindex changing vector blobs expires search cursor', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'reindex-cursor-app' };
    const scopeKey = encodeScope(scope);

    let memId = 0;
    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-reindex', scopeKey, 'normal');

      // Create 6 memories so pagination cursor is produced
      for (let i = 0; i < 6; i++) {
        const m = createMemory(db, {
          scopeKey,
          title: `Reindex Item ${i}`,
          content: `Content for reindex item ${i}`,
          type: 'fact',
          sessionId: 'sess-reindex',
        });
        publishValidatedChunks(db, m.id, 1, {
          model_id: CANONICAL_MODEL,
          model_revision: CANONICAL_REVISION,
          dimensions: CANONICAL_DIMENSIONS,
          normalized: 1,
        }, [
          { chunk_index: 0, chunk_text: `Chunk ${i}`, start_char: 0, end_char: 10, token_count: 3, vector: makeVectorWithCosine(0.88) },
        ]);
        if (i === 0) memId = m.id;
      }
    });

    const client = mockClientWithVector(BASE_QUERY_VECTOR);
    const service = new SearchService(dbPath, client);

    const page1 = await service.search({
      query: 'item',
      mode: 'semantic',
      scope,
    });

    assert.equal(page1.has_more, true);
    assert.ok(page1.next_cursor);
    const cursor = page1.next_cursor!;

    // Perform same-content reindex on memId (same content_version 1, but new vector values)
    withDatabase(dbPath, (db) => {
      publishValidatedChunks(db, memId, 1, {
        model_id: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: CANONICAL_DIMENSIONS,
        normalized: 1,
      }, [
        { chunk_index: 0, chunk_text: 'Chunk 0 updated', start_char: 0, end_char: 15, token_count: 4, vector: makeVectorWithCosine(0.92) },
      ]);
    });

    // Cursor must now be expired because dataset fingerprint reflects vector blobs!
    await assert.rejects(
      async () => {
        await service.search({
          query: 'item',
          mode: 'semantic',
          scope,
          cursor,
        });
      },
      /cursor_dataset_modified|cursor_expired/,
    );
  } finally {
    cleanup();
  }
});

test('M3-A01, M3-A03 & M3-A04: Incompatible synthetic model revision v2 must be excluded from semantic and hybrid retrieval, proving filter-before-budget and canonical-only admission', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'canonical-proof-app' };
    const scopeKey = encodeScope(scope);

    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-proof', scopeKey, 'normal');

      // 1. Target Canonical Memory: similarity 0.88, canonical revision
      const mCanonical = createMemory(db, {
        scopeKey,
        title: 'Canonical Production Architecture',
        content: 'Authoritative canonical architecture documentation',
        type: 'fact',
        sessionId: 'sess-proof',
      });
      publishValidatedChunks(db, mCanonical.id, 1, {
        model_id: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: CANONICAL_DIMENSIONS,
        normalized: 1,
      }, [
        {
          chunk_index: 0,
          chunk_text: 'Authoritative canonical architecture documentation',
          start_char: 0,
          end_char: 45,
          token_count: 8,
          vector: makeVectorWithCosine(0.88),
        },
      ]);

      // 2. Filter-before-budget starvation test:
      // Insert >200 (220) chunks with synthetic model_revision = 'v2' and high similarity (0.95).
      // If revision is not strictly filtered BEFORE candidate LIMIT 200, these 220 chunks
      // will consume all 200 budget slots and starve the canonical memory (similarity 0.88).
      for (let i = 0; i < 22; i++) {
        const mV2 = createMemory(db, {
          scopeKey,
          title: `Synthetic v2 Memory ${i}`,
          content: `Content for synthetic v2 record ${i}`,
          type: 'fact',
          sessionId: 'sess-proof',
        });
        const v2Chunks = [];
        for (let j = 0; j < 10; j++) {
          v2Chunks.push({
            chunk_index: j,
            chunk_text: `Synthetic v2 chunk ${j}`,
            start_char: 0,
            end_char: 20,
            token_count: 5,
            vector: makeVectorWithCosine(0.95),
          });
        }
        publishValidatedChunks(db, mV2.id, 1, {
          model_id: CANONICAL_MODEL,
          model_revision: 'v2',
          dimensions: CANONICAL_DIMENSIONS,
          normalized: 1,
        }, v2Chunks);
      }

      // 3. Incompatible model revision (v1) with high similarity (0.95)
      const mIncompat = createMemory(db, {
        scopeKey,
        title: 'Incompatible Revision Memory',
        content: 'Content with incompatible v1 revision',
        type: 'fact',
        sessionId: 'sess-proof',
      });
      publishValidatedChunks(db, mIncompat.id, 1, {
        model_id: 'other-vendor/incompatible-model',
        model_revision: 'v1',
        dimensions: 384,
        normalized: 1,
      }, [
        {
          chunk_index: 0,
          chunk_text: 'Incompatible v1 chunk',
          start_char: 0,
          end_char: 20,
          token_count: 4,
          vector: makeVectorWithCosine(0.95),
        },
      ]);

      // 4. Hybrid lexical candidates outside semantic 200:
      // Both match lexical query "specifications" (coverage >= 0.35) and have cosine 0.84
      // (which is >= 0.82 hybrid lexical floor, but < 0.86 semantic floor, so neither appears in semantic 200).
      // One has canonical revision, the other has synthetic v2 revision.
      const mCanonicalLex = createMemory(db, {
        scopeKey,
        title: 'Canonical Lexical Specifications',
        content: 'Detailed specifications for architecture module',
        type: 'fact',
        sessionId: 'sess-proof',
      });
      publishValidatedChunks(db, mCanonicalLex.id, 1, {
        model_id: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: CANONICAL_DIMENSIONS,
        normalized: 1,
      }, [
        {
          chunk_index: 0,
          chunk_text: 'Detailed specifications for architecture module',
          start_char: 0,
          end_char: 45,
          token_count: 7,
          vector: makeVectorWithCosine(0.84),
        },
      ]);

      const mV2Lex = createMemory(db, {
        scopeKey,
        title: 'Synthetic v2 Lexical Specifications',
        content: 'Detailed specifications for architecture module in v2 format',
        type: 'fact',
        sessionId: 'sess-proof',
      });
      publishValidatedChunks(db, mV2Lex.id, 1, {
        model_id: CANONICAL_MODEL,
        model_revision: 'v2',
        dimensions: CANONICAL_DIMENSIONS,
        normalized: 1,
      }, [
        {
          chunk_index: 0,
          chunk_text: 'Detailed specifications for architecture module in v2 format',
          start_char: 0,
          end_char: 55,
          token_count: 8,
          vector: makeVectorWithCosine(0.84),
        },
      ]);
    });

    const client = mockClientWithVector(BASE_QUERY_VECTOR);
    const service = new SearchService(dbPath, client);

    // Route A: Semantic retrieval
    // Canonical memory (0.88) must NOT be starved by the 220 synthetic v2 chunks (0.95).
    // Synthetic v2 memories and incompatible memories must be strictly excluded.
    const resSemantic = await service.search({
      query: 'architecture',
      mode: 'semantic',
      scope,
    });

    assert.equal(resSemantic.status, 'ok');
    // Only canonical memory must be admitted
    assert.equal(resSemantic.results.length, 1);
    assert.equal(resSemantic.results[0].title, 'Canonical Production Architecture');
    assert.ok(!resSemantic.results.some((r) => r.title.includes('Synthetic v2')));
    assert.ok(!resSemantic.results.some((r) => r.title.includes('Incompatible Revision')));

    // Route B: Hybrid retrieval
    // Query "specifications":
    // - mCanonicalLex has cosine 0.84 (>= 0.82) with CANONICAL_REVISION: must be ADMITTED
    // - mV2Lex has cosine 0.84 (>= 0.82) with model_revision = 'v2': must be EXCLUDED
    const resHybrid = await service.search({
      query: 'specifications',
      mode: 'hybrid',
      scope,
    });

    assert.equal(resHybrid.status, 'ok');
    assert.ok(
      resHybrid.results.some((r) => r.title === 'Canonical Lexical Specifications'),
      'Canonical lexical memory with cosine 0.84 must be admitted in hybrid search',
    );
    assert.ok(
      !resHybrid.results.some((r) => r.title.includes('Synthetic v2')),
      'Synthetic v2 memory must NOT be admitted in hybrid search even with cosine 0.84',
    );

    // Route C: Pure FTS5 text lookup remains independent of vectors
    // Text search for "specifications" under fts5 mode should find both records without vector checks
    const resFts = await service.search({
      query: 'specifications',
      mode: 'fts5',
      scope,
    });

    assert.equal(resFts.status, 'ok');
    assert.ok(resFts.results.some((r) => r.title === 'Canonical Lexical Specifications'));
    assert.ok(resFts.results.some((r) => r.title === 'Synthetic v2 Lexical Specifications'));
  } finally {
    cleanup();
  }
});

