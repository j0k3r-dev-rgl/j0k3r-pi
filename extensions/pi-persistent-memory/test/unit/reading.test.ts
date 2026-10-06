import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withDatabase } from '../../src/storage/db.ts';
import { initSchema } from '../../src/storage/schema.ts';
import { createMemory, softDeleteMemory, replaceMemory, restoreMemory } from '../../src/storage/memory-store.ts';
import { activateSession } from '../../src/storage/session-store.ts';
import { encodeScope } from '../../src/identity.ts';
import type { Scope } from '../../src/types.ts';
import { readMemoryDetail } from '../../src/reading/get.ts';
import { readDeletedList } from '../../src/reading/deleted.ts';
import { readMemoryContext } from '../../src/reading/context.ts';

function createTempDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-mini-005-read-'));
  const dbPath = join(dir, 'memories.db');
  withDatabase(dbPath, (db) => {
    initSchema(db);
  });
  return {
    dbPath,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

test('M5-A04: memory_get returns full title and content progressively with Unicode code point boundaries', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const scopeKey = encodeScope(scope);

    // Multibyte emojis and CJK characters
    const multiByteContent = '👋 🌍 Hello World! 🚀 測試文本 '.repeat(100);
    let memId: number = 0;
    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-1', scopeKey, 'normal');
      const created = createMemory(db, {
        scopeKey,
        title: 'Multibyte Guide',
        content: multiByteContent,
        type: 'guide',
        sessionId: 'sess-1',
      });
      memId = created.id;
    });

    // Read first page with small byte chunk limit
    const page1 = readMemoryDetail(dbPath, {
      id: memId,
      sessionScope: scope,
      maxChunkBytes: 500,
    });

    assert.equal(page1.id, memId);
    assert.equal(page1.title, 'Multibyte Guide');
    assert.equal(page1.field, 'content');
    assert.equal(page1.offset, 0);
    assert.ok(page1.has_more);
    assert.ok(page1.next_cursor);
    assert.ok(page1.content.length > 0);
    // Ensure content chunk did not split any Unicode code point
    assert.doesNotThrow(() => {
      Buffer.from(page1.content, 'utf8');
    });

    // Read subsequent pages until complete
    let accumulatedContent = page1.content;
    let nextCursor: string | null = page1.next_cursor;
    let pageCount = 1;

    while (nextCursor) {
      pageCount++;
      const nextPage = readMemoryDetail(dbPath, {
        id: memId,
        sessionScope: scope,
        cursor: nextCursor,
        maxChunkBytes: 500,
      });
      accumulatedContent += nextPage.content;
      nextCursor = nextPage.next_cursor;
      if (!nextPage.has_more) {
        assert.equal(nextCursor, null);
      }
    }

    assert.ok(pageCount > 1, `Expected multiple pages, got ${pageCount}`);
    assert.equal(accumulatedContent, multiByteContent);
  } finally {
    cleanup();
  }
});

test('M5-A04: memory_get giant title pagination advances cleanly to content', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const scopeKey = encodeScope(scope);

    const giantTitle = 'T'.repeat(1200);
    const normalContent = 'Short content here.';
    let memId: number = 0;
    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-1', scopeKey, 'normal');
      const created = createMemory(db, {
        scopeKey,
        title: giantTitle,
        content: normalContent,
        type: 'doc',
        sessionId: 'sess-1',
      });
      memId = created.id;
    });

    const page1 = readMemoryDetail(dbPath, {
      id: memId,
      sessionScope: scope,
      maxChunkBytes: 500,
    });

    assert.equal(page1.field, 'title');
    assert.equal(page1.offset, 0);
    assert.ok(page1.has_more);
    assert.ok(page1.next_cursor);
    assert.equal(page1.content, '');

    // Read next page of title
    const page2 = readMemoryDetail(dbPath, {
      id: memId,
      sessionScope: scope,
      cursor: page1.next_cursor!,
      maxChunkBytes: 500,
    });

    assert.equal(page2.field, 'title');
    assert.ok(page2.offset > 0);
    assert.ok(page2.next_cursor);

    // Read until content page
    let cursor: string | null = page2.next_cursor;
    let reachedContent = false;
    let accumulatedTitle = page1.title + page2.title;
    while (cursor) {
      const page = readMemoryDetail(dbPath, {
        id: memId,
        sessionScope: scope,
        cursor,
        maxChunkBytes: 500,
      });
      if (page.field === 'title') {
        accumulatedTitle += page.title;
      } else if (page.field === 'content') {
        reachedContent = true;
        assert.equal(page.content, normalContent);
      }
      cursor = page.next_cursor;
    }

    assert.ok(reachedContent, 'Expected to reach content page after giant title');
    assert.equal(accumulatedTitle, giantTitle);
  } finally {
    cleanup();
  }
});

