import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
import { applyBrowserFilterCommand, filterBrowserItems, loadMemories, loadPrompts, loadSessions } from '../src/memory-browser.js';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-memory-advanced-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function db() { const d = openMemoryDb(':memory:'); migrate(d); return d; }
function project(dir = tmp) { fs.mkdirSync(path.join(dir, '.pi'), { recursive: true }); fs.writeFileSync(path.join(dir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Advanced App', enabled: true, git: { enabled: true } })); return resolveMemoryContext(dir, os.homedir(), {}); }
function registerCommitChangelogHarness(dbPath = path.join(tmp, `commit-changelog-${Date.now()}-${Math.random()}.sqlite`)) {
  const d = openMemoryDb(dbPath);
  migrate(d);
  const old = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;
  const tools = new Map<string, any>();
  extension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: () => {}, on: () => {} });
  if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
  return { d, dbPath, tools };
}

function createProjectDir(name: string, dirName: string) {
  const projectDir = path.join(tmp, dirName);
  fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: name, enabled: true, git: { enabled: true } }));
  return projectDir;
}

function createMemoryBackup(): string {
  const source = db(), c = project(path.join(tmp, 'backup-source'));
  addMemory(source, { scope: 'project', kind: 'note', content: 'configurable import defaults memory' }, c);
  const out = path.join(tmp, `backup-${Date.now()}-${Math.random()}.jsonl`);
  exportMemory(source, { path: out });
  return out;
}

function createGitMemoryBackup(): string {
  const source = db(), c = project(path.join(tmp, 'git-backup-source'));
  addMemory(source, { scope: 'project', kind: 'note', content: 'ordinary memory import still works' }, c);
  addMemory(source, {
    scope: 'project',
    kind: 'commit_record',
    title: 'import git commit memory',
    content: 'git commit memory should follow git.sync.import config',
    metadata_json: { commit: { repo: 'repo', commit_hash: 'def5678', release_impact: 'minor' } },
  }, c);
  const out = path.join(tmp, `git-backup-${Date.now()}-${Math.random()}.jsonl`);
  exportMemory(source, { path: out, context: c, include_git: true });
  return out;
}

function createLegacyProfileDb() {
  const d = openMemoryDb(':memory:');
  d.exec(`
CREATE TABLE memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('general','project','global')),
  project_id TEXT,
  project_name TEXT,
  kind TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  content TEXT NOT NULL,
  tags TEXT,
  source TEXT NOT NULL DEFAULT 'agent',
  origin_type TEXT DEFAULT 'inferred_by_agent',
  confidence REAL NOT NULL DEFAULT 1.0,
  importance INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','superseded')),
  version INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
  cloud_sync_id TEXT,
  cloud_synced_at TEXT,
  cloud_revision TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  CHECK ((scope IN ('general','global') AND project_id IS NULL AND project_name IS NULL) OR (scope='project' AND project_id IS NOT NULL AND project_name IS NOT NULL))
);
CREATE TABLE memory_links (
  id TEXT PRIMARY KEY,
  from_memory_id TEXT NOT NULL REFERENCES memories(id),
  to_memory_id TEXT NOT NULL REFERENCES memories(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('supports','supersedes','contradicts','derived_from','related_to')),
  created_at TEXT NOT NULL,
  metadata_json TEXT
);
CREATE TABLE memory_entities (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id),
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT,
  created_at TEXT NOT NULL
);
`);
  return d;
}

function insertLegacyProjectProfile(d: any, row: {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  summary: string;
  content: string;
  tags?: string[];
  origin_type?: string;
  confidence?: number;
  importance?: number;
  status?: string;
  version?: number;
  sync_status?: string;
  metadata_json?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}) {
  d.prepare(`INSERT INTO memories(
    id,user_id,device_id,scope,project_id,project_name,kind,title,summary,content,tags,source,origin_type,confidence,importance,status,version,sync_status,content_hash,created_at,updated_at,metadata_json
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.id,
    'test-user',
    'test-device',
    'project',
    row.project_id,
    row.project_name,
    'project_profile',
    row.title,
    row.summary,
    row.content,
    JSON.stringify(row.tags ?? ['project_profile']),
    'agent',
    row.origin_type ?? 'confirmed_by_user',
    row.confidence ?? 1,
    row.importance ?? 5,
    row.status ?? 'active',
    row.version ?? 1,
    row.sync_status ?? 'local',
    null,
    row.created_at,
    row.updated_at,
    JSON.stringify(row.metadata_json ?? {}),
  );
}

function createProjectProfileBackup(profile: { content: string; title?: string; summary?: string; metadata_json?: Record<string, unknown>; tags?: string[]; }) {
  const sourceDir = path.join(tmp, `profile-backup-source-${Date.now()}-${Math.random()}`);
  const source = db();
  const c = project(sourceDir);
  const memory = addMemory(source, {
    scope: 'project',
    kind: 'project_profile',
    title: profile.title ?? 'advanced app project profile',
    summary: profile.summary ?? 'living project profile for advanced app',
    content: profile.content,
    tags: profile.tags ?? ['project_profile', 'profile'],
    metadata_json: profile.metadata_json ?? {},
    importance: 5,
    origin_type: 'confirmed_by_user',
  }, c).memory;
  const out = path.join(tmp, `profile-backup-${Date.now()}-${Math.random()}.jsonl`);
  exportMemory(source, { path: out, context: c });
  return { path: out, memory, context: c };
}

async function runMemoryExportTool(memoryConfig: Record<string, unknown> = {}, params: Record<string, unknown> = {}) {
  const dbPath = path.join(tmp, `export-target-${Date.now()}-${Math.random()}.sqlite`);
  const projectDir = path.join(tmp, `export-project-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Export Tool App', enabled: true, ...memoryConfig }));
  const d = openMemoryDb(dbPath);
  migrate(d);
  const context = resolveMemoryContext(projectDir, os.homedir(), {});
  addMemory(d, { scope: 'project', kind: 'note', content: 'automatic mirror backup export memory' }, context);
  addMemory(d, {
    scope: 'project',
    kind: 'commit_record',
    title: 'export git commit memory',
    content: 'git commit memory should follow git.sync.export config',
    metadata_json: { commit: { repo: 'repo', commit_hash: 'abc1234', release_impact: 'patch' } },
  }, context);
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
  fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Import Tool App', enabled: true, ...memoryConfig }));
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
  return { result, details: result.details as any };
}

async function telemetryToolHarness(name: string, memoryConfig: Record<string, unknown> = {}) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dbPath = path.join(tmp, `${slug}.sqlite`);
  const projectDir = path.join(tmp, `${slug}-project`);
  fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: name, enabled: true, git: { enabled: true }, ...memoryConfig }));
  const d = openMemoryDb(dbPath);
  migrate(d);
  const old = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;
  const tools = new Map<string, any>();
  const handlers = new Map<string, Function>();
  extension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: () => {}, on: (event: string, handler: Function) => handlers.set(event, handler) });
  if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
  return { d, dbPath, projectDir, tools, handlers };
}

