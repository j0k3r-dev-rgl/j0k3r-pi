import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Type } from 'typebox';
import type { Db } from './db.js';
import { resolveBackupPath } from './config.js';
import { resolveMemoryContext } from './context.js';
import { addMemory, archiveMemory, getMemory, listMemories, updateMemory } from './memory-store.js';
import { searchMemory } from './search.js';
import { addSessionPrompt, finishMemorySession, startMemorySession } from './sessions.js';
import { exportMemory, importMemory } from './export-import.js';
import { getCurrentMemorySessionId } from './runtime-state.js';
import { observeRetrieval } from './retrieval-telemetry.js';
import { consolidateMemories } from './consolidation.js';
import { ensureProjectProfile, getCurrentProjectProfile, updateProjectProfile } from './project-profile.js';
import { getSyncStatus } from './sync-status.js';
import { renderMemoryToolResult } from './render.js';
import { addChangelogEntry, addCommitChangelogLink, addCommitRecord, addReleaseRecord, previewReleaseNotes, searchCommitChangelog, searchReleaseCandidates } from './commit-changelog.js';
import { addMemoryLink, MEMORY_LINK_RELATIONS } from './links.js';
import { MEMORY_KINDS } from './types.js';
import type { MemoryExportMode, MemoryImportConflictPolicy, MemoryImportMode, ToolResult } from './types.js';

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
const Kind = Type.Union(MEMORY_KINDS.map((x) => Type.Literal(x)) as any);
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
const ExportMode = Type.Union([Type.Literal('mirror'), Type.Literal('merge')]);
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

