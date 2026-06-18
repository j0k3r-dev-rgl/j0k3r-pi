import { Type } from 'typebox';
import type { Db } from './db.js';
import { resolveBackupPath } from './config.js';
import { resolveMemoryContext } from './context.js';
import { addMemory, archiveMemory, getMemory, listMemories, updateMemory } from './memory-store.js';
import { searchMemory } from './search.js';
import { addSessionPrompt, finishMemorySession, startMemorySession } from './sessions.js';
import { exportMemory, importMemory } from './export-import.js';
import { getCurrentMemorySessionId } from './runtime-state.js';
import { consolidateMemories } from './consolidation.js';
import { ensureProjectProfile, getCurrentProjectProfile, updateProjectProfile } from './project-profile.js';
import { getSyncStatus } from './sync-status.js';
import { renderMemoryToolResult } from './render.js';
import type { MemoryImportConflictPolicy, MemoryImportMode, ToolResult } from './types.js';

function ok(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: 'text', text }], details };
}

function fail(error: unknown): ToolResult {
  const msg = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: msg }], details: { error: msg }, isError: true };
}

function compactResultLine(item: any): string {
  const parts = [
    item.id,
    item.type ?? 'memory',
    item.scope ? `${item.scope}${item.project_name ? `/${item.project_name}` : ''}` : undefined,
    item.kind,
    item.title,
  ].filter(Boolean);
  const snippet = String(item.snippet ?? '').replace(/\s+/g, ' ').trim();
  return `- ${parts.join(' · ')}${snippet ? ` — ${snippet.slice(0, 160)}` : ''}`;
}

function resultListText(prefix: string, rows: any[]): string {
  if (!rows.length) return prefix;
  return `${prefix}\n${rows.slice(0, 20).map(compactResultLine).join('\n')}`;
}

const Scope = Type.Union([Type.Literal('general'), Type.Literal('project'), Type.Literal('global')]);
const Kind = Type.Union([
  'preference',
  'decision',
  'architecture',
  'architectural_decision',
  'command',
  'constraint',
  'workflow',
  'note',
  'learning',
  'session_summary',
  'prompt',
  'bug',
  'todo',
  'progress',
  'api',
  'dependency',
  'project_profile',
].map((x) => Type.Literal(x)) as any);
const Origin = Type.Union([
  Type.Literal('explicit_user'),
  Type.Literal('inferred_by_agent'),
  Type.Literal('confirmed_by_user'),
  Type.Literal('observed_from_code'),
  Type.Literal('session_summary'),
]);
const ProjectMode = Type.Union([Type.Literal('current'), Type.Literal('all'), Type.Literal('selected')]);
const ImportMode = Type.Union([Type.Literal('merge'), Type.Literal('dry_run')]);
const ImportConflictPolicy = Type.Union([
  Type.Literal('keep_local'),
  Type.Literal('keep_imported'),
  Type.Literal('mark_conflict'),
]);
const RecallContext = Type.Union([
  'startup',
  'before_task',
  'task',
  'before_edit',
  'edit',
  'before_test',
  'test',
  'before_commit',
  'commit',
  'review',
  'session_end',
  'end',
].map((x) => Type.Literal(x)) as any);

function normalizeRecallContext(value: string): string {
  return {
    task: 'before_task',
    edit: 'before_edit',
    test: 'before_test',
    commit: 'before_commit',
    end: 'session_end',
  }[value] ?? value;
}

function resolveImportDefaults(
  params: any,
  context: { cwd: string; config?: { import?: { mode?: MemoryImportMode; on_conflict?: MemoryImportConflictPolicy }; backups?: { path?: string } }, warnings?: string[] },
) {
  return {
    mode: params?.mode ?? context.config?.import?.mode ?? 'dry_run',
    on_conflict: params?.on_conflict ?? context.config?.import?.on_conflict ?? 'mark_conflict',
    path: resolveBackupPath(context.cwd, context.config?.backups?.path),
  } as { path: string; mode: MemoryImportMode; on_conflict: MemoryImportConflictPolicy };
}

function resolveExportDefaults(
  params: any,
  context: ReturnType<typeof resolveMemoryContext>,
) {
  const hasExplicitIncludeSessions = params && typeof params === 'object' && Object.prototype.hasOwnProperty.call(params, 'include_sessions');
  return {
    ...params,
    path: resolveBackupPath(context.cwd, context.config?.backups?.path),
    include_sessions: hasExplicitIncludeSessions ? params?.include_sessions : context.config?.backups?.include_sessions,
    context,
  } as {
    path: string;
    format?: 'jsonl' | 'sqlite';
    include_archived?: boolean;
    include_sessions?: boolean;
    context: ReturnType<typeof resolveMemoryContext>;
  };
}

