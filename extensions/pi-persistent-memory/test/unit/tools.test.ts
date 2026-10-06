import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withDatabase } from '../../src/storage/db.ts';
import { initSchema } from '../../src/storage/schema.ts';
import { activateSession } from '../../src/storage/session-store.ts';
import { createMemory } from '../../src/storage/memory-store.ts';
import { encodeScope } from '../../src/identity.ts';
import type { Scope } from '../../src/types.ts';
import { createMemoryTools, TOOL_NAMES } from '../../src/tools/index.ts';
import type { OperationContext } from '../../src/tools/types.ts';

function createTempDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-mini-005-tools-'));
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

function createMockOpContext(dbPath: string, scope: Scope, sessionId = 'test-session-123'): OperationContext {
  const scopeKey = encodeScope(scope);
  withDatabase(dbPath, (db) => {
    activateSession(db, sessionId, scopeKey, 'normal');
  });
  return {
    sessionId,
    scope,
    scopeKey,
    isChild: false,
    signal: new AbortController().signal,
    assertActive: () => {},
    dbPath,
  };
}

test('M5-A01: Exactly nine tools register with valid provider-compatible flat schemas and additionalProperties false', () => {
  const tools = createMemoryTools();
  assert.equal(tools.length, 9);

  const registeredNames = tools.map((t) => t.name).sort();
  const expectedNames = [
    'memory_context',
    'memory_delete',
    'memory_deleted_list',
    'memory_entity',
    'memory_get',
    'memory_relation',
    'memory_restore',
    'memory_save',
    'memory_search',
  ].sort();
  assert.deepEqual(registeredNames, expectedNames);
  assert.deepEqual(TOOL_NAMES.slice().sort(), expectedNames);

  for (const tool of tools) {
    const schema = tool.parameters as any;
    assert.equal(schema.type, 'object', `Tool ${tool.name} must have root Type.Object`);
    assert.equal(schema.additionalProperties, false, `Tool ${tool.name} must have additionalProperties: false`);
    assert.ok(tool.description && tool.description.length > 20, `Tool ${tool.name} must have meaningful English description`);
  }
});

test('M5-A01 & M5-A03: memory_save requires title/content/type for save and rejects textual fields for reindex', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const tools = createMemoryTools();
    const saveTool = tools.find((t) => t.name === 'memory_save')!;
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const opCtx = createMockOpContext(dbPath, scope);

    // Missing title -> fails
    const res1 = await saveTool.execute('call-1', { action: 'save', content: 'test content', type: 'note' }, undefined, undefined, opCtx as any);
    assert.equal(res1.isError, true);
    assert.match((res1.content[0] as any).text, /required/i);

    // Save success -> compact confirmation, NO full text echo in content
    const fullContent = 'This is the long secret text of the note that must not be echoed.';
    const res2 = await saveTool.execute('call-2', { action: 'save', title: 'Note Title', content: fullContent, type: 'note' }, undefined, undefined, opCtx as any);
    assert.equal(res2.isError, false);
    assert.ok((res2.details as any)?.id > 0);
    assert.equal((res2.details as any)?.status, 'saved');
    assert.ok(!(res2.content[0] as any).text.includes(fullContent), 'Must not echo full content in tool result');

    // Reindex rejects title / content / type / topic_key
    const res3 = await saveTool.execute('call-3', { action: 'reindex', title: 'Forbidden Title' }, undefined, undefined, opCtx as any);
    assert.equal(res3.isError, true);
    assert.match((res3.content[0] as any).text, /forbidden for action 'reindex'/i);
  } finally {
    cleanup();
  }
});

test('M5-A01: memory_search enforces non-graph query and graph entity_id contradictions', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const tools = createMemoryTools();
    const searchTool = tools.find((t) => t.name === 'memory_search')!;
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const opCtx = createMockOpContext(dbPath, scope);

    // Non-graph requires query
    const res1 = await searchTool.execute('call-1', { mode: 'hybrid' }, undefined, undefined, opCtx as any);
    assert.equal(res1.isError, true);
    assert.match((res1.content[0] as any).text, /query is required/i);

    // Non-graph rejects contradictory entity_id
    const res2 = await searchTool.execute('call-2', { query: 'test', entity_id: 'ent-1' }, undefined, undefined, opCtx as any);
    assert.equal(res2.isError, true);
    assert.match((res2.content[0] as any).text, /contradictory/i);

    // Graph requires entity_id
    const res3 = await searchTool.execute('call-3', { mode: 'graph' }, undefined, undefined, opCtx as any);
    assert.equal(res3.isError, true);
    assert.match((res3.content[0] as any).text, /entity_id is required/i);

    // Graph rejects contradictory query
    const res4 = await searchTool.execute('call-4', { mode: 'graph', entity_id: 'ent-1', query: 'contradictory' }, undefined, undefined, opCtx as any);
    assert.equal(res4.isError, true);
    assert.match((res4.content[0] as any).text, /contradictory/i);
  } finally {
    cleanup();
  }
});

