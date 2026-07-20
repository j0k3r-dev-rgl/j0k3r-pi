import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';
import { resolveMemoryContext } from './context.js';
import { listMemories } from './memory-store.js';
import { addSessionPrompt, finishMemorySession, reopenMemorySessionIfClosed, startMemorySession } from './sessions.js';
import { setCurrentMemorySessionId } from './runtime-state.js';
import { buildHeuristicSessionSummary, buildSemanticSessionSummary, extractConversationFacts } from './session-summary.js';
import { autoUpdateProjectProfileFromSession, semanticUpdateProjectProfileFromSession } from './project-profile.js';

const MEMORY_SESSION_ENTRY_TYPE = 'memory-session';
const RECENT_ACTIVE_FALLBACK_MS = 15 * 60 * 1000;
const STARTUP_SNIPPET_LIMIT = 160;
const SUBAGENT_SESSION_REGISTRY_KEY = Symbol.for('pi.permissionGuard.subagentSessions');

function compactStartupSnippet(value: unknown): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= STARTUP_SNIPPET_LIMIT) return normalized;
  return `${normalized.slice(0, STARTUP_SNIPPET_LIMIT - 1).trimEnd()}…`;
}

function memoryDebugLog(ctx: any, event: string, data: Record<string, unknown> = {}): void {
  try {
    const cwd = ctx?.cwd ?? process.cwd();
    const context = resolveMemoryContext(cwd);
    if (context.config?.debug !== true) return;
    const sessionManager = ctx?.sessionManager;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      cwd,
      mode: ctx?.mode ?? null,
      pi_session_id: sessionManager?.getSessionId?.() ?? null,
      pi_session_file: sessionManager?.getSessionFile?.() ?? null,
      pi_session_persisted: sessionManager?.isPersisted?.() ?? null,
      pi_leaf_id: sessionManager?.getLeafId?.() ?? null,
      pi_entries_count: sessionManager?.getEntries?.()?.length ?? null,
      ...data,
    });
    fs.appendFileSync(path.join(cwd, 'memory-session-debug.log'), `${line}\n`, 'utf8');
  } catch {
    // Debug logging must never affect the memory lifecycle.
  }
}

function buildMemoryInstructions(context: any): string {
  const projectLine = context.scope === 'project'
    ? `Current memory project: ${context.project_name} (${context.project_id}).`
    : 'Current memory scope: general; no active project.';

  return [
    'Pi Memory Extension is active. Treat it as the agent persistent brain.',
    projectLine,
    'Behavior rules:',
    '- Use memory intelligently, not mechanically: first rely on startup brain context, loaded skill content, and current conversation.',
    '- Startup brain context is a compact index, not fully loaded knowledge. If an item may matter, search for it and use memory_get only for the selected full record.',
    '- Proactively call memory_search with specific task terms when the request may depend on previous work, prior decisions, user preferences, project conventions, unresolved todos, or known bugs.',
    '- Use memory_recall for broad workflow context when the task phase needs missing or uncertain project history. Do not repeat retrieval when the relevant context is already in the conversation.',
    '- Skip retrieval for tiny self-contained tasks that clearly cannot benefit from project history.',
    '- For substantial tasks in this project, inspect the current project profile early with memory_project_profile get unless startup context already includes an up-to-date profile.',
    '- Prefer local project memory plus general preferences and global rules; do not use other project memories unless explicitly requested or cwd is HOME.',
    '- Store durable reusable knowledge with memory_add: user preferences, confirmed project decisions, workflow/policy decisions, commands, constraints, architecture, bugs, todos, learnings, progress, and project_profile updates.',
    '- Ask before saving global or general user preferences, large project_profile rewrites, contradictions, or policy changes that affect future agents.',
    '- After a meaningful discussion or substantial work, perform a brief decision checkpoint: identify confirmed decisions, durable workflow rules, validated commands, open todos, risks accepted, and reusable learnings; save only the durable non-sensitive items.',
    '- Write memory titles, summaries, contents, and tags in english lowercase to improve retrieval consistency.',
    '- Good memories are durable, actionable, atomic, recoverable, current, and non-sensitive.',
    '- Memory content should include the idea type, context, concrete details, implications for future agents, and source when useful.',
    '- Load the `persistent-memory` skill when you need detailed memory operating policy and it is not already loaded in the conversation: substantial tasks, deciding what to save, project_profile updates, consolidation, import/export, or session-end summaries.',
    '- At the end of substantial work, summarize what changed, decisions made, progress, validations, open todos, and reusable learnings.',
    '- Do not store secrets, tokens, passwords, private keys, or low-value temporary details.',
    '- memory_search returns compact candidates; use memory_get only when full content is needed.',
    '- Use memory_archive instead of deleting obsolete memories.',
  ].join('\n');
}

