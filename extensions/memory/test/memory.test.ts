import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import extension from '../index.js';
import { resolveBackupPath, resolveDbPath, readProjectMemoryConfig } from '../src/config.js';
import { openMemoryDb } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { resolveMemoryContext, parseGitRemote } from '../src/context.js';
import { generateMemoryId } from '../src/ids.js';
import { addMemory, getMemory, getMemoryRaw, updateMemory, archiveMemory } from '../src/memory-store.js';
import { searchMemory } from '../src/search.js';
import { startMemorySession, addSessionPrompt, finishMemorySession } from '../src/sessions.js';
import { resolveCloudRuntime } from '../src/cloud.js';
import { containsSecret } from '../src/security.js';
import { buildConversationText, buildHeuristicSessionSummary, buildSemanticSessionSummaryPrompt, extractConversationFacts } from '../src/session-summary.js';
import { autoUpdateProjectProfileFromSession, ensureProjectProfile, updateProjectProfile } from '../src/project-profile.js';
import { consolidateMemories } from '../src/consolidation.js';
import { exportMemory, importMemory } from '../src/export-import.js';
import { getSyncStatus } from '../src/sync-status.js';
import { migrateProjectCanonicals } from '../src/project-migration.js';
import { renderMemoryToolResult } from '../src/render.js';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-memory-test-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function db() { const d = openMemoryDb(':memory:'); migrate(d); return d; }
function project(dir = tmp) { fs.mkdirSync(path.join(dir, '.pi'), { recursive: true }); fs.writeFileSync(path.join(dir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'My App' })); return resolveMemoryContext(dir, os.homedir(), {}); }

describe('extension setup', () => {
  it('exports a pi extension function and registers tools/commands', () => {
    const tools: string[] = [], commands: string[] = [], events: string[] = [];
    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = path.join(tmp, 'memory.sqlite');
    extension({ registerTool: (t: any) => tools.push(t.name), registerCommand: (n: string) => commands.push(n), on: (n: string) => events.push(n) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
    expect(tools).toContain('memory_context');
    expect(tools).toContain('memory_add');
    expect(tools).toContain('memory_export');
    expect(tools).toContain('memory_project_profile');
    expect(tools).toContain('memory_consolidate');
    expect(tools).toContain('memory_sync_status');
    expect(tools).toContain('memory_migrate_project');
    expect(commands).toContain('memory-status');
    expect(commands).toContain('memory-sync-status');
    expect(commands).toContain('memory-migrate-project');
    expect(events).toContain('before_agent_start');
  });
  it('memory search and list tool results render compact by default and expand details on demand', () => {
    const result = {
      content: [{ type: 'text', text: 'Found 1 memory result(s).\n- mem_1 · memory · project/app · decision · compact title — compact snippet' }],
      details: {
        results: [{
          id: 'mem_1',
          type: 'memory',
          scope: 'project',
          project_name: 'app',
          kind: 'decision',
          title: 'compact title',
          snippet: 'expanded snippet with enough detail to show only when expanded',
          importance: 0.8,
          confidence: 0.95,
          updated_at: '2026-01-01T00:00:00.000Z',
        }],
      },
    };
    const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

    const compact = renderMemoryToolResult(result, { expanded: false, isPartial: false }, theme).render(120).join('\n');
    const expanded = renderMemoryToolResult(result, { expanded: true, isPartial: false }, theme).render(120).join('\n');

    expect(compact).toContain('memory · 1 result');
    expect(compact).not.toContain('mem_1');
    expect(compact).toContain('ctrl+o expand');
    expect(compact).not.toContain('importance: 0.8');
    expect(expanded).toContain('memory · 1 result');
    expect(expanded).not.toContain('id: mem_1');
    expect(expanded).toContain('importance: 0.8');
    expect(expanded).toContain('expanded snippet');
    expect(expanded).toContain('ctrl+o collapse');
  });

  it('memory tools register compact expandable result renderers', () => {
    const tools = new Map<string, any>();
    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = path.join(tmp, 'renderers.sqlite');
    extension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: () => {}, on: () => {} });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;

    for (const name of ['memory_search', 'memory_list', 'memory_get', 'memory_recall', 'memory_project_profile']) {
      expect(tools.get(name)?.renderResult).toBeTypeOf('function');
    }
  });

  it('memory search and list tool text include compact result ids', async () => {
    const dbPath = path.join(tmp, 'tool-ids.sqlite');
    const projectDir = path.join(tmp, 'tool-project');
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Tool Ids App' }));
    const d = openMemoryDb(dbPath);
    migrate(d);
    const context = resolveMemoryContext(projectDir, os.homedir(), {});
    const memory = addMemory(d, { scope: 'project', kind: 'decision', title: 'search ids decision', content: 'memory search ids should be visible', importance: 0.8 }, context).memory;
    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const tools = new Map<string, any>();
    extension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: () => {}, on: () => {} });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;

    const search = await tools.get('memory_search').execute('search-call', { query: 'search ids', limit: 5 }, undefined, undefined, { cwd: projectDir });
    const list = await tools.get('memory_list').execute('list-call', { scope: 'project', limit: 5 }, undefined, undefined, { cwd: projectDir });

    expect(search.content[0].text).toContain(memory.id);
    expect(search.content[0].text).toContain('decision');
    expect(list.content[0].text).toContain(memory.id);
    expect(list.content[0].text).toContain('search ids decision');
  });

  it('lifecycle shutdown writes summary metadata and auto-updates project profile', async () => {
    const dbPath = path.join(tmp, 'lifecycle.sqlite');
    const projectDir = path.join(tmp, 'project');
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Lifecycle App' }));
    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const handlers = new Map<string, Function>();
    extension({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
    const ctx = {
      cwd: projectDir,
      ui: { setStatus: () => {}, notify: () => {} },
      sessionManager: {
        getSessionFile: () => path.join(tmp, 'pi-session.json'),
        getBranch: () => [
          { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Add lifecycle tests' }] } },
          { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'npm test' } }, { type: 'toolCall', name: 'edit', arguments: { path: 'src/lifecycle.ts' } }] } },
        ],
      },
    };
    await handlers.get('session_start')?.({}, ctx);
    await handlers.get('before_agent_start')?.({ prompt: 'Add lifecycle tests' }, ctx);
    await handlers.get('session_shutdown')?.({ reason: 'quit' }, ctx);
    const d = openMemoryDb(dbPath);
    const session = d.prepare('SELECT summary, metadata_json FROM memory_sessions ORDER BY started_at DESC LIMIT 1').get() as any;
    expect(session.summary).toContain('summary:');
    expect(JSON.parse(session.metadata_json).summary_source).toBe('heuristic');
    const profile = d.prepare("SELECT content FROM memories WHERE kind='project_profile' LIMIT 1").get() as any;
    expect(profile.content).toContain('recent session updates');
    expect(profile.content).toContain('npm test');
  });
});

