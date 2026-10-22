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
import { Compile } from 'typebox/compile';
import { RELATION_TYPES } from '../../src/graph/types.ts';
import { OfflineE5Client } from '../fixtures/offline-e5.ts';
import { formatSuccessResult, formatErrorResult } from '../../src/tools/result-helper.ts';

const resultText = (result: any): string => result.content[0].text;
const listedIds = (result: any): string[] => [...resultText(result).matchAll(/^\[([^\]\n]+)\]/gm)].map((match) => match[1]);

function pageBody(result: any): string {
  const text = resultText(result);
  const start = text.indexOf('\n\n') + 2;
  const end = result.details?.has_more ? text.lastIndexOf('\n\nMore available.') : text.length;
  return text.slice(start, end);
}

test('Execution output: search is readable, lean and keeps fallback and continuation visible', () => {
  const data = {
    status: 'ok', requested_mode: 'hybrid', actual_mode: 'fts5',
    scope: { kind: 'project', project: 'current', explicit_global: true },
    results: [{ id: 12, title: 'Offline tests', excerpt: 'Use the network guard.',
      scope: { kind: 'project', project: 'other' }, type: 'lesson', updated_at: '2026-10-22',
      score: 0.123, excerpt_meta: { field: 'content', start: 0, end: 22 } }],
    warnings: ['semantic_unavailable'], has_more: true, next_cursor: 'exact-cursor',
  };
  const result = formatSuccessResult(data);
  const text = resultText(result);
  assert.match(text, /\[12\] Offline tests/);
  assert.match(text, /Use the network guard/);
  assert.match(text, /other/);
  assert.match(text, /fts5/);
  assert.match(text, /semantic_unavailable/);
  assert.match(text, /cursor: exact-cursor/);
  assert.doesNotMatch(text, /excerpt_meta|updated_at|explicit_global|requested_mode|"status"|"score"/);
  assert.ok(text.length < JSON.stringify(data, null, 2).length * 0.65);
});

test('Execution output: matching title excerpts are not repeated', () => {
  const text = resultText(formatSuccessResult({ results: [{ id: 1, title: 'Offline tests', excerpt: 'Offline tests' }],
    requested_mode: 'fts5', actual_mode: 'fts5', has_more: false }));
  assert.equal(text.match(/Offline tests/g)?.length, 1);
});

test('Execution output: complete reads preserve exact text without paging internals', () => {
  const content = 'Line one\n\n"Quoted" \\ path 🚀\n';
  const title = 'Offline tests\n"Exact" 🚀';
  const result = formatSuccessResult({ id: 12, title, content, type: 'lesson',
    field: 'content', offset: 0, total_field_bytes: 99, page_bytes: 99, content_version: 2,
    scope_key: '["project","current"]', created_at: 'date', updated_at: 'date',
    has_more: false, next_cursor: null });
  assert.equal(resultText(result), `[12] ${title}\n\n${content}`);
});

test('Execution output: confirmations distinguish saved text from pending indexing and errors retain IDs', () => {
  const result = formatSuccessResult({ action: 'save', id: 12, committed: true, indexed: false,
    indexing_status: 'pending', notice: 'unavailable: E5 offline', status: 'saved' });
  assert.match(resultText(result), /Memory \[12\] saved; indexing pending/);
  assert.match(resultText(result), /E5 offline/);
  assert.doesNotMatch(resultText(result), /"committed"|"indexed"|"status"/);
  const error = formatErrorResult('cancelled: text remains pending', { id: 12, committed: true });
  assert.match(resultText(error), /\[12\].*cancelled/);
  assert.equal(error.isError, true);
});