function assertGitMemoryEnabled(context: { config?: { git?: { enabled?: boolean } } }): void {
  if (context.config?.git?.enabled !== true) {
    throw new Error('Memory git module is disabled. Set git.enabled=true in .pi/memory.json to use commit/changelog memory tools.');
  }
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function optionalGit(cwd: string, args: string[]): string | undefined {
  try {
    return runGit(cwd, args) || undefined;
  } catch {
    return undefined;
  }
}

function requireRichCurrentCommitContext(params: any): void {
  if (!String(params?.summary ?? '').trim()) throw new Error('summary is required for memory_record_current_commit');
  if (!String(params?.functional_description ?? '').trim()) throw new Error('functional_description is required for memory_record_current_commit');
  if (!Array.isArray(params?.changelog_bullets) || !params.changelog_bullets.some((bullet: unknown) => String(bullet ?? '').trim())) {
    throw new Error('changelog_bullets must contain at least one entry for memory_record_current_commit');
  }
  if (!String(params?.change_type ?? '').trim()) throw new Error('change_type is required for memory_record_current_commit');
  if (!String(params?.release_impact ?? '').trim()) throw new Error('release_impact is required for memory_record_current_commit');
}

function currentCommitInput(cwd: string, params: any): any {
  requireRichCurrentCommitContext(params);
  const hash = runGit(cwd, ['rev-parse', 'HEAD']);
  const subject = runGit(cwd, ['show', '-s', '--format=%s', 'HEAD']);
  const author = runGit(cwd, ['show', '-s', '--format=%an <%ae>', 'HEAD']);
  const authoredAt = runGit(cwd, ['show', '-s', '--format=%aI', 'HEAD']);
  const branch = optionalGit(cwd, ['branch', '--show-current']);
  const remote = optionalGit(cwd, ['config', '--get', 'remote.origin.url']);
  const root = optionalGit(cwd, ['rev-parse', '--show-toplevel']);
  const files = runGit(cwd, ['show', '--name-only', '--format=', 'HEAD']).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const diffstat = runGit(cwd, ['show', '--stat', '--oneline', '--format=short', 'HEAD']);
  return {
    ...params,
    repo: remote ?? (root ? path.basename(root) : 'unknown'),
    commit_hash: hash,
    subject,
    branch,
    author,
    authored_at: authoredAt,
    files_changed: files,
    diffstat,
  };
}

function resolveImportDefaults(
  params: any,
  context: { cwd: string; config?: { import?: { mode?: MemoryImportMode; on_conflict?: MemoryImportConflictPolicy }; backups?: { path?: string }; git?: { enabled?: boolean; sync?: { import?: boolean } } }, warnings?: string[] },
) {
  return {
    mode: params?.mode ?? context.config?.import?.mode ?? 'dry_run',
    on_conflict: params?.on_conflict ?? context.config?.import?.on_conflict ?? 'mark_conflict',
    path: resolveBackupPath(context.cwd, context.config?.backups?.path),
    include_git: context.config?.git?.enabled === true && context.config.git.sync?.import === true,
  } as { path: string; mode: MemoryImportMode; on_conflict: MemoryImportConflictPolicy; include_git: boolean };
}

function resolveExportDefaults(
  params: any,
  context: ReturnType<typeof resolveMemoryContext>,
) {
  const hasExplicitIncludeSessions = params && typeof params === 'object' && Object.prototype.hasOwnProperty.call(params, 'include_sessions');
  return {
    ...params,
    path: resolveBackupPath(context.cwd, context.config?.backups?.path),
    mode: params?.mode ?? context.config?.backups.mode ?? 'mirror',
    include_sessions: hasExplicitIncludeSessions ? params?.include_sessions : context.config?.backups?.include_sessions,
    include_git: context.config?.git.enabled === true && context.config.git.sync.export === true,
    context,
  } as {
    path: string;
    format?: 'jsonl' | 'sqlite';
    mode: MemoryExportMode;
    include_archived?: boolean;
    include_sessions?: boolean;
    include_git?: boolean;
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
    name: 'memory_record_current_commit',
    label: 'Memory Record Current Commit',
    description: 'Record the current Git HEAD commit in Memory with rich release/changelog provenance context. Does not commit, tag, push, or edit files.',
    parameters: Type.Object({
      scope: Type.Optional(Scope),
      change_type: Type.Optional(Type.Union([
        Type.Literal('fix'),
        Type.Literal('feature'),
        Type.Literal('chore'),
        Type.Literal('docs'),
        Type.Literal('refactor'),
        Type.Literal('test'),
        Type.Literal('sync'),
        Type.Literal('other'),
      ])),
      release_impact: Type.Optional(Type.Union([
        Type.Literal('major'),
        Type.Literal('minor'),
        Type.Literal('patch'),
        Type.Literal('none'),
      ])),
      summary: Type.Optional(Type.String()),
      content: Type.Optional(Type.String()),
      functional_description: Type.Optional(Type.String()),
      changelog_bullets: Type.Optional(Type.Array(Type.String())),
      areas: Type.Optional(Type.Array(Type.String())),
      validation: Type.Optional(Type.Array(Type.String())),
      risks: Type.Optional(Type.Array(Type.String())),
      decisions: Type.Optional(Type.Array(Type.String())),
      related_memory_ids: Type.Optional(Type.Array(Type.String())),
      tags: Type.Optional(Type.Array(Type.String())),
      confidence: Type.Optional(Type.Number()),
      importance: Type.Optional(Type.Number()),
      metadata_json: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const context = resolveMemoryContext(cwd);
        assertGitMemoryEnabled(context);
        const result = addCommitRecord(db, currentCommitInput(cwd, params ?? {}), context);
        return ok(`Current commit record saved: ${result.memory.title ?? result.memory.id}${result.warning ? ` (${result.warning})` : ''}`, result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_commit_record_add',
    label: 'Memory Commit Record Add',
    description: 'Create a commit record memory with commit metadata and optional provenance links.',
    parameters: Type.Object({
      scope: Type.Optional(Scope),
      repo: Type.String(),
      commit_hash: Type.String(),
      subject: Type.String(),
      branch: Type.Optional(Type.String()),
      author: Type.Optional(Type.String()),
      authored_at: Type.Optional(Type.String()),
      change_type: Type.Optional(Type.Union([
        Type.Literal('fix'),
        Type.Literal('feature'),
        Type.Literal('chore'),
        Type.Literal('docs'),
        Type.Literal('refactor'),
        Type.Literal('test'),
        Type.Literal('sync'),
        Type.Literal('other'),
      ])),
      release_impact: Type.Optional(Type.Union([
        Type.Literal('major'),
        Type.Literal('minor'),
        Type.Literal('patch'),
        Type.Literal('none'),
      ])),
      summary: Type.Optional(Type.String()),
      content: Type.Optional(Type.String()),
      functional_description: Type.Optional(Type.String()),
      changelog_bullets: Type.Optional(Type.Array(Type.String())),
      areas: Type.Optional(Type.Array(Type.String())),
      validation: Type.Optional(Type.Array(Type.String())),
      risks: Type.Optional(Type.Array(Type.String())),
      decisions: Type.Optional(Type.Array(Type.String())),
      files_changed: Type.Optional(Type.Array(Type.String())),
      diffstat: Type.Optional(Type.Union([Type.String(), Type.Record(Type.String(), Type.Any())])),
      source_session_id: Type.Optional(Type.String()),
      related_memory_ids: Type.Optional(Type.Array(Type.String())),
      tags: Type.Optional(Type.Array(Type.String())),
      confidence: Type.Optional(Type.Number()),
      importance: Type.Optional(Type.Number()),
      metadata_json: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        assertGitMemoryEnabled(context);
        const result = addCommitRecord(db, params, context);
        return ok(`Commit record saved: ${result.memory.title ?? result.memory.id}${result.warning ? ` (${result.warning})` : ''}`, result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_changelog_entry_add',
    label: 'Memory Changelog Entry Add',
    description: 'Create a changelog entry memory with release metadata and optional provenance links.',
    parameters: Type.Object({
      scope: Type.Optional(Scope),
      version: Type.String(),
      section: Type.String(),
      bullets: Type.Array(Type.String()),
      release_tag: Type.Optional(Type.String()),
      release_date: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      summary: Type.Optional(Type.String()),
      content: Type.Optional(Type.String()),
      source_commit_ids: Type.Optional(Type.Array(Type.String())),
      related_memory_ids: Type.Optional(Type.Array(Type.String())),
      tags: Type.Optional(Type.Array(Type.String())),
      confidence: Type.Optional(Type.Number()),
      importance: Type.Optional(Type.Number()),
      metadata_json: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        assertGitMemoryEnabled(context);
        const result = addChangelogEntry(db, params, context);
        return ok(`Changelog entry saved: ${result.memory.title ?? result.memory.id}${result.warning ? ` (${result.warning})` : ''}`, result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_link',
    label: 'Memory Link',
    description: 'Create a generic relationship between two existing memories.',
    parameters: Type.Object({
      from_memory_id: Type.String(),
      to_memory_id: Type.String(),
      relation_type: Type.Union(MEMORY_LINK_RELATIONS.map((relation) => Type.Literal(relation)) as any),
      metadata_json: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    async execute(_id: string, params: any) {
      try {
        const result = addMemoryLink(db, params);
        return ok(`Link saved: ${result.link.id}${result.warning ? ` (${result.warning})` : ''}`, result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_commit_changelog_link',
    label: 'Memory Commit Changelog Link',
    description: 'Link commit/changelog memories or supporting memories through memory_links.',
    parameters: Type.Object({
      from_memory_id: Type.String(),
      to_memory_id: Type.String(),
      relation_type: Type.Union([
        Type.Literal('derived_from'),
        Type.Literal('supports'),
        Type.Literal('related_to'),
        Type.Literal('supersedes'),
      ]),
      metadata_json: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        assertGitMemoryEnabled(context);
        const result = addCommitChangelogLink(db, params);
        return ok(`Link saved: ${result.link.id}${result.warning ? ` (${result.warning})` : ''}`, result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_release_candidates_search',
    label: 'Memory Release Candidates Search',
    description: 'Search release-impacting commit records that are not yet linked to a release/tag record.',
    parameters: Type.Object({
      scope: Type.Optional(Scope),
      project_mode: Type.Optional(ProjectMode),
      project_name: Type.Optional(Type.String()),
      repo: Type.Optional(Type.String()),
      branch: Type.Optional(Type.String()),
      change_type: Type.Optional(Type.Union([
        Type.Literal('fix'),
        Type.Literal('feature'),
        Type.Literal('chore'),
        Type.Literal('docs'),
        Type.Literal('refactor'),
        Type.Literal('test'),
        Type.Literal('sync'),
        Type.Literal('other'),
      ])),
      release_impact: Type.Optional(Type.Union([
        Type.Literal('major'),
        Type.Literal('minor'),
        Type.Literal('patch'),
      ])),
      since: Type.Optional(Type.String()),
      until: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        assertGitMemoryEnabled(context);
        const results = searchReleaseCandidates(db, params ?? {}, context);
        return ok(resultListText(`Found ${results.results.length} release candidate commit(s).`, results.results), results);
      } catch (e) {
        return fail(e);
      }
    },
    renderResult: renderMemoryToolResult,
  });

  pi.registerTool({
    name: 'memory_release_notes_preview',
    label: 'Memory Release Notes Preview',
    description: 'Preview release notes from unlinked release candidate commit records. Read-only: does not edit changelog files or create memory records.',
    parameters: Type.Object({
      scope: Type.Optional(Scope),
      project_mode: Type.Optional(ProjectMode),
      project_name: Type.Optional(Type.String()),
      repo: Type.Optional(Type.String()),
      branch: Type.Optional(Type.String()),
      change_type: Type.Optional(Type.Union([
        Type.Literal('fix'),
        Type.Literal('feature'),
        Type.Literal('chore'),
        Type.Literal('docs'),
        Type.Literal('refactor'),
        Type.Literal('test'),
        Type.Literal('sync'),
        Type.Literal('other'),
      ])),
      release_impact: Type.Optional(Type.Union([
        Type.Literal('major'),
        Type.Literal('minor'),
        Type.Literal('patch'),
      ])),
      version: Type.Optional(Type.String()),
      release_tag: Type.Optional(Type.String()),
      since: Type.Optional(Type.String()),
      until: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        assertGitMemoryEnabled(context);
        const result = previewReleaseNotes(db, params ?? {}, context);
        return ok(result.text || 'No release candidate notes found.', result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_release_record_add',
    label: 'Memory Release Record Add',
    description: 'Create a release/tag memory record and explicitly link selected commit records without generating changelog content.',
    parameters: Type.Object({
      scope: Type.Optional(Scope),
      version: Type.String(),
      release_tag: Type.String(),
      release_date: Type.Optional(Type.String()),
      commit_ids: Type.Array(Type.String()),
      title: Type.Optional(Type.String()),
      summary: Type.Optional(Type.String()),
      content: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      confidence: Type.Optional(Type.Number()),
      importance: Type.Optional(Type.Number()),
      metadata_json: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        assertGitMemoryEnabled(context);
        const result = addReleaseRecord(db, params, context);
        return ok(`Release record saved: ${result.memory.title ?? result.memory.id}${result.warning ? ` (${result.warning})` : ''}`, result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: 'memory_commit_changelog_search',
    label: 'Memory Commit Changelog Search',
    description: 'Search commit records, changelog entries, and optional provenance links.',
    parameters: Type.Object({
      query: Type.Optional(Type.String()),
      record_types: Type.Optional(Type.Array(Type.Union([Type.Literal('commit_record'), Type.Literal('changelog_entry'), Type.Literal('release_record')]))),
      scope: Type.Optional(Scope),
      project_mode: Type.Optional(ProjectMode),
      project_name: Type.Optional(Type.String()),
      repo: Type.Optional(Type.String()),
      commit_hash: Type.Optional(Type.String()),
      branch: Type.Optional(Type.String()),
      change_type: Type.Optional(Type.Union([
        Type.Literal('fix'),
        Type.Literal('feature'),
        Type.Literal('chore'),
        Type.Literal('docs'),
        Type.Literal('refactor'),
        Type.Literal('test'),
        Type.Literal('sync'),
        Type.Literal('other'),
      ])),
      release_impact: Type.Optional(Type.Union([
        Type.Literal('major'),
        Type.Literal('minor'),
        Type.Literal('patch'),
        Type.Literal('none'),
      ])),
      version: Type.Optional(Type.String()),
      release_tag: Type.Optional(Type.String()),
      section: Type.Optional(Type.String()),
      status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('archived'), Type.Literal('superseded')])),
      since: Type.Optional(Type.String()),
      until: Type.Optional(Type.String()),
      include_links: Type.Optional(Type.Boolean()),
      include_related: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        assertGitMemoryEnabled(context);
        const results = searchCommitChangelog(db, params ?? {}, context);
        return ok(resultListText(`Found ${results.results.length} commit/changelog result(s).`, results.results), results);
      } catch (e) {
        return fail(e);
      }
    },
    renderResult: renderMemoryToolResult,
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
        const results = observeRetrieval(db, context, {
          operation: 'search',
          trigger_category: 'tool_call',
          session_id: getCurrentMemorySessionId() ?? null,
        }, () => searchMemory(db, { ...params, current_session_id: getCurrentMemorySessionId() }, context).results);
        return ok(resultListText(`Found ${results.length} memory result(s).`, results), { results });
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
        const results = observeRetrieval(
          db,
          context,
          {
            operation: 'recall',
            trigger_category: 'tool_call',
            session_id: getCurrentMemorySessionId() ?? null,
          },
          () => searchMemory(
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
          ).results,
        );
        return ok(`Recalled ${results.length} item(s).`, { results, recall_context: moment, query });
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
    description: 'Export local memory to the configured JSONL backup.',
    parameters: Type.Object({
      format: Type.Optional(Type.Union([Type.Literal('jsonl'), Type.Literal('sqlite')])),
      mode: Type.Optional(ExportMode),
      include_archived: Type.Optional(Type.Boolean()),
      include_sessions: Type.Optional(Type.Boolean()),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
        const input = resolveExportDefaults(params, context);
        const result = exportMemory(db, input);
        return ok(`Memory backup exported (${result.mode}): ${result.path}`, { ...result, warnings: context.warnings });
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
        return ok(`Memory import ${result.mode}: ${result.inserted} inserted, ${result.would_insert} would insert, ${result.conflicts} conflicts.`, {
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
