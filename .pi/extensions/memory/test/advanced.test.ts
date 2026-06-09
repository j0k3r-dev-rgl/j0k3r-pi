import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import extension from '../index.js';
import { openMemoryDb } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { resolveMemoryContext } from '../src/context.js';
import { addMemory } from '../src/memory-store.js';
import { consolidateMemories } from '../src/consolidation.js';
import { buildProjectProfileUpdatePreview, buildSemanticProjectProfilePrompt, shouldConfirmProjectProfileUpdate } from '../src/project-profile.js';
import { exportMemory, importMemory } from '../src/export-import.js';
import { searchMemory } from '../src/search.js';
import { applyBrowserFilterCommand, filterBrowserItems } from '../src/memory-browser.js';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-memory-advanced-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function db() { const d = openMemoryDb(':memory:'); migrate(d); return d; }
function project(dir = tmp) { fs.mkdirSync(path.join(dir, '.pi'), { recursive: true }); fs.writeFileSync(path.join(dir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Advanced App' })); return resolveMemoryContext(dir, os.homedir(), {}); }

async function lifecycleHarness() {
  const dbPath = path.join(tmp, 'lifecycle.sqlite');
  const projectDir = path.join(tmp, 'project');
  fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Lifecycle Advanced' }));
  const old = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;
  const handlers = new Map<string, Function>();
  extension({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
  if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
  const notifications: string[] = [];
  const ctx: any = {
    cwd: projectDir,
    ui: { setStatus: () => {}, notify: (msg: string) => notifications.push(msg) },
    sessionManager: {
      getSessionFile: () => path.join(tmp, 'pi-session.json'),
      getBranch: () => [
        { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Run lifecycle checks' }] } },
        { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'npm test' } }] } },
      ],
    },
  };
  await handlers.get('session_start')?.({}, ctx);
  return { dbPath, handlers, ctx, notifications };
}

describe('advanced lifecycle behavior', () => {
  it('does not close memory session on reload shutdown', async () => {
    const h = await lifecycleHarness();
    await h.handlers.get('before_agent_start')?.({ prompt: 'first turn' }, h.ctx);
    await h.handlers.get('session_shutdown')?.({ reason: 'reload' }, h.ctx);
    const d = openMemoryDb(h.dbPath);
    const row = d.prepare('SELECT ended_at, summary FROM memory_sessions LIMIT 1').get() as any;
    expect(row.ended_at).toBeNull();
    expect(row.summary).toBeNull();
  });

  it('injects startup context only once across turns', async () => {
    const h = await lifecycleHarness();
    const first = await h.handlers.get('before_agent_start')?.({ prompt: 'first turn' }, h.ctx);
    const second = await h.handlers.get('before_agent_start')?.({ prompt: 'second turn' }, h.ctx);
    expect(first?.message?.customType).toBe('memory-context');
    expect(second).toBeUndefined();
  });

  it('startup context prefers previous completed session summaries over the current empty session', async () => {
    const dbPath = path.join(tmp, 'startup.sqlite');
    const projectDir = path.join(tmp, 'startup-project');
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Startup App' }));
    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const d = openMemoryDb(dbPath);
    migrate(d);
    const c = resolveMemoryContext(projectDir, os.homedir(), {});
    const previous: any = (await import('../src/sessions.js')).startMemorySession(d, { title: 'Previous Done' }, c);
    (await import('../src/sessions.js')).finishMemorySession(d, { session_id: previous.id, summary: 'previous useful summary' }, c);
    const active: any = (await import('../src/sessions.js')).startMemorySession(d, { title: 'Active Summary' }, c);
    d.prepare('UPDATE memory_sessions SET summary=?, started_at=? WHERE id=?').run('active summary should not win', '2999-01-01T00:00:00.000Z', active.id);
    const handlers = new Map<string, Function>();
    extension({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
    const ctx = { cwd: projectDir, ui: { setStatus: () => {}, notify: () => {} }, sessionManager: { getSessionFile: () => path.join(tmp, 'new-pi-session.json') } };
    await handlers.get('session_start')?.({}, ctx);
    const first = await handlers.get('before_agent_start')?.({ prompt: 'new turn' }, ctx);
    expect(first.message.content).toContain('Previous Done');
    expect(first.message.content).not.toContain('Active Summary');
    expect(first.message.content).not.toContain('Session without summary yet');
  });

  it('does not rewrite prompt foreign keys to a temporary legacy sessions table', () => {
    const dbPath = path.join(tmp, 'old-schema.sqlite');
    const d = openMemoryDb(dbPath);
    d.exec(`
      CREATE TABLE memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE memory_sessions (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('general','project','global')),
        project_id TEXT,
        project_name TEXT,
        title TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        summary TEXT,
        learned TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','superseded')),
        sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
        cloud_sync_id TEXT,
        cloud_synced_at TEXT,
        cloud_revision TEXT,
        content_hash TEXT,
        metadata_json TEXT,
        CHECK ((scope IN ('general','global') AND project_id IS NULL AND project_name IS NULL) OR (scope='project' AND project_id IS NOT NULL AND project_name IS NOT NULL))
      );
      CREATE TABLE memory_session_prompts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES memory_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool','extension')),
        prompt TEXT NOT NULL,
        prompt_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
        cloud_sync_id TEXT,
        cloud_synced_at TEXT,
        cloud_revision TEXT,
        content_hash TEXT,
        metadata_json TEXT
      );
    `);
    migrate(d);
    const fkRows = d.prepare('PRAGMA foreign_key_list(memory_session_prompts)').all() as any[];
    expect(fkRows.map((row) => row.table)).toEqual(['memory_sessions']);
  });

  it('falls back when semantic session summary model throws and records metadata error', async () => {
    const h = await lifecycleHarness();
    h.ctx.model = { provider: 'fake', id: 'broken-model' };
    h.ctx.modelRegistry = { getApiKeyAndHeaders: async () => { throw new Error('auth exploded'); } };
    await h.handlers.get('before_agent_start')?.({ prompt: 'first turn' }, h.ctx);
    await h.handlers.get('session_shutdown')?.({ reason: 'quit' }, h.ctx);
    const d = openMemoryDb(h.dbPath);
    const row = d.prepare('SELECT summary, metadata_json FROM memory_sessions LIMIT 1').get() as any;
    const meta = JSON.parse(row.metadata_json);
    expect(row.summary).toContain('semantic model summary was unavailable');
    expect(meta.summary_source).toBe('heuristic');
    expect(meta.summary_error).toContain('auth exploded');
  });
});

describe('semantic profile, consolidation links, and entities', () => {
  it('parses and applies browser filter commands', () => {
    const filters = applyBrowserFilterCommand({}, 'query=npm kind=command scope=project status=active project=app');
    expect(filters).toEqual({ query: 'npm', kind: 'command', scope: 'project', status: 'active', project: 'app' });
    expect(applyBrowserFilterCommand(filters, 'clear')).toEqual({});
  });

  it('filters browser items by query, kind, scope, status, and project', () => {
    const items: any[] = [
      { type: 'memories', id: '1', label: 'command · npm test', description: 'project/app · active', detail: 'kind: command\nstatus: active\nscope: project/app\nnpm test', updated: '' },
      { type: 'memories', id: '2', label: 'decision · old', description: 'global · archived', detail: 'kind: decision\nstatus: archived\nscope: global', updated: '' },
    ];
    const filtered = filterBrowserItems(items, { query: 'npm', kind: 'command', scope: 'project', status: 'active', project: 'app' });
    expect(filtered.map((i) => i.id)).toEqual(['1']);
  });

  it('builds a semantic project profile prompt with conservative instructions', () => {
    const prompt = buildSemanticProjectProfilePrompt('type: project_profile\ndetails:', {
      session_id: 's1',
      summary: 'summary:\n  what changed: added tests',
      learned: 'reusable learnings:\n- keep updates conservative',
      validations: ['npm test'],
      filesTouched: ['src/project-profile.ts'],
    });
    expect(prompt).toContain('update the project_profile');
    expect(prompt).toContain('do not invent');
    expect(prompt).toContain('npm test');
    expect(shouldConfirmProjectProfileUpdate('a\nb', 'a\nb\nc\nd\ne\nf\ng\nh\ni')).toBe(true);
    expect(shouldConfirmProjectProfileUpdate('a\nb', 'a\nb\nc')).toBe(false);
    const preview = buildProjectProfileUpdatePreview('a\nb', 'a\nc');
    expect(preview).toContain('+ c');
    expect(preview).toContain('- b');
  });

  it('skips similarity consolidation candidates with contradiction risk', () => {
    const d = db(), c = project();
    addMemory(d, { scope: 'project', kind: 'decision', title: 'sqlite decision', content: 'use sqlite for local memory storage' }, c);
    addMemory(d, { scope: 'project', kind: 'decision', title: 'sqlite decision alternative', content: 'do not use sqlite for local memory storage' }, c);
    const result = consolidateMemories(d, { kind: 'decision', dry_run: true, similarity: true }, c as any);
    expect(result.candidates.length).toBe(0);
    expect(result.skipped_contradictions.length).toBe(1);
  });

  it('finds similar duplicate memories by content, not only exact title', () => {
    const d = db(), c = project();
    addMemory(d, { scope: 'project', kind: 'learning', title: 'profile update rules', content: 'project profile updates should be conservative and avoid temporary details' }, c);
    addMemory(d, { scope: 'project', kind: 'learning', title: 'conservative profile updates', content: 'avoid temporary details when updating the project profile conservatively' }, c);
    const result = consolidateMemories(d, { kind: 'learning', dry_run: true, similarity: true }, c as any);
    expect(result.candidates.length).toBe(1);
  });

  it('creates supersedes links when consolidation is applied', () => {
    const d = db(), c = project();
    addMemory(d, { scope: 'project', kind: 'progress', title: 'duplicate progress', content: 'first fact' }, c);
    addMemory(d, { scope: 'project', kind: 'progress', title: 'duplicate progress', content: 'second fact' }, c);
    const result = consolidateMemories(d, { kind: 'progress', dry_run: false }, c);
    expect(result.applied.length).toBe(1);
    const links = d.prepare("SELECT relation_type FROM memory_links WHERE relation_type='supersedes'").all() as any[];
    expect(links.length).toBe(2);
  });

  it('validates import schema and rebuilds fts after merge', () => {
    const d = db(), c = project();
    addMemory(d, { scope: 'project', kind: 'note', content: 'robust import searchable memory' }, c);
    const out = path.join(tmp, 'export.jsonl');
    exportMemory(d, { path: out });
    const target = db();
    const result = importMemory(target, { path: out, mode: 'merge' });
    expect(result.rebuilt_fts).toBe(true);
    expect(searchMemory(target, { query: 'robust import searchable', limit: 5 }, c).results.length).toBeGreaterThan(0);
    const bad = path.join(tmp, 'bad.jsonl');
    fs.writeFileSync(bad, JSON.stringify({ type: 'meta', schema_version: 999 }) + '\n');
    expect(() => importMemory(target, { path: bad, mode: 'dry_run' })).toThrow(/unsupported schema_version/i);
    const conflict = importMemory(target, { path: out, mode: 'merge', on_conflict: 'keep_local' });
    expect(conflict.conflict_details.length).toBeGreaterThan(0);
    expect(conflict.conflict_details[0].action).toBe('kept_local');
  });

  it('extracts file and command entities when adding memories', () => {
    const d = db(), c = project();
    const mem = addMemory(d, { scope: 'project', kind: 'command', content: 'run npm test after editing src/memory-store.ts' }, c).memory;
    const entities = d.prepare('SELECT entity_type, name FROM memory_entities WHERE memory_id=? ORDER BY entity_type, name').all(mem.id) as any[];
    expect(entities.some((e) => e.entity_type === 'command' && e.name === 'npm test')).toBe(true);
    expect(entities.some((e) => e.entity_type === 'file' && e.name === 'src/memory-store.ts')).toBe(true);
  });
});