async function lifecycleHarness(memoryConfig: Record<string, unknown> = {}) {
  const dbPath = path.join(tmp, 'lifecycle.sqlite');
  const projectDir = path.join(tmp, 'project');
  fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Lifecycle Advanced', enabled: true, ...memoryConfig }));
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
  it('creates the lifecycle memory session lazily on the first real user prompt', async () => {
    const h = await lifecycleHarness();
    const d = openMemoryDb(h.dbPath);

    const afterSessionStart = d.prepare('SELECT COUNT(*) AS count FROM memory_sessions').get() as any;
    expect(afterSessionStart.count).toBe(0);

    const empty = await h.handlers.get('before_agent_start')?.({ prompt: '   ' }, h.ctx);
    expect(empty).toBeUndefined();
    const afterEmptyPrompt = d.prepare('SELECT COUNT(*) AS count FROM memory_sessions').get() as any;
    expect(afterEmptyPrompt.count).toBe(0);

    const first = await h.handlers.get('before_agent_start')?.({ prompt: 'first real turn' }, h.ctx);
    expect(first?.message?.customType).toBe('memory-context');
    expect(String(first?.message?.content ?? '')).toContain('Memory session: session_');

    const rows = d.prepare('SELECT id, status, ended_at FROM memory_sessions').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('active');
    expect(rows[0].ended_at).toBeNull();

    const prompt = d.prepare('SELECT role, prompt, prompt_index FROM memory_session_prompts WHERE session_id=?').get(rows[0].id) as any;
    expect(prompt).toMatchObject({ role: 'user', prompt: 'first real turn', prompt_index: 1 });
  });

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

    const beforePrompt = d.prepare('SELECT status, ended_at FROM memory_sessions WHERE id=?').get(existing.id) as any;
    expect(beforePrompt.status).toBe('completed');
    expect(beforePrompt.ended_at).not.toBeNull();

    await handlers.get('before_agent_start')?.({ prompt: 'resumed turn' }, ctx);

    const row = d.prepare('SELECT status, ended_at, metadata_json FROM memory_sessions WHERE id=?').get(existing.id) as any;
    expect(row.status).toBe('active');
    expect(row.ended_at).toBeNull();
    expect(JSON.parse(row.metadata_json).pi_session_id).toBe('pi-session-123');
    const prompt = d.prepare('SELECT prompt, prompt_index FROM memory_session_prompts WHERE session_id=?').get(existing.id) as any;
    expect(prompt).toMatchObject({ prompt: 'resumed turn', prompt_index: 1 });
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
    await handlers.get('before_agent_start')?.({ prompt: 'reused by pi id' }, ctx);

    const rows = d.prepare('SELECT id, status FROM memory_sessions ORDER BY started_at ASC').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
    expect(rows[0].status).toBe('active');
    const prompt = d.prepare('SELECT session_id, prompt FROM memory_session_prompts LIMIT 1').get() as any;
    expect(prompt).toMatchObject({ session_id: existing.id, prompt: 'reused by pi id' });
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
    expect(appended).toHaveLength(0);

    await h.handlers.get('before_agent_start')?.({ prompt: 'persist session entry lazily' }, ctx);

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
    await handlers.get('before_agent_start')?.({ prompt: 'reused by custom entry' }, ctx);

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
    await handlers.get('before_agent_start')?.({ prompt: 'reused recent active session' }, ctx);

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
    const rowsAfterSessionStart = d.prepare('SELECT id FROM memory_sessions').all() as any[];
    expect(rowsAfterSessionStart).toHaveLength(2);

    await handlers.get('before_agent_start')?.({ prompt: 'ambiguous fallback creates a new session lazily' }, ctx);

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

  it('injects context once per Pi session across extension reloads', async () => {
    const h = await lifecycleHarness();
    const firstCtx = {
      ...h.ctx,
      sessionManager: {
        ...h.ctx.sessionManager,
        getSessionId: () => 'pi-session-one',
        getSessionFile: () => path.join(tmp, 'pi-session-one.jsonl'),
        getEntries: () => [],
      },
    };
    const first = await h.handlers.get('before_agent_start')?.({ prompt: 'first Pi session' }, firstCtx);
    const firstMemorySessionId = String(first?.message?.content ?? '').match(/Memory session: (session_[^\s]+)/)?.[1];
    await h.handlers.get('session_shutdown')?.({ reason: 'reload' }, firstCtx);

    const registerReloadedHandlers = () => {
      const handlers = new Map<string, Function>();
      const old = process.env.PI_MEMORY_DB_PATH;
      process.env.PI_MEMORY_DB_PATH = h.dbPath;
      extension({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
      if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
      return handlers;
    };

    const reloadedHandlers = registerReloadedHandlers();
    const reloadedCtx = {
      ...firstCtx,
      sessionManager: {
        ...firstCtx.sessionManager,
        getEntries: () => [
          { type: 'custom', customType: 'memory-session', data: { memory_session_id: firstMemorySessionId } },
          { type: 'custom_message', customType: 'memory-context', content: first.message.content },
        ],
      },
    };
    await reloadedHandlers.get('session_start')?.({ reason: 'reload' }, reloadedCtx);
    const sameSessionReload = await reloadedHandlers.get('before_agent_start')?.({ prompt: 'same Pi session after reload' }, reloadedCtx);

    const newSessionHandlers = registerReloadedHandlers();
    const newSessionCtx = {
      ...h.ctx,
      sessionManager: {
        ...h.ctx.sessionManager,
        getSessionId: () => 'pi-session-two',
        getSessionFile: () => path.join(tmp, 'pi-session-two.jsonl'),
        getEntries: () => [],
      },
    };
    await newSessionHandlers.get('session_start')?.({ reason: 'new' }, newSessionCtx);
    const second = await newSessionHandlers.get('before_agent_start')?.({ prompt: 'second Pi session' }, newSessionCtx);
    const secondMemorySessionId = String(second?.message?.content ?? '').match(/Memory session: (session_[^\s]+)/)?.[1];

    expect(first?.message?.customType).toBe('memory-context');
    expect(sameSessionReload).toBeUndefined();
    expect(second?.message?.customType).toBe('memory-context');
    expect(firstMemorySessionId).toMatch(/^session_/);
    expect(secondMemorySessionId).toMatch(/^session_/);
    expect(secondMemorySessionId).not.toBe(firstMemorySessionId);
  });

  it('reopens a closed memory session lazily on the first real prompt after resume', async () => {
    const h = await lifecycleHarness();
    await h.handlers.get('before_agent_start')?.({ prompt: 'first turn before close' }, h.ctx);
    await h.handlers.get('session_shutdown')?.({ reason: 'quit' }, h.ctx);

    const d = openMemoryDb(h.dbPath);
    const closed = d.prepare('SELECT id, status, ended_at, summary FROM memory_sessions LIMIT 1').get() as any;
    expect(closed.status).toBe('completed');
    expect(closed.ended_at).not.toBeNull();
    expect(closed.summary).toContain('captured 1 prompt(s)');

    await h.handlers.get('session_start')?.({ reason: 'resume' }, h.ctx);
    const stillClosed = d.prepare('SELECT status, ended_at, summary FROM memory_sessions WHERE id=?').get(closed.id) as any;
    expect(stillClosed.status).toBe('completed');
    expect(stillClosed.ended_at).not.toBeNull();
    expect(stillClosed.summary).toBe(closed.summary);

    await h.handlers.get('before_agent_start')?.({ prompt: 'stored turn after lazy reopen' }, h.ctx);
    const reopened = d.prepare('SELECT status, ended_at, summary FROM memory_sessions WHERE id=?').get(closed.id) as any;
    expect(reopened.status).toBe('active');
    expect(reopened.ended_at).toBeNull();
    expect(reopened.summary).toBe(closed.summary);
    const promptCountAfterReopen = d.prepare('SELECT COUNT(*) AS count FROM memory_session_prompts WHERE session_id=?').get(closed.id) as any;
    expect(promptCountAfterReopen.count).toBe(2);

    await h.handlers.get('session_shutdown')?.({ reason: 'quit-again' }, h.ctx);
    const refinished = d.prepare('SELECT status, summary FROM memory_sessions WHERE id=?').get(closed.id) as any;
    expect(refinished.status).toBe('completed');
    expect(refinished.summary).toContain('captured 2 prompt(s)');
  });

  it('does not reopen the current closed memory session just because a durable memory is saved', async () => {
    const dbPath = path.join(tmp, 'memory-add-closed.sqlite');
    const projectDir = path.join(tmp, 'memory-add-closed-project');
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Memory Add Closed App' }));
    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const handlers = new Map<string, Function>();
    const tools = new Map<string, any>();
    extension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
    const ctx = { cwd: projectDir, ui: { setStatus: () => {}, notify: () => {} }, sessionManager: { getSessionFile: () => path.join(tmp, 'memory-add-closed.jsonl'), getBranch: () => [] } };

    await handlers.get('session_start')?.({}, ctx);
    await handlers.get('before_agent_start')?.({ prompt: 'first turn before memory add' }, ctx);
    await handlers.get('session_shutdown')?.({ reason: 'quit' }, ctx);
    const d = openMemoryDb(dbPath);
    const closed = d.prepare('SELECT id, status, ended_at FROM memory_sessions LIMIT 1').get() as any;
    expect(closed.status).toBe('completed');

    await tools.get('memory_add').execute('tool-call', { kind: 'note', content: 'memory saved after session was closed' }, undefined, undefined, ctx);
    const stillClosed = d.prepare('SELECT status, ended_at FROM memory_sessions WHERE id=?').get(closed.id) as any;
    expect(stillClosed.status).toBe('completed');
    expect(stillClosed.ended_at).not.toBeNull();
  });

  it('marks memory sessions started inside subagent runtime as subagent origin', async () => {
    const h = await lifecycleHarness();
    const registryKey = Symbol.for('pi.permissionGuard.subagentSessions');
    const registry = new Map<string, any>();
    (globalThis as any)[registryKey] = registry;
    const d = openMemoryDb(h.dbPath);
    const parentContext = resolveMemoryContext(h.ctx.cwd, os.homedir(), {});
    const parent: any = startMemorySession(d, { title: 'Parent User Session', metadata_json: { pi_session_id: 'parent-pi-session' } }, parentContext);
    h.ctx.sessionManager.getSessionId = () => 'nested-subagent-session';
    registry.set('nested-subagent-session', {
      origin: 'subagent',
      requester: { subagentName: 'discovery', description: 'read-only research', taskId: 'task_discovery_123' },
      parent: { piSessionId: 'parent-pi-session' },
    });

    await h.handlers.get('before_agent_start')?.({ prompt: 'subagent delegated prompt' }, h.ctx);
    const row = d.prepare('SELECT metadata_json FROM memory_sessions WHERE id != ? LIMIT 1').get(parent.id) as any;
    const meta = JSON.parse(row.metadata_json);
    expect(meta.origin).toBe('subagent');
    expect(meta.subagent_name).toBe('discovery');
    expect(meta.subagent_description).toBe('read-only research');
    expect(meta.subagent_task_id).toBe('task_discovery_123');
    expect(meta.parent_pi_session_id).toBe('parent-pi-session');
    expect(meta.parent_memory_session_id).toBe(parent.id);
    registry.delete('nested-subagent-session');
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
    addMemory(d, {
      scope: 'project',
      kind: 'decision',
      title: 'bounded startup summary',
      summary: `compact retrieval cue ${'useful context '.repeat(20)}hidden-tail-marker`,
      content: 'full memory content should not be loaded at startup',
    }, c);
    const active: any = (await import('../src/sessions.js')).startMemorySession(d, { title: 'Active Summary' }, c);
    d.prepare('UPDATE memory_sessions SET summary=?, started_at=? WHERE id=?').run('active summary should not win', '2999-01-01T00:00:00.000Z', active.id);
    const handlers = new Map<string, Function>();
    extension({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
    const ctx = { cwd: projectDir, ui: { setStatus: () => {}, notify: () => {} }, sessionManager: { getSessionFile: () => path.join(tmp, 'new-pi-session.json') } };
    await handlers.get('session_start')?.({}, ctx);
    const first = await handlers.get('before_agent_start')?.({ prompt: 'new turn' }, ctx);
    expect(first.message.content).toContain('Previous Done — previous useful summary');
    expect(first.message.content).toContain('bounded startup summary — compact retrieval cue');
    expect(first.message.content).not.toContain('hidden-tail-marker');
    expect(first.message.content).not.toContain('full memory content should not be loaded at startup');
    expect(first.message.content).not.toContain('Active Summary');
    expect(first.message.content).not.toContain('Session without summary yet');
  });

  it('injects scored startup context with active-only current-project results plus one completed session summary', async () => {
    const dbPath = path.join(tmp, 'startup-scored.sqlite');
    const projectDir = path.join(tmp, 'startup-scored-project');
    const otherDir = path.join(tmp, 'startup-scored-other');
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.mkdirSync(path.join(otherDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Startup Scored App' }));
    fs.writeFileSync(path.join(otherDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Other Startup Scored App' }));
    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const d = openMemoryDb(dbPath);
    migrate(d);
    const c = resolveMemoryContext(projectDir, os.homedir(), {});
    const other = resolveMemoryContext(otherDir, os.homedir(), {});

    const previous: any = (await import('../src/sessions.js')).startMemorySession(d, { title: 'Previous Startup Session' }, c);
    (await import('../src/sessions.js')).finishMemorySession(d, { session_id: previous.id, summary: 'previous startup summary survives append' }, c);

    const decision = addMemory(d, { scope: 'project', kind: 'decision', title: 'startup decision', summary: 'decision should outrank fresh progress', content: 'decision should outrank fresh progress', importance: 3 }, c).memory;
    const freshCommand = addMemory(d, { scope: 'project', kind: 'command', title: 'fresh command', summary: 'fresh command summary', content: 'fresh command summary', importance: 3 }, c).memory;
    const globalCommand = addMemory(d, { scope: 'global', kind: 'command', title: 'global startup command', summary: 'global startup command summary', content: 'global startup command summary', importance: 4 }, c).memory;
    const note = addMemory(d, { scope: 'project', kind: 'note', title: 'startup note', summary: 'startup note summary', content: 'startup note summary', importance: 5 }, c).memory;
    const progress = addMemory(d, { scope: 'project', kind: 'progress', title: 'fresh progress', summary: 'fresh progress with prompt keyword match', content: 'fresh progress with prompt keyword match', importance: 5 }, c).memory;
    const archived = addMemory(d, { scope: 'project', kind: 'decision', title: 'archived startup decision', summary: 'archived', content: 'archived', importance: 5 }, c).memory;
    const superseded = addMemory(d, { scope: 'project', kind: 'command', title: 'superseded startup command', summary: 'superseded', content: 'superseded', importance: 5 }, c).memory;
    addMemory(d, { scope: 'project', kind: 'decision', title: 'other project startup decision', summary: 'must not leak', content: 'must not leak', importance: 5 }, other);

    d.prepare('UPDATE memories SET updated_at=? WHERE id=?').run('2026-03-02T00:00:00.000Z', decision.id);
    d.prepare('UPDATE memories SET updated_at=? WHERE id=?').run('2026-04-01T00:00:00.000Z', freshCommand.id);
    d.prepare('UPDATE memories SET updated_at=? WHERE id=?').run('2026-04-01T00:00:00.000Z', globalCommand.id);
    d.prepare('UPDATE memories SET updated_at=? WHERE id=?').run('2026-04-01T00:00:00.000Z', note.id);
    d.prepare('UPDATE memories SET updated_at=? WHERE id=?').run('2026-04-01T00:00:00.000Z', progress.id);
    d.prepare('UPDATE memories SET status=? WHERE id=?').run('archived', archived.id);
    d.prepare('UPDATE memories SET status=? WHERE id=?').run('superseded', superseded.id);

    const handlers = new Map<string, Function>();
    extension({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
    const ctx = { cwd: projectDir, ui: { setStatus: () => {}, notify: () => {} }, sessionManager: { getSessionFile: () => path.join(tmp, 'scored-pi-session.json') } };
    await handlers.get('session_start')?.({}, ctx);
    const first = await handlers.get('before_agent_start')?.({ prompt: 'prompt keyword match should not affect startup order' }, ctx);
    const text = String(first.message.content);
    const startupSection = text.split('Startup brain context (recent memories and session summaries):\n')[1] ?? '';
    const startupLines = startupSection.split('\n').filter((line) => line.startsWith('- memory') || line.startsWith('- session'));

    expect(startupLines).toHaveLength(5);
    expect(text).toContain('Previous Startup Session — previous startup summary survives append');
    expect(text).toContain('startup decision');
    expect(text).toContain('fresh command');
    expect(text).toContain('global startup command');
    expect(text).toContain('startup note');
    expect(startupSection).not.toContain('fresh progress —');
    expect(startupSection).not.toContain('archived startup decision');
    expect(startupSection).not.toContain('superseded startup command');
    expect(startupSection).not.toContain('other project startup decision');
    expect(startupSection.indexOf('startup decision')).toBeLessThan(startupSection.indexOf('fresh command'));
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

describe('retrieval telemetry', () => {
  it('writes nothing and prunes nothing when telemetry is disabled by default', async () => {
    const { d, projectDir, tools } = await telemetryToolHarness('Telemetry Disabled App');
    const context = resolveMemoryContext(projectDir, os.homedir(), {});
    addMemory(d, { scope: 'project', kind: 'decision', title: 'disabled telemetry decision', content: 'disabled telemetry decision', importance: 5 }, context);
    d.prepare(`INSERT INTO retrieval_telemetry(id,timestamp,operation,trigger_category,project_id,session_id,result_memory_ids,result_ranks,result_count,latency_ms,success,error_category)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'telemetry_old_disabled', '2000-01-01T00:00:00.000Z', 'search', 'tool_call', context.project_id, null, '[]', '[]', 0, 1, 1, 'none',
    );

    const search = await tools.get('memory_search').execute('tool-call', { query: 'disabled telemetry', limit: 5 }, undefined, undefined, { cwd: projectDir });
    expect(search.isError).not.toBe(true);
    const rows = d.prepare('SELECT id FROM retrieval_telemetry ORDER BY id').all() as Array<{ id: string }>;
    expect(rows).toEqual([{ id: 'telemetry_old_disabled' }]);
  });

  it('records enabled search, recall, and startup telemetry with ids/ranks/count/latency/categories only', async () => {
    const sentinel = 'sensitive sentinel alpha 123';
    const sentinelHash = createHash('sha256').update(sentinel).digest('hex');
    const { d, projectDir, tools, handlers } = await telemetryToolHarness('Telemetry Enabled App', { telemetry: { retrieval: { enabled: true, retention_days: 30 } } });
    const context = resolveMemoryContext(projectDir, os.homedir(), {});
    const note = addMemory(d, {
      scope: 'project',
      kind: 'note',
      title: `title ${sentinel}`,
      summary: `summary ${sentinel}`,
      content: `content ${sentinel}`,
      importance: 5,
    }, context).memory;

    const ctx = { cwd: projectDir, ui: { setStatus: () => {}, notify: () => {} }, sessionManager: { getSessionFile: () => path.join(tmp, 'telemetry-enabled-session.json') } };
    await handlers.get('session_start')?.({}, ctx);
    const startup = await handlers.get('before_agent_start')?.({ prompt: `prompt ${sentinel}` }, ctx);
    expect(startup.message.content).toContain('Memory session:');

    const search = await tools.get('memory_search').execute('tool-call', { query: sentinel, limit: 5 }, undefined, undefined, { cwd: projectDir });
    const recall = await tools.get('memory_recall').execute('tool-call', { context: 'task', query: sentinel, limit: 5 }, undefined, undefined, { cwd: projectDir });
    expect(search.isError).not.toBe(true);
    expect(recall.isError).not.toBe(true);

    const rows = d.prepare('SELECT timestamp,operation,trigger_category,project_id,session_id,result_memory_ids,result_ranks,result_count,latency_ms,success,error_category FROM retrieval_telemetry ORDER BY timestamp ASC').all() as Array<any>;
    expect(rows.map((row) => row.operation)).toEqual(['startup', 'search', 'recall']);
    expect(rows.map((row) => row.trigger_category)).toEqual(['lifecycle', 'tool_call', 'tool_call']);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['error_category', 'latency_ms', 'operation', 'project_id', 'result_count', 'result_memory_ids', 'result_ranks', 'session_id', 'success', 'timestamp', 'trigger_category'].sort());
      expect(row.project_id).toBe(context.project_id);
      expect(typeof row.result_memory_ids).toBe('string');
      expect(typeof row.result_ranks).toBe('string');
      expect(JSON.parse(row.result_memory_ids)).toEqual(expect.arrayContaining([note.id]));
      expect(JSON.parse(row.result_ranks)[0]).toBe(0);
      expect(row.result_count).toBeGreaterThan(0);
      expect(row.latency_ms).toBeGreaterThanOrEqual(0);
      expect(row.success).toBe(1);
      expect(row.error_category).toBe('none');
      const persisted = JSON.stringify(row);
      expect(persisted).not.toContain(sentinel);
      expect(persisted).not.toContain(sentinelHash);
    }

    const schemaText = d.prepare("SELECT sql FROM sqlite_master WHERE name='retrieval_telemetry'").get() as { sql: string };
    expect(schemaText.sql).not.toContain('metadata_json');
    expect(schemaText.sql).not.toContain('query');
    expect(schemaText.sql).not.toContain('content');
    expect(schemaText.sql).not.toContain('summary');
    expect(schemaText.sql).not.toContain('title');
    expect(schemaText.sql).not.toContain('hash');
  });

  it('prunes only telemetry rows older than the enabled retention boundary', async () => {
    const { d, projectDir, tools } = await telemetryToolHarness('Telemetry Prune App', { telemetry: { retrieval: { enabled: true, retention_days: 30 } } });
    const context = resolveMemoryContext(projectDir, os.homedir(), {});
    addMemory(d, { scope: 'project', kind: 'note', content: 'prune target memory', importance: 5 }, context);
    d.prepare(`INSERT INTO retrieval_telemetry(id,timestamp,operation,trigger_category,project_id,session_id,result_memory_ids,result_ranks,result_count,latency_ms,success,error_category)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('telemetry_old', '2026-01-01T00:00:00.000Z', 'search', 'tool_call', context.project_id, null, '[]', '[]', 0, 1, 1, 'none');
    d.prepare(`INSERT INTO retrieval_telemetry(id,timestamp,operation,trigger_category,project_id,session_id,result_memory_ids,result_ranks,result_count,latency_ms,success,error_category)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('telemetry_boundary', '2026-01-31T00:00:00.000Z', 'search', 'tool_call', context.project_id, null, '[]', '[]', 0, 1, 1, 'none');

    const realDate = Date;
    class FixedDate extends Date {
      constructor(value?: any) { super(value ?? '2026-03-01T00:00:00.000Z'); }
      static now() { return new realDate('2026-03-01T00:00:00.000Z').getTime(); }
    }
    (globalThis as any).Date = FixedDate;
    try {
      const result = await tools.get('memory_search').execute('tool-call', { query: 'prune target', limit: 5 }, undefined, undefined, { cwd: projectDir });
      expect(result.isError).not.toBe(true);
    } finally {
      (globalThis as any).Date = realDate;
    }

    const rows = d.prepare('SELECT id FROM retrieval_telemetry ORDER BY id').all() as Array<{ id: string }>;
    expect(rows.map((row) => row.id)).not.toContain('telemetry_old');
    expect(rows.map((row) => row.id)).toContain('telemetry_boundary');
  });

  it('swallows telemetry write and prune failures without altering retrieval results and stays local/export-free', async () => {
    const sentinel = 'privacy sentinel beta 456';
    const { d, projectDir, tools, handlers } = await telemetryToolHarness('Telemetry Failure App', { telemetry: { retrieval: { enabled: true, retention_days: 30 } } });
    const context = resolveMemoryContext(projectDir, os.homedir(), {});
    const memory = addMemory(d, { scope: 'project', kind: 'note', title: `title ${sentinel}`, summary: `summary ${sentinel}`, content: `content ${sentinel}`, importance: 5 }, context).memory;

    const originalFetch = (globalThis as any).fetch;
    let fetchCalls = 0;
    (globalThis as any).fetch = (..._args: any[]) => { fetchCalls += 1; throw new Error('telemetry must remain local only'); };
    d.exec(`CREATE TRIGGER retrieval_telemetry_fail_delete BEFORE DELETE ON retrieval_telemetry BEGIN SELECT RAISE(ABORT, 'prune blocked'); END;`);
    d.prepare(`INSERT INTO retrieval_telemetry(id,timestamp,operation,trigger_category,project_id,session_id,result_memory_ids,result_ranks,result_count,latency_ms,success,error_category)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('telemetry_failure_seed', '2000-01-01T00:00:00.000Z', 'search', 'tool_call', context.project_id, null, '[]', '[]', 0, 1, 1, 'none');
    const ctx = { cwd: projectDir, ui: { setStatus: () => {}, notify: () => {} }, sessionManager: { getSessionFile: () => path.join(tmp, 'telemetry-failure-session.json') } };
    try {
      await handlers.get('session_start')?.({}, ctx);
      const startup = await handlers.get('before_agent_start')?.({ prompt: sentinel }, ctx);
      const search = await tools.get('memory_search').execute('tool-call', { query: sentinel, limit: 5 }, undefined, undefined, { cwd: projectDir });
      const recall = await tools.get('memory_recall').execute('tool-call', { context: 'task', query: sentinel, limit: 5 }, undefined, undefined, { cwd: projectDir });
      expect(startup.message.content).toContain('Memory session:');
      expect(search.isError).not.toBe(true);
      expect(recall.isError).not.toBe(true);
      expect(search.details.results.map((item: any) => item.id)).toContain(memory.id);
      expect(recall.details.results.map((item: any) => item.id)).toContain(memory.id);
      expect(fetchCalls).toBe(0);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }

    d.exec('DROP TABLE retrieval_telemetry');
    const searchAfterDrop = await tools.get('memory_search').execute('tool-call', { query: sentinel, limit: 5 }, undefined, undefined, { cwd: projectDir });
    expect(searchAfterDrop.isError).not.toBe(true);
    expect(searchAfterDrop.details.results.map((item: any) => item.id)).toContain(memory.id);

    const exported = path.join(tmp, 'telemetry-export.jsonl');
    exportMemory(d, { path: exported, context });
    const payload = fs.readFileSync(exported, 'utf8');
    expect(payload).not.toContain('retrieval_telemetry');
    expect(payload).not.toContain('telemetry_failure_seed');
  });
});

describe('commit changelog advanced behavior', () => {
  it('supports allowed relation types, preserves metadata_json.extra, and expands search links', async () => {
    const { d, tools } = registerCommitChangelogHarness();
    const projectDir = createProjectDir('Commit Search App', 'commit-search-app');
    const memoryAdd = tools.get('memory_add');
    const commitAdd = tools.get('memory_commit_record_add');
    const changelogAdd = tools.get('memory_changelog_entry_add');
    const linkTool = tools.get('memory_commit_changelog_link');
    const searchTool = tools.get('memory_commit_changelog_search');

    expect(commitAdd).toBeTruthy();
    expect(changelogAdd).toBeTruthy();
    expect(linkTool).toBeTruthy();
    expect(searchTool).toBeTruthy();

    const support = await memoryAdd.execute('tool-call', { kind: 'decision', content: 'supporting release decision memory' }, undefined, undefined, { cwd: projectDir });
    const commit = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'abc1234',
      subject: 'add changelog tool tests',
      branch: 'main',
      metadata_json: { source: 'git log', ticket: 'MEM-101' },
      related_memory_ids: [support.details.memory.id],
    }, undefined, undefined, { cwd: projectDir });
    const changelog = await changelogAdd.execute('tool-call', {
      version: '1.4.0',
      release_tag: 'v1.4.0',
      section: 'added',
      bullets: ['memory commit changelog test coverage'],
      metadata_json: { channel: 'stable' },
      source_commit_ids: [commit.details.memory.id],
      related_memory_ids: [support.details.memory.id],
    }, undefined, undefined, { cwd: projectDir });

    const automaticSourceLinks = d.prepare("SELECT * FROM memory_links WHERE from_memory_id=? AND to_memory_id=? AND relation_type='derived_from'").all(changelog.details.memory.id, commit.details.memory.id) as any[];
    expect(automaticSourceLinks).toHaveLength(0);

    for (const relationType of ['derived_from', 'supports', 'related_to', 'supersedes']) {
      const result = await linkTool.execute('tool-call', {
        from_memory_id: changelog.details.memory.id,
        to_memory_id: commit.details.memory.id,
        relation_type: relationType,
      }, undefined, undefined, { cwd: projectDir });
      expect(result.isError).not.toBe(true);
      expect(result.details.link.relation_type).toBe(relationType);
    }

    const duplicateLink = await linkTool.execute('tool-call', {
      from_memory_id: changelog.details.memory.id,
      to_memory_id: support.details.memory.id,
      relation_type: 'supports',
      metadata_json: { reason: 'release evidence' },
    }, undefined, undefined, { cwd: projectDir });
    const duplicateLinkAgain = await linkTool.execute('tool-call', {
      from_memory_id: changelog.details.memory.id,
      to_memory_id: support.details.memory.id,
      relation_type: 'supports',
      metadata_json: { reason: 'release evidence' },
    }, undefined, undefined, { cwd: projectDir });
    expect(duplicateLinkAgain.details.link.id).toBe(duplicateLink.details.link.id);

    const linkCounts = d.prepare("SELECT relation_type, COUNT(*) AS count FROM memory_links GROUP BY relation_type ORDER BY relation_type").all() as Array<{ relation_type: string; count: number }>;
    expect(linkCounts).toEqual([
      { relation_type: 'derived_from', count: 1 },
      { relation_type: 'related_to', count: 3 },
      { relation_type: 'supersedes', count: 1 },
      { relation_type: 'supports', count: 2 },
    ]);

    const commitMetaRow = d.prepare("SELECT metadata_json FROM memories WHERE id=?").get(commit.details.memory.id) as { metadata_json: string };
    expect(JSON.parse(commitMetaRow.metadata_json)).toMatchObject({
      commit: { repo: 'github.com/j0k3r/j0k3r-pi', commit_hash: 'abc1234', branch: 'main', subject: 'add changelog tool tests' },
      extra: { source: 'git log', ticket: 'MEM-101' },
    });
    const changelogMetaRow = d.prepare("SELECT metadata_json FROM memories WHERE id=?").get(changelog.details.memory.id) as { metadata_json: string };
    expect(JSON.parse(changelogMetaRow.metadata_json)).toMatchObject({
      changelog: { version: '1.4.0', release_tag: 'v1.4.0', section: 'added', bullets: ['memory commit changelog test coverage'], source_commit_ids: [commit.details.memory.id] },
      extra: { channel: 'stable' },
    });

    const commitSearch = await searchTool.execute('tool-call', {
      query: 'changelog tool tests',
      record_types: ['commit_record'],
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'abc1234',
      branch: 'main',
      include_links: true,
      include_related: true,
      limit: 10,
    }, undefined, undefined, { cwd: projectDir });
    expect(commitSearch.isError).not.toBe(true);
    expect(commitSearch.details.results).toHaveLength(1);
    expect(commitSearch.details.results[0]).toMatchObject({ kind: 'commit_record' });
    expect(JSON.stringify(commitSearch.details.results[0])).toContain('supports');
    expect(JSON.stringify(commitSearch.details.results[0])).toContain(support.details.memory.id);

    const changelogSearch = await searchTool.execute('tool-call', {
      query: 'test coverage',
      record_types: ['changelog_entry'],
      version: '1.4.0',
      release_tag: 'v1.4.0',
      section: 'added',
      include_links: true,
      include_related: true,
      limit: 10,
    }, undefined, undefined, { cwd: projectDir });
    expect(changelogSearch.isError).not.toBe(true);
    expect(changelogSearch.details.results).toHaveLength(1);
    expect(changelogSearch.details.results[0]).toMatchObject({ kind: 'changelog_entry' });
    expect(JSON.stringify(changelogSearch.details.results[0])).toContain('derived_from');
    expect(JSON.stringify(changelogSearch.details.results[0])).toContain(commit.details.memory.id);
  });

  it('defaults search to the current project and preserves commit/changelog memories plus links through export/import', async () => {
    const dbPath = path.join(tmp, 'commit-export-import.sqlite');
    const { d, tools } = registerCommitChangelogHarness(dbPath);
    const projectADir = createProjectDir('Commit Project A', 'commit-project-a');
    const projectBDir = createProjectDir('Commit Project B', 'commit-project-b');
    const commitAdd = tools.get('memory_commit_record_add');
    const changelogAdd = tools.get('memory_changelog_entry_add');
    const searchTool = tools.get('memory_commit_changelog_search');
    const linkTool = tools.get('memory_commit_changelog_link');

    expect(commitAdd).toBeTruthy();
    expect(changelogAdd).toBeTruthy();
    expect(searchTool).toBeTruthy();
    expect(linkTool).toBeTruthy();

    const commitA = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'aaaaaaa',
      subject: 'project a commit',
      branch: 'main',
    }, undefined, undefined, { cwd: projectADir });
    const changelogA = await changelogAdd.execute('tool-call', {
      version: '1.0.0',
      release_tag: 'v1.0.0',
      section: 'added',
      bullets: ['project a release note'],
      source_commit_ids: [commitA.details.memory.id],
    }, undefined, undefined, { cwd: projectADir });
    await linkTool.execute('tool-call', {
      from_memory_id: changelogA.details.memory.id,
      to_memory_id: commitA.details.memory.id,
      relation_type: 'derived_from',
    }, undefined, undefined, { cwd: projectADir });
    await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'bbbbbbb',
      subject: 'project b commit',
      branch: 'release',
    }, undefined, undefined, { cwd: projectBDir });
    await changelogAdd.execute('tool-call', {
      version: '9.9.9',
      release_tag: 'v9.9.9',
      section: 'fixed',
      bullets: ['project b release note'],
    }, undefined, undefined, { cwd: projectBDir });

    const defaultScoped = await searchTool.execute('tool-call', {
      query: 'project',
      include_links: true,
      include_related: true,
      limit: 10,
    }, undefined, undefined, { cwd: projectADir });
    expect(defaultScoped.isError).not.toBe(true);
    const defaultText = JSON.stringify(defaultScoped.details.results);
    expect(defaultText).toContain('project a commit');
    expect(defaultText).toContain('project a release note');
    expect(defaultText).not.toContain('project b commit');
    expect(defaultText).not.toContain('project b release note');

    const exportPath = path.join(tmp, 'commit-project-a.jsonl');
    const exportResult = exportMemory(d, { path: exportPath, context: resolveMemoryContext(projectADir, os.homedir(), {}), include_git: true });
    expect(exportResult.path).toBe(exportPath);
    const exportText = fs.readFileSync(exportPath, 'utf8');
    expect(exportText).toContain(commitA.details.memory.id);
    expect(exportText).toContain(changelogA.details.memory.id);
    expect(exportText).toContain('memory_links');

    const importedDbPath = path.join(tmp, 'commit-imported.sqlite');
    const importedDb = openMemoryDb(importedDbPath);
    migrate(importedDb);
    const importResult = importMemory(importedDb, { path: exportPath, mode: 'merge', include_git: true });
    expect(importResult.inserted).toBeGreaterThan(0);

    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = importedDbPath;
    const importedTools = new Map<string, any>();
    extension({ registerTool: (tool: any) => importedTools.set(tool.name, tool), registerCommand: () => {}, on: () => {} });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
    const importedProjectDir = createProjectDir('Commit Project A', 'commit-project-a-imported');
    const importedSearch = await importedTools.get('memory_commit_changelog_search').execute('tool-call', {
      query: 'project a',
      include_links: true,
      include_related: true,
      limit: 10,
    }, undefined, undefined, { cwd: importedProjectDir });
    expect(importedSearch.isError).not.toBe(true);
    const importedText = JSON.stringify(importedSearch.details.results);
    expect(importedText).toContain('project a commit');
    expect(importedText).toContain('project a release note');
    expect(importedText).toContain(commitA.details.memory.id);
    expect(importedText).toContain(changelogA.details.memory.id);
  });

  it('filters commit search by normalized change_type and release_impact including release-neutral sync commits', async () => {
    const { tools } = registerCommitChangelogHarness(path.join(tmp, 'commit-classification-search.sqlite'));
    const projectDir = createProjectDir('Commit Classification Search App', 'commit-classification-search-app');
    const memoryAdd = tools.get('memory_add');
    const commitAdd = tools.get('memory_commit_record_add');
    const searchTool = tools.get('memory_commit_changelog_search');

    expect(commitAdd).toBeTruthy();
    expect(searchTool).toBeTruthy();

    const fixCommit = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: '1111111',
      subject: 'fix release classification filtering',
      change_type: 'fix',
      release_impact: 'patch',
    }, undefined, undefined, { cwd: projectDir });
    const featureCommit = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: '2222222',
      subject: 'add release planning support',
      change_type: 'feature',
      release_impact: 'minor',
    }, undefined, undefined, { cwd: projectDir });
    const syncCommit = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: '3333333',
      subject: 'sync cloud memory state',
      change_type: 'sync',
    }, undefined, undefined, { cwd: projectDir });
    const legacy = await memoryAdd.execute('tool-call', {
      scope: 'project',
      kind: 'commit_record',
      title: 'legacy commit without release classification',
      content: 'legacy commit search coverage',
      metadata_json: {
        commit: {
          repo: 'github.com/j0k3r/j0k3r-pi',
          commit_hash: '4444444',
          subject: 'legacy commit without release classification',
        },
      },
    }, undefined, undefined, { cwd: projectDir });

    const fixSearch = await searchTool.execute('tool-call', {
      record_types: ['commit_record'],
      change_type: ' FIX ',
      release_impact: ' Patch ',
      limit: 10,
    }, undefined, undefined, { cwd: projectDir });
    expect(fixSearch.isError).not.toBe(true);
    expect(fixSearch.details.results.map((result: any) => result.id)).toEqual([fixCommit.details.memory.id]);

    const majorSearch = await searchTool.execute('tool-call', {
      record_types: ['commit_record'],
      release_impact: 'major',
      limit: 10,
    }, undefined, undefined, { cwd: projectDir });
    expect(majorSearch.isError).not.toBe(true);
    expect(majorSearch.details.results).toEqual([]);

    const syncSearch = await searchTool.execute('tool-call', {
      record_types: ['commit_record'],
      change_type: 'sync',
      release_impact: 'none',
      limit: 10,
    }, undefined, undefined, { cwd: projectDir });
    expect(syncSearch.isError).not.toBe(true);
    expect(syncSearch.details.results.map((result: any) => result.id)).toEqual([syncCommit.details.memory.id]);

    const unfiltered = await searchTool.execute('tool-call', {
      record_types: ['commit_record'],
      query: 'commit',
      limit: 10,
    }, undefined, undefined, { cwd: projectDir });
    expect(unfiltered.isError).not.toBe(true);
    const unfilteredIds = unfiltered.details.results.map((result: any) => result.id);
    expect(unfilteredIds).toContain(fixCommit.details.memory.id);
    expect(unfilteredIds).toContain(featureCommit.details.memory.id);
    expect(unfilteredIds).toContain(syncCommit.details.memory.id);
    expect(unfilteredIds).toContain(legacy.details.memory.id);
  });
});

describe('semantic profile, consolidation links, and entities', () => {
  it('parses and applies browser filter commands', () => {
    const filters = applyBrowserFilterCommand({}, 'query=npm kind=command scope=project status=active project=app origin=all');
    expect(filters).toEqual({ query: 'npm', kind: 'command', scope: 'project', status: 'active', project: 'app', origin: 'all' });
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

  it('loads memory browser items only for the current project', () => {
    const d = db(), c = project();
    addMemory(d, { scope: 'project', kind: 'note', title: 'current project memory', content: 'current project only' }, c);
    addMemory(d, { scope: 'general', kind: 'note', title: 'general memory', content: 'general should be hidden' }, c);
    addMemory(d, { scope: 'global', kind: 'note', title: 'global memory', content: 'global should be hidden' }, c);

    const otherDir = path.join(tmp, 'other-memory-project');
    fs.mkdirSync(path.join(otherDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(otherDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Other Memory App' }));
    const other = resolveMemoryContext(otherDir, os.homedir(), {});
    addMemory(d, { scope: 'project', kind: 'note', title: 'other project memory', content: 'other project should be hidden' }, other);

    const memories = loadMemories(d, c);
    expect(memories.map((item) => item.label)).toEqual(['note · current project memory']);
    expect(JSON.stringify(memories)).not.toContain('general should be hidden');
    expect(JSON.stringify(memories)).not.toContain('global should be hidden');
    expect(JSON.stringify(memories)).not.toContain('other project should be hidden');
  });

  it('loads session items only for the current project', () => {
    const d = db(), c = project();
    const currentSession: any = startMemorySession(d, { title: 'Current Project Session' }, c);
    startMemorySession(d, { title: 'General Session', scope: 'general' }, c);
    startMemorySession(d, { title: 'Global Session', scope: 'global' }, c);

    const otherDir = path.join(tmp, 'other-session-project');
    fs.mkdirSync(path.join(otherDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(otherDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Other Session App' }));
    const other = resolveMemoryContext(otherDir, os.homedir(), {});
    startMemorySession(d, { title: 'Other Project Session' }, other);

    const sessions = loadSessions(d, c);
    expect(sessions.map((item) => item.id)).toEqual([currentSession.id]);
    expect(JSON.stringify(sessions)).not.toContain('General Session');
    expect(JSON.stringify(sessions)).not.toContain('Global Session');
    expect(JSON.stringify(sessions)).not.toContain('Other Project Session');
  });

  it('loads prompt items for the memory browser scoped only to the current project', () => {
    const d = db(), c = project();
    const currentSession: any = startMemorySession(d, { title: 'Current Prompt Session' }, c);
    addSessionPrompt(d, { session_id: currentSession.id, role: 'user', prompt: 'show browser prompts', prompt_index: 1 }, c);
    const generalSession: any = startMemorySession(d, { title: 'General Prompt Session', scope: 'general' }, c);
    addSessionPrompt(d, { session_id: generalSession.id, role: 'user', prompt: 'general prompt should be hidden', prompt_index: 1 }, c);
    const globalSession: any = startMemorySession(d, { title: 'Global Prompt Session', scope: 'global' }, c);
    addSessionPrompt(d, { session_id: globalSession.id, role: 'user', prompt: 'global prompt should be hidden', prompt_index: 1 }, c);

    const otherDir = path.join(tmp, 'other-project');
    fs.mkdirSync(path.join(otherDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(otherDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Other App' }));
    const other = resolveMemoryContext(otherDir, os.homedir(), {});
    const otherSession: any = startMemorySession(d, { title: 'Other Prompt Session' }, other);
    addSessionPrompt(d, { session_id: otherSession.id, role: 'user', prompt: 'other project prompt', prompt_index: 1 }, other);

    const prompts = loadPrompts(d, c);
    expect(prompts.map((item) => item.type)).toEqual(['prompts']);
    expect(prompts[0]).toMatchObject({
      label: 'user #1 · show browser prompts',
      description: 'project/Advanced App · user · Current Prompt Session',
    });
    expect(prompts[0]?.detail).toContain(`session: ${currentSession.id}`);
    expect(prompts[0]?.detail).toContain('role: user');
    expect(prompts[0]?.detail).toContain('show browser prompts');
    expect(JSON.stringify(prompts)).not.toContain('general prompt should be hidden');
    expect(JSON.stringify(prompts)).not.toContain('global prompt should be hidden');
    expect(JSON.stringify(prompts)).not.toContain('other project prompt');
  });

  it('includes linked prompts in session browser details', () => {
    const d = db(), c = project();
    const session: any = startMemorySession(d, { title: 'Linked Prompt Session' }, c);
    addSessionPrompt(d, { session_id: session.id, role: 'user', prompt: 'first linked prompt', prompt_index: 1 }, c);
    addSessionPrompt(d, { session_id: session.id, role: 'assistant', prompt: 'second linked response', prompt_index: 2 }, c);

    const sessions = loadSessions(d, c);
    const item = sessions.find((candidate) => candidate.id === session.id);
    expect(item?.detail).toContain('linked prompts:');
    expect(item?.detail).toContain('[1] user');
    expect(item?.detail).toContain('first linked prompt');
    expect(item?.detail).toContain('[2] assistant');
    expect(item?.detail).toContain('second linked response');
  });

  it('hides subagent sessions and prompts by default while allowing origin filters', () => {
    const d = db(), c = project();
    const userSession: any = startMemorySession(d, { title: 'User Session', metadata_json: { pi_session_id: 'parent-pi-session' } }, c);
    addSessionPrompt(d, { session_id: userSession.id, role: 'user', prompt: 'user prompt', prompt_index: 1 }, c);
    const subagentSession: any = startMemorySession(d, { title: 'Subagent Session', metadata_json: { origin: 'subagent', subagent_name: 'discovery', subagent_task_id: 'task_discovery_123', parent_pi_session_id: 'parent-pi-session', parent_memory_session_id: userSession.id } }, c);
    addSessionPrompt(d, { session_id: subagentSession.id, role: 'user', prompt: 'subagent prompt', prompt_index: 1 }, c);

    const sessions = loadSessions(d, c);
    expect(filterBrowserItems(sessions, {}).map((item) => item.id)).toEqual([userSession.id]);
    expect(filterBrowserItems(sessions, { origin: 'subagent' }).map((item) => item.id)).toEqual([subagentSession.id]);
    expect(filterBrowserItems(sessions, { origin: 'all' }).map((item) => item.id).sort()).toEqual([subagentSession.id, userSession.id].sort());
    const userDetail = sessions.find((item) => item.id === userSession.id)?.detail;
    expect(userDetail).toContain('linked subagent sessions:');
    expect(userDetail).toContain('discovery · task_discovery_123');
    expect(userDetail).toContain(subagentSession.id);
    const subagentDetail = sessions.find((item) => item.id === subagentSession.id)?.detail;
    expect(subagentDetail).toContain(`parent memory session: ${userSession.id}`);

    const prompts = loadPrompts(d, c);
    expect(filterBrowserItems(prompts, {}).map((item) => item.id)).toHaveLength(1);
    expect(filterBrowserItems(prompts, {})[0]?.detail).toContain('user prompt');
    expect(filterBrowserItems(prompts, { origin: 'subagent' })[0]?.detail).toContain('subagent prompt');
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

  it('canonicalizes legacy duplicate active project profiles during migration and preserves superseded rows byte-for-byte', () => {
    const legacy = createLegacyProfileDb();
    insertLegacyProjectProfile(legacy, {
      id: 'profile-a',
      project_id: 'project-1',
      project_name: 'advanced app',
      title: 'advanced app project profile a',
      summary: 'profile a summary',
      content: 'type: project_profile\ndetails: profile a',
      metadata_json: { source: 'a', nested: { value: 1 } },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-03T00:00:00.000Z',
    });
    insertLegacyProjectProfile(legacy, {
      id: 'profile-b',
      project_id: 'project-1',
      project_name: 'advanced app',
      title: 'advanced app project profile b',
      summary: 'profile b summary',
      content: 'type: project_profile\ndetails: profile b',
      metadata_json: { source: 'b', nested: { value: 2 } },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-04T00:00:00.000Z',
    });
    insertLegacyProjectProfile(legacy, {
      id: 'profile-c',
      project_id: 'project-2',
      project_name: 'other app',
      title: 'other app profile c',
      summary: 'profile c summary',
      content: 'type: project_profile\ndetails: profile c',
      metadata_json: { source: 'c' },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    });

    migrate(legacy);

    const projectOne = legacy.prepare("SELECT id, status, content, title, summary, metadata_json FROM memories WHERE project_id='project-1' ORDER BY id ASC").all() as Array<any>;
    expect(projectOne.map((row) => ({ id: row.id, status: row.status }))).toEqual([
      { id: 'profile-a', status: 'superseded' },
      { id: 'profile-b', status: 'active' },
    ]);
    expect(projectOne[0].content).toBe('type: project_profile\ndetails: profile a');
    expect(projectOne[0].title).toBe('advanced app project profile a');
    expect(projectOne[0].summary).toBe('profile a summary');
    expect(JSON.parse(projectOne[0].metadata_json)).toEqual({ source: 'a', nested: { value: 1 } });

    const links = legacy.prepare("SELECT from_memory_id, to_memory_id, relation_type FROM memory_links WHERE to_memory_id='profile-b' ORDER BY from_memory_id ASC").all() as Array<any>;
    expect(links).toEqual([
      { from_memory_id: 'profile-a', to_memory_id: 'profile-b', relation_type: 'supersedes' },
    ]);

    const indexes = legacy.prepare("PRAGMA index_list('memories')").all() as Array<any>;
    expect(indexes.some((row) => row.name === 'uq_active_project_profile')).toBe(true);
    expect(() => insertLegacyProjectProfile(legacy, {
      id: 'profile-d',
      project_id: 'project-1',
      project_name: 'advanced app',
      title: 'duplicate active profile',
      summary: 'should violate unique invariant',
      content: 'type: project_profile\ndetails: duplicate',
      created_at: '2026-01-05T00:00:00.000Z',
      updated_at: '2026-01-05T00:00:00.000Z',
    })).toThrow();
  });

  it('uses id ascending to break project_profile migration ties on updated_at', () => {
    const legacy = createLegacyProfileDb();
    insertLegacyProjectProfile(legacy, {
      id: 'profile-a',
      project_id: 'project-tie',
      project_name: 'tie app',
      title: 'tie profile a',
      summary: 'tie a',
      content: 'type: project_profile\ndetails: tie a',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-05T00:00:00.000Z',
    });
    insertLegacyProjectProfile(legacy, {
      id: 'profile-z',
      project_id: 'project-tie',
      project_name: 'tie app',
      title: 'tie profile z',
      summary: 'tie z',
      content: 'type: project_profile\ndetails: tie z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-05T00:00:00.000Z',
    });

    migrate(legacy);

    const rows = legacy.prepare("SELECT id, status FROM memories WHERE project_id='project-tie' ORDER BY id ASC").all() as Array<any>;
    expect(rows).toEqual([
      { id: 'profile-a', status: 'active' },
      { id: 'profile-z', status: 'superseded' },
    ]);
  });

  it('reports project_profile import collisions in dry run without writes and preserves one active profile for merge policies', () => {
    const target = db();
    const targetDir = path.join(tmp, 'profile-import-target');
    const context = project(targetDir);
    const canonical = addMemory(target, {
      scope: 'project',
      kind: 'project_profile',
      title: 'advanced app project profile',
      summary: 'living project profile for advanced app',
      content: 'type: project_profile\ndetails: local canonical profile',
      tags: ['project_profile', 'profile'],
      metadata_json: { owner: 'local' },
      importance: 5,
      origin_type: 'confirmed_by_user',
    }, context).memory;

    const backup = createProjectProfileBackup({
      content: 'type: project_profile\ndetails: imported profile',
      metadata_json: { owner: 'imported' },
    });

    const beforeRows = target.prepare("SELECT COUNT(*) AS count FROM memories WHERE project_id=?").get(context.project_id) as { count: number };
    const dryRun = importMemory(target, { path: backup.path, mode: 'dry_run', on_conflict: 'keep_local' });
    const afterDryRunRows = target.prepare("SELECT COUNT(*) AS count FROM memories WHERE project_id=?").get(context.project_id) as { count: number };

    expect(afterDryRunRows.count).toBe(beforeRows.count);
    expect(dryRun.profile_collision_details).toEqual([
      {
        project_id: context.project_id,
        incoming_profile_id: backup.memory.id,
        canonical_profile_id: canonical.id,
        action: 'keep_local',
      },
    ]);
    expect(dryRun.inserted).toBe(0);
    expect(dryRun.would_insert).toBe(0);

    for (const policy of ['keep_local', 'keep_imported', 'mark_conflict'] as const) {
      const policyDb = db();
      const policyDir = path.join(tmp, `profile-import-target-${policy}`);
      const policyContext = project(policyDir);
      const local = addMemory(policyDb, {
        scope: 'project',
        kind: 'project_profile',
        title: 'advanced app project profile',
        summary: 'living project profile for advanced app',
        content: 'type: project_profile\ndetails: local canonical profile',
        tags: ['project_profile', 'profile'],
        metadata_json: { owner: 'local' },
        importance: 5,
        origin_type: 'confirmed_by_user',
      }, policyContext).memory;

      const result = importMemory(policyDb, { path: backup.path, mode: 'merge', on_conflict: policy });
      expect(result.profile_collision_details).toEqual([
        {
          project_id: policyContext.project_id,
          incoming_profile_id: backup.memory.id,
          canonical_profile_id: local.id,
          action: policy,
        },
      ]);

      const rows = policyDb.prepare("SELECT id, status, content, sync_status, metadata_json FROM memories WHERE project_id=? AND kind='project_profile' ORDER BY id ASC").all(policyContext.project_id) as Array<any>;
      expect(rows.filter((row) => row.status === 'active')).toHaveLength(1);
      expect(rows.find((row) => row.id === backup.memory.id)?.status).toBe('superseded');
      expect(rows.find((row) => row.id === backup.memory.id)?.content).toBe('type: project_profile\ndetails: imported profile');

      const link = policyDb.prepare("SELECT from_memory_id, to_memory_id, relation_type FROM memory_links WHERE from_memory_id=?").get(backup.memory.id) as any;
      expect(link).toEqual({ from_memory_id: backup.memory.id, to_memory_id: local.id, relation_type: 'supersedes' });

      const active = rows.find((row) => row.status === 'active');
      if (policy === 'keep_local') {
        expect(active.id).toBe(local.id);
        expect(active.content).toBe('type: project_profile\ndetails: local canonical profile');
      } else if (policy === 'keep_imported') {
        expect(active.id).toBe(local.id);
        expect(active.content).toBe('type: project_profile\ndetails: imported profile');
        expect(JSON.parse(active.metadata_json)).toMatchObject({ owner: 'imported' });
      } else {
        expect(active.id).toBe(local.id);
        expect(active.content).toBe('type: project_profile\ndetails: local canonical profile');
        expect(rows.find((row) => row.id === backup.memory.id)?.sync_status).toBe('conflict');
      }
    }
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

  it('imports missing sessions before their prompts when existing memory rows conflict', () => {
    const source = db(), c = project();
    addMemory(source, { scope: 'project', kind: 'note', content: 'session restore ordering memory' }, c);
    const session: any = startMemorySession(source, { title: 'session restore ordering' }, c);
    addSessionPrompt(source, { session_id: session.id, role: 'user', prompt: 'restore this prompt after its session exists', prompt_index: 1 }, c);

    const memoryOnly = path.join(tmp, 'memory-only.jsonl');
    const withSessions = path.join(tmp, 'with-sessions.jsonl');
    exportMemory(source, { path: memoryOnly, context: c, include_sessions: false });
    exportMemory(source, { path: withSessions, context: c, include_sessions: true });

    const target = db();
    importMemory(target, { path: memoryOnly, mode: 'merge' });

    const dryRun = importMemory(target, { path: withSessions, mode: 'dry_run', on_conflict: 'keep_local' });
    expect(dryRun.inserted).toBe(0);
    expect(dryRun.would_insert).toBe(2);

    const result = importMemory(target, { path: withSessions, mode: 'merge', on_conflict: 'keep_local' });
    expect(result.inserted).toBe(2);
    expect(result.inserted_by_table.memory_sessions).toBe(1);
    expect(result.inserted_by_table.memory_session_prompts).toBe(1);
    const sessionCount = target.prepare('SELECT COUNT(*) AS count FROM memory_sessions').get() as { count: number };
    const promptCount = target.prepare('SELECT COUNT(*) AS count FROM memory_session_prompts').get() as { count: number };
    expect(sessionCount.count).toBe(1);
    expect(promptCount.count).toBe(1);
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

  it('uses explicit include_sessions to override configured include_sessions', async () => {
    const { details } = await runMemoryExportTool({ backups: { include_sessions: true } }, { include_sessions: false });
    const text = fs.readFileSync(details.path, 'utf8');
    expect(JSON.parse(text.split('\n')[0]).includes_sessions).toBe(false);
    expect(text).not.toContain('configured backup prompt export');
  });

  it('uses configured include_sessions when the tool param is omitted', async () => {
    const { details } = await runMemoryExportTool({ backups: { include_sessions: true } });
    const text = fs.readFileSync(details.path, 'utf8');
    expect(JSON.parse(text.split('\n')[0]).includes_sessions).toBe(true);
    expect(text).toContain('configured backup prompt export');
  });

  it('keeps session/prompt export disabled by default', async () => {
    const { details } = await runMemoryExportTool();
    const text = fs.readFileSync(details.path, 'utf8');
    expect(JSON.parse(text.split('\n')[0]).includes_sessions).toBe(false);
    expect(text).not.toContain('configured backup prompt export');
  });

  it('uses git.sync.export to include or exclude git memory records from configured exports', async () => {
    const disabled = await runMemoryExportTool({ git: { enabled: true, sync: { export: false } } });
    const disabledText = fs.readFileSync(disabled.details.path, 'utf8');
    expect(disabledText).toContain('automatic mirror backup export memory');
    expect(disabledText).not.toContain('export git commit memory');
    expect(disabled.details.includes_git).toBe(false);

    const enabled = await runMemoryExportTool({ git: { enabled: true, sync: { export: true } } });
    const enabledText = fs.readFileSync(enabled.details.path, 'utf8');
    expect(enabledText).toContain('automatic mirror backup export memory');
    expect(enabledText).toContain('export git commit memory');
    expect(enabled.details.includes_git).toBe(true);
  });

  it('uses git.sync.import to include or skip git memory records from configured imports', async () => {
    const out = createGitMemoryBackup();
    const { details: disabled } = await runMemoryImportTool({ git: { enabled: true, sync: { import: false } }, import: { mode: 'merge', on_conflict: 'keep_local' } }, { path: out });
    expect(disabled.inserted).toBeGreaterThan(0);
    expect(disabled.skipped_git).toBeGreaterThan(0);
    expect(disabled.seen_by_table.memories).toBeGreaterThan(disabled.inserted_by_table.memories);

    const { details: enabled } = await runMemoryImportTool({ git: { enabled: true, sync: { import: true } }, import: { mode: 'merge', on_conflict: 'keep_local' } }, { path: out });
    expect(enabled.skipped_git).toBe(0);
    expect(enabled.inserted_by_table.memories).toBeGreaterThanOrEqual(2);
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
    expect(result.mode).toBe('mirror');
    expect(fs.readFileSync(out, 'utf8')).not.toContain(mem.id);
  });

  it('merge export preserves existing backup rows that are missing locally', () => {
    const d = db(), c = project();
    const preserved = addMemory(d, { scope: 'project', kind: 'note', content: 'row preserved by merge backup mode' }, c).memory;
    const current = addMemory(d, { scope: 'project', kind: 'note', content: 'row still present in local db' }, c).memory;
    const out = path.join(tmp, 'merge.jsonl');
    exportMemory(d, { path: out, mode: 'mirror' });

    d.prepare('DELETE FROM memories WHERE id=?').run(preserved.id);
    const result = exportMemory(d, { path: out, mode: 'merge' });
    const lines = fs.readFileSync(out, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const meta = lines[0];
    const text = JSON.stringify(lines);

    expect(result.mirror).toBe(false);
    expect(result.mode).toBe('merge');
    expect(meta.mode).toBe('merge');
    expect(text).toContain(preserved.id);
    expect(text).toContain(current.id);
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
    exportMemory(d, { path: out, context: ca, include_sessions: true });
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
    const { details } = await runMemoryImportTool({}, { path: out });
    expect(details.mode).toBe('dry_run');
    expect(details.on_conflict).toBe('mark_conflict');
    expect(details.inserted).toBe(0);
    expect(details.seen).toBeGreaterThan(0);
  });

  it('uses configured memory_import defaults when params are omitted', async () => {
    const out = createMemoryBackup();
    const { details } = await runMemoryImportTool({ import: { mode: 'merge', on_conflict: 'keep_local' } }, { path: out });
    expect(details.mode).toBe('merge');
    expect(details.on_conflict).toBe('keep_local');
    expect(details.inserted).toBeGreaterThan(0);
  });

  it('lets explicit memory_import params override configured defaults', async () => {
    const out = createMemoryBackup();
    const { details } = await runMemoryImportTool({ import: { mode: 'merge', on_conflict: 'keep_local' } }, { path: out, mode: 'dry_run', on_conflict: 'mark_conflict' });
    expect(details.mode).toBe('dry_run');
    expect(details.on_conflict).toBe('mark_conflict');
    expect(details.inserted).toBe(0);
  });

  it('does not break memory_import on invalid configured defaults and keeps warnings visible to the agent', async () => {
    const out = createMemoryBackup();
    const { result, details } = await runMemoryImportTool({ import: { mode: 'apply', on_conflict: 'explode' } }, { path: out });
    expect(details.mode).toBe('dry_run');
    expect(details.on_conflict).toBe('mark_conflict');
    expect(details.inserted).toBe(0);
    expect(details.warnings.join('\n')).toContain('invalid import.mode');
    expect(details.warnings.join('\n')).toContain('invalid import.on_conflict');
    expect(result.content[0].text).toContain('warnings=');
    expect(result.content[0].text).toContain('invalid import.mode');
    expect(result.content[0].text).toContain('invalid import.on_conflict');
  });

  it('memory consolidate/import/export/sync tool text exposes bounded review details and counts', async () => {
    const dbPath = path.join(tmp, `review-tools-${Date.now()}-${Math.random()}.sqlite`);
    const projectDir = path.join(tmp, `review-tools-project-${Date.now()}-${Math.random()}`);
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Review Tools App', enabled: true, git: { enabled: true } }));
    const d = openMemoryDb(dbPath);
    migrate(d);
    const context = resolveMemoryContext(projectDir, os.homedir(), {});
    const duplicateA = addMemory(d, { scope: 'project', kind: 'progress', title: 'same thing', content: 'first duplicate review candidate' }, context).memory;
    const duplicateB = addMemory(d, { scope: 'project', kind: 'progress', title: 'same thing', content: 'second duplicate review candidate' }, context).memory;
    d.prepare("UPDATE memories SET sync_status='pending' WHERE id=?").run(duplicateA.id);
    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const tools = new Map<string, any>();
    extension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: () => {}, on: () => {} });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;

    const consolidate = await tools.get('memory_consolidate').execute('tool-call', { kind: 'progress', dry_run: true }, undefined, undefined, { cwd: projectDir });
    expect(consolidate.content[0].text).toContain(duplicateA.id);
    expect(consolidate.content[0].text).toContain(duplicateB.id);
    expect(consolidate.content[0].text).toContain('same thing');

    const sync = await tools.get('memory_sync_status').execute('tool-call', {}, undefined, undefined, { cwd: projectDir });
    expect(sync.content[0].text).toContain('memories');
    expect(sync.content[0].text).toContain('pending=1');

    const exportResult = await tools.get('memory_export').execute('tool-call', {}, undefined, undefined, { cwd: projectDir });
    expect(exportResult.content[0].text).toContain(exportResult.details.path);
    expect(exportResult.content[0].text).toContain(`rows=${exportResult.details.rows}`);

    const importSource = db();
    const importSourceContext = project(path.join(tmp, `import-source-${Date.now()}-${Math.random()}`));
    const importMemoryRow = addMemory(importSource, { scope: 'project', kind: 'note', title: 'import conflict note', content: 'import conflict note body' }, importSourceContext).memory;
    const importBackup = path.join(tmp, `import-review-${Date.now()}-${Math.random()}.jsonl`);
    exportMemory(importSource, { path: importBackup, context: importSourceContext });
    const importedRawRow = importSource.prepare('SELECT * FROM memories WHERE id=?').get(importMemoryRow.id) as Record<string, unknown>;
    const memoryColumns = Object.keys(importedRawRow);
    d.prepare(`INSERT INTO memories(${memoryColumns.join(',')}) VALUES(${memoryColumns.map(() => '?').join(',')})`).run(...memoryColumns.map((column) => importedRawRow[column]) as any[]);
    fs.mkdirSync(path.join(projectDir, '.pi', 'mempry-backups'), { recursive: true });
    fs.copyFileSync(importBackup, path.join(projectDir, '.pi', 'mempry-backups', 'memory-backup.jsonl'));

    const imported = await tools.get('memory_import').execute('tool-call', { mode: 'dry_run', on_conflict: 'mark_conflict' }, undefined, undefined, { cwd: projectDir });
    expect(imported.content[0].text).toContain('conflicts=1');
    expect(imported.content[0].text).toContain(importMemoryRow.id);
    expect(imported.content[0].text).toContain('kept_local');
  });

  it('extracts file and command entities when adding memories', () => {
    const d = db(), c = project();
    const mem = addMemory(d, { scope: 'project', kind: 'command', content: 'run npm test after editing src/memory-store.ts' }, c).memory;
    const entities = d.prepare('SELECT entity_type, name FROM memory_entities WHERE memory_id=? ORDER BY entity_type, name').all(mem.id) as any[];
    expect(entities.some((e) => e.entity_type === 'command' && e.name === 'npm test')).toBe(true);
    expect(entities.some((e) => e.entity_type === 'file' && e.name === 'src/memory-store.ts')).toBe(true);
  });
});