test('M5-A01 & M5-A03: memory_delete and memory_restore enforce owner_scope assertion against DB row', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const tools = createMemoryTools();
    const delTool = tools.find((t) => t.name === 'memory_delete')!;
    const restoreTool = tools.find((t) => t.name === 'memory_restore')!;
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const opCtx = createMockOpContext(dbPath, scope);

    let memId = 0;
    withDatabase(dbPath, (db) => {
      const m = createMemory(db, {
        scopeKey: encodeScope(scope),
        title: 'Delete Target',
        content: 'Content',
        type: 'note',
        sessionId: opCtx.sessionId,
      });
      memId = m.id;
    });

    // Mismatched owner_scope assertion fails without touching row
    const resMismatch = await delTool.execute('call-1', { id: memId, owner_scope: 'global' }, undefined, undefined, opCtx as any);
    assert.equal(resMismatch.isError, true);
    assert.match((resMismatch.content[0] as any).text, /owner_scope_mismatch/);

    // Matching owner_scope succeeds
    const resDel = await delTool.execute('call-2', { id: memId, owner_scope: 'project' }, undefined, undefined, opCtx as any);
    assert.equal(resDel.isError, false);
    assert.equal((resDel.details as any)?.status, 'deleted');

    // Restore with mismatched owner_scope fails
    const resResMismatch = await restoreTool.execute('call-3', { id: memId, owner_scope: 'global' }, undefined, undefined, opCtx as any);
    assert.equal(resResMismatch.isError, true);
    assert.match((resResMismatch.content[0] as any).text, /owner_scope_mismatch/);

    // Restore with matching owner_scope succeeds
    const resRestore = await restoreTool.execute('call-4', { id: memId, owner_scope: 'project' }, undefined, undefined, opCtx as any);
    assert.equal(resRestore.isError, false);
    assert.equal((resRestore.details as any)?.status, 'restored');
  } finally {
    cleanup();
  }
});

test('M5-A05: session_summary reserved topic_key is enforced and conflicting key rejected', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const tools = createMemoryTools();
    const saveTool = tools.find((t) => t.name === 'memory_save')!;
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const nativeSessionId = 'active-native-sess-999';
    const opCtx = createMockOpContext(dbPath, scope, nativeSessionId);

    // Conflicting provided topic_key fails
    const resConflict = await saveTool.execute('call-1', {
      action: 'save',
      title: 'Session Summary',
      content: 'Summary text',
      type: 'session_summary',
      topic_key: 'my-custom-topic-key',
    }, undefined, undefined, opCtx as any);
    assert.equal(resConflict.isError, true);
    assert.match((resConflict.content[0] as any).text, /Conflicting topic_key for session_summary/);

    // Omitting topic_key automatically sets the reserved key
    const resOk = await saveTool.execute('call-2', {
      action: 'save',
      title: 'Session Summary',
      content: 'Summary text',
      type: 'session_summary',
    }, undefined, undefined, opCtx as any);
    assert.equal(resOk.isError, false);
    assert.equal((resOk.details as any)?.topic_key, `session/${nativeSessionId}/summary`);
  } finally {
    cleanup();
  }
});