describe('config', () => {
  it('resolves db path from env precedence', () => {
    expect(resolveDbPath({ PI_MEMORY_DB_PATH: '/x/db.sqlite' } as any)).toBe('/x/db.sqlite');
    expect(resolveDbPath({ PI_MEMORY_HOME: '/x/home' } as any)).toBe('/x/home/memory.sqlite');
    expect(resolveDbPath({ XDG_DATA_HOME: '/xdg' } as any)).toBe('/xdg/pi/memory/memory.sqlite');
  });
  it('reads cloud config with env defaults and warnings', () => {
    fs.mkdirSync(path.join(tmp, '.pi'));
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', cloud: { enabled: true, organization_id: 'o', actor_id: 'a', remote_project_id: 'p' } }));
    const cfg = readProjectMemoryConfig(tmp, {});
    expect(cfg.cloud.url_env).toBe('PI_MEMORY_CLOUD_URL');
    expect(cfg.warnings.join('\n')).toContain('PI_MEMORY_CLOUD_URL');
  });
  it('reads backup path config as a normalized relative path and rejects unsafe paths', () => {
    fs.mkdirSync(path.join(tmp, '.pi'));
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', backups: { path: 'custom//memory.jsonl', include_prompts: true } }));
    const cfg = readProjectMemoryConfig(tmp, {});
    expect(cfg.backups.path).toBe('custom/memory.jsonl');
    expect(cfg.backups.include_prompts).toBe(true);
    expect(resolveBackupPath(tmp, cfg.backups.path)).toBe(path.join(tmp, 'custom', 'memory.jsonl'));

    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', backups: { path: '/tmp/memory.jsonl' } }));
    const invalid = readProjectMemoryConfig(tmp, {});
    expect(invalid.backups.path).toBeUndefined();
    expect(invalid.warnings.join('\n')).toContain('absolute paths are not allowed');
  });
  it('reads import defaults and ignores invalid import config defensively', () => {
    fs.mkdirSync(path.join(tmp, '.pi'));
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', import: { mode: 'merge', on_conflict: 'keep_local' } }));
    const cfg = readProjectMemoryConfig(tmp, {});
    expect(cfg.import).toEqual({ mode: 'merge', on_conflict: 'keep_local' });

    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', import: { mode: 'apply', on_conflict: 'explode' } }));
    const invalid = readProjectMemoryConfig(tmp, {});
    expect(invalid.import).toEqual({ mode: undefined, on_conflict: undefined });
    expect(invalid.warnings.join('\n')).toContain('invalid import.mode');
    expect(invalid.warnings.join('\n')).toContain('invalid import.on_conflict');
  });
});