test('Execution output: empty, recovery and graph outputs expose only useful state', () => {
  const empty = resultText(formatSuccessResult({ results: [], requested_mode: 'fts5', actual_mode: 'fts5',
    scope: { kind: 'project' }, warnings: [], has_more: false, next_cursor: null }));
  assert.match(empty, /0 memory excerpts/);
  assert.doesNotMatch(empty, /cursor|Warning|fallback|null|false/);
  const deleted = resultText(formatSuccessResult({ items: [{ id: 4, title: 'Recover me',
    scope_key: '["global"]', deleted_at: '2026-10-22', type: 'note' }], has_more: false }));
  assert.match(deleted, /\[4\] Recover me \(global\)/);
  assert.match(deleted, /Deleted: 2026-10-22/);
  const graph = resultText(formatSuccessResult({ root: { id: 'root' },
    nodes: [{ id: 'root', type: 'concept', display_name: 'Root', scope: { kind: 'global' } }],
    edges: [{ id: 'edge', source: 'child', target: 'root', type: 'uses', direction: 'incoming' }],
    associations: [{ id: 'link', memory_id: 12, entity_id: 'root' }],
    limits: { has_more: true, depth_limit: true, entity_limit: false, byte_limit: false } }));
  assert.match(graph, /\[child\] --uses--> \[root\]/);
  assert.match(graph, /Memory \[12\] linked to entity \[root\]/);
  assert.match(graph, /Partial graph \(depth limit\).*focused graph root/);
  const reindex = resultText(formatSuccessResult({ action: 'reindex', processed: 5, succeeded: 3,
    failed: 1, stale: 1, remaining: 2, notice: 'Service unavailable', has_more: true, next_cursor: 'retry-cursor' }));
  assert.match(reindex, /5 processed, 3 indexed, 1 failed, 1 stale, 2 remaining/);
  assert.match(reindex, /Service unavailable/);
  assert.match(reindex, /cursor: retry-cursor/);
});

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
    client: new OfflineE5Client(),
  };
}