test('M5-A06: Complete serialized AgentToolResult is <= 6144 bytes across all tools', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const tools = createMemoryTools();
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const opCtx = createMockOpContext(dbPath, scope);

    // Create some large memories
    for (let i = 1; i <= 5; i++) {
      withDatabase(dbPath, (db) => {
        createMemory(db, {
          scopeKey: encodeScope(scope),
          title: `Memory Title ${i} ` + 'A'.repeat(50),
          content: `Content for ${i} ` + 'B'.repeat(500),
          type: 'feature',
          sessionId: opCtx.sessionId,
        });
      });
    }

    for (const tool of tools) {
      let args: any = {};
      if (tool.name === 'memory_save') {
        args = { action: 'save', title: 'T', content: 'C', type: 'note' };
      } else if (tool.name === 'memory_search') {
        args = { query: 'Memory' };
      } else if (tool.name === 'memory_get') {
        args = { id: 1 };
      } else if (tool.name === 'memory_context') {
        args = {};
      } else if (tool.name === 'memory_delete') {
        args = { id: 1, owner_scope: 'project' };
      } else if (tool.name === 'memory_restore') {
        args = { id: 1, owner_scope: 'project' };
      } else if (tool.name === 'memory_deleted_list') {
        args = {};
      } else if (tool.name === 'memory_entity') {
        args = { action: 'list' };
      } else if (tool.name === 'memory_relation') {
        args = { action: 'save', source: 's', target: 't', relation_type: 'depends_on' };
      }

      const result = await tool.execute('call-audit', args, undefined, undefined, opCtx as any);
      const serialized = JSON.stringify(result);
      const byteLen = Buffer.byteLength(serialized, 'utf8');
      assert.ok(
        byteLen <= 6144,
        `Tool ${tool.name} result exceeded 6144 bytes: got ${byteLen} bytes`,
      );
    }
  } finally {
    cleanup();
  }
});

test('M5-A04 & M5-A06 RED: memory_get giant title and content reconstructs losslessly with valid JSON and <= 6144 bytes', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const tools = createMemoryTools();
    const getTool = tools.find((t) => t.name === 'memory_get')!;
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const opCtx = createMockOpContext(dbPath, scope);

    // Giant title with quotes, backslashes, newlines, emoji
    const giantTitle = 'Title "Quoted" \\Backslash\\ \nNewline 🚀 '.repeat(80);
    // Giant content with quotes, backslashes, newlines, emoji
    const giantContent = 'Content "Quoted" \\Backslash\\ \nNewline 🌍 測試 '.repeat(200);

    let memId = 0;
    withDatabase(dbPath, (db) => {
      const m = createMemory(db, {
        scopeKey: encodeScope(scope),
        title: giantTitle,
        content: giantContent,
        type: 'guide',
        sessionId: opCtx.sessionId,
      });
      memId = m.id;
    });

    let cursor: string | undefined = undefined;
    let accumulatedTitle = '';
    let accumulatedContent = '';
    let pageCount = 0;

    do {
      pageCount++;
      const res = await getTool.execute('call-get', { id: memId, cursor }, undefined, undefined, opCtx as any);

      // Assertion 1: isError must be explicitly false
      assert.equal(res.isError, false, `Page ${pageCount} isError must be false, got ${res.isError}`);

      // Assertion 2: Entire serialized result must be <= 6144 bytes
      const serialized = JSON.stringify(res);
      const byteLen = Buffer.byteLength(serialized, 'utf8');
      assert.ok(byteLen <= 6144, `Page ${pageCount} serialized byte length ${byteLen} exceeds 6144`);

      // Assertion 3: content[0].text must be valid JSON (no broken syntax from raw string slicing)
      assert.ok(res.content && res.content[0] && res.content[0].type === 'text');
      let parsed: any;
      assert.doesNotThrow(() => {
        parsed = JSON.parse((res.content[0] as any).text);
      }, `Page ${pageCount} content[0].text must be valid JSON`);

      // Assertion 4: Details truncated flag must not be true (no data loss)
      assert.notEqual((res.details as any)?.truncated, true, `Page ${pageCount} must not be truncated with data loss`);

      if (parsed.field === 'title') {
        accumulatedTitle += parsed.title;
        assert.equal(parsed.content, '');
      } else if (parsed.field === 'content') {
        accumulatedContent += parsed.content;
      }

      cursor = (res.details as any)?.next_cursor ?? undefined;
    } while (cursor);

    assert.ok(pageCount > 1, `Expected multiple pages, got ${pageCount}`);
    assert.equal(accumulatedTitle, giantTitle, 'Reconstructed title must match original 100% losslessly');
    assert.equal(accumulatedContent, giantContent, 'Reconstructed content must match original 100% losslessly');
  } finally {
    cleanup();
  }
});