function recallQuery(context: string, query?: string): string {
  if (query) return query;

  const queries: Record<string, string> = {
    startup: 'project profile preferences decisions commands learnings todos recent sessions',
    before_task: 'preferences constraints active decisions project profile todos workflow',
    before_edit: 'architecture conventions constraints files modules active decisions',
    before_test: 'test commands testing conventions tdd validation',
    before_commit: 'consolidate checks validation todos changelog',
    review: 'decisions constraints bugs quality risks validations',
    session_end: 'current session prompts changes decisions validations todos learnings summary',
  };

  return queries[context] ?? context;
}

export function registerMemoryTools(pi: any, db: Db): void {
  pi.registerTool({
    name: 'memory_context',
    label: 'Memory Context',
    description: 'Resolve current memory scope and project identity.',
    promptSnippet: 'Resolve current memory scope and project context.',
    promptGuidelines: ['Use memory_context when you need to know the active memory project/scope.'],
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        return ok(`Memory context: ${context.scope}${context.project_name ? ` (${context.project_name})` : ''}`, { context });
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_add',
    label: 'Memory Add',
    description: 'Store a persistent memory. The tool auto-resolves project_id/project_name.',
    promptSnippet: 'Store durable memories only when needed.',
    promptGuidelines: [
      'Use memory_add only for durable reusable knowledge; never store secrets; do not provide project_id/project_name. Write title, summary, content, and tags in english lowercase.',
    ],
    parameters: Type.Object({
      scope: Type.Optional(Scope),
      kind: Kind,
      title: Type.Optional(Type.String()),
      summary: Type.Optional(Type.String()),
      content: Type.String(),
      tags: Type.Optional(Type.Array(Type.String())),
      origin_type: Type.Optional(Origin),
      confidence: Type.Optional(Type.Number()),
      importance: Type.Optional(Type.Number()),
      metadata_json: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const res = addMemory(db, params, context);
        return ok(`Memory saved: "${res.memory.title ?? res.memory.summary ?? res.memory.kind}"${res.warning ? ` (${res.warning})` : ''}`, {
          memory: compactMemory(res.memory),
          warning: res.warning,
        });
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_search',
    label: 'Memory Search',
    description: 'Search compact local memories and session summaries.',
    promptSnippet: 'Search local memory only when startup/conversation context is insufficient.',
    promptGuidelines: ['Use memory_search when persistent context, full-session memory, and project summary are required.'],
    parameters: Type.Object({
      query: Type.String(),
      scopes: Type.Optional(Type.Array(Scope)),
      project_mode: Type.Optional(ProjectMode),
      project_name: Type.Optional(Type.String()),
      kinds: Type.Optional(Type.Array(Kind)),
      include_sessions: Type.Optional(Type.Boolean()),
      include_prompts: Type.Optional(Type.Boolean()),
      types: Type.Optional(Type.Array(Type.Union([Type.Literal('memory'), Type.Literal('session'), Type.Literal('prompt')]))) ,
      current_session_only: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Number()),
      min_importance: Type.Optional(Type.Number()),
      compact: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const results = searchMemory(db, { ...params, current_session_id: getCurrentMemorySessionId() }, context);
        return ok(resultListText(`Found ${results.results.length} memory result(s).`, results.results), results);
      } catch (e) {
        return fail(e);
      }
    },
    renderResult: renderMemoryToolResult,
  });

  pi.registerTool({
    name: 'memory_get',
    label: 'Memory Get',
    description: 'Read a complete memory by id.',
    promptSnippet: 'Load one full memory by id after memory_search.',
    promptGuidelines: ['Use memory_get only for candidate IDs returned by memory_search.'],
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id: string, params: any) {
      try {
        const mem = getMemory(db, params.id);
        if (!mem) throw new Error('Memory not found');
        return ok(`Memory: ${mem.title ?? mem.id}`, { memory: mem });
      } catch (e) {
        return fail(e);
      }
    },
    renderResult: renderMemoryToolResult,
  });

  pi.registerTool({
    name: 'memory_list',
    label: 'Memory List',
    description: 'List compact memories by filters.',
    promptSnippet: 'List memory IDs and snippets by scope/kind/project filter.',
    promptGuidelines: ['Use memory_list for inventory; use memory_get for full content.'],
    parameters: Type.Object({
      scope: Type.Optional(Scope),
      project_mode: Type.Optional(ProjectMode),
      project_name: Type.Optional(Type.String()),
      kind: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const rows = listMemories(db, params ?? {}, context).map(compactMemory);
        return ok(resultListText(`Listed ${rows.length} memory item(s).`, rows), { results: rows });
      } catch (e) {
        return fail(e);
      }
    },
    renderResult: renderMemoryToolResult,
  });

  pi.registerTool({
    name: 'memory_update',
    label: 'Memory Update',
    description: 'Update an existing memory.',
    promptSnippet: 'Update memory content/tags/confidence/importance/status.',
    promptGuidelines: ['Use memory_update for corrections; use supersedes links for major replacements in future.'],
    parameters: Type.Object({
      id: Type.String(),
      content: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      confidence: Type.Optional(Type.Number()),
      importance: Type.Optional(Type.Number()),
      status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('archived'), Type.Literal('superseded')])) ,
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const mem = updateMemory(db, params.id, params, context);
        return ok(`Memory updated: "${mem.title ?? mem.summary ?? mem.kind}"`, { memory: compactMemory(mem) });
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_archive',
    label: 'Memory Archive',
    description: 'Archive a memory without deleting it.',
    promptSnippet: 'Archive obsolete memory so it stops appearing by default.',
    promptGuidelines: ['Use memory_archive instead of deleting memories.'],
    parameters: Type.Object({ id: Type.String(), reason: Type.Optional(Type.String()) }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const mem = archiveMemory(db, params.id, context, params.reason);
        return ok(`Memory archived: "${mem.title ?? mem.summary ?? mem.kind}"`, { memory: compactMemory(mem) });
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_session_start',
    label: 'Memory Session Start',
    description: 'Create/register a memory session.',
    parameters: Type.Object({
      title: Type.Optional(Type.String()),
      scope: Type.Optional(Scope),
      metadata_json: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const session = startMemorySession(db, params ?? {}, context);
        return ok('Memory session started.', { session });
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_session_prompt_add',
    label: 'Memory Session Prompt Add',
    description: 'Store a relevant session prompt for audit.',
    parameters: Type.Object({
      session_id: Type.String(),
      role: Type.Union([
        Type.Literal('user'),
        Type.Literal('assistant'),
        Type.Literal('system'),
        Type.Literal('tool'),
        Type.Literal('extension'),
      ]),
      prompt: Type.String(),
      prompt_index: Type.Number(),
      metadata_json: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const prompt = addSessionPrompt(db, params, context);
        return ok('Session prompt saved for audit.', { prompt });
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_session_finish',
    label: 'Memory Session Finish',
    description: 'Finish a memory session and extract learnings/decisions.',
    parameters: Type.Object({
      session_id: Type.String(),
      summary: Type.String(),
      learned: Type.Optional(Type.String()),
      architectural_decisions: Type.Optional(Type.Array(Type.String())),
      memories_to_add: Type.Optional(Type.Array(Type.Any())),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const result = finishMemorySession(db, params, context);
        return ok('Memory session finished.', result as any);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_start_chat',
    label: 'Memory Start Chat',
    description: 'Start memory session and return compact startup context.',
    promptSnippet: 'Create a memory session and retrieve compact startup memory context.',
    promptGuidelines: ['Use memory_start_chat at the beginning of substantial sessions/tasks.'],
    parameters: Type.Object({
      user_prompt: Type.Optional(Type.String()),
      session_title: Type.Optional(Type.String()),
      limit_recent_sessions: Type.Optional(Type.Number()),
      limit_memories: Type.Optional(Type.Number()),
      include_prompts: Type.Optional(Type.Boolean()),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const session = startMemorySession(db, { title: params?.session_title, metadata_json: { user_prompt: params?.user_prompt } }, context);
        const startup = searchMemory(db, { query: params?.user_prompt || 'project preferences decisions commands learnings todos', limit: params?.limit_memories ?? 12 }, context);
        const startup_context = {
          global_rules: startup.results.filter((r: any) => r.scope === 'global'),
          general_preferences: startup.results.filter((r: any) => r.scope === 'general'),
          project_profile: startup.results.find((r: any) => r.kind === 'project_profile') ?? null,
          active_decisions: startup.results.filter((r: any) => r.kind === 'architectural_decision' || r.kind === 'decision'),
          known_commands: startup.results.filter((r: any) => r.kind === 'command'),
          recent_learnings: startup.results.filter((r: any) => r.kind === 'learning'),
          open_todos: startup.results.filter((r: any) => r.kind === 'todo'),
          recent_sessions: startup.results.filter((r: any) => r.type === 'session'),
        };
        return ok('Memory chat started.', { session_id: (session as any).id, context, startup_context });
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_recall',
    label: 'Memory Recall',
    description: 'Recall compact context for a workflow moment.',
    promptSnippet: 'Recall compact context for workflow moments only when startup context and conversation do not already contain the needed persistent context.',
    promptGuidelines: [
      'Use memory_recall deliberately when startup context and conversation do not already contain the needed persistent context. Do not repeat recall for every edit/test/commit phase of the same task.',
      'Aliases task/edit/test/commit/end are accepted.',
    ],
    parameters: Type.Object({
      context: RecallContext,
      query: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const moment = normalizeRecallContext(String(params?.context || 'startup'));
        const query = recallQuery(moment, params?.query);
        const isSessionEnd = moment === 'session_end';
        const result = searchMemory(
          db,
          {
            query,
            limit: params?.limit ?? 10,
            current_session_id: getCurrentMemorySessionId(),
            current_session_only: isSessionEnd,
            include_prompts: isSessionEnd ? true : undefined,
            types: isSessionEnd ? ['memory', 'session', 'prompt'] : undefined,
          },
          context,
        );
        return ok(`Recalled ${result.results.length} item(s).`, { ...result, recall_context: moment, query });
      } catch (e) {
        return fail(e);
      }
    },
    renderResult: renderMemoryToolResult,
  });

  pi.registerTool({
    name: 'memory_project_profile',
    label: 'Memory Project Profile',
    description: 'Create, read, or update the current project profile.',
    promptSnippet: 'Maintain the living project profile with durable stack, commands, conventions, risks, and current work.',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('get'), Type.Literal('ensure'), Type.Literal('update')]),
      content: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        if (params.action === 'update') {
          if (!params.content) throw new Error('content is required for update');
          const profile = updateProjectProfile(db, context, params.content, params.tags);
          return ok('Project profile updated.', { profile: compactMemory(profile) });
        }
        if (params.action === 'get') {
          const profile = getCurrentProjectProfile(db, context);
          return ok(profile ? 'Project profile loaded.' : 'No project profile found.', { profile: profile ? compactMemory(profile) : null, created: false });
        }
        const result = ensureProjectProfile(db, context);
        return ok(result.created ? 'Project profile created.' : 'Project profile loaded.', {
          profile: result.profile ? compactMemory(result.profile) : null,
          created: result.created,
        });
      } catch (e) {
        return fail(e);
      }
    },
    renderResult: renderMemoryToolResult,
  });

  pi.registerTool({
    name: 'memory_consolidate',
    label: 'Memory Consolidate',
    description: 'Find or consolidate duplicate active memories.',
    promptSnippet: 'Consolidate duplicate memories safely; dry_run defaults to true.',
    parameters: Type.Object({
      kind: Type.Optional(Type.String()),
      scope: Type.Optional(Scope),
      dry_run: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Number()),
      similarity: Type.Optional(Type.Boolean()),
      similarity_threshold: Type.Optional(Type.Number()),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const result = consolidateMemories(db, params ?? {}, context);
        return ok(`Consolidation ${result.dry_run ? 'dry run' : 'applied'}: ${result.candidates.length} candidate group(s).`, result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_sync_status',
    label: 'Memory Sync Status',
    description: 'Show local sync-aware status counts.',
    promptSnippet: 'Check pending/local/conflict memory sync status.',
    parameters: Type.Object({}),
    async execute(_id: string, _params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const status = getSyncStatus(db, context);
        return ok(`Memory sync status: pending=${status.has_pending}, conflicts=${status.has_conflicts}.`, status);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_export',
    label: 'Memory Export',
    description: 'Export local memory to the configured mirror JSONL backup.',
    parameters: Type.Object({
      format: Type.Optional(Type.Union([Type.Literal('jsonl'), Type.Literal('sqlite')])),
      include_archived: Type.Optional(Type.Boolean()),
      include_sessions: Type.Optional(Type.Boolean()),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const input = resolveExportDefaults(params, context);
        const result = exportMemory(db, input);
        return ok(`Memory mirror backup exported: ${result.path}`, { ...result, warnings: context.warnings });
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_import',
    label: 'Memory Import',
    description: 'Import local memory from the configured mirror JSONL backup.',
    parameters: Type.Object({ mode: Type.Optional(ImportMode), on_conflict: Type.Optional(ImportConflictPolicy) }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const input = resolveImportDefaults(params, context);
        const result = importMemory(db, input);
        return ok(`Memory import ${result.mode}: ${result.inserted} inserted, ${result.conflicts} conflicts.`, {
          ...result,
          warnings: context.warnings,
        });
      } catch (e) {
        return fail(e);
      }
    },
  });
}

function compactMemory(m: any) {
  return {
    id: m.id,
    type: 'memory',
    scope: m.scope,
    project_name: m.project_name,
    kind: m.kind,
    title: m.title,
    snippet: (m.summary || m.content || '').slice(0, 240),
    importance: m.importance,
    confidence: m.confidence,
    status: m.status,
    sync_status: m.sync_status,
    updated_at: m.updated_at,
  };
}