test('M5-A01: Exactly ten tools register with valid provider-compatible flat schemas and additionalProperties false', () => {
  const tools = createMemoryTools();
  assert.equal(tools.length, 10);

  const registeredNames = tools.map((t) => t.name).sort();
  const expectedNames = [
    'memory_context',
    'memory_delete',
    'memory_deleted_list',
    'memory_entity',
    'memory_get',
    'memory_history',
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

test('Memory guidance: all nine registered tools expose actionable prompt guidelines and parameter help', () => {
  for (const tool of createMemoryTools()) {
    assert.ok(tool.promptGuidelines?.length, `${tool.name} must provide guidelines to Pi and lean subagents`);
    for (const guideline of tool.promptGuidelines!) {
      assert.ok(guideline.trim().length > 0);
      assert.ok(guideline.includes(tool.name), `${tool.name} guideline must identify its operation`);
    }
    for (const [name, property] of Object.entries((tool.parameters as any).properties)) {
      assert.ok((property as any).description?.length > 15, `${tool.name}.${name} needs actionable help`);
    }
  }
});

test('Memory guidance: save documents replacement, deduplication, confirmation and safety boundaries', () => {
  const save = createMemoryTools().find((tool) => tool.name === 'memory_save')!;
  const guidance = [save.description, ...(save.promptGuidelines ?? [])].join(' ');
  for (const concept of [/confirmed/i, /topic_key/, /replace/i, /memory_get/, /source/i, /committed/, /indexing_status/, /secret/i, /session_summary/, /explicit.*user request/i]) {
    assert.match(guidance, concept);
  }
  assert.match((save.parameters as any).properties.content.description, /replace/i);
  assert.match((save.parameters as any).properties.scope.description, /global/);
});

test('Memory guidance: search and recovery document real continuation and scope contracts', () => {
  const tools = createMemoryTools();
  const search = tools.find((tool) => tool.name === 'memory_search')!;
  for (const concept of [/hybrid/, /fts5/, /semantic/, /graph/, /entity_id/, /memory_get/, /query/, /next_cursor/, /warnings/]) {
    assert.match(search.description, concept);
  }
  assert.match((search.parameters as any).properties.cursor.description, /same query.*mode.*global/i);
  const restore = tools.find((tool) => tool.name === 'memory_restore')!;
  for (const concept of [/memory_deleted_list/, /owner_scope/, /scope.*global/, /pending/, /reindex/]) {
    assert.match(restore.description, concept);
  }
});

test('M6-A01 & M6-A05: public relation schema accepts exactly the approved graph vocabulary', () => {
  const tool = createMemoryTools().find((entry) => entry.name === 'memory_relation')!;
  const validator = Compile(tool.parameters);
  const declared = (tool.parameters as any).properties.relation_type.enum;
  assert.deepEqual([...declared].sort(), [...RELATION_TYPES].sort());
  for (const relationType of RELATION_TYPES) {
    assert.equal(validator.Check({ action: 'save', source: 'source', target: 'target', relation_type: relationType }), true, relationType);
    assert.ok(tool.description.includes(relationType), `Description must document supported relation ${relationType}`);
  }
  for (const relationType of ['implements', 'configured_by', 'owned_by', 'unknown']) {
    assert.equal(validator.Check({ action: 'save', source: 'source', target: 'target', relation_type: relationType }), false, relationType);
    assert.ok(!tool.description.includes(relationType), `Description must not advertise unsupported relation ${relationType}`);
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

test('M5-A04 & M5-A06: memory_get giant title and content reconstructs losslessly with readable pages and <= 6144 bytes', async () => {
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

      // The exact returned field is readable text, including quotes, Unicode and newlines.
      assert.ok(res.content && res.content[0] && res.content[0].type === 'text');
      const field = (res.details as any).field;
      assert.ok(field === 'title' || field === 'content');

      // Assertion 4: Details truncated flag must not be true (no data loss)
      assert.notEqual((res.details as any)?.truncated, true, `Page ${pageCount} must not be truncated with data loss`);

      if (field === 'title') {
        accumulatedTitle += pageBody(res);
      } else {
        accumulatedContent += pageBody(res);
      }
      if ((res.details as any).has_more) assert.ok(resultText(res).includes(`cursor: ${(res.details as any).next_cursor}`));

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

    assert.match(resultText(res), /Graph root: \[root-entity-1\]/);
    assert.match(resultText(res), /--depends_on-->/);
    assert.doesNotMatch(resultText(res), /"scope"|"canonical_name"/);
  } finally {
    cleanup();
  }
});

test('M5-A04 & M5-A06: All tools handle giant data with <= 6144 bytes, readable output and exact ID sets', async () => {
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
    assert.match(resultText(giantSaveRes), /saved and indexed/);
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
      for (const rawId of listedIds(sRes)) {
        const id = Number(rawId);
        assert.ok(!collectedSearchIds.has(id), `Search duplicate ID ${id} detected on page ${searchPages}`);
        collectedSearchIds.add(id);
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
      for (const rawId of listedIds(cRes)) {
        const id = Number(rawId);
        assert.ok(!collectedContextIds.has(id), `Context duplicate ID ${id} detected on page ${contextPages}`);
        collectedContextIds.add(id);
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
      for (const rawId of listedIds(dlRes)) {
        const id = Number(rawId);
        assert.ok(!collectedDelIds.has(id), `Deleted list duplicate ID ${id} on page ${delPages}`);
        collectedDelIds.add(id);
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
      for (const id of listedIds(elRes)) {
        assert.ok(!collectedEntityIds.has(id), `Entity list duplicate ID ${id} on page ${entPages}`);
        collectedEntityIds.add(id);
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

    // 9. memory_history: action search and get with giant data <= 6144 bytes, valid JSON, isError: false
    const historyTool = tools.find((t) => t.name === 'memory_history')!;
    const { createUserMessage } = await import('../../src/storage/history-store.ts');
    const { resolveHistoryProjectKey } = await import('../../src/identity.ts');
    const projectKey = resolveHistoryProjectKey(process.cwd());

    let msgIdGiant: number = 0;
    withDatabase(dbPath, (db) => {
      // Create giant user message
      const giantMsg = createUserMessage(db, {
        sessionId: opCtx.sessionId,
        projectKey,
        content: 'Giant user prompt ' + 'P'.repeat(10000),
      });
      msgIdGiant = giantMsg.id;
    });

    const histSearchRes = await historyTool.execute(
      'call-hist-search',
      { action: 'search' },
      undefined,
      undefined,
      opCtx as any,
    );
    assert.equal(histSearchRes.isError, false);
    const histSearchLen = Buffer.byteLength(JSON.stringify(histSearchRes), 'utf8');
    assert.ok(histSearchLen <= 6144, `memory_history search length ${histSearchLen} exceeds 6144`);
    assert.ok(listedIds(histSearchRes).includes(String(msgIdGiant)));

    const histGetRes = await historyTool.execute(
      'call-hist-get',
      { action: 'get', id: msgIdGiant },
      undefined,
      undefined,
      opCtx as any,
    );
    assert.equal(histGetRes.isError, false);
    const histGetLen = Buffer.byteLength(JSON.stringify(histGetRes), 'utf8');
    assert.ok(histGetLen <= 6144, `memory_history get length ${histGetLen} exceeds 6144`);
    assert.match(resultText(histGetRes), /Message \[\d+\]/);
    assert.match(resultText(histGetRes), /Giant user prompt/);
    assert.ok(resultText(histGetRes).includes(`cursor: ${(histGetRes.details as any).next_cursor}`));
  } finally {
    cleanup();
  }
});