test('M5-A06: memory_search mode graph on dense graph produces valid serialized AgentToolResult <= 6144 bytes', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const tools = createMemoryTools();
    const searchTool = tools.find((t) => t.name === 'memory_search')!;
    const scope: Scope = { kind: 'project', project: 'my-proj' };
    const opCtx = createMockOpContext(dbPath, scope);

    // Create 19 neighboring entities with long names/aliases
    const rootId = 'root-entity-1';
    withDatabase(dbPath, (db) => {
      db.prepare(`
        INSERT INTO entities (id, type, canonical_name, scope_key, display_name, aliases_json, session_id, created_at, updated_at)
        VALUES (?, 'concept', ?, '["project","my-proj"]', ?, '[]', ?, datetime('now'), datetime('now'));
      `).run(rootId, 'root_concept', 'Root Concept "Quoted"', opCtx.sessionId);

      for (let i = 1; i <= 19; i++) {
        const neighborId = `neighbor-entity-${i}`;
        db.prepare(`
          INSERT INTO entities (id, type, canonical_name, scope_key, display_name, aliases_json, session_id, created_at, updated_at)
          VALUES (?, 'concept', ?, '["project","my-proj"]', ?, '["alias_one_long_name","alias_two_long_name"]', ?, datetime('now'), datetime('now'));
        `).run(neighborId, `neighbor_concept_${i}`, `Neighbor Entity ${i} "With Quotes" & \\Backslashes\\ \nLine`, opCtx.sessionId);

        db.prepare(`
          INSERT INTO relations (id, source_entity_id, target_entity_id, relation_type, scope_key, session_id, created_at)
          VALUES (?, ?, ?, 'depends_on', '["project","my-proj"]', ?, datetime('now'));
        `).run(`rel-${i}`, rootId, neighborId, opCtx.sessionId);
      }
    });

    const res = await searchTool.execute('call-graph', { mode: 'graph', entity_id: rootId }, undefined, undefined, opCtx as any);

    // Assertion 1: isError must be false
    assert.equal(res.isError, false, `isError must be false, got ${res.isError}`);

    // Assertion 2: Serialized byte length <= 6144
    const serialized = JSON.stringify(res);
    const byteLen = Buffer.byteLength(serialized, 'utf8');
    assert.ok(byteLen <= 6144, `Graph search serialized byte length ${byteLen} exceeds 6144 bytes`);

    // Assertion 3: content[0].text is valid JSON
    assert.doesNotThrow(() => {
      JSON.parse((res.content[0] as any).text);
    }, 'Graph search content[0].text must be valid JSON');
  } finally {
    cleanup();
  }
});

