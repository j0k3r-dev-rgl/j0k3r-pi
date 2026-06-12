import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import extension from '../index.js';
import { openMemoryDb } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { resolveMemoryContext } from '../src/context.js';
import { addMemory } from '../src/memory-store.js';
import { addSessionPrompt, finishMemorySession, startMemorySession } from '../src/sessions.js';
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

function createMemoryBackup(): string {
  const source = db(), c = project(path.join(tmp, 'backup-source'));
  addMemory(source, { scope: 'project', kind: 'note', content: 'configurable import defaults memory' }, c);
  const out = path.join(tmp, `backup-${Date.now()}-${Math.random()}.jsonl`);
  exportMemory(source, { path: out });
  return out;
}

async function runMemoryExportTool(memoryConfig: Record<string, unknown> = {}, params: Record<string, unknown> = {}) {
  const dbPath = path.join(tmp, `export-target-${Date.now()}-${Math.random()}.sqlite`);
  const projectDir = path.join(tmp, `export-project-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Export Tool App', ...memoryConfig }));
  const d = openMemoryDb(dbPath);
  migrate(d);
  const context = resolveMemoryContext(projectDir, os.homedir(), {});
  addMemory(d, { scope: 'project', kind: 'note', content: 'automatic mirror backup export memory' }, context);
  const session: any = startMemorySession(d, { title: 'export tool session' }, context);
  addSessionPrompt(d, { session_id: session.id, role: 'user', prompt: 'configured backup prompt export', prompt_index: 1 }, context);
  const old = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;
  const tools = new Map<string, any>();
  extension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: () => {}, on: () => {} });
  if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
  const result = await tools.get('memory_export').execute('tool-call', params, undefined, undefined, { cwd: projectDir });
  return { projectDir, details: result.details as any };
}

async function runMemoryImportTool(memoryConfig: Record<string, unknown>, params: Record<string, unknown>) {
  const dbPath = path.join(tmp, `target-${Date.now()}-${Math.random()}.sqlite`);
  const projectDir = path.join(tmp, `import-project-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Import Tool App', ...memoryConfig }));
  if (typeof params.path === 'string') {
    const backupPath = path.join(projectDir, '.pi', 'mempry-backups', 'memory-backup.jsonl');
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(params.path, backupPath);
  }
  const old = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;
  const tools = new Map<string, any>();
  extension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: () => {}, on: () => {} });
  if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
  const { path: _ignoredPath, ...toolParams } = params;
  const result = await tools.get('memory_import').execute('tool-call', toolParams, undefined, undefined, { cwd: projectDir });
  return result.details as any;
}