describe('context', () => {
  it('resolves home as general', () => {
    const c = resolveMemoryContext(tmp, tmp, {});
    expect(c.scope).toBe('general');
    expect(c.project_id).toBeNull();
  });
  it('memory.json overrides project identity', () => {
    const c = project();
    expect(c.scope).toBe('project');
    expect(c.project_id).toBe('project:my-app');
    expect(c.source).toBe('.pi/memory.json');
  });
  it('parses git remotes', () => {
    expect(parseGitRemote('git@github.com:j0k3r/j0k3r-pi.git')?.projectId).toBe('git:github.com/j0k3r/j0k3r-pi');
    expect(parseGitRemote('https://github.com/j0k3r/j0k3r-pi.git')?.projectName).toBe('j0k3r-pi');
  });
});

describe('store/search/sessions', () => {
  it('generates canonical memory ids', () => {
    expect(generateMemoryId({ userSlug: 'J0 K3R', scope: 'project', projectName: 'My App', timeMs: 1 })).toMatch(/^mem_j0-k3r_my-app_1_/);
  });
  it('adds, gets, updates and archives project memory', () => {
    const d = db(), c = project();
    const added = addMemory(d, { scope: 'project', kind: 'decision', content: 'Use SQLite FTS5 for local memory', tags: ['sqlite'] }, c).memory;
    expect(added.project_name).toBe('My App');
    expect(added.sync_status).toBe('local');
    expect(getMemory(d, added.id)?.access_count).toBe(1);
    const updated = updateMemory(d, added.id, { content: 'Use SQLite and FTS5 for local memory' }, c);
    expect(updated.version).toBe(2);
    expect(archiveMemory(d, added.id, c).status).toBe('archived');
  });
  it('searches compact active memories and excludes archived', () => {
    const d = db(), c = project();
    const a = addMemory(d, { scope: 'project', kind: 'command', content: 'Run tests with npm test' }, c).memory;
    addMemory(d, { scope: 'general', kind: 'preference', content: 'User prefers Spanish concise answers' }, c);
    archiveMemory(d, a.id, c);
    const r = searchMemory(d, { query: 'Spanish', limit: 10 }, c);
    expect(r.results.some((x: any) => x.scope === 'general')).toBe(true);
    expect(r.results.some((x: any) => x.id === a.id)).toBe(false);
    expect(JSON.stringify(r.results)).not.toContain('Run tests with npm test');
  });

  it('finds normal durable memories below importance 1 unless min_importance is explicit', () => {
    const d = db(), c = project();
    const added = addMemory(d, { scope: 'project', kind: 'progress', title: 'subagents optimization checkpoint', content: 'subagents render optimization completed', importance: 0.8 }, c).memory;

    const defaultSearch = searchMemory(d, { query: 'subagents', limit: 10 }, c);
    expect(defaultSearch.results.map((x: any) => x.id)).toContain(added.id);

    const strictSearch = searchMemory(d, { query: 'subagents', limit: 10, min_importance: 1 }, c);
    expect(strictSearch.results.map((x: any) => x.id)).not.toContain(added.id);
  });
  it('stores sessions and prompts for audit without normal prompt search', () => {
    const d = db(), c = project();
    const s: any = startMemorySession(d, { title: 'Work' }, c);
    const p: any = addSessionPrompt(d, { session_id: s.id, role: 'user', prompt: 'Important private prompt text', prompt_index: 1 }, c);
    expect(p.metadata_json).toContain('audit_only');
    const done = finishMemorySession(d, { session_id: s.id, summary: 'Did memory work', learned: 'FTS works', architectural_decisions: ['Keep searches local'] }, c);
    expect(done.added_memory_ids.length).toBe(1);
    expect((done.session as any).status).toBe('completed');
    expect(searchMemory(d, { query: 'private prompt', include_prompts: false }, c).results.length).toBe(0);
  });

  it('keeps session and prompt search scoped to the current project', () => {
    const d = db();
    const aDir = path.join(tmp, 'a'), bDir = path.join(tmp, 'b');
    fs.mkdirSync(path.join(aDir, '.pi'), { recursive: true });
    fs.mkdirSync(path.join(bDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(aDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'App A' }));
    fs.writeFileSync(path.join(bDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'App B' }));
    const ca = resolveMemoryContext(aDir, os.homedir(), {});
    const cb = resolveMemoryContext(bDir, os.homedir(), {});
    const sa: any = startMemorySession(d, { title: 'blue session' }, ca);
    addSessionPrompt(d, { session_id: sa.id, role: 'user', prompt: 'blue prompt text', prompt_index: 1 }, ca);
    finishMemorySession(d, { session_id: sa.id, summary: 'blue session summary' }, ca);
    expect(searchMemory(d, { query: 'blue', types: ['session', 'prompt'], include_prompts: true, limit: 10 }, ca).results.length).toBeGreaterThan(0);
    expect(searchMemory(d, { query: 'blue', types: ['session', 'prompt'], include_prompts: true, limit: 10 }, cb).results.length).toBe(0);
  });

  it('can recall recent current-session prompts for session-end checkpoints even without query match', () => {
    const d = db(), c = project();
    const s: any = startMemorySession(d, { title: 'Current Work' }, c);
    addSessionPrompt(d, { session_id: s.id, role: 'user', prompt: 'we agreed to keep the orchestrator in control', prompt_index: 1 }, c);
    const result = searchMemory(d, { query: 'validations todos learnings', current_session_id: s.id, current_session_only: true, include_prompts: true, types: ['prompt'], limit: 5 }, c);
    expect(result.results.map((r: any) => r.type)).toEqual(['prompt']);
    expect(result.results[0].snippet).toContain('orchestrator');
  });
  it('keeps project isolation in end-to-end search', () => {
    const d = db();
    const aDir = path.join(tmp, 'a'), bDir = path.join(tmp, 'b');
    fs.mkdirSync(path.join(aDir, '.pi'), { recursive: true });
    fs.mkdirSync(path.join(bDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(aDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'App A' }));
    fs.writeFileSync(path.join(bDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'App B' }));
    const ca = resolveMemoryContext(aDir, os.homedir(), {});
    const cb = resolveMemoryContext(bDir, os.homedir(), {});
    addMemory(d, { scope: 'project', kind: 'decision', content: 'App A uses a blue adapter' }, ca);
    expect(searchMemory(d, { query: 'blue adapter', limit: 10 }, ca).results.length).toBe(1);
    expect(searchMemory(d, { query: 'blue adapter', limit: 10 }, cb).results.length).toBe(0);
  });
});

