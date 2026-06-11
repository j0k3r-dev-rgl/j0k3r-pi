import type { Db } from './db.js';
import type { MemoryScope, ResolvedContext } from './types.js';
import { snippet } from './utils.js';

export interface SearchInput {
  query: string;
  scopes?: MemoryScope[];
  project_mode?: 'current' | 'all' | 'selected';
  project_name?: string;
  kinds?: string[];
  include_sessions?: boolean;
  include_prompts?: boolean;
  types?: Array<'memory' | 'session' | 'prompt'>;
  current_session_only?: boolean;
  current_session_id?: string;
  limit?: number;
  min_importance?: number;
}

function buildFtsQuery(raw: string): string {
  const terms = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[\p{L}\p{N}_]{2,}/gu)
    ?.slice(0, 12) ?? [];
  return terms.length ? terms.map((t) => t.replace(/"/g, '')).join(' OR ') : '*';
}

export function searchMemory(db: Db, input: SearchInput, context: ResolvedContext) {
  const scopes = input.scopes ?? ['global', 'general', 'project'];
  const projectMode = input.project_mode ?? (context.scope === 'project' ? 'current' : 'all');
  const types = input.types ?? (input.include_prompts === true ? ['memory', 'session', 'prompt'] : ['memory', 'session']);
  const limit = input.limit ?? 10;
  const results: any[] = [];
  const where = ['m.status = \'active\'', `m.scope IN (${scopes.map(() => '?').join(',')})`, 'm.importance >= ?'];
  const args: unknown[] = [...scopes, input.min_importance ?? 1];
  if (projectMode === 'current' && context.scope === 'project') { where.push('(m.scope != \'project\' OR m.project_id = ?)'); args.push(context.project_id); }
  if (projectMode === 'selected') { where.push('(m.scope != \'project\' OR m.project_name = ?)'); args.push(input.project_name ?? ''); }
  if (input.kinds?.length) { where.push(`m.kind IN (${input.kinds.map(() => '?').join(',')})`); args.push(...input.kinds); }
  const rawQuery = input.query.trim();
  const query = buildFtsQuery(rawQuery);
  let rows: any[] = [];
  if (types.includes('memory')) {
    try {
      rows = db.prepare(`SELECT m.*, bm25(memories_fts) AS rank FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid WHERE memories_fts MATCH ? AND ${where.join(' AND ')} ORDER BY rank, m.importance DESC, m.updated_at DESC LIMIT ?`).all(...([query, ...args, limit] as any[])) as any[];
    } catch {}
  }
  if (types.includes('memory') && !rows.length && rawQuery) {
    const likeTerms = (rawQuery.match(/[\p{L}\p{N}_]{2,}/gu) ?? [rawQuery]).slice(0, 6);
    const likeWhere = likeTerms.map(() => '(m.title LIKE ? OR m.summary LIKE ? OR m.content LIKE ? OR m.tags LIKE ?)').join(' OR ');
    const likeArgs = likeTerms.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`]);
    rows = db.prepare(`SELECT m.*, 0 AS rank FROM memories m WHERE ${where.join(' AND ')} AND (${likeWhere}) ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?`).all(...([...args, ...likeArgs, limit] as any[])) as any[];
  }
  for (const r of rows) results.push({ id: r.id, type: 'memory', scope: r.scope, project_name: r.project_name, kind: r.kind, title: r.title, snippet: snippet(r.summary || r.content), score: Number(r.rank ?? 0), importance: r.importance, confidence: r.confidence, updated_at: r.updated_at });

  if ((input.include_sessions ?? true) && types.includes('session')) {
    const sessionWhere = ['s.status IN (\'active\', \'completed\')', `s.scope IN (${scopes.map(() => '?').join(',')})`];
    const sessionArgs: unknown[] = [...scopes];
    if (projectMode === 'current' && context.scope === 'project') { sessionWhere.push('(s.scope != \'project\' OR s.project_id = ?)'); sessionArgs.push(context.project_id); }
    if (projectMode === 'selected') { sessionWhere.push('(s.scope != \'project\' OR s.project_name = ?)'); sessionArgs.push(input.project_name ?? ''); }
    if (input.current_session_only && input.current_session_id) { sessionWhere.push('s.id = ?'); sessionArgs.push(input.current_session_id); }
    let sessions: any[] = [];
    try { sessions = db.prepare(`SELECT s.*, bm25(memory_sessions_fts) AS rank FROM memory_sessions_fts JOIN memory_sessions s ON s.rowid = memory_sessions_fts.rowid WHERE memory_sessions_fts MATCH ? AND ${sessionWhere.join(' AND ')} ORDER BY rank, s.started_at DESC LIMIT ?`).all(...([query, ...sessionArgs, Math.max(1, Math.floor(limit / 2))] as any[])) as any[]; } catch {}
    for (const s of sessions) results.push({ id: s.id, type: 'session', scope: s.scope, project_name: s.project_name, kind: 'session_summary', title: s.title, snippet: snippet(s.summary || s.learned || ''), score: Number(s.rank ?? 0), updated_at: s.ended_at || s.started_at });
  }

  if (input.include_prompts === true && types.includes('prompt')) {
    const promptWhere = [`s.scope IN (${scopes.map(() => '?').join(',')})`];
    const promptArgs: unknown[] = [...scopes];
    if (projectMode === 'current' && context.scope === 'project') { promptWhere.push('(s.scope != \'project\' OR s.project_id = ?)'); promptArgs.push(context.project_id); }
    if (projectMode === 'selected') { promptWhere.push('(s.scope != \'project\' OR s.project_name = ?)'); promptArgs.push(input.project_name ?? ''); }
    if (input.current_session_only && input.current_session_id) { promptWhere.push('p.session_id = ?'); promptArgs.push(input.current_session_id); }
    let prompts: any[] = [];
    try {
      prompts = db.prepare(`SELECT p.id, p.role, p.prompt, p.created_at, s.scope, s.project_name
        FROM memory_session_prompts_fts f
        JOIN memory_session_prompts p ON p.rowid = f.rowid
        JOIN memory_sessions s ON s.id = p.session_id
        WHERE memory_session_prompts_fts MATCH ? AND ${promptWhere.join(' AND ')}
        ORDER BY p.created_at DESC LIMIT ?`).all(...([query, ...promptArgs, Math.max(1, Math.floor(limit / 2))] as any[])) as any[];
    } catch {}
    if (input.current_session_only && input.current_session_id) {
      const seen = new Set(prompts.map((p) => p.id));
      try {
        const recent = db.prepare(`SELECT p.id, p.role, p.prompt, p.created_at, s.scope, s.project_name
          FROM memory_session_prompts p
          JOIN memory_sessions s ON s.id = p.session_id
          WHERE ${promptWhere.join(' AND ')}
          ORDER BY p.created_at DESC LIMIT ?`).all(...([...promptArgs, Math.max(1, Math.floor(limit / 2))] as any[])) as any[];
        for (const p of recent) if (!seen.has(p.id)) prompts.push(p);
      } catch {}
    }
    for (const p of prompts) results.push({ id: p.id, type: 'prompt', scope: p.scope, project_name: p.project_name, kind: 'prompt', title: `Prompt ${p.role}`, snippet: snippet(p.prompt), score: 0, updated_at: p.created_at });
  }
  if (input.current_session_only && input.include_prompts === true) {
    const prompts = results.filter((r) => r.type === 'prompt');
    const other = results.filter((r) => r.type !== 'prompt');
    return { results: [...prompts, ...other].slice(0, limit) };
  }
  return { results: results.slice(0, limit) };
}