async function lifecycleHarness(memoryConfig: Record<string, unknown> = {}) {
  const dbPath = path.join(tmp, 'lifecycle.sqlite');
  const projectDir = path.join(tmp, 'project');
  fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Lifecycle Advanced', ...memoryConfig }));
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

  it('reactivates a resumed memory session and backfills pi session id on reuse', async () => {
    const dbPath = path.join(tmp, 'resume-reuse.sqlite');
    const projectDir = path.join(tmp, 'resume-project');
    const piSessionFile = path.join(tmp, 'pi-session.jsonl');
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Resume App' }));
    const d = openMemoryDb(dbPath);
    migrate(d);
    const context = resolveMemoryContext(projectDir, os.homedir(), {});
    const existing: any = startMemorySession(d, {
      title: 'Pi session previous',
      metadata_json: { pi_session_file: piSessionFile, auto_started: true },
    }, context);
    finishMemorySession(d, { session_id: existing.id, summary: 'previous completed summary' }, context);

    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const handlers = new Map<string, Function>();
    extension({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;

    const ctx = {
      cwd: projectDir,
      ui: { setStatus: () => {}, notify: () => {} },
      sessionManager: {
        getSessionId: () => 'pi-session-123',
        getSessionFile: () => piSessionFile,
        isPersisted: () => true,
        getLeafId: () => null,
        getEntries: () => [],
      },
    };
    await handlers.get('session_start')?.({ reason: 'resume' }, ctx);

    const row = d.prepare('SELECT status, ended_at, metadata_json FROM memory_sessions WHERE id=?').get(existing.id) as any;
    expect(row.status).toBe('active');
    expect(row.ended_at).toBeNull();
    expect(JSON.parse(row.metadata_json).pi_session_id).toBe('pi-session-123');
  });

  it('reuses a memory session by pi session id when pi session file is unavailable', async () => {
    const dbPath = path.join(tmp, 'resume-by-id.sqlite');
    const projectDir = path.join(tmp, 'resume-by-id-project');
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Resume By Id App' }));
    const d = openMemoryDb(dbPath);
    migrate(d);
    const context = resolveMemoryContext(projectDir, os.homedir(), {});
    const existing: any = startMemorySession(d, {
      title: 'Pi session id only',
      metadata_json: { pi_session_id: 'stable-pi-session-id', auto_started: true },
    }, context);

    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const handlers = new Map<string, Function>();
    extension({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;

    const ctx = {
      cwd: projectDir,
      ui: { setStatus: () => {}, notify: () => {} },
      sessionManager: {
        getSessionId: () => 'stable-pi-session-id',
        getSessionFile: () => null,
        isPersisted: () => true,
        getLeafId: () => null,
        getEntries: () => [],
      },
    };
    await handlers.get('session_start')?.({ reason: 'reload' }, ctx);

    const rows = d.prepare('SELECT id, status FROM memory_sessions ORDER BY started_at ASC').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
    expect(rows[0].status).toBe('active');
  });

  it('persists the memory session id into the pi session for future fallback', async () => {
    const h = await lifecycleHarness();
    const appended: Array<{ customType: string; data: any }> = [];
    const ctx = { ...h.ctx, appendEntry: undefined } as any;
    const pi = {
      registerTool: () => {},
      registerCommand: () => {},
      appendEntry: (customType: string, data: any) => appended.push({ customType, data }),
      on: (name: string, handler: Function) => h.handlers.set(name, handler),
    };
    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = h.dbPath;
    extension(pi);
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;

    await h.handlers.get('session_start')?.({ reason: 'startup' }, ctx);

    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe('memory-session');
    expect(appended[0].data.memory_session_id).toMatch(/^session_/);
    expect(appended[0].data.project_name).toBe('Lifecycle Advanced');
  });

  it('reuses a memory session from a pi custom entry when pi id and file are unavailable', async () => {
    const dbPath = path.join(tmp, 'resume-by-entry.sqlite');
    const projectDir = path.join(tmp, 'resume-by-entry-project');
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Resume By Entry App' }));
    const d = openMemoryDb(dbPath);
    migrate(d);
    const context = resolveMemoryContext(projectDir, os.homedir(), {});
    const existing: any = startMemorySession(d, { title: 'Pi custom entry session' }, context);

    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const handlers = new Map<string, Function>();
    extension({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;

    const ctx = {
      cwd: projectDir,
      ui: { setStatus: () => {}, notify: () => {} },
      sessionManager: {
        getSessionId: () => null,
        getSessionFile: () => null,
        getEntries: () => [{ type: 'custom', customType: 'memory-session', data: { memory_session_id: existing.id } }],
        getLeafId: () => null,
      },
    };
    await handlers.get('session_start')?.({ reason: 'reload' }, ctx);

    const rows = d.prepare('SELECT id, status FROM memory_sessions ORDER BY started_at ASC').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
    expect(rows[0].status).toBe('active');
  });

  it('conservatively reuses one recent active auto session when pi identity is unavailable', async () => {
    const dbPath = path.join(tmp, 'recent-active.sqlite');
    const projectDir = path.join(tmp, 'recent-active-project');
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Recent Active App' }));
    const d = openMemoryDb(dbPath);
    migrate(d);
    const context = resolveMemoryContext(projectDir, os.homedir(), {});
    const existing: any = startMemorySession(d, { title: 'Recent Active', metadata_json: { auto_started: true, cwd: projectDir } }, context);

    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const handlers = new Map<string, Function>();
    extension({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;

    const ctx = {
      cwd: projectDir,
      ui: { setStatus: () => {}, notify: () => {} },
      sessionManager: { getSessionId: () => null, getSessionFile: () => null, getEntries: () => [], getLeafId: () => null },
    };
    await handlers.get('session_start')?.({ reason: 'reload' }, ctx);

    const rows = d.prepare('SELECT id, status FROM memory_sessions ORDER BY started_at ASC').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
  });

  it('does not use the recent active fallback when multiple candidates are ambiguous', async () => {
    const dbPath = path.join(tmp, 'recent-active-ambiguous.sqlite');
    const projectDir = path.join(tmp, 'recent-active-ambiguous-project');
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Recent Active Ambiguous App' }));
    const d = openMemoryDb(dbPath);
    migrate(d);
    const context = resolveMemoryContext(projectDir, os.homedir(), {});
    startMemorySession(d, { title: 'Recent Active 1', metadata_json: { auto_started: true, cwd: projectDir } }, context);
    startMemorySession(d, { title: 'Recent Active 2', metadata_json: { auto_started: true, cwd: projectDir } }, context);

    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const handlers = new Map<string, Function>();
    extension({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;

    const ctx = {
      cwd: projectDir,
      ui: { setStatus: () => {}, notify: () => {} },
      sessionManager: { getSessionId: () => null, getSessionFile: () => null, getEntries: () => [], getLeafId: () => null },
    };
    await handlers.get('session_start')?.({ reason: 'reload' }, ctx);

    const rows = d.prepare('SELECT id FROM memory_sessions').all() as any[];
    expect(rows).toHaveLength(3);
  });

  it('writes memory session debug log only when memory.json debug is true', async () => {
    const disabled = await lifecycleHarness();
    await disabled.handlers.get('before_agent_start')?.({ prompt: 'no debug log' }, disabled.ctx);
    expect(fs.existsSync(path.join(disabled.ctx.cwd, 'memory-session-debug.log'))).toBe(false);

    const enabled = await lifecycleHarness({ debug: true });
    await enabled.handlers.get('before_agent_start')?.({ prompt: 'debug log enabled' }, enabled.ctx);
    const logPath = path.join(enabled.ctx.cwd, 'memory-session-debug.log');
    expect(fs.existsSync(logPath)).toBe(true);
    const text = fs.readFileSync(logPath, 'utf8');
    expect(text).toContain('before_agent_start');
    expect(text).toContain('pi_session_file');
    expect(text).not.toContain('debug log enabled');
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

  it('skips semantic shutdown work by default even when a model is configured', async () => {
    const h = await lifecycleHarness();
    let authCalls = 0;
    h.ctx.model = { provider: 'fake', id: 'slow-model' };
    h.ctx.modelRegistry = { getApiKeyAndHeaders: async () => { authCalls += 1; throw new Error('should not be called'); } };
    await h.handlers.get('before_agent_start')?.({ prompt: 'first turn' }, h.ctx);
    await h.handlers.get('session_shutdown')?.({ reason: 'quit' }, h.ctx);
    const d = openMemoryDb(h.dbPath);
    const row = d.prepare('SELECT summary, metadata_json FROM memory_sessions LIMIT 1').get() as any;
    const meta = JSON.parse(row.metadata_json);
    expect(authCalls).toBe(0);
    expect(row.summary).toContain('semantic shutdown summary disabled');
    expect(meta.summary_source).toBe('heuristic');
    expect(meta.summary_error).toBeNull();
  });

  it('falls back when opt-in semantic session summary model throws and records metadata error', async () => {
    const h = await lifecycleHarness({ session_end: { semantic: true } });
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
    fs.writeFileSync(bad, JSON.stringify({ type: 'meta', format: 'pi-memory-backup', version: 2, schema_version: 999 }) + '\n');
    expect(() => importMemory(target, { path: bad, mode: 'dry_run' })).toThrow(/unsupported schema_version/i);
    const conflict = importMemory(target, { path: out, mode: 'merge', on_conflict: 'keep_local' });
    expect(conflict.conflict_details.length).toBeGreaterThan(0);
    expect(conflict.conflict_details[0].action).toBe('kept_local');
  });

  it('exports to the automatic default mirror backup path', async () => {
    const { projectDir, details } = await runMemoryExportTool();
    expect(details.path).toBe(path.join(projectDir, '.pi', 'mempry-backups', 'memory-backup.jsonl'));
    expect(details.mirror).toBe(true);
    const lines = fs.readFileSync(details.path, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ type: 'meta', format: 'pi-memory-backup', version: 2, mirror: true });
    expect(lines[1]).toMatchObject({ type: 'manifest', mirror: true });
    expect(lines.some((line) => line.type === 'memories' && line.hash && line.id)).toBe(true);
  });

  it('exports to configured relative mirror backup path', async () => {
    const { projectDir, details } = await runMemoryExportTool({ backups: { path: 'custom/backups/main.jsonl' } });
    expect(details.path).toBe(path.join(projectDir, 'custom', 'backups', 'main.jsonl'));
    expect(fs.existsSync(details.path)).toBe(true);
  });

  it('uses configured backup include_prompts when exporting automatically', async () => {
    const { details } = await runMemoryExportTool({ backups: { include_prompts: true } }, { include_prompts: false });
    const text = fs.readFileSync(details.path, 'utf8');
    expect(JSON.parse(text.split('\n')[0]).includes_prompts).toBe(true);
    expect(text).toContain('configured backup prompt export');
  });

  it('keeps prompt export disabled by default', async () => {
    const { details } = await runMemoryExportTool();
    const text = fs.readFileSync(details.path, 'utf8');
    expect(JSON.parse(text.split('\n')[0]).includes_prompts).toBe(false);
    expect(text).not.toContain('configured backup prompt export');
  });

  it('mirror export rewrites the backup without keeping removed local rows', () => {
    const d = db(), c = project();
    const mem = addMemory(d, { scope: 'project', kind: 'note', content: 'row removed from mirror backup' }, c).memory;
    const out = path.join(tmp, 'mirror.jsonl');
    exportMemory(d, { path: out });
    expect(fs.readFileSync(out, 'utf8')).toContain(mem.id);
    d.prepare('DELETE FROM memories WHERE id=?').run(mem.id);
    const result = exportMemory(d, { path: out });
    expect(result.mirror).toBe(true);
    expect(fs.readFileSync(out, 'utf8')).not.toContain(mem.id);
  });

  it('exports only the current project memories, sessions, prompts, and entities', () => {
    const d = db();
    const aDir = path.join(tmp, 'project-a'), bDir = path.join(tmp, 'project-b');
    fs.mkdirSync(path.join(aDir, '.pi'), { recursive: true });
    fs.mkdirSync(path.join(bDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(aDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Export App A' }));
    fs.writeFileSync(path.join(bDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Export App B' }));
    const ca = resolveMemoryContext(aDir, os.homedir(), {});
    const cb = resolveMemoryContext(bDir, os.homedir(), {});
    const aMem = addMemory(d, { scope: 'project', kind: 'note', content: 'app a scoped export memory src/a.ts' }, ca).memory;
    const bMem = addMemory(d, { scope: 'project', kind: 'note', content: 'app b must not export src/b.ts' }, cb).memory;
    const aSession: any = startMemorySession(d, { title: 'app a session' }, ca);
    const bSession: any = startMemorySession(d, { title: 'app b session' }, cb);
    addSessionPrompt(d, { session_id: aSession.id, role: 'user', prompt: 'app a prompt', prompt_index: 1 }, ca);
    addSessionPrompt(d, { session_id: bSession.id, role: 'user', prompt: 'app b prompt', prompt_index: 1 }, cb);

    const out = path.join(tmp, 'project-a-backup.jsonl');
    exportMemory(d, { path: out, context: ca, include_prompts: true });
    const rows = fs.readFileSync(out, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const exported = rows.filter((row) => row.row).map((row) => row.row);

    expect(JSON.stringify(exported)).toContain(aMem.id);
    expect(JSON.stringify(exported)).toContain(aSession.id);
    expect(JSON.stringify(exported)).toContain('app a prompt');
    expect(JSON.stringify(exported)).not.toContain(bMem.id);
    expect(JSON.stringify(exported)).not.toContain(bSession.id);
    expect(JSON.stringify(exported)).not.toContain('app b prompt');
    expect(exported.filter((row: any) => row.project_name).every((row: any) => row.project_name === 'Export App A')).toBe(true);
    expect(rows.filter((row) => row.type === 'memory_entities').every((row) => row.row.memory_id === aMem.id)).toBe(true);
  });

  it('uses safe memory_import tool defaults without config', async () => {
    const out = createMemoryBackup();
    const details = await runMemoryImportTool({}, { path: out });
    expect(details.mode).toBe('dry_run');
    expect(details.on_conflict).toBe('mark_conflict');
    expect(details.inserted).toBe(0);
    expect(details.seen).toBeGreaterThan(0);
  });

  it('uses configured memory_import defaults when params are omitted', async () => {
    const out = createMemoryBackup();
    const details = await runMemoryImportTool({ import: { mode: 'merge', on_conflict: 'keep_local' } }, { path: out });
    expect(details.mode).toBe('merge');
    expect(details.on_conflict).toBe('keep_local');
    expect(details.inserted).toBeGreaterThan(0);
  });

  it('lets explicit memory_import params override configured defaults', async () => {
    const out = createMemoryBackup();
    const details = await runMemoryImportTool({ import: { mode: 'merge', on_conflict: 'keep_local' } }, { path: out, mode: 'dry_run', on_conflict: 'mark_conflict' });
    expect(details.mode).toBe('dry_run');
    expect(details.on_conflict).toBe('mark_conflict');
    expect(details.inserted).toBe(0);
  });

  it('does not break memory_import on invalid configured defaults', async () => {
    const out = createMemoryBackup();
    const details = await runMemoryImportTool({ import: { mode: 'apply', on_conflict: 'explode' } }, { path: out });
    expect(details.mode).toBe('dry_run');
    expect(details.on_conflict).toBe('mark_conflict');
    expect(details.inserted).toBe(0);
    expect(details.warnings.join('\n')).toContain('invalid import.mode');
    expect(details.warnings.join('\n')).toContain('invalid import.on_conflict');
  });

  it('extracts file and command entities when adding memories', () => {
    const d = db(), c = project();
    const mem = addMemory(d, { scope: 'project', kind: 'command', content: 'run npm test after editing src/memory-store.ts' }, c).memory;
    const entities = d.prepare('SELECT entity_type, name FROM memory_entities WHERE memory_id=? ORDER BY entity_type, name').all(mem.id) as any[];
    expect(entities.some((e) => e.entity_type === 'command' && e.name === 'npm test')).toBe(true);
    expect(entities.some((e) => e.entity_type === 'file' && e.name === 'src/memory-store.ts')).toBe(true);
  });
});