describe('session summaries', () => {
  it('redacts secrets from semantic summary conversation text', () => {
    const conversation = buildConversationText([
      { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'token=supersecretvalue12345 keep this private' }] } },
    ]);
    expect(conversation).toContain('[REDACTED_SECRET]');
    expect(conversation).not.toContain('supersecretvalue12345');
  });

  it('builds semantic summary prompts with sdd-friendly structure', () => {
    const conversation = buildConversationText([
      { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Improve session summaries for SDD' }] } },
      { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'read', arguments: { path: 'src/lifecycle.ts' } }] } },
    ]);
    expect(conversation).toContain('user: Improve session summaries');
    expect(conversation).toContain('tool read called');
    const prompt = buildSemanticSessionSummaryPrompt(conversation, { reason: 'quit', promptCount: 1, durableMemories: [], decisions: [], todos: [], progress: [], validations: [] });
    expect(prompt).toContain('what changed:');
    expect(prompt).toContain('memory candidates:');
    expect(prompt).toContain('prefer semantic facts');
    const facts = extractConversationFacts([{ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'npm test' } }, { type: 'toolCall', name: 'edit', arguments: { path: 'src/a.ts' } }] } }]);
    expect(facts.commands).toContain('npm test');
    expect(facts.files).toContain('src/a.ts');
  });
  it('keeps heuristic summary as a structured fallback', () => {
    const result = buildHeuristicSessionSummary({
      reason: 'quit',
      promptCount: 2,
      durableMemories: [{ kind: 'decision', title: 'semantic session summaries' }],
      decisions: [{ title: 'semantic session summaries' }],
      todos: [{ title: 'add more tests' }],
      progress: [],
      validations: ['npm test'],
    });
    expect(result.summary).toContain('summary:');
    expect(result.summary).toContain('decisions made: semantic session summaries');
    expect(result.summary).toContain('validations: npm test');
  });
});