test('M5-A04 & M5-A06: All nine tools handle giant data with <= 6144 bytes, isError: false, valid JSON, exact ID sets', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const tools = createMemoryTools();
    const scope: Scope = { kind: 'project', project: 'giant-proj-' + 'x'.repeat(60) };
    const opCtx = createMockOpContext(dbPath, scope);

    // 1. memory_save: giant title + giant content + long scope -> compact confirmation <= 6144, isError: false
    const saveTool = tools.find((t) => t.name === 'memory_save')!;
    const giantSaveRes = await saveTool.execute(
      'call-save-giant',
      {
        action: 'save',
        title: 'Giant Title ' + 'T'.repeat(800),
        content: 'Giant Content ' + 'C'.repeat(4000),
        type: 'note',
      },
      undefined,
      undefined,
      opCtx as any,
    );
    assert.equal(giantSaveRes.isError, false);
    const saveLen = Buffer.byteLength(JSON.stringify(giantSaveRes), 'utf8');
    assert.ok(saveLen <= 6144, `memory_save confirmation byte length ${saveLen} exceeds 6144`);
    assert.doesNotThrow(() => JSON.parse((giantSaveRes.content[0] as any).text));
    const savedId = (giantSaveRes.details as any)?.id;
    assert.ok(savedId > 0);

    // Populate 12 memories with giant titles for pagination tests
    const createdIds: number[] = [savedId];
    for (let i = 2; i <= 12; i++) {
      withDatabase(dbPath, (db) => {
        const m = createMemory(db, {
          scopeKey: opCtx.scopeKey,
          title: `Memory ${i} Giant Title ` + 'T'.repeat(500) + ` "Quotes" & \nLines`,
          content: `Content ${i} ` + 'D'.repeat(800),
          type: 'note',
          sessionId: opCtx.sessionId,
        });
        createdIds.push(m.id);
      });
    }

    // 2. memory_search (fts5): paginate across memories, check exact ID sets without skip/drop/duplicate
    const searchTool = tools.find((t) => t.name === 'memory_search')!;
    let searchCursor: string | undefined = undefined;
    const collectedSearchIds = new Set<number>();
    let searchPages = 0;
    do {
      searchPages++;
      const sRes = await searchTool.execute(
        'call-search-paged',
        { mode: 'fts5', query: 'Memory', cursor: searchCursor },
        undefined,
        undefined,
        opCtx as any,
      );
      assert.equal(sRes.isError, false, `Search page ${searchPages} isError must be false`);
      const sLen = Buffer.byteLength(JSON.stringify(sRes), 'utf8');
      assert.ok(sLen <= 6144, `Search page ${searchPages} byte length ${sLen} exceeds 6144`);
      assert.doesNotThrow(() => JSON.parse((sRes.content[0] as any).text));
      const sParsed = JSON.parse((sRes.content[0] as any).text);
      for (const r of sParsed.results) {
        assert.ok(!collectedSearchIds.has(r.id), `Search duplicate ID ${r.id} detected on page ${searchPages}`);
        collectedSearchIds.add(r.id);
      }
      searchCursor = (sRes.details as any)?.next_cursor ?? undefined;
    } while (searchCursor);
    assert.ok(searchPages > 1, `Expected multiple search pages, got ${searchPages}`);
    assert.ok(collectedSearchIds.size >= 10, `Expected at least 10 search results, got ${collectedSearchIds.size}`);

    // 3. memory_context: paginate context with giant titles, check exact ID sets
    const contextTool = tools.find((t) => t.name === 'memory_context')!;
    let contextCursor: string | undefined = undefined;
    const collectedContextIds = new Set<number>();
    let contextPages = 0;
    do {
      contextPages++;
      const cRes = await contextTool.execute(
        'call-context-paged',
        { cursor: contextCursor },
        undefined,
        undefined,
        opCtx as any,
      );
      assert.equal(cRes.isError, false, `Context page ${contextPages} isError must be false`);
      const cLen = Buffer.byteLength(JSON.stringify(cRes), 'utf8');
      assert.ok(cLen <= 6144, `Context page ${contextPages} byte length ${cLen} exceeds 6144`);
      assert.doesNotThrow(() => JSON.parse((cRes.content[0] as any).text));
      const cParsed = JSON.parse((cRes.content[0] as any).text);
      for (const item of cParsed.items) {
        assert.ok(!collectedContextIds.has(item.id), `Context duplicate ID ${item.id} detected on page ${contextPages}`);
        collectedContextIds.add(item.id);
      }
      contextCursor = (cRes.details as any)?.next_cursor ?? undefined;
    } while (contextCursor);
    assert.ok(contextPages > 1, `Expected multiple context pages, got ${contextPages}`);
    assert.equal(collectedContextIds.size, 12, 'Context must cover all 12 active memories without drop or skip');

    // 4. memory_delete: delete 6 memories with matching owner_scope
    const deleteTool = tools.find((t) => t.name === 'memory_delete')!;
    const deletedIds: number[] = [];
    for (let i = 7; i <= 12; i++) {
      const delRes = await deleteTool.execute(
        `call-del-${i}`,
        { id: createdIds[i - 1], owner_scope: 'project' },
        undefined,
        undefined,
        opCtx as any,
      );
      assert.equal(delRes.isError, false);
      const delLen = Buffer.byteLength(JSON.stringify(delRes), 'utf8');
      assert.ok(delLen <= 6144);
      deletedIds.push(createdIds[i - 1]);
    }

    // 5. memory_deleted_list: paginate deleted list with giant titles, check exact ID sets
    const deletedListTool = tools.find((t) => t.name === 'memory_deleted_list')!;
    let delCursor: string | undefined = undefined;
    const collectedDelIds = new Set<number>();
    let delPages = 0;
    do {
      delPages++;
      const dlRes = await deletedListTool.execute(
        'call-del-list',
        { cursor: delCursor },
        undefined,
        undefined,
        opCtx as any,
      );
      assert.equal(dlRes.isError, false, `Deleted list page ${delPages} isError must be false`);
      const dlLen = Buffer.byteLength(JSON.stringify(dlRes), 'utf8');
      assert.ok(dlLen <= 6144, `Deleted list page ${delPages} byte length ${dlLen} exceeds 6144`);
      assert.doesNotThrow(() => JSON.parse((dlRes.content[0] as any).text));
      const dlParsed = JSON.parse((dlRes.content[0] as any).text);
      for (const item of dlParsed.items) {
        assert.ok(!collectedDelIds.has(item.id), `Deleted list duplicate ID ${item.id} on page ${delPages}`);
        collectedDelIds.add(item.id);
      }
      delCursor = (dlRes.details as any)?.next_cursor ?? undefined;
    } while (delCursor);
    assert.ok(delPages > 1, `Expected multiple deleted list pages, got ${delPages}`);
    assert.equal(collectedDelIds.size, 6, 'Deleted list must return exactly the 6 deleted IDs');

    // 6. memory_restore: restore one memory
    const restoreTool = tools.find((t) => t.name === 'memory_restore')!;
    const restRes = await restoreTool.execute(
      'call-restore',
      { id: deletedIds[0], owner_scope: 'project' },
      undefined,
      undefined,
      opCtx as any,
    );
    assert.equal(restRes.isError, false);
    const restLen = Buffer.byteLength(JSON.stringify(restRes), 'utf8');
    assert.ok(restLen <= 6144);

    // 7. memory_entity: action save with giant aliases and display name
    const entityTool = tools.find((t) => t.name === 'memory_entity')!;
    const giantAliases = Array.from({ length: 15 }, (_, idx) => `alias_${idx}_` + 'A'.repeat(50));
    const entSaveRes = await entityTool.execute(
      'call-ent-save',
      {
        action: 'save',
        type: 'concept',
        name: 'Concept Name ' + 'N'.repeat(60),
        aliases: giantAliases,
      },
      undefined,
      undefined,
      opCtx as any,
    );
    assert.equal(entSaveRes.isError, false);
    const entSaveLen = Buffer.byteLength(JSON.stringify(entSaveRes), 'utf8');
    assert.ok(entSaveLen <= 6144, `Entity save byte length ${entSaveLen} exceeds 6144`);
    const savedEntityId = (entSaveRes.details as any)?.id;
    assert.ok(savedEntityId);

    // Create 10 entities and paginate action list
    for (let i = 1; i <= 10; i++) {
      await entityTool.execute(
        `call-ent-create-${i}`,
        {
          action: 'save',
          type: 'concept',
          name: `Batch Entity ${i} ` + 'B'.repeat(40),
          aliases: [`alias_b_${i}_one`, `alias_b_${i}_two`],
        },
        undefined,
        undefined,
        opCtx as any,
      );
    }

    let entCursor: string | undefined = undefined;
    const collectedEntityIds = new Set<string>();
    let entPages = 0;
    do {
      entPages++;
      const elRes = await entityTool.execute(
        'call-ent-list',
        { action: 'list', cursor: entCursor },
        undefined,
        undefined,
        opCtx as any,
      );
      assert.equal(elRes.isError, false);
      const elLen = Buffer.byteLength(JSON.stringify(elRes), 'utf8');
      assert.ok(elLen <= 6144, `Entity list page ${entPages} byte length ${elLen} exceeds 6144`);
      assert.doesNotThrow(() => JSON.parse((elRes.content[0] as any).text));
      const elParsed = JSON.parse((elRes.content[0] as any).text);
      for (const e of elParsed.entities) {
        assert.ok(!collectedEntityIds.has(e.id), `Entity list duplicate ID ${e.id} on page ${entPages}`);
        collectedEntityIds.add(e.id);
      }
      entCursor = (elRes.details as any)?.next_cursor ?? undefined;
    } while (entCursor);
    assert.ok(collectedEntityIds.size >= 11, `Expected at least 11 entities, got ${collectedEntityIds.size}`);

    // 8. memory_relation: action save and delete
    const relationTool = tools.find((t) => t.name === 'memory_relation')!;
    const entityListArray = Array.from(collectedEntityIds);
    const relSaveRes = await relationTool.execute(
      'call-rel-save',
      {
        action: 'save',
        source: entityListArray[0],
        target: entityListArray[1],
        relation_type: 'depends_on',
      },
      undefined,
      undefined,
      opCtx as any,
    );
    assert.equal(relSaveRes.isError, false);
    const relSaveLen = Buffer.byteLength(JSON.stringify(relSaveRes), 'utf8');
    assert.ok(relSaveLen <= 6144);
    const relId = (relSaveRes.details as any)?.id;
    assert.ok(relId);

    const relDelRes = await relationTool.execute(
      'call-rel-del',
      { action: 'delete', id: relId },
      undefined,
      undefined,
      opCtx as any,
    );
    assert.equal(relDelRes.isError, false);
    const relDelLen = Buffer.byteLength(JSON.stringify(relDelRes), 'utf8');
    assert.ok(relDelLen <= 6144);
  } finally {
    cleanup();
  }
});
