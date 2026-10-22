import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withDatabase } from '../../src/storage/db.ts';
import { initSchema } from '../../src/storage/schema.ts';
import { activateSession } from '../../src/storage/session-store.ts';
import { createUserMessage } from '../../src/storage/history-store.ts';
import { searchHistory, getHistoryDetail } from '../../src/history/service.ts';
import { encodeHistoryCursor, decodeHistoryCursor } from '../../src/history/cursor.ts';
import { MAX_TOOL_RESULT_BYTES, measureSerializedToolResult } from '../../src/tools/result-helper.ts';

function createTempDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-history-test-'));
  const dbPath = join(dir, 'test.db');
  return {
    dbPath,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

test('MINI-004: searchHistory lists and filters project messages with keyset pagination', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      activateSession(db, 'sess-1', '["project","p1"]', 'normal');
      activateSession(db, 'sess-2', '["project","p1"]', 'normal');

      for (let i = 1; i <= 10; i++) {
        createUserMessage(db, {
          sessionId: i <= 5 ? 'sess-1' : 'sess-2',
          projectKey: 'git:/my/repo',
          content: `User query ${i} regarding docker containers`,
        });
      }

      // Foreign project message
      createUserMessage(db, {
        sessionId: 'sess-1',
        projectKey: 'git:/other/repo',
        content: `Foreign message regarding docker containers`,
      });
    });

    // 1. Search page 1 (limit 4)
    const page1 = searchHistory(dbPath, 'git:/my/repo', { limit: 4 });
    assert.equal(page1.records.length, 4);
    assert.equal(page1.has_more, true);
    assert.ok(page1.next_cursor);
    assert.deepEqual(page1.records.map((r) => r.id), [10, 9, 8, 7]);

    // 2. Search page 2 using cursor
    const page2 = searchHistory(dbPath, 'git:/my/repo', { limit: 4, cursor: page1.next_cursor! });
    assert.equal(page2.records.length, 4);
    assert.equal(page2.has_more, true);
    assert.ok(page2.next_cursor);
    assert.deepEqual(page2.records.map((r) => r.id), [6, 5, 4, 3]);

    // 3. Search page 3 using cursor
    const page3 = searchHistory(dbPath, 'git:/my/repo', { limit: 4, cursor: page2.next_cursor! });
    assert.equal(page3.records.length, 2);
    assert.equal(page3.has_more, false);
    assert.equal(page3.next_cursor, null);
    assert.deepEqual(page3.records.map((r) => r.id), [2, 1]);

    // 4. Session filtering: only sess-2
    const sess2Search = searchHistory(dbPath, 'git:/my/repo', { session_id: 'sess-2', limit: 10 });
    assert.equal(sess2Search.records.length, 5);
    assert.equal(sess2Search.has_more, false);
    assert.deepEqual(sess2Search.records.map((r) => r.id), [10, 9, 8, 7, 6]);

    // 5. Foreign project query strictly fails to see other repo
    const foreignSearch = searchHistory(dbPath, 'git:/other/repo', { limit: 10 });
    assert.equal(foreignSearch.records.length, 1);
    assert.equal(foreignSearch.records[0].excerpt, 'Foreign message regarding docker containers');
  } finally {
    cleanup();
  }
});

test('MINI-004: searchHistory enforces byte budget <= 6144 bytes', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      initSchema(db);
      activateSession(db, 'sess-1', '["project","p1"]', 'normal');

      // Create 15 long messages
      for (let i = 1; i <= 15; i++) {
        createUserMessage(db, {
          sessionId: 'sess-1',
          projectKey: 'git:/budget/repo',
          content: `Message ${i}: `.padEnd(1000, `data-line-${i}-`),
        });
      }
    });

    const res = searchHistory(dbPath, 'git:/budget/repo', { limit: 15 });
    const details = { action: 'search', count: res.records.length, has_more: res.has_more };
    const bytes = measureSerializedToolResult(res, details, false);
    assert.ok(bytes <= MAX_TOOL_RESULT_BYTES, `Result bytes ${bytes} must not exceed ${MAX_TOOL_RESULT_BYTES}`);
  } finally {
    cleanup();
  }
});