describe('profile/consolidation/export/sync', () => {
  it('ensures and updates project profile', () => {
    const d = db(), c = project();
    const ensured = ensureProjectProfile(d, c);
    expect(ensured.created).toBe(true);
    const updated = updateProjectProfile(d, c, 'type: project_profile\ndetails: tests use npm test');
    expect(updated.version).toBe(2);
  });
  it('auto-updates project profile from durable session facts once per session', () => {
    const d = db(), c = project();
    const result = autoUpdateProjectProfileFromSession(d, c, {
      session_id: 'session_test_1',
      summary: 'summary:\n  what changed: added project profile auto update.\n  validations: npm test passed.\n  open todos: refine browser.',
      learned: 'reusable learnings:\n- profile updates should be conservative.',
      decisions: ['profile auto update is conservative'],
      validations: ['npm test'],
      filesTouched: ['src/project-profile.ts'],
    });
    expect(result.updated).toBe(true);
    expect(result.profile?.content).toContain('recent session updates');
    expect(result.profile?.content).toContain('profile auto update is conservative');
    const again = autoUpdateProjectProfileFromSession(d, c, { session_id: 'session_test_1', summary: 'summary:\n  what changed: duplicate' });
    expect(again.updated).toBe(false);
    expect(again.reason).toContain('already applied');
  });
  it('does not auto-update project profile outside project context or without durable facts', () => {
    const d = db();
    const general = resolveMemoryContext(tmp, tmp, {});
    expect(autoUpdateProjectProfileFromSession(d, general, { session_id: 's', summary: 'minor chat' }).updated).toBe(false);
    const c = project();
    expect(autoUpdateProjectProfileFromSession(d, c, { session_id: 's2', summary: 'minor chat' }).updated).toBe(false);
  });
  it('finds duplicate consolidation candidates in dry run', () => {
    const d = db(), c = project();
    addMemory(d, { scope: 'project', kind: 'progress', title: 'same thing', content: 'first durable fact' }, c);
    addMemory(d, { scope: 'project', kind: 'progress', title: 'same thing', content: 'second durable fact' }, c);
    const result = consolidateMemories(d, { kind: 'progress', dry_run: true }, c);
    expect(result.candidates.length).toBe(1);
    expect(result.applied.length).toBe(0);
  });
  it('exports prompts only when explicitly requested and imports dry run', () => {
    const d = db(), c = project();
    const s: any = startMemorySession(d, { title: 'Export' }, c);
    addSessionPrompt(d, { session_id: s.id, role: 'user', prompt: 'audit prompt text', prompt_index: 1 }, c);
    const noPrompts = path.join(tmp, 'no-prompts.jsonl');
    exportMemory(d, { path: noPrompts });
    expect(fs.readFileSync(noPrompts, 'utf8')).not.toContain('audit prompt text');
    const withPrompts = path.join(tmp, 'with-prompts.jsonl');
    exportMemory(d, { path: withPrompts, include_prompts: true });
    expect(fs.readFileSync(withPrompts, 'utf8')).toContain('audit prompt text');
    expect(importMemory(db(), { path: withPrompts, mode: 'dry_run' }).seen).toBeGreaterThan(0);
  });
  it('reports sync status counts', () => {
    const d = db(), c = project();
    addMemory(d, { scope: 'project', kind: 'note', content: 'local sync status item' }, c);
    const status = getSyncStatus(d, c);
    expect(status.memories.local).toBeGreaterThan(0);
  });
  it('dry-runs and applies project canonical migration across memory aliases', () => {
    const d = db();
    const canonical = project();
    const folderAlias = { ...canonical, project_id: 'project:j0k3r-pi', project_name: 'j0k3r-pi', source: 'folder' } as any;
    const gitAlias = { ...canonical, project_id: 'git:github.com/j0k3r/j0k3r-pi', project_name: 'j0k3r-pi', source: 'git_remote' } as any;
    const keepOther = { ...canonical, project_id: 'project:other-app', project_name: 'other-app', source: 'folder' } as any;
    const m1 = addMemory(d, { scope: 'project', kind: 'note', content: 'folder alias memory' }, folderAlias).memory;
    const m2 = addMemory(d, { scope: 'project', kind: 'note', content: 'git alias memory' }, gitAlias).memory;
    const m3 = addMemory(d, { scope: 'project', kind: 'note', content: 'other project memory' }, keepOther).memory;
    const s: any = startMemorySession(d, { title: 'Alias Session' }, folderAlias);
    const dry = migrateProjectCanonicals(d, canonical, { aliases: [{ project_id: folderAlias.project_id, project_name: folderAlias.project_name }, { project_id: gitAlias.project_id, project_name: gitAlias.project_name }], dry_run: true });
    expect(dry.memories_to_update).toBe(2);
    expect(dry.sessions_to_update).toBe(1);
    expect(getMemoryRaw(d, m1.id)?.project_id).toBe(folderAlias.project_id);
    const applied = migrateProjectCanonicals(d, canonical, { aliases: [{ project_id: folderAlias.project_id, project_name: folderAlias.project_name }, { project_id: gitAlias.project_id, project_name: gitAlias.project_name }], dry_run: false });
    expect(applied.updated_memories).toBe(2);
    expect(getMemoryRaw(d, m1.id)?.project_id).toBe(canonical.project_id);
    expect(getMemoryRaw(d, m2.id)?.project_name).toBe(canonical.project_name);
    expect(getMemoryRaw(d, m3.id)?.project_id).toBe(keepOther.project_id);
    const migratedSession = d.prepare('SELECT project_id, project_name FROM memory_sessions WHERE id=?').get(s.id) as any;
    expect(migratedSession.project_id).toBe(canonical.project_id);
  });

  it('does not over-migrate projects that only share an alias project_name', () => {
    const d = db();
    const canonical = project();
    const alias = { ...canonical, project_id: 'project:alias-a', project_name: 'shared-name', source: 'folder' } as any;
    const sameNameOtherId = { ...canonical, project_id: 'project:other-id', project_name: 'shared-name', source: 'folder' } as any;
    const aliased = addMemory(d, { scope: 'project', kind: 'note', content: 'aliased memory' }, alias).memory;
    const other = addMemory(d, { scope: 'project', kind: 'note', content: 'other memory' }, sameNameOtherId).memory;
    const applied = migrateProjectCanonicals(d, canonical, { aliases: [{ project_id: alias.project_id, project_name: alias.project_name }], dry_run: false });
    expect(applied.updated_memories).toBe(1);
    expect(getMemoryRaw(d, aliased.id)?.project_id).toBe(canonical.project_id);
    expect(getMemoryRaw(d, other.id)?.project_id).toBe(sameNameOtherId.project_id);
  });
});

describe('cloud/security', () => {
  it('cloud enabled marks project memories pending and resolves runtime', () => {
    fs.mkdirSync(path.join(tmp, '.pi'));
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Cloud App', cloud: { enabled: true, organization_id: 'org', actor_id: 'actor', remote_project_id: 'proj' } }));
    const c = resolveMemoryContext(tmp, os.homedir(), { PI_MEMORY_CLOUD_URL: 'https://x', PI_MEMORY_CLOUD_TOKEN: 't' });
    expect(resolveCloudRuntime(c, { PI_MEMORY_CLOUD_URL: 'https://x', PI_MEMORY_CLOUD_TOKEN: 't' }).ready).toBe(true);
    const m = addMemory(db(), { scope: 'project', kind: 'note', content: 'Cloud pending memory' }, c).memory;
    expect(m.sync_status).toBe('pending');
  });
  it('detects obvious secrets', () => {
    expect(containsSecret('PASSWORD=supersecretvalue')).toBe(true);
  });
});
