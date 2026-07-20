import type { Db } from './db.js';
import { generateGenericId, generateSessionId } from './ids.js';
import type { AddMemoryInput, MemoryScope, ResolvedContext } from './types.js';
import { initialSyncStatus } from './cloud.js';
import { assertSafeText } from './security.js';
import { jsonString, nowIso, sha256 } from './utils.js';
import { addMemory } from './memory-store.js';

function sessionProjectFields(scope: MemoryScope, context: ResolvedContext) {
  if (scope === 'project' && context.scope === 'project') return { scope, project_id: context.project_id, project_name: context.project_name };
  return { scope: scope === 'project' ? 'general' : scope, project_id: null, project_name: null };
}

export function isSessionCompatibleWithContext(session: { scope?: MemoryScope | null; project_id?: string | null } | undefined, context: ResolvedContext): boolean {
  if (!session || session.scope !== context.scope) return false;
  if (context.scope === 'project') return session.project_id === context.project_id;
  return session.project_id == null;
}

export function startMemorySession(db: Db, input: { title?: string; scope?: MemoryScope; session_id?: string; metadata_json?: Record<string, unknown> }, context: ResolvedContext) {
  const fields = sessionProjectFields(input.scope ?? context.scope, context);
  const id = typeof input.session_id === 'string'
    ? input.session_id
    : generateSessionId({ scope: fields.scope, projectName: fields.project_name });
  if (!id || !String(id).trim()) throw new Error('Session id must be a non-empty string');
  const now = nowIso();
  const sync = fields.scope === 'project' && context.config?.cloud.enabled ? initialSyncStatus(context) : 'local';
  db.prepare('INSERT INTO memory_sessions(id,scope,project_id,project_name,title,started_at,status,sync_status,metadata_json) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, fields.scope, fields.project_id, fields.project_name, input.title ?? null, now, 'active', sync, jsonString(input.metadata_json ?? {}));
  return db.prepare('SELECT * FROM memory_sessions WHERE id=?').get(id);
}

export function reopenMemorySessionIfClosed(db: Db, sessionId: string | undefined, context: ResolvedContext): boolean {
  if (!sessionId) return false;
  const session = db.prepare('SELECT id, status, ended_at, scope FROM memory_sessions WHERE id=?').get(sessionId) as any;
  if (!session) return false;
  if (session.status === 'active' && session.ended_at == null) return false;
  const sync = session.scope === 'project' && context.config?.cloud.enabled ? 'pending' : 'local';
  db.prepare("UPDATE memory_sessions SET ended_at=NULL, status='active', sync_status=? WHERE id=?").run(sync, sessionId);
  return true;
}

export function addSessionPrompt(db: Db, input: { session_id: string; role: string; prompt: string; prompt_index: number; metadata_json?: Record<string, unknown> }, context: ResolvedContext) {
  assertSafeText(input.prompt);
  const session = db.prepare('SELECT * FROM memory_sessions WHERE id=?').get(input.session_id) as any;
  if (!session) throw new Error(`Session not found: ${input.session_id}`);
  if (session.status !== 'active' || session.ended_at != null) throw new Error(`Session is closed: ${input.session_id}`);
  const id = generateGenericId('prompt');
  const sync = session.scope === 'project' && context.config?.cloud.enabled ? 'pending' : 'local';
  const meta = { ...(input.metadata_json ?? {}), cloud_distribution: 'audit_only' };
  db.prepare('INSERT INTO memory_session_prompts(id,session_id,role,prompt,prompt_index,created_at,sync_status,content_hash,metadata_json) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, input.session_id, input.role, input.prompt, input.prompt_index, nowIso(), sync, sha256(input.prompt), jsonString(meta));
  return db.prepare('SELECT * FROM memory_session_prompts WHERE id=?').get(id);
}

export function finishMemorySession(db: Db, input: { session_id: string; summary: string; learned?: string; architectural_decisions?: string[]; memories_to_add?: Array<Partial<AddMemoryInput> & { content: string }>; metadata_json?: Record<string, unknown> }, context: ResolvedContext) {
  assertSafeText(input.summary);
  if (input.learned) assertSafeText(input.learned);
  const summary = input.summary.trim();
  const learned = input.learned?.trim();
  const hash = sha256(JSON.stringify({ summary, learned: learned ?? '' }));
  const existing = db.prepare(`SELECT * FROM memory_sessions
    WHERE id=?
      AND status IN ('active','completed')
    LIMIT 1`).get(input.session_id) as any;
  if (!isSessionCompatibleWithContext(existing, context)) throw new Error(`Session not found: ${input.session_id}`);
  const sync = existing.scope === 'project' && context.config?.cloud.enabled ? 'pending' : 'local';
  const metadata = { ...(existing?.metadata_json ? JSON.parse(existing.metadata_json) : {}), ...(input.metadata_json ?? {}) };
  db.prepare('UPDATE memory_sessions SET ended_at=?, summary=?, learned=?, status=?, sync_status=?, content_hash=?, metadata_json=? WHERE id=?')
    .run(nowIso(), summary, learned ?? null, 'completed', sync, hash, jsonString(metadata), input.session_id);
  const added: string[] = [];
  for (const decision of input.architectural_decisions ?? []) {
    added.push(addMemory(db, { scope: 'project', kind: 'architectural_decision', content: decision, origin_type: 'session_summary', importance: 4 }, context).memory.id);
  }
  for (const mem of input.memories_to_add ?? []) {
    added.push(addMemory(db, { scope: 'project', kind: mem.kind ?? 'learning', content: mem.content, tags: mem.tags, origin_type: 'session_summary', importance: mem.importance ?? 3 }, context).memory.id);
  }
  return { session: db.prepare('SELECT * FROM memory_sessions WHERE id=?').get(input.session_id), added_memory_ids: added };
}