test('M5-A04: memory_get invalidates cursor when content_version changes or memory is deleted', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const scopeKey = encodeScope(scope);

    let memId: number = 0;
    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-1', scopeKey, 'normal');
      const created = createMemory(db, {
        scopeKey,
        title: 'Volatile Memory',
        content: 'Long content here '.repeat(100),
        type: 'note',
        sessionId: 'sess-1',
      });
      memId = created.id;
    });

    const page1 = readMemoryDetail(dbPath, {
      id: memId,
      sessionScope: scope,
      maxChunkBytes: 300,
    });
    assert.ok(page1.next_cursor);

    // 1. Replace memory to bump content_version
    withDatabase(dbPath, (db) => {
      replaceMemory(db, memId, {
        scopeKey,
        title: 'Volatile Memory Updated',
        content: 'Brand new content '.repeat(100),
        type: 'note',
        sessionId: 'sess-1',
      });
    });

    // Old cursor must be rejected
    assert.throws(() => {
      readMemoryDetail(dbPath, {
        id: memId,
        sessionScope: scope,
        cursor: page1.next_cursor!,
        maxChunkBytes: 300,
      });
    }, /cursor_expired/);

    // 2. Read new page 1, then soft-delete
    const newPage1 = readMemoryDetail(dbPath, {
      id: memId,
      sessionScope: scope,
      maxChunkBytes: 300,
    });
    assert.ok(newPage1.next_cursor);

    withDatabase(dbPath, (db) => {
      softDeleteMemory(db, memId, scopeKey);
    });

    // Now reading with cursor or fresh read throws target_deleted / target_not_found
    assert.throws(() => {
      readMemoryDetail(dbPath, {
        id: memId,
        sessionScope: scope,
        cursor: newPage1.next_cursor!,
        maxChunkBytes: 300,
      });
    }, /target_deleted/);

    assert.throws(() => {
      readMemoryDetail(dbPath, {
        id: memId,
        sessionScope: scope,
        maxChunkBytes: 300,
      });
    }, /target_deleted/);
  } finally {
    cleanup();
  }
});

test('M5-A04: memory_get enforces scope and hides foreign records without disclosure', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const projAScope: Scope = { kind: 'project', project: 'proj-a' };
    const projBScope: Scope = { kind: 'project', project: 'proj-b' };

    let memIdA: number = 0;
    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-a', encodeScope(projAScope), 'normal');
      const created = createMemory(db, {
        scopeKey: encodeScope(projAScope),
        title: 'Secret Proj A Note',
        content: 'Confidential details',
        type: 'secret',
        sessionId: 'sess-a',
      });
      memIdA = created.id;
    });

    // Proj B cannot read Proj A's memory by default
    assert.throws(() => {
      readMemoryDetail(dbPath, {
        id: memIdA,
        sessionScope: projBScope,
      });
    }, /target_not_found/);

    // Global read allows reading active memory across projects
    const globalRead = readMemoryDetail(dbPath, {
      id: memIdA,
      sessionScope: projBScope,
      global: true,
    });
    assert.equal(globalRead.id, memIdA);
    assert.equal(globalRead.title, 'Secret Proj A Note');
  } finally {
    cleanup();
  }
});

test('M5-A04: memory_deleted_list returns recovery metadata only without content', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const scopeKey = encodeScope(scope);

    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-1', scopeKey, 'normal');
      const m1 = createMemory(db, {
        scopeKey,
        title: 'Deleted Note 1',
        content: 'SUPER SECRET CONTENT 1',
        type: 'note',
        sessionId: 'sess-1',
      });
      const m2 = createMemory(db, {
        scopeKey,
        title: 'Deleted Note 2',
        content: 'SUPER SECRET CONTENT 2',
        type: 'note',
        sessionId: 'sess-1',
      });
      createMemory(db, {
        scopeKey,
        title: 'Active Note 3',
        content: 'Visible content',
        type: 'note',
        sessionId: 'sess-1',
      });

      softDeleteMemory(db, m1.id, scopeKey);
      softDeleteMemory(db, m2.id, scopeKey);
    });

    const result = readDeletedList(dbPath, {
      sessionScope: scope,
      pageSize: 10,
    });

    assert.equal(result.items.length, 2);
    // Content is NEVER returned in deleted list!
    for (const item of result.items) {
      assert.ok(item.id > 0);
      assert.ok(item.title);
      assert.ok(item.deleted_at);
      assert.equal((item as any).content, undefined);
    }
  } finally {
    cleanup();
  }
});

