import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
import { renderMemoryContextMessage, renderMemoryToolResult } from '../src/render.js';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-memory-test-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function db() { const d = openMemoryDb(':memory:'); migrate(d); return d; }
function project(dir = tmp) { fs.mkdirSync(path.join(dir, '.pi'), { recursive: true }); fs.writeFileSync(path.join(dir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'My App', enabled: true, git: { enabled: true } })); return resolveMemoryContext(dir, os.homedir(), {}); }
function registerMemoryToolHarness(name = 'Commit Tool App') {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dbPath = path.join(tmp, `${slug}.sqlite`);
  const projectDir = path.join(tmp, `${slug}-project`);
  fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: name, enabled: true, git: { enabled: true } }));
  const d = openMemoryDb(dbPath);
  migrate(d);
  const old = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;
  const tools = new Map<string, any>();
  extension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: () => {}, registerMessageRenderer: () => {}, on: () => {} });
  if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
  return { d, dbPath, projectDir, tools };
}

function git(projectDir: string, args: string[]) {
  return execFileSync('git', args, { cwd: projectDir, encoding: 'utf8' }).trim();
}

describe('extension setup', () => {
  it('exports a pi extension function and registers tools/commands/renderers', () => {
    const tools: string[] = [], commands: string[] = [], events: string[] = [], renderers: string[] = [];
    fs.mkdirSync(path.join(tmp, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Test App', enabled: true }));
    const oldCwd = process.cwd();
    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = path.join(tmp, 'memory.sqlite');
    process.chdir(tmp);
    try {
      extension({ registerTool: (t: any) => tools.push(t.name), registerCommand: (n: string) => commands.push(n), registerMessageRenderer: (n: string) => renderers.push(n), on: (n: string) => events.push(n) });
      expect(tools).toContain('memory_context');
      expect(tools).toContain('memory_add');
      expect(tools).toContain('memory_export');
      expect(tools).toContain('memory_project_profile');
      expect(tools).toContain('memory_consolidate');
      expect(tools).toContain('memory_sync_status');
      expect(commands).toContain('memory-status');
      expect(commands).toContain('memory-sync-status');
      expect(events).toContain('before_agent_start');
      expect(renderers).toContain('memory-context');
    } finally {
      process.chdir(oldCwd);
      if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
    }
  });
  it('memory context messages render compact by default and expand full agent instructions on demand', () => {
    const content = [
      'Pi Memory Extension is active. Treat it as the agent persistent brain.',
      'Current memory project: j0k3r-pi (project:j0k3r-pi).',
      'Behavior rules:',
      '- Use memory intelligently, not mechanically: first rely on startup brain context, loaded skill content, and current conversation.',
      '- Store durable reusable knowledge with memory_add: user preferences, confirmed project decisions, workflow/policy decisions, commands, constraints, architecture, bugs, todos, learnings, progress, and project_profile updates.',
      '',
      'Memory session: session_1234567890abcdef',
      '',
      'Startup brain context (recent memories and session summaries):',
      '- memory · project/j0k3r-pi · project_profile · j0k3r-pi project profile',
      '- memory · project/j0k3r-pi · workflow · policy-sensitive changes require explicit workflow routing',
    ].join('\n');
    const theme = { fg: (_name: string, text: string) => text, bg: (name: string, text: string) => `[${name}]${text}`, bold: (text: string) => text };

    const compactLines = renderMemoryContextMessage({ customType: 'memory-context', content }, { expanded: false }, theme).render(120);
    const expandedLines = renderMemoryContextMessage({ customType: 'memory-context', content }, { expanded: true }, theme).render(120);
    const compact = compactLines.join('\n');
    const expanded = expandedLines.join('\n');

    expect(compact).toContain('[toolSuccessBg]');
    expect(compactLines[0]).not.toContain('memory_context');
    expect(compactLines[1]).toContain('memory_context');
    expect(compactLines.at(-1)).not.toContain('memory');
    expect(compact).toContain('memory_context');
    expect(compact).toContain('j0k3r-pi');
    expect(compact).toContain('2 startup items');
    expect(compact).toContain('ctrl+o expand');
    expect(compact).not.toContain('Behavior rules:');
    expect(compact).not.toContain('Store durable reusable knowledge');
    expect(expanded).toContain('Behavior rules:');
    expect(expanded).toContain('Store durable reusable knowledge');
    expect(expanded).toContain('ctrl+o collapse');
  });

  it('does not register when disabled from config', () => {
    const tools: string[] = [], commands: string[] = [];
    const oldCwd = process.cwd();
    const old = process.env.PI_MEMORY_DB_PATH;
    try {
      fs.mkdirSync(path.join(tmp, '.pi'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Disabled App', enabled: false }));
      process.chdir(tmp);
      process.env.PI_MEMORY_DB_PATH = path.join(tmp, 'disabled-memory.sqlite');
      extension({ registerTool: (t: any) => tools.push(t.name), registerCommand: (n: string) => commands.push(n), registerMessageRenderer: () => {}, on: () => {} });
      expect(tools).toEqual([]);
      expect(commands).toEqual([]);
    } finally {
      process.chdir(oldCwd);
      if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;
    }
  });

  it('startup memory context instructs the agent consistently with agent and persistent-memory policy', async () => {
    const dbPath = path.join(tmp, 'policy-context.sqlite');
    const projectDir = path.join(tmp, 'policy-project');
    fs.mkdirSync(path.join(projectDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Policy Project', enabled: true }));
    const old = process.env.PI_MEMORY_DB_PATH;
    process.env.PI_MEMORY_DB_PATH = dbPath;
    const handlers = new Map<string, Function>();
    extension({ registerTool: () => {}, registerCommand: () => {}, registerMessageRenderer: () => {}, on: (name: string, handler: Function) => handlers.set(name, handler) });
    if (old === undefined) delete process.env.PI_MEMORY_DB_PATH; else process.env.PI_MEMORY_DB_PATH = old;

    const ctx = { cwd: projectDir, ui: { setStatus: () => {}, notify: () => {} }, sessionManager: { getSessionFile: () => path.join(tmp, 'pi-session.json') } };
    await handlers.get('session_start')?.({}, ctx);
    const injected = await handlers.get('before_agent_start')?.({ prompt: 'Review memory policy' }, ctx);
    const content = String(injected?.message?.content ?? '');

    expect(content).toContain('Treat it as the agent persistent brain');
    expect(content).toContain('first rely on startup brain context, loaded skill content, and current conversation');
    expect(content).toContain('memory_search or memory_recall only when persistent context is missing, stale, ambiguous, or needed for a decision');
    expect(content).toContain('inspect the current project profile early with memory_project_profile get unless startup context already includes an up-to-date profile');
    expect(content).toContain('Store durable reusable knowledge with memory_add');
    expect(content).toContain('Ask before saving global or general user preferences, large project_profile rewrites, contradictions, or policy changes that affect future agents');
    expect(content).not.toContain('precommit checkpoint');
    expect(content).not.toContain('For user-requested commits');
    expect(content).toContain('memory_search returns compact candidates; use memory_get only when full content is needed');
    expect(content).toContain('Use memory_archive instead of deleting obsolete memories');
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
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', backups: { path: 'custom//memory.jsonl', include_sessions: true } }));
    const cfg = readProjectMemoryConfig(tmp, {});
    expect(cfg.backups.path).toBe('custom/memory.jsonl');
    expect(cfg.backups.include_sessions).toBe(true);
    expect(resolveBackupPath(tmp, cfg.backups.path)).toBe(path.join(tmp, 'custom', 'memory.jsonl'));

    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', backups: { path: '/tmp/memory.jsonl' } }));
    const invalid = readProjectMemoryConfig(tmp, {});
    expect(invalid.backups.path).toBeUndefined();
    expect(invalid.warnings.join('\n')).toContain('absolute paths are not allowed');
  });
  it('supports legacy include_prompts as fallback for include_sessions with deprecation warning', () => {
    fs.mkdirSync(path.join(tmp, '.pi'));
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', backups: { include_prompts: true } }));
    const cfg = readProjectMemoryConfig(tmp, {});
    expect(cfg.backups.include_sessions).toBe(true);
    expect(cfg.warnings.join('\n')).toContain('deprecated');

    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', backups: { include_sessions: false, include_prompts: true } }));
    const cfgAuthoritative = readProjectMemoryConfig(tmp, {});
    expect(cfgAuthoritative.backups.include_sessions).toBe(false);
    expect(cfgAuthoritative.warnings.join('\n')).toContain('authoritative');
  });
  it('reads enabled flag defaults and validates non-boolean values', () => {
    fs.mkdirSync(path.join(tmp, '.pi'));
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X' }));
    expect(readProjectMemoryConfig(tmp, {}).enabled).toBe(false);

    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', enabled: true }));
    expect(readProjectMemoryConfig(tmp, {}).enabled).toBe(true);

    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', enabled: 'yes' }));
    const invalid = readProjectMemoryConfig(tmp, {});
    expect(invalid.enabled).toBe(false);
    expect(invalid.warnings.join('\n')).toContain('Ignoring invalid enabled flag');
  });

  it('reads git module config with disabled sync defaults and validates booleans defensively', () => {
    expect(readProjectMemoryConfig(tmp, {}).git).toEqual({ enabled: false, sync: { cloud: false, export: false, import: false } });

    fs.mkdirSync(path.join(tmp, '.pi'));
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({
      project_name: 'X',
      git: { enabled: true, sync: { cloud: true, export: true, import: true } },
    }));
    expect(readProjectMemoryConfig(tmp, {}).git).toEqual({ enabled: true, sync: { cloud: true, export: true, import: true } });

    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({
      project_name: 'X',
      git: { enabled: 'yes', sync: { cloud: 'yes', export: 1, import: null } },
    }));
    const invalid = readProjectMemoryConfig(tmp, {});
    expect(invalid.git).toEqual({ enabled: false, sync: { cloud: false, export: false, import: false } });
    expect(invalid.warnings.join('\n')).toContain('invalid git.enabled');
    expect(invalid.warnings.join('\n')).toContain('invalid git.sync.cloud');
    expect(invalid.warnings.join('\n')).toContain('invalid git.sync.export');
    expect(invalid.warnings.join('\n')).toContain('invalid git.sync.import');
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

  it('reads debug flag with a safe false default', () => {
    expect(readProjectMemoryConfig(tmp, {}).debug).toBe(false);
    fs.mkdirSync(path.join(tmp, '.pi'));
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X' }));
    expect(readProjectMemoryConfig(tmp, {}).debug).toBe(false);
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', debug: true }));
    expect(readProjectMemoryConfig(tmp, {}).debug).toBe(true);
    fs.writeFileSync(path.join(tmp, '.pi', 'memory.json'), JSON.stringify({ project_name: 'X', debug: 'yes' }));
    expect(readProjectMemoryConfig(tmp, {}).debug).toBe(false);
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
  it('exports sessions (and session prompts) only when explicitly requested and imports dry run', () => {
    const d = db(), c = project();
    const s: any = startMemorySession(d, { title: 'Export' }, c);
    addSessionPrompt(d, { session_id: s.id, role: 'user', prompt: 'audit prompt text', prompt_index: 1 }, c);
    const noSessions = path.join(tmp, 'no-sessions.jsonl');
    exportMemory(d, { path: noSessions });
    expect(fs.readFileSync(noSessions, 'utf8')).not.toContain('audit prompt text');
    const withSessions = path.join(tmp, 'with-sessions.jsonl');
    exportMemory(d, { path: withSessions, include_sessions: true });
    const payload = fs.readFileSync(withSessions, 'utf8');
    expect(payload).toContain('audit prompt text');
    expect(payload).toContain('"includes_sessions":true');
    expect(importMemory(db(), { path: withSessions, mode: 'dry_run' }).seen).toBeGreaterThan(0);
  });
  it('reports sync status counts', () => {
    const d = db(), c = project();
    addMemory(d, { scope: 'project', kind: 'note', content: 'local sync status item' }, c);
    const status = getSyncStatus(d, c);
    expect(status.memories.local).toBeGreaterThan(0);
  });
});

describe('commit changelog tool contracts', () => {
  it('registers commit/changelog tools and schemas without a public duplicate override', () => {
    const { tools } = registerMemoryToolHarness();

    expect(tools.has('memory_commit_record_add')).toBe(true);
    expect(tools.has('memory_record_current_commit')).toBe(true);
    expect(tools.has('memory_changelog_entry_add')).toBe(true);
    expect(tools.has('memory_commit_changelog_link')).toBe(true);
    expect(tools.has('memory_commit_changelog_search')).toBe(true);
    expect(tools.has('memory_release_candidates_search')).toBe(true);
    expect(tools.has('memory_release_notes_preview')).toBe(true);
    expect(tools.has('memory_release_record_add')).toBe(true);

    const addSchema = JSON.stringify(tools.get('memory_add')?.parameters ?? {});
    expect(addSchema).toContain('commit_record');
    expect(addSchema).toContain('changelog_entry');
    expect(addSchema).toContain('release_record');

    const searchSchema = JSON.stringify(tools.get('memory_search')?.parameters ?? {});
    expect(searchSchema).toContain('commit_record');
    expect(searchSchema).toContain('changelog_entry');
    expect(searchSchema).toContain('release_record');

    const commitSchema = JSON.stringify(tools.get('memory_commit_record_add')?.parameters ?? {});
    expect(commitSchema).toContain('repo');
    expect(commitSchema).toContain('commit_hash');
    expect(commitSchema).toContain('subject');
    expect(commitSchema).toContain('change_type');
    expect(commitSchema).toContain('release_impact');
    expect(commitSchema).toContain('functional_description');
    expect(commitSchema).toContain('changelog_bullets');
    expect(commitSchema).toContain('areas');
    expect(commitSchema).toContain('validation');
    expect(commitSchema).toContain('risks');
    expect(commitSchema).toContain('decisions');
    expect(commitSchema).toContain('sync');
    expect(commitSchema).toContain('none');
    expect(commitSchema).not.toContain('allow_duplicate');

    const currentCommitSchema = JSON.stringify(tools.get('memory_record_current_commit')?.parameters ?? {});
    expect(currentCommitSchema).toContain('functional_description');
    expect(currentCommitSchema).toContain('changelog_bullets');
    expect(currentCommitSchema).toContain('release_impact');
    expect(currentCommitSchema).not.toContain('commit_hash');

    const changelogSchema = JSON.stringify(tools.get('memory_changelog_entry_add')?.parameters ?? {});
    expect(changelogSchema).toContain('version');
    expect(changelogSchema).toContain('section');
    expect(changelogSchema).toContain('bullets');
    expect(changelogSchema).not.toContain('allow_duplicate');

    const linkSchema = JSON.stringify(tools.get('memory_commit_changelog_link')?.parameters ?? {});
    expect(linkSchema).toContain('from_memory_id');
    expect(linkSchema).toContain('to_memory_id');
    expect(linkSchema).toContain('relation_type');
    expect(linkSchema).toContain('derived_from');
    expect(linkSchema).toContain('supports');
    expect(linkSchema).toContain('related_to');
    expect(linkSchema).toContain('supersedes');

    const commitSearchSchema = JSON.stringify(tools.get('memory_commit_changelog_search')?.parameters ?? {});
    expect(commitSearchSchema).toContain('record_types');
    expect(commitSearchSchema).toContain('release_record');
    expect(commitSearchSchema).toContain('repo');
    expect(commitSearchSchema).toContain('commit_hash');
    expect(commitSearchSchema).toContain('branch');
    expect(commitSearchSchema).toContain('version');
    expect(commitSearchSchema).toContain('release_tag');
    expect(commitSearchSchema).toContain('section');
    expect(commitSearchSchema).toContain('include_links');
    expect(commitSearchSchema).toContain('include_related');

    const releaseCandidatesSchema = JSON.stringify(tools.get('memory_release_candidates_search')?.parameters ?? {});
    expect(releaseCandidatesSchema).toContain('repo');
    expect(releaseCandidatesSchema).toContain('since');
    expect(releaseCandidatesSchema).toContain('until');
    expect(releaseCandidatesSchema).toContain('release_impact');

    const releasePreviewSchema = JSON.stringify(tools.get('memory_release_notes_preview')?.parameters ?? {});
    expect(releasePreviewSchema).toContain('repo');
    expect(releasePreviewSchema).toContain('version');
    expect(releasePreviewSchema).toContain('release_tag');
    expect(releasePreviewSchema).not.toContain('edit');

    const releaseRecordSchema = JSON.stringify(tools.get('memory_release_record_add')?.parameters ?? {});
    expect(releaseRecordSchema).toContain('version');
    expect(releaseRecordSchema).toContain('release_tag');
    expect(releaseRecordSchema).toContain('commit_ids');
    expect(releaseRecordSchema).not.toContain('generate');
  });

  it('rejects commit/changelog module tools when git memory config is disabled by default', async () => {
    const { projectDir, tools } = registerMemoryToolHarness('Git Disabled App');
    fs.writeFileSync(path.join(projectDir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'Git Disabled App', enabled: true }));
    for (const toolName of ['memory_commit_record_add', 'memory_release_candidates_search']) {
      const result = await tools.get(toolName).execute('tool-call', toolName === 'memory_commit_record_add' ? {
        repo: 'j0k3r/pi',
        commit_hash: 'abcdef1234567890',
        subject: 'add git memory gate',
      } : {}, undefined, undefined, { cwd: projectDir });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('git.enabled=true');
    }
  });

  it('stores minimal commit/changelog records and rejects missing related/source memories', async () => {
    const { d, projectDir, tools } = registerMemoryToolHarness('Commit Behavior App');
    const memoryAdd = tools.get('memory_add');
    const commitAdd = tools.get('memory_commit_record_add');
    const changelogAdd = tools.get('memory_changelog_entry_add');

    expect(commitAdd).toBeTruthy();
    expect(changelogAdd).toBeTruthy();

    const support = await memoryAdd.execute('tool-call', { kind: 'note', content: 'supporting memory for commit changelog tools' }, undefined, undefined, { cwd: projectDir });
    const supportId = support.details.memory.id;

    const commit = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'abc1234',
      subject: 'add commit memory contract tests',
      related_memory_ids: [supportId],
    }, undefined, undefined, { cwd: projectDir });
    expect(commit.isError).not.toBe(true);
    expect(commit.details.memory.kind).toBe('commit_record');

    const changelog = await changelogAdd.execute('tool-call', {
      version: '1.2.3',
      section: 'added',
      bullets: ['commit changelog contract coverage'],
      source_commit_ids: [commit.details.memory.id],
      related_memory_ids: [supportId],
    }, undefined, undefined, { cwd: projectDir });
    expect(changelog.isError).not.toBe(true);
    expect(changelog.details.memory.kind).toBe('changelog_entry');

    const links = d.prepare('SELECT from_memory_id, to_memory_id, relation_type FROM memory_links ORDER BY relation_type, from_memory_id, to_memory_id').all() as Array<{ from_memory_id: string; to_memory_id: string; relation_type: string }>;
    expect(links).toHaveLength(2);
    expect(links).toEqual(expect.arrayContaining([
      { from_memory_id: commit.details.memory.id, to_memory_id: supportId, relation_type: 'related_to' },
      { from_memory_id: changelog.details.memory.id, to_memory_id: supportId, relation_type: 'related_to' },
    ]));
    expect(links).not.toContainEqual({ from_memory_id: changelog.details.memory.id, to_memory_id: commit.details.memory.id, relation_type: 'derived_from' });

    const changelogMeta = d.prepare('SELECT metadata_json FROM memories WHERE id=?').get(changelog.details.memory.id) as { metadata_json: string };
    expect(JSON.parse(changelogMeta.metadata_json)).toMatchObject({
      changelog: { source_commit_ids: [commit.details.memory.id] },
    });

    const invalidRelated = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'def5678',
      subject: 'reject missing related memory ids',
      related_memory_ids: ['mem_missing_related'],
    }, undefined, undefined, { cwd: projectDir });
    expect(invalidRelated.isError).toBe(true);

    const invalidSource = await changelogAdd.execute('tool-call', {
      version: '1.2.4',
      section: 'fixed',
      bullets: ['reject missing source commit ids'],
      source_commit_ids: ['mem_missing_commit'],
    }, undefined, undefined, { cwd: projectDir });
    expect(invalidSource.isError).toBe(true);

    const kinds = d.prepare("SELECT kind FROM memories WHERE project_name=? ORDER BY created_at ASC").all('Commit Behavior App') as Array<{ kind: string }>;
    expect(kinds.map((row) => row.kind)).toEqual(['note', 'commit_record', 'changelog_entry']);
  });

  it('rejects invalid commit hashes and empty changelog bullets', async () => {
    const { d, projectDir, tools } = registerMemoryToolHarness('Commit Validation App');
    const commitAdd = tools.get('memory_commit_record_add');
    const changelogAdd = tools.get('memory_changelog_entry_add');

    expect(commitAdd).toBeTruthy();
    expect(changelogAdd).toBeTruthy();

    const invalidCommit = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'not-a-hash',
      subject: 'invalid hash should fail',
    }, undefined, undefined, { cwd: projectDir });
    expect(invalidCommit.isError).toBe(true);

    const emptyBullets = await changelogAdd.execute('tool-call', {
      version: '2.0.0',
      section: 'changed',
      bullets: ['   ', ''],
    }, undefined, undefined, { cwd: projectDir });
    expect(emptyBullets.isError).toBe(true);

    const count = d.prepare("SELECT COUNT(*) AS count FROM memories WHERE project_name=? AND kind IN ('commit_record', 'changelog_entry')").get('Commit Validation App') as { count: number };
    expect(count.count).toBe(0);
  });

  it('deduplicates duplicate commit and changelog adds without an override parameter', async () => {
    const { d, projectDir, tools } = registerMemoryToolHarness('Commit Dedup App');
    const commitAdd = tools.get('memory_commit_record_add');
    const changelogAdd = tools.get('memory_changelog_entry_add');

    expect(commitAdd).toBeTruthy();
    expect(changelogAdd).toBeTruthy();

    const firstCommit = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'fedcba9',
      subject: 'dedupe commit record',
    }, undefined, undefined, { cwd: projectDir });
    const secondCommit = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'fedcba9',
      subject: 'dedupe commit record',
    }, undefined, undefined, { cwd: projectDir });

    expect(secondCommit.isError).not.toBe(true);
    expect(secondCommit.details.memory.id).toBe(firstCommit.details.memory.id);

    const firstEntry = await changelogAdd.execute('tool-call', {
      version: '3.0.0',
      section: 'added',
      bullets: ['dedupe changelog entry'],
    }, undefined, undefined, { cwd: projectDir });
    const secondEntry = await changelogAdd.execute('tool-call', {
      version: '3.0.0',
      section: 'added',
      bullets: ['dedupe changelog entry'],
    }, undefined, undefined, { cwd: projectDir });

    expect(secondEntry.isError).not.toBe(true);
    expect(secondEntry.details.memory.id).toBe(firstEntry.details.memory.id);

    const counts = d.prepare("SELECT kind, COUNT(*) AS count FROM memories WHERE project_name=? AND kind IN ('commit_record', 'changelog_entry') GROUP BY kind ORDER BY kind").all('Commit Dedup App') as Array<{ kind: string; count: number }>;
    expect(counts).toEqual([
      { kind: 'changelog_entry', count: 1 },
      { kind: 'commit_record', count: 1 },
    ]);
  });

  it('requires rich release context when recording the current git HEAD commit', async () => {
    const { projectDir, tools } = registerMemoryToolHarness('Current Commit Required App');
    const currentCommit = tools.get('memory_record_current_commit');

    git(projectDir, ['init']);
    git(projectDir, ['config', 'user.name', 'Test User']);
    git(projectDir, ['config', 'user.email', 'test@example.com']);
    fs.writeFileSync(path.join(projectDir, 'feature.txt'), 'current commit memory\n');
    git(projectDir, ['add', 'feature.txt']);
    git(projectDir, ['commit', '-m', 'feat(memory): require rich context']);

    const missingSummary = await currentCommit.execute('tool-call', {
      functional_description: 'records current commit with required context',
      changelog_bullets: ['Added required rich commit context.'],
      change_type: 'feature',
      release_impact: 'minor',
    }, undefined, undefined, { cwd: projectDir });
    expect(missingSummary.isError).toBe(true);
    expect(missingSummary.content[0].text).toContain('summary is required');

    const missingBullets = await currentCommit.execute('tool-call', {
      summary: 'Records current commit with required context.',
      functional_description: 'records current commit with required context',
      change_type: 'feature',
      release_impact: 'minor',
    }, undefined, undefined, { cwd: projectDir });
    expect(missingBullets.isError).toBe(true);
    expect(missingBullets.content[0].text).toContain('changelog_bullets must contain at least one entry');
  });

  it('records the current git HEAD commit with rich context without performing git writes', async () => {
    const { d, projectDir, tools } = registerMemoryToolHarness('Current Commit App');
    const currentCommit = tools.get('memory_record_current_commit');
    expect(currentCommit).toBeTruthy();

    git(projectDir, ['init']);
    git(projectDir, ['config', 'user.name', 'Test User']);
    git(projectDir, ['config', 'user.email', 'test@example.com']);
    git(projectDir, ['remote', 'add', 'origin', 'https://github.com/j0k3r/current-commit-app.git']);
    fs.writeFileSync(path.join(projectDir, 'feature.txt'), 'current commit memory\n');
    git(projectDir, ['add', 'feature.txt']);
    git(projectDir, ['commit', '-m', 'feat(memory): record current commit']);
    const head = git(projectDir, ['rev-parse', 'HEAD']);
    const branch = git(projectDir, ['branch', '--show-current']);

    const result = await currentCommit.execute('tool-call', {
      summary: 'Records the current git HEAD commit with rich release context.',
      functional_description: 'The Memory Extension can read HEAD metadata and store a rich commit record without performing Git writes.',
      changelog_bullets: ['Added current commit memory recording from Git HEAD.'],
      areas: ['memory', 'git'],
      validation: ['git rev-parse HEAD', 'git show --name-only HEAD'],
      risks: ['Requires running inside a Git repository.'],
      decisions: ['Do not perform commit, tag, push, or changelog edits from this tool.'],
      change_type: 'feature',
      release_impact: 'minor',
    }, undefined, undefined, { cwd: projectDir });
    expect(result.isError).not.toBe(true);
    expect(result.details.memory.kind).toBe('commit_record');

    const row = d.prepare('SELECT content, metadata_json FROM memories WHERE id=?').get(result.details.memory.id) as { content: string; metadata_json: string };
    const metadata = JSON.parse(row.metadata_json);
    expect(metadata.commit).toMatchObject({
      repo: 'https://github.com/j0k3r/current-commit-app.git',
      commit_hash: head.toLowerCase(),
      subject: 'feat(memory): record current commit',
      branch,
      author: 'test user <test@example.com>',
      change_type: 'feature',
      release_impact: 'minor',
      files_changed: ['feature.txt'],
    });
    expect(metadata.release_context.changelog_bullets).toEqual(['added current commit memory recording from git head.']);
    expect(row.content).toContain('functional_description: the memory extension can read head metadata');
    expect(git(projectDir, ['rev-parse', 'HEAD'])).toBe(head);
  });

  it('stores rich commit release context metadata and makes it searchable', async () => {
    const { d, projectDir, tools } = registerMemoryToolHarness('Rich Commit App');
    const commitAdd = tools.get('memory_commit_record_add');
    const searchTool = tools.get('memory_commit_changelog_search');

    const commit = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'abc9876',
      subject: 'add rich commit memory context',
      summary: 'Added centralized frontend input normalization and memory provenance context.',
      functional_description: 'InputFilled and TextFilled now normalize text on blur by default while preserving normalize=false as an escape hatch.',
      changelog_bullets: [
        'Added centralized frontend text normalization for shared input primitives.',
        'Recorded richer commit provenance for future release notes.',
      ],
      areas: ['frontend', 'memory'],
      validation: ['cd front && bun run typecheck', 'cd extensions/memory && npm test -- --run'],
      risks: ['normalize=false remains the compatibility escape hatch'],
      decisions: ['store release context in commit memory metadata without generating changelog content'],
      change_type: 'feature',
      release_impact: 'minor',
    }, undefined, undefined, { cwd: projectDir });
    expect(commit.isError).not.toBe(true);

    const metaRow = d.prepare('SELECT content, metadata_json FROM memories WHERE id=?').get(commit.details.memory.id) as { content: string; metadata_json: string };
    expect(metaRow.content).toContain('functional_description: inputfilled and textfilled now normalize text on blur');
    expect(metaRow.content).toContain('changelog_bullets: added centralized frontend text normalization for shared input primitives');
    expect(JSON.parse(metaRow.metadata_json)).toMatchObject({
      commit: { change_type: 'feature', release_impact: 'minor' },
      release_context: {
        functional_description: 'inputfilled and textfilled now normalize text on blur by default while preserving normalize=false as an escape hatch.',
        changelog_bullets: [
          'added centralized frontend text normalization for shared input primitives.',
          'recorded richer commit provenance for future release notes.',
        ],
        areas: ['frontend', 'memory'],
        validation: ['cd front && bun run typecheck', 'cd extensions/memory && npm test -- --run'],
        risks: ['normalize=false remains the compatibility escape hatch'],
        decisions: ['store release context in commit memory metadata without generating changelog content'],
      },
    });

    const search = await searchTool.execute('tool-call', {
      query: 'frontend normalization primitives',
      record_types: ['commit_record'],
      limit: 5,
    }, undefined, undefined, { cwd: projectDir });
    expect(search.isError).not.toBe(true);
    expect(search.details.results.map((item: any) => item.id)).toContain(commit.details.memory.id);
  });

  it('previews release notes from candidate commit bullets without writing changelog records', async () => {
    const { d, projectDir, tools } = registerMemoryToolHarness('Release Preview App');
    const commitAdd = tools.get('memory_commit_record_add');
    const previewTool = tools.get('memory_release_notes_preview');

    const feature = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'ddd4444',
      subject: 'add release notes preview',
      summary: 'Adds release notes preview for memory candidates.',
      functional_description: 'The agent can preview release notes from stored commit bullets without editing changelog files.',
      changelog_bullets: ['Added release notes preview from Memory commit candidates.'],
      areas: ['memory', 'release'],
      validation: ['cd extensions/memory && npm test -- --run'],
      change_type: 'feature',
      release_impact: 'minor',
      authored_at: '2026-06-18T12:00:00Z',
    }, undefined, undefined, { cwd: projectDir });
    const fix = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'eee5555',
      subject: 'fix preview grouping',
      summary: 'Fixes preview grouping.',
      functional_description: 'Fix commits are grouped into Fixed.',
      changelog_bullets: ['Fixed release notes preview grouping.'],
      change_type: 'fix',
      release_impact: 'patch',
      authored_at: '2026-06-18T13:00:00Z',
    }, undefined, undefined, { cwd: projectDir });
    const chore = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'fff6666',
      subject: 'chore without bullets',
      summary: 'Internal cleanup without release bullets.',
      functional_description: 'This commit intentionally lacks changelog bullets.',
      change_type: 'chore',
      release_impact: 'patch',
      authored_at: '2026-06-18T14:00:00Z',
    }, undefined, undefined, { cwd: projectDir });

    const preview = await previewTool.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      version: '1.6.0',
      release_tag: 'v1.6.0',
      limit: 10,
    }, undefined, undefined, { cwd: projectDir });
    expect(preview.isError).not.toBe(true);
    expect(preview.details.candidates.map((item: any) => item.id)).toEqual([chore.details.memory.id, fix.details.memory.id, feature.details.memory.id]);
    expect(preview.details.sections.Added).toContain('Added release notes preview from memory commit candidates.');
    expect(preview.details.sections.Fixed).toContain('Fixed release notes preview grouping.');
    expect(preview.details.needs_context.map((item: any) => item.id)).toEqual([chore.details.memory.id]);
    expect(preview.content[0].text).toContain('## 1.6.0');
    expect(preview.content[0].text).toContain('### Added');
    expect(preview.content[0].text).toContain('- Added release notes preview from memory commit candidates.');
    expect(preview.content[0].text).toContain('### Needs context');

    const generatedRows = d.prepare("SELECT COUNT(*) AS count FROM memories WHERE kind IN ('changelog_entry','release_record')").get() as { count: number };
    expect(generatedRows.count).toBe(0);
  });

  it('finds unreleased commit candidates and records explicit release/tag links without generating changelogs', async () => {
    const { d, projectDir, tools } = registerMemoryToolHarness('Release Tag App');
    const commitAdd = tools.get('memory_commit_record_add');
    const candidatesSearch = tools.get('memory_release_candidates_search');
    const releaseAdd = tools.get('memory_release_record_add');

    const feature = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'aaa1111',
      subject: 'add release memory candidates',
      change_type: 'feature',
      release_impact: 'minor',
      authored_at: '2026-06-18T10:00:00Z',
    }, undefined, undefined, { cwd: projectDir });
    const fix = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'bbb2222',
      subject: 'fix release candidate filtering',
      change_type: 'fix',
      release_impact: 'patch',
      authored_at: '2026-06-18T11:00:00Z',
    }, undefined, undefined, { cwd: projectDir });
    await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'ccc3333',
      subject: 'sync memory backup metadata',
      change_type: 'sync',
    }, undefined, undefined, { cwd: projectDir });

    const before = await candidatesSearch.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      limit: 10,
    }, undefined, undefined, { cwd: projectDir });
    expect(before.isError).not.toBe(true);
    expect(before.details.results.map((item: any) => item.id)).toEqual([fix.details.memory.id, feature.details.memory.id]);

    const release = await releaseAdd.execute('tool-call', {
      version: '1.5.0',
      release_tag: 'v1.5.0',
      release_date: '2026-06-18',
      commit_ids: [feature.details.memory.id, fix.details.memory.id],
      summary: 'Release memory records for explicit tag provenance.',
      content: 'The agent writes the changelog separately using the selected commit context.',
    }, undefined, undefined, { cwd: projectDir });
    expect(release.isError).not.toBe(true);
    expect(release.details.memory.kind).toBe('release_record');
    expect(release.details.memory.metadata_summary).toMatchObject({ version: '1.5.0', release_tag: 'v1.5.0' });

    const releaseMeta = d.prepare('SELECT metadata_json FROM memories WHERE id=?').get(release.details.memory.id) as { metadata_json: string };
    expect(JSON.parse(releaseMeta.metadata_json)).toMatchObject({
      release: { version: '1.5.0', release_tag: 'v1.5.0', commit_ids: [feature.details.memory.id, fix.details.memory.id] },
    });
    const links = d.prepare("SELECT from_memory_id, to_memory_id, relation_type FROM memory_links WHERE from_memory_id=? ORDER BY to_memory_id").all(release.details.memory.id) as Array<{ from_memory_id: string; to_memory_id: string; relation_type: string }>;
    expect(links).toEqual([
      { from_memory_id: release.details.memory.id, to_memory_id: feature.details.memory.id, relation_type: 'derived_from' },
      { from_memory_id: release.details.memory.id, to_memory_id: fix.details.memory.id, relation_type: 'derived_from' },
    ].sort((a, b) => a.to_memory_id.localeCompare(b.to_memory_id)));

    const changelogRows = d.prepare("SELECT COUNT(*) AS count FROM memories WHERE kind='changelog_entry'").get() as { count: number };
    expect(changelogRows.count).toBe(0);

    const after = await candidatesSearch.execute('tool-call', { repo: 'github.com/j0k3r/j0k3r-pi', limit: 10 }, undefined, undefined, { cwd: projectDir });
    expect(after.details.results).toHaveLength(0);
  });

  it('stores normalized commit release classification metadata, defaults sync release impact, and keeps legacy commit records valid', async () => {
    const { d, projectDir, tools } = registerMemoryToolHarness('Commit Classification App');
    const memoryAdd = tools.get('memory_add');
    const commitAdd = tools.get('memory_commit_record_add');
    const searchTool = tools.get('memory_commit_changelog_search');

    expect(commitAdd).toBeTruthy();
    expect(searchTool).toBeTruthy();

    const classified = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'c0ffee1',
      subject: 'ship release classification support',
      change_type: ' Feature ',
      release_impact: ' Minor ',
    }, undefined, undefined, { cwd: projectDir });
    expect(classified.isError).not.toBe(true);

    const classifiedMeta = d.prepare('SELECT metadata_json FROM memories WHERE id=?').get(classified.details.memory.id) as { metadata_json: string };
    expect(JSON.parse(classifiedMeta.metadata_json)).toMatchObject({
      commit: {
        change_type: 'feature',
        release_impact: 'minor',
      },
    });

    const syncCommit = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'c0ffee2',
      subject: 'sync cloud memory metadata',
      change_type: 'sync',
    }, undefined, undefined, { cwd: projectDir });
    expect(syncCommit.isError).not.toBe(true);

    const syncMeta = d.prepare('SELECT metadata_json FROM memories WHERE id=?').get(syncCommit.details.memory.id) as { metadata_json: string };
    expect(JSON.parse(syncMeta.metadata_json)).toMatchObject({
      commit: {
        change_type: 'sync',
        release_impact: 'none',
      },
    });

    const invalidChangeType = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'c0ffee3',
      subject: 'reject invalid classification',
      change_type: 'breaking',
    }, undefined, undefined, { cwd: projectDir });
    expect(invalidChangeType.isError).toBe(true);

    const invalidReleaseImpact = await commitAdd.execute('tool-call', {
      repo: 'github.com/j0k3r/j0k3r-pi',
      commit_hash: 'c0ffee4',
      subject: 'reject invalid release impact',
      release_impact: 'micro',
    }, undefined, undefined, { cwd: projectDir });
    expect(invalidReleaseImpact.isError).toBe(true);

    const legacy = await memoryAdd.execute('tool-call', {
      scope: 'project',
      kind: 'commit_record',
      title: 'legacy commit record',
      content: 'legacy commit content without classification metadata',
      metadata_json: {
        commit: {
          repo: 'github.com/j0k3r/j0k3r-pi',
          commit_hash: 'c0ffee5',
          subject: 'legacy commit record',
        },
      },
    }, undefined, undefined, { cwd: projectDir });
    expect(legacy.isError).not.toBe(true);

    const legacySearch = await searchTool.execute('tool-call', {
      record_types: ['commit_record'],
      commit_hash: 'c0ffee5',
      limit: 10,
    }, undefined, undefined, { cwd: projectDir });
    expect(legacySearch.isError).not.toBe(true);
    expect(legacySearch.details.results).toHaveLength(1);
    expect(legacySearch.details.results[0].id).toBe(legacy.details.memory.id);
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