export function registerMemoryLifecycle(pi: any, db: Db): void {
  let activeMemorySessionId: string | undefined;
  let promptIndex = 0;
  let startupContextInjected = false;
  let sessionClosed = false;

  function startupContextAlreadyPersisted(ctx: any): boolean {
    const entries = ctx?.sessionManager?.getEntries?.() ?? ctx?.sessionManager?.getBranch?.() ?? [];
    return entries.some((entry: any) => entry?.type === 'custom_message' && entry?.customType === 'memory-context');
  }

  function memorySessionEntryId(ctx: any): string | null {
    const entries = ctx?.sessionManager?.getEntries?.() ?? ctx?.sessionManager?.getBranch?.() ?? [];
    for (const entry of [...entries].reverse()) {
      if (entry?.type === 'custom' && entry?.customType === MEMORY_SESSION_ENTRY_TYPE && typeof entry?.data?.memory_session_id === 'string') {
        return entry.data.memory_session_id;
      }
    }
    return null;
  }

  function findSessionByMemoryId(memorySessionId: string | null, context: any): any | undefined {
    if (!memorySessionId) return undefined;
    return db.prepare(`SELECT * FROM memory_sessions
      WHERE id = ?
        AND status IN ('active','completed')
        AND (? != 'project' OR scope != 'project' OR project_id = ?)
      LIMIT 1`).get(memorySessionId, context.scope, context.project_id) as any | undefined;
  }

  function parseSessionMetadata(row: any): Record<string, unknown> {
    try { return JSON.parse(row?.metadata_json || '{}') as Record<string, unknown>; }
    catch { return {}; }
  }

  function subagentRuntimeMetadata(ctx: any): Record<string, unknown> | undefined {
    const piSessionId = ctx?.sessionManager?.getSessionId?.() ?? null;
    if (!piSessionId) return undefined;
    const registry = (globalThis as Record<symbol, unknown>)[SUBAGENT_SESSION_REGISTRY_KEY];
    if (!(registry instanceof Map)) return undefined;
    const metadata = registry.get(piSessionId) as any;
    if (metadata?.origin !== 'subagent') return undefined;
    const parentPiSessionId = metadata.parent?.piSessionId ?? null;
    const result: Record<string, unknown> = {
      origin: 'subagent',
      subagent_name: metadata.requester?.subagentName ?? metadata.requester?.subagentId ?? null,
      subagent_description: metadata.requester?.description ?? null,
      subagent_task_id: metadata.requester?.taskId ?? null,
      parent_pi_session_id: parentPiSessionId,
    };
    if (parentPiSessionId) {
      const parent = db.prepare(`SELECT id FROM memory_sessions
        WHERE metadata_json LIKE ?
        ORDER BY started_at DESC
        LIMIT 1`).get(`%${parentPiSessionId}%`) as any;
      if (parent?.id) result.parent_memory_session_id = parent.id;
    }
    return result;
  }

  function mergeSessionMetadata(sessionId: string, updates: Record<string, unknown>): void {
    if (!Object.keys(updates).length) return;
    const row = db.prepare('SELECT metadata_json FROM memory_sessions WHERE id=?').get(sessionId) as any;
    const metadata = { ...(row?.metadata_json ? parseSessionMetadata(row) : {}), ...updates };
    db.prepare('UPDATE memory_sessions SET metadata_json=? WHERE id=?').run(JSON.stringify(metadata), sessionId);
  }

  function findRecentActiveSession(context: any): any | undefined {
    const since = new Date(Date.now() - RECENT_ACTIVE_FALLBACK_MS).toISOString();
    const rows = db.prepare(`SELECT * FROM memory_sessions
      WHERE status = 'active'
        AND ended_at IS NULL
        AND started_at >= ?
        AND (? != 'project' OR scope != 'project' OR project_id = ?)
      ORDER BY started_at DESC
      LIMIT 5`).all(since, context.scope, context.project_id) as any[];
    const candidates = rows.filter((row) => {
      const meta = parseSessionMetadata(row);
      return meta.auto_started === true && meta.cwd === context.cwd;
    });
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  function findExistingSessionByPiIdentity(piSessionId: string | null, piSessionFile: string | null, entryMemorySessionId: string | null, context: any): any | undefined {
    const rows = db.prepare(`SELECT * FROM memory_sessions
      WHERE status IN ('active','completed')
        AND (? != 'project' OR scope != 'project' OR project_id = ?)
      ORDER BY started_at DESC
      LIMIT 100`).all(context.scope, context.project_id) as any[];
    const parsed = rows.map((row) => ({ row, meta: parseSessionMetadata(row) }));
    if (piSessionId) {
      const byId = parsed.find(({ meta }) => meta.pi_session_id === piSessionId);
      if (byId) return byId.row;
    }
    if (piSessionFile) {
      const byFile = parsed.find(({ meta }) => meta.pi_session_file === piSessionFile);
      if (byFile) return byFile.row;
    }
    const byEntry = findSessionByMemoryId(entryMemorySessionId, context);
    if (byEntry) return byEntry;
    if (piSessionId || piSessionFile || entryMemorySessionId) return undefined;
    return findRecentActiveSession(context);
  }

  function persistMemorySessionEntry(ctx: any, context: any, memorySessionId: string, piSessionId: string | null, piSessionFile: string | null): void {
    const entries = ctx?.sessionManager?.getEntries?.() ?? ctx?.sessionManager?.getBranch?.() ?? [];
    const alreadyPersisted = entries.some((entry: any) => entry?.type === 'custom' && entry?.customType === MEMORY_SESSION_ENTRY_TYPE && entry?.data?.memory_session_id === memorySessionId);
    if (alreadyPersisted) return;
    try {
      pi.appendEntry?.(MEMORY_SESSION_ENTRY_TYPE, {
        memory_session_id: memorySessionId,
        project_id: context.project_id,
        project_name: context.project_name,
        pi_session_id: piSessionId,
        pi_session_file: piSessionFile,
      });
    } catch {
      // Session-entry persistence is a fallback and must not affect memory startup.
    }
  }

  function ensureMemorySession(ctx: any, options: { reopenClosed?: boolean } = {}): { id: string; context: any; closed: boolean } {
    const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
    const piSessionId = ctx?.sessionManager?.getSessionId?.() ?? null;
    const piSessionFile = ctx?.sessionManager?.getSessionFile?.() ?? null;
    const entryMemorySessionId = memorySessionEntryId(ctx);
    if (!activeMemorySessionId) {
      memoryDebugLog(ctx, 'ensure_memory_session:no_active', {
        memory_scope: context.scope,
        memory_project_id: context.project_id ?? null,
        memory_project_name: context.project_name ?? null,
        pi_session_id_seen: piSessionId,
        pi_session_file_seen: piSessionFile,
        memory_session_entry_id_seen: entryMemorySessionId,
      });
      const existing = findExistingSessionByPiIdentity(piSessionId, piSessionFile, entryMemorySessionId, context);
      if (existing) {
        activeMemorySessionId = existing.id;
        setCurrentMemorySessionId(activeMemorySessionId);
        const shouldReopen = options.reopenClosed === true || (existing.status === 'active' && existing.ended_at == null);
        sessionClosed = !shouldReopen;
        const metadata = parseSessionMetadata(existing);
        if (piSessionId) metadata.pi_session_id = piSessionId;
        if (piSessionFile) metadata.pi_session_file = piSessionFile;
        metadata.cwd = context.cwd;
        Object.assign(metadata, subagentRuntimeMetadata(ctx) ?? {});
        if (shouldReopen) db.prepare("UPDATE memory_sessions SET ended_at=NULL, status='active', metadata_json=? WHERE id=?").run(JSON.stringify(metadata), existing.id);
        else db.prepare("UPDATE memory_sessions SET metadata_json=? WHERE id=?").run(JSON.stringify(metadata), existing.id);
        const maxPrompt = db.prepare('SELECT COALESCE(MAX(prompt_index), 0) AS max_index FROM memory_session_prompts WHERE session_id=?').get(existing.id) as any;
        promptIndex = Number(maxPrompt?.max_index ?? 0);
        persistMemorySessionEntry(ctx, context, activeMemorySessionId!, piSessionId, piSessionFile);
        memoryDebugLog(ctx, 'ensure_memory_session:reused_by_identity', {
          memory_session_id: activeMemorySessionId,
          prompt_index: promptIndex,
        });
      } else {
        const session = startMemorySession(db, {
          title: `Pi session ${new Date().toISOString()}`,
          metadata_json: {
            pi_session_id: piSessionId,
            pi_session_file: piSessionFile,
            cwd: context.cwd,
            auto_started: true,
            ...(subagentRuntimeMetadata(ctx) ?? {}),
          },
        }, context) as any;
        activeMemorySessionId = session.id;
        setCurrentMemorySessionId(activeMemorySessionId);
        persistMemorySessionEntry(ctx, context, activeMemorySessionId!, piSessionId, piSessionFile);
        memoryDebugLog(ctx, 'ensure_memory_session:created', {
          memory_session_id: activeMemorySessionId,
          pi_session_id_stored: piSessionId,
          pi_session_file_stored: piSessionFile,
        });
      }
    } else {
      persistMemorySessionEntry(ctx, context, activeMemorySessionId, piSessionId, piSessionFile);
      const reopened = options.reopenClosed === true ? reopenMemorySessionIfClosed(db, activeMemorySessionId, context) : false;
      if (reopened) sessionClosed = false;
      mergeSessionMetadata(activeMemorySessionId, subagentRuntimeMetadata(ctx) ?? {});
      memoryDebugLog(ctx, 'ensure_memory_session:already_active', {
        memory_session_id: activeMemorySessionId,
        prompt_index: promptIndex,
        session_closed: sessionClosed,
        reopened,
      });
    }
    setCurrentMemorySessionId(activeMemorySessionId);
    return { id: activeMemorySessionId!, context, closed: sessionClosed };
  }

  async function closeActiveMemorySession(ctx: any, reason: string): Promise<void> {
    if (!activeMemorySessionId || sessionClosed) return;
    const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
    try {
      const session = db.prepare('SELECT * FROM memory_sessions WHERE id=?').get(activeMemorySessionId) as any;
      const prompts = db.prepare(`SELECT role, prompt_index, prompt, created_at
        FROM memory_session_prompts
        WHERE session_id=?
        ORDER BY prompt_index ASC
        LIMIT 100`).all(activeMemorySessionId) as any[];
      const memories = db.prepare(`SELECT kind, title, summary, created_at
        FROM memories
        WHERE (? != 'project' OR scope != 'project' OR project_id = ?)
          AND created_at >= ?
        ORDER BY created_at ASC
        LIMIT 50`).all(context.scope, context.project_id, session?.started_at ?? '1970-01-01T00:00:00.000Z') as any[];
      const conversationFacts = extractConversationFacts(ctx?.sessionManager?.getBranch?.() ?? ctx?.sessionManager?.getEntries?.() ?? []);
      const semanticShutdownEnabled = context.config?.session_end.semantic === true;
      const evidence = {
        reason,
        promptCount: prompts.length,
        durableMemories: memories,
        decisions: memories.filter((m) => m.kind === 'decision' || m.kind === 'architectural_decision'),
        todos: memories.filter((m) => m.kind === 'todo'),
        progress: memories.filter((m) => m.kind === 'progress' || m.kind === 'project_profile'),
        validations: [...memories.filter((m) => m.kind === 'command').map((m) => m.title), ...conversationFacts.commands.filter((cmd) => /\b(test|typecheck|lint|build)\b/i.test(cmd))],
        filesTouched: conversationFacts.files,
        semanticSummaryDisabled: !semanticShutdownEnabled,
      };
      let summaryError: string | undefined;
      const generated = semanticShutdownEnabled
        ? await buildSemanticSessionSummary(ctx, evidence).catch((error) => {
          summaryError = error instanceof Error ? error.message : String(error);
          ctx?.ui?.notify?.(`Semantic memory summary unavailable: ${summaryError}`, 'warning');
          return null;
        })
        : null;
      const { summary, learned } = generated ?? buildHeuristicSessionSummary(evidence);

      finishMemorySession(db, {
        session_id: activeMemorySessionId,
        summary,
        learned,
        metadata_json: {
          summary_source: generated ? 'semantic' : 'heuristic',
          summary_model: generated ? `${ctx?.model?.provider ?? 'unknown'}/${ctx?.model?.id ?? ctx?.model?.name ?? 'unknown'}` : null,
          summary_generated_at: new Date().toISOString(),
          summary_error: summaryError ?? null,
        },
      }, context);
      const profileFacts = {
        session_id: activeMemorySessionId,
        summary,
        learned,
        decisions: evidence.decisions.map((m) => m.title ?? m.summary).filter(Boolean) as string[],
        validations: evidence.validations.filter(Boolean) as string[],
        filesTouched: evidence.filesTouched,
        todos: evidence.todos.map((m) => m.title ?? m.summary).filter(Boolean) as string[],
      };
      const semanticProfileUpdate = semanticShutdownEnabled
        ? await semanticUpdateProjectProfileFromSession(db, context, profileFacts, ctx).catch((error) => {
          ctx?.ui?.notify?.(`Semantic project profile update unavailable: ${error instanceof Error ? error.message : String(error)}`, 'warning');
          return null;
        })
        : null;
      const profileUpdate = semanticProfileUpdate ?? autoUpdateProjectProfileFromSession(db, context, profileFacts);
      if (profileUpdate.updated) ctx?.ui?.notify?.('Project profile auto-updated from session summary.', 'info');
      sessionClosed = true;
      setCurrentMemorySessionId(undefined);
    } catch (error) {
      ctx?.ui?.notify?.(`Memory session close skipped: ${error instanceof Error ? error.message : String(error)}`, 'warning');
    }
  }

  pi.on?.('session_start', async (event: any, ctx: any) => {
    startupContextInjected = startupContextAlreadyPersisted(ctx);
    memoryDebugLog(ctx, 'session_start', {
      reason: event?.reason ?? null,
      previous_session_file: event?.previousSessionFile ?? null,
      active_memory_session_id_before: activeMemorySessionId ?? null,
      session_closed: sessionClosed,
    });
    const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
    memoryDebugLog(ctx, 'session_start:ready', {
      reason: event?.reason ?? null,
      active_memory_session_id_after: activeMemorySessionId ?? null,
      memory_scope: context.scope,
      memory_project_name: context.project_name ?? null,
    });
    ctx.ui?.setStatus?.('memory', `memory:${context.scope}${context.project_name ? `/${context.project_name}` : ''}`);
  });

  pi.on?.('before_agent_start', async (event: any, ctx: any) => {
    const prompt = String(event.prompt ?? '');
    const hasPrompt = prompt.trim().length > 0;
    memoryDebugLog(ctx, 'before_agent_start', {
      has_prompt: hasPrompt,
      active_memory_session_id_before: activeMemorySessionId ?? null,
      startup_context_injected: startupContextInjected,
      session_closed: sessionClosed,
    });
    if (!hasPrompt) return undefined;

    startupContextInjected ||= startupContextAlreadyPersisted(ctx);
    const { id: sessionId, context: c, closed } = ensureMemorySession(ctx, { reopenClosed: true });

    if (!closed) {
      try {
        addSessionPrompt(db, {
          session_id: sessionId,
          role: 'user',
          prompt,
          prompt_index: ++promptIndex,
          metadata_json: { source: 'before_agent_start', auto_captured: true },
        }, c);
      } catch (error) {
        ctx.ui?.notify?.(`Memory prompt capture skipped: ${error instanceof Error ? error.message : String(error)}`, 'warning');
      }
    }

    const instructions = buildMemoryInstructions(c);

    if (!startupContextInjected) {
      startupContextInjected = true;
      const recentMemories = listMemories(db, { limit: 4 }, c).map((m: any) => ({
        type: 'memory',
        id: m.id,
        scope: m.scope,
        project_name: m.project_name,
        kind: m.kind,
        title: m.title,
        snippet: m.summary || m.content,
        updated_at: m.updated_at,
      }));
      const recentSessions = db.prepare(`SELECT id, scope, project_name, title, summary, learned, ended_at, started_at
        FROM memory_sessions
        WHERE status = 'completed'
          AND id != ?
          AND (summary IS NOT NULL OR learned IS NOT NULL)
          AND (? != 'project' OR scope != 'project' OR project_id = ?)
        ORDER BY COALESCE(ended_at, started_at) DESC
        LIMIT 1`).all(sessionId, c.scope, c.project_id) as any[];
      const startupItems = [
        ...recentMemories,
        ...recentSessions.map((s) => ({
          type: 'session',
          id: s.id,
          scope: s.scope,
          project_name: s.project_name,
          kind: 'session_summary',
          title: s.title,
          snippet: s.summary || s.learned || 'Session without summary yet',
          updated_at: s.ended_at || s.started_at,
        })),
      ];
      const startupLines = startupItems.length
        ? startupItems.map((m: any) => {
          const title = compactStartupSnippet(m.title || m.snippet);
          const snippet = compactStartupSnippet(m.snippet);
          const indexedContent = snippet && snippet !== title ? `${title} — ${snippet}` : title;
          return `- ${m.type} · ${m.scope}${m.project_name ? `/${m.project_name}` : ''} · ${m.kind ?? ''} · ${indexedContent}`;
        }).join('\n')
        : '- No recent local memories or session summaries found yet.';
      return {
        message: {
          customType: 'memory-context',
          display: true,
          content: `${instructions}\n\nMemory session: ${sessionId}\n\nStartup brain context (recent memories and session summaries):\n${startupLines}`,
        },
      };
    }

    if (prompt.trim() && closed) return undefined;

    // After startup, do not inject memory automatically on every turn.
    // The agent has the brain instructions and should call memory_search/memory_recall
    // only when the task actually needs persistent context.
    return undefined;
  });

  pi.on?.('session_shutdown', async (event: any, ctx: any) => {
    const reason = event?.reason ?? 'shutdown';
    memoryDebugLog(ctx, 'session_shutdown', {
      reason,
      target_session_file: event?.targetSessionFile ?? null,
      active_memory_session_id_before: activeMemorySessionId ?? null,
      session_closed: sessionClosed,
    });
    if (reason === 'reload') {
      memoryDebugLog(ctx, 'session_shutdown:reload_skipped_close', {
        active_memory_session_id: activeMemorySessionId ?? null,
      });
      return;
    }
    await closeActiveMemorySession(ctx, reason);
    memoryDebugLog(ctx, 'session_shutdown:closed', {
      reason,
      active_memory_session_id_after: activeMemorySessionId ?? null,
      session_closed: sessionClosed,
    });
  });
}