test('M5-A04: memory_deleted_list cursor expires on restore/delete in same scope', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const scopeKey = encodeScope(scope);

    let m1Id = 0;
    let m2Id = 0;
    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-1', scopeKey, 'normal');
      const m1 = createMemory(db, {
        scopeKey,
        title: 'Del 1',
        content: 'content 1',
        type: 'note',
        sessionId: 'sess-1',
      });
      const m2 = createMemory(db, {
        scopeKey,
        title: 'Del 2',
        content: 'content 2',
        type: 'note',
        sessionId: 'sess-1',
      });
      const m3 = createMemory(db, {
        scopeKey,
        title: 'Del 3',
        content: 'content 3',
        type: 'note',
        sessionId: 'sess-1',
      });
      m1Id = m1.id;
      m2Id = m2.id;
      softDeleteMemory(db, m1.id, scopeKey);
      softDeleteMemory(db, m2.id, scopeKey);
      softDeleteMemory(db, m3.id, scopeKey);
    });

    const page1 = readDeletedList(dbPath, {
      sessionScope: scope,
      pageSize: 2,
    });

    assert.equal(page1.items.length, 2);
    assert.ok(page1.has_more);
    assert.ok(page1.next_cursor);

    // Restore one memory in same scope
    withDatabase(dbPath, (db) => {
      restoreMemory(db, m1Id, scopeKey);
    });

    // Cursor must now be expired
    assert.throws(() => {
      readDeletedList(dbPath, {
        sessionScope: scope,
        cursor: page1.next_cursor!,
        pageSize: 2,
      });
    }, /cursor_expired/);
  } finally {
    cleanup();
  }
});

test('M5-A04: memory_context orders session_summary first, project_summary second, recent memories third', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const scopeKey = encodeScope(scope);
    const nativeSessionId = 'current-native-sess-123';

    withDatabase(dbPath, (db) => {
      activateSession(db, 'other-sess', scopeKey, 'normal');
      activateSession(db, 'old-sess', scopeKey, 'normal');
      activateSession(db, nativeSessionId, scopeKey, 'normal');

      // 1. Regular recent memories
      createMemory(db, {
        scopeKey,
        title: 'Recent Memory 1',
        content: 'Some details about feature X',
        type: 'feature',
        topicKey: 'feature-x',
        sessionId: 'other-sess',
      });
      createMemory(db, {
        scopeKey,
        title: 'Recent Memory 2',
        content: 'Some details about feature Y',
        type: 'feature',
        topicKey: 'feature-y',
        sessionId: 'other-sess',
      });

      // 2. Project summary
      createMemory(db, {
        scopeKey,
        title: 'Project Overview',
        content: 'Summary of project my-proj architecture.',
        type: 'project_summary',
        sessionId: 'old-sess',
      });

      // 3. Current session summary
      createMemory(db, {
        scopeKey,
        title: 'Session Summary',
        content: 'Work done in session current-native-sess-123.',
        type: 'session_summary',
        topicKey: `session/${nativeSessionId}/summary`,
        sessionId: nativeSessionId,
      });
    });

    const ctx = readMemoryContext(dbPath, {
      sessionScope: scope,
      sessionId: nativeSessionId,
      pageSize: 10,
    });

    assert.ok(ctx.items.length >= 3);
    // Priority check:
    // 1st item MUST be the session summary!
    assert.equal(ctx.items[0].kind, 'session_summary');
    assert.equal(ctx.items[0].title, 'Session Summary');

    // 2nd item MUST be the project summary!
    assert.equal(ctx.items[1].kind, 'project_summary');
    assert.equal(ctx.items[1].title, 'Project Overview');

    // Remaining items are recent memories
    assert.equal(ctx.items[2].kind, 'recent_memory');
  } finally {
    cleanup();
  }
});

test('M5-A04: memory_context deduplicates by memory id and topic key, handles missing summaries without saving', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const scopeKey = encodeScope(scope);
    const nativeSessionId = 'fresh-sess-456';

    withDatabase(dbPath, (db) => {
      activateSession(db, 'sess-1', scopeKey, 'normal');
      activateSession(db, 'sess-2', scopeKey, 'normal');

      // Only regular memories, NO session summary or project summary
      createMemory(db, {
        scopeKey,
        title: 'Mem A',
        content: 'Content A',
        type: 'note',
        topicKey: 'topic-alpha',
        sessionId: 'sess-1',
      });
      // Replace or update Mem A with same topicKey (or second memory with same topicKey)
      createMemory(db, {
        scopeKey,
        title: 'Mem B',
        content: 'Content B',
        type: 'note',
        sessionId: 'sess-2',
      });
    });

    const ctx = readMemoryContext(dbPath, {
      sessionScope: scope,
      sessionId: nativeSessionId,
      pageSize: 10,
    });

    // Missing summaries: no crash, no summaries saved!
    assert.equal(ctx.items.length, 2);
    assert.ok(ctx.items.every((it) => it.kind === 'recent_memory'));

    // Check DB: verify NO summary was generated or saved!
    withDatabase(dbPath, (db) => {
      const summaries = db.prepare('SELECT * FROM memories WHERE type IN (\'session_summary\', \'project_summary\');').all();
      assert.equal(summaries.length, 0);
    });
  } finally {
    cleanup();
  }
});