test('MINI-004: getHistoryDetail retrieves full message or paginates large Unicode text safely', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    let msgIdSmall: number;
    let msgIdLarge: number;
    withDatabase(dbPath, (db) => {
      initSchema(db);
      activateSession(db, 'sess-1', '["project","p1"]', 'normal');

      const small = createUserMessage(db, {
        sessionId: 'sess-1',
        projectKey: 'git:/my/repo',
        content: 'Simple message text',
      });
      msgIdSmall = small.id;

      // Large message: 10,000 multi-byte characters (emoji and CJK)
      const bigText = '🚀 汉语 / 日本語 / 한국어 '.repeat(500);
      const large = createUserMessage(db, {
        sessionId: 'sess-1',
        projectKey: 'git:/my/repo',
        content: bigText,
      });
      msgIdLarge = large.id;

      // Foreign project message
      createUserMessage(db, {
        sessionId: 'sess-1',
        projectKey: 'git:/foreign/repo',
        content: 'Secret from foreign repo',
      });
    });

    // 1. Small get: completes in one page
    const smallRes = getHistoryDetail(dbPath, 'git:/my/repo', { id: msgIdSmall! });
    assert.equal(smallRes.content, 'Simple message text');
    assert.equal(smallRes.has_more, false);
    assert.equal(smallRes.next_cursor, null);

    // 2. Foreign project get: fail-closed with not_found
    assert.throws(() => {
      getHistoryDetail(dbPath, 'git:/foreign/repo', { id: msgIdSmall! });
    }, /not_found/);

    // 3. Large get: paginates losslessly along code points <= 6144 bytes
    let reconstructed = '';
    let currentCursor: string | undefined = undefined;
    let pageCount = 0;

    while (true) {
      pageCount++;
      const pageRes = getHistoryDetail(dbPath, 'git:/my/repo', { id: msgIdLarge!, cursor: currentCursor });
      const details = { action: 'get', id: pageRes.id, offset: pageRes.offset, has_more: pageRes.has_more };
      const bytes = measureSerializedToolResult(pageRes, details, false);
      assert.ok(bytes <= MAX_TOOL_RESULT_BYTES, `Page ${pageCount} bytes ${bytes} must not exceed ${MAX_TOOL_RESULT_BYTES}`);

      reconstructed += pageRes.content;
      if (!pageRes.has_more) {
        break;
      }
      assert.ok(pageRes.next_cursor);
      currentCursor = pageRes.next_cursor;
    }

    assert.ok(pageCount > 1, 'Large text must take more than 1 page');
    const expectedContent = '🚀 汉语 / 日本語 / 한국어 '.repeat(500);
    assert.equal(reconstructed, expectedContent, 'Reconstructed content across pages must match exactly losslessly');
  } finally {
    cleanup();
  }
});

test('MINI-004: Tampered or cross-project cursor is rejected fail-closed', () => {
  const cursor = encodeHistoryCursor({
    op: 'history_search',
    project_key: 'git:/other/project',
    before_id: 10,
  });

  const { dbPath, cleanup } = createTempDb();
  try {
    assert.throws(() => {
      searchHistory(dbPath, 'git:/current/project', { cursor });
    }, /cursor_scope_mismatch/);

    const getCursor = encodeHistoryCursor({
      op: 'history_get',
      project_key: 'git:/other/project',
      id: 5,
      byte_offset: 100,
    });

    assert.throws(() => {
      getHistoryDetail(dbPath, 'git:/current/project', { id: 5, cursor: getCursor });
    }, /cursor_scope_mismatch/);
  } finally {
    cleanup();
  }
});
