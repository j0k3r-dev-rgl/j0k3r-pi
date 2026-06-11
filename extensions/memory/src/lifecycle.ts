import type { Db } from './db.js';
import { resolveMemoryContext } from './context.js';
import { listMemories } from './memory-store.js';
import { addSessionPrompt, finishMemorySession, startMemorySession } from './sessions.js';
import { setCurrentMemorySessionId } from './runtime-state.js';
import { buildHeuristicSessionSummary, buildSemanticSessionSummary, extractConversationFacts } from './session-summary.js';
import { autoUpdateProjectProfileFromSession, semanticUpdateProjectProfileFromSession } from './project-profile.js';

function buildMemoryInstructions(context: any): string {
  const projectLine = context.scope === 'project'
    ? `Current memory project: ${context.project_name} (${context.project_id}).`
    : 'Current memory scope: general; no active project.';

  return [
    'Pi Memory Extension is active. Treat it as the agent persistent brain.',
    projectLine,
    'Behavior rules:',
    '- Use memory intelligently, not mechanically: first rely on startup brain context, loaded skill content, and current conversation.',
    '- Call memory_search or memory_recall only when persistent context is missing, stale, ambiguous, or needed for a decision; do not repeat recall just because a task moves from edit to test if the relevant context is already in conversation.',
    '- For substantial tasks in this project, inspect the current project profile early with memory_project_profile get unless startup context already includes an up-to-date profile.',
    '- Prefer local project memory plus general preferences and global rules; do not use other project memories unless explicitly requested or cwd is HOME.',
    '- Store durable reusable knowledge with memory_add: user preferences, confirmed project decisions, workflow/policy decisions, commands, constraints, architecture, bugs, todos, learnings, progress, and project_profile updates.',
    '- Ask before saving global or general user preferences, large project_profile rewrites, contradictions, or policy changes that affect future agents.',
    '- After a meaningful discussion or substantial work, perform a brief decision checkpoint: identify confirmed decisions, durable workflow rules, validated commands, open todos, risks accepted, and reusable learnings; save only the durable non-sensitive items.',
    '- Write memory titles, summaries, contents, and tags in english lowercase to improve retrieval consistency.',
    '- Good memories are durable, actionable, atomic, recoverable, current, and non-sensitive.',
    '- Memory content should include the idea type, context, concrete details, implications for future agents, and source when useful.',
    '- Load the `persistent-memory` skill when you need detailed memory operating policy and it is not already loaded in the conversation: substantial tasks, deciding what to save, project_profile updates, consolidation, migration, import/export, or session-end summaries.',
    '- At the end of substantial work, summarize what changed, decisions made, progress, validations, open todos, and reusable learnings.',
    '- For user-requested commits, precommit checkpoint memories must summarize what was accomplished, why it matters, decisions/tradeoffs, validations, open todos, and risks; do not save only changed files or timestamps.',
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

  function findExistingSessionByPiFile(piSessionFile: string | null, context: any): any | undefined {
    if (!piSessionFile) return undefined;
    const rows = db.prepare(`SELECT * FROM memory_sessions
      WHERE (? != 'project' OR scope != 'project' OR project_id = ?)
      ORDER BY started_at DESC
      LIMIT 100`).all(context.scope, context.project_id) as any[];
    return rows.find((row) => {
      try {
        const meta = JSON.parse(row.metadata_json || '{}');
        return meta.pi_session_file === piSessionFile;
      } catch {
        return false;
      }
    });
  }

  function ensureMemorySession(ctx: any): { id: string; context: any } {
    const context = resolveMemoryContext(ctx?.cwd ?? process.cwd());
    if (!activeMemorySessionId) {
      const piSessionFile = ctx?.sessionManager?.getSessionFile?.() ?? null;
      const existing = findExistingSessionByPiFile(piSessionFile, context);
      if (existing) {
        activeMemorySessionId = existing.id;
        setCurrentMemorySessionId(activeMemorySessionId);
        sessionClosed = false;
        db.prepare('UPDATE memory_sessions SET ended_at=NULL WHERE id=?').run(existing.id);
        const maxPrompt = db.prepare('SELECT COALESCE(MAX(prompt_index), 0) AS max_index FROM memory_session_prompts WHERE session_id=?').get(existing.id) as any;
        promptIndex = Number(maxPrompt?.max_index ?? 0);
      } else {
        const session = startMemorySession(db, {
          title: `Pi session ${new Date().toISOString()}`,
          metadata_json: {
            pi_session_file: piSessionFile,
            auto_started: true,
          },
        }, context) as any;
        activeMemorySessionId = session.id;
        setCurrentMemorySessionId(activeMemorySessionId);
      }
    }
    setCurrentMemorySessionId(activeMemorySessionId);
    return { id: activeMemorySessionId!, context };
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

  pi.on?.('session_start', async (_event: any, ctx: any) => {
    const { context } = ensureMemorySession(ctx);
    ctx.ui?.setStatus?.('memory', `memory:${context.scope}${context.project_name ? `/${context.project_name}` : ''}`);
  });

  pi.on?.('before_agent_start', async (event: any, ctx: any) => {
    const prompt = String(event.prompt ?? '');
    const { id: sessionId, context: c } = ensureMemorySession(ctx);

    if (prompt.trim()) {
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
        ? startupItems.map((m: any) => `- ${m.type} · ${m.scope}${m.project_name ? `/${m.project_name}` : ''} · ${m.kind ?? ''} · ${m.title ?? String(m.snippet).slice(0, 180)}`).join('\n')
        : '- No recent local memories or session summaries found yet.';
      return {
        message: {
          customType: 'memory-context',
          display: true,
          content: `${instructions}\n\nMemory session: ${sessionId}\n\nStartup brain context (recent memories and session summaries):\n${startupLines}`,
        },
      };
    }

    // After startup, do not inject memory automatically on every turn.
    // The agent has the brain instructions and should call memory_search/memory_recall
    // only when the task actually needs persistent context.
    return undefined;
  });

  pi.on?.('session_shutdown', async (event: any, ctx: any) => {
    const reason = event?.reason ?? 'shutdown';
    if (reason === 'reload') return;
    await closeActiveMemorySession(ctx, reason);
  });
}
