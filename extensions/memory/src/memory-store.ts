import os from 'node:os';
import type { Db } from './db.js';
import { generateMemoryId } from './ids.js';
import type { AddMemoryInput, MemoryRecord, MemoryScope, MemoryStatus } from './types.js';
import type { ResolvedContext } from './types.js';
import { assertSafeText } from './security.js';
import { firstLine, jsonString, nowIso, sha256, snippet } from './utils.js';
import { initialSyncStatus } from './cloud.js';
import { replaceMemoryEntities } from './entities.js';

function userId(): string { return process.env.USER || process.env.USERNAME || os.userInfo().username || 'user'; }
function deviceId(): string { return os.hostname(); }
function normalizeMemoryText(text: string): string { return text.trim().toLowerCase(); }
function normalizeTags(tags: string[] | undefined): string[] { return (tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean); }

function projectFields(scope: MemoryScope, context: ResolvedContext): { scope: MemoryScope; project_id: string | null; project_name: string | null; warning?: string } {
  if (scope === 'general' || scope === 'global') return { scope, project_id: null, project_name: null };
  if (context.scope !== 'project' || !context.project_id || !context.project_name) {
    return { scope: 'general', project_id: null, project_name: null, warning: 'scope=project requested outside a project; degraded to general.' };
  }
  return { scope: 'project', project_id: context.project_id, project_name: context.project_name };
}

function insertMemoryRow(db: Db, input: AddMemoryInput, context: ResolvedContext, fields: { scope: MemoryScope; project_id: string | null; project_name: string | null; warning?: string }) {
  const normalizedContent = normalizeMemoryText(input.content);
  const normalizedTags = normalizeTags(input.tags);
  const created = nowIso();
  const title = normalizeMemoryText(input.title ?? firstLine(normalizedContent));
  const summary = normalizeMemoryText(input.summary ?? snippet(normalizedContent, 160));
  const contentHash = sha256(JSON.stringify({ title, summary, content: normalizedContent, tags: normalizedTags }));
  const id = generateMemoryId({ scope: fields.scope, projectName: fields.project_name });
  const syncStatus = fields.scope === 'project' && context.config?.cloud.enabled ? initialSyncStatus(context) : 'local';
  db.prepare(`INSERT INTO memories(id,user_id,device_id,scope,project_id,project_name,kind,title,summary,content,tags,source,origin_type,confidence,importance,status,version,sync_status,content_hash,created_at,updated_at,metadata_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, userId(), deviceId(), fields.scope, fields.project_id, fields.project_name, input.kind,
      title, summary, normalizedContent, jsonString(normalizedTags), 'agent', input.origin_type ?? 'inferred_by_agent',
      input.confidence ?? 1.0, input.importance ?? 3, 'active', 1, syncStatus, contentHash, created, created, jsonString(input.metadata_json ?? {})
    );
  replaceMemoryEntities(db, id, `${title}\n${summary}\n${normalizedContent}`);
  return { memory: getMemoryRaw(db, id)!, warning: fields.warning, created: true };
}

export function upsertProjectProfile(db: Db, input: AddMemoryInput, context: ResolvedContext): { memory: MemoryRecord; warning?: string; created: boolean } {
  assertSafeText(input.content);
  const fields = projectFields(input.scope ?? context.scope, context);
  if (fields.scope !== 'project' || !fields.project_id || !fields.project_name) {
    return insertMemoryRow(db, input, context, fields);
  }

  const currentUserId = userId();
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare(`SELECT * FROM memories
      WHERE user_id=? AND scope='project' AND project_id=? AND kind='project_profile' AND status='active'
      ORDER BY updated_at DESC, id ASC
      LIMIT 1`).get(currentUserId, fields.project_id) as MemoryRecord | undefined;

    if (!existing) {
      const created = insertMemoryRow(db, input, context, fields);
      db.exec('COMMIT');
      return created;
    }

    const content = normalizeMemoryText(input.content);
    const title = input.title !== undefined ? normalizeMemoryText(input.title) : existing.title;
    const summary = input.summary !== undefined ? normalizeMemoryText(input.summary) : existing.summary;
    const tags = input.tags !== undefined ? jsonString(normalizeTags(input.tags)) : existing.tags;
    const metadata = input.metadata_json !== undefined
      ? { ...JSON.parse(existing.metadata_json || '{}'), ...input.metadata_json }
      : JSON.parse(existing.metadata_json || '{}');
    const contentHash = sha256(JSON.stringify({ title, summary, content, tags: JSON.parse(tags || '[]') }));
    const syncStatus = context.config?.cloud.enabled ? 'pending' : existing.sync_status;
    const updatedAt = nowIso();

    db.prepare(`UPDATE memories SET
      title=?,
      summary=?,
      content=?,
      tags=?,
      origin_type=?,
      confidence=?,
      importance=?,
      status='active',
      version=version+1,
      sync_status=?,
      content_hash=?,
      updated_at=?,
      metadata_json=?
      WHERE id=?`).run(
      title,
      summary,
      content,
      tags,
      input.origin_type ?? existing.origin_type,
      input.confidence ?? existing.confidence,
      input.importance ?? existing.importance,
      syncStatus,
      contentHash,
      updatedAt,
      jsonString(metadata),
      existing.id,
    );
    replaceMemoryEntities(db, existing.id, `${title ?? ''}\n${summary ?? ''}\n${content}`);
    db.exec('COMMIT');
    return { memory: getMemoryRaw(db, existing.id)!, warning: fields.warning, created: false };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function addMemory(db: Db, input: AddMemoryInput, context: ResolvedContext): { memory: MemoryRecord; warning?: string; created?: boolean } {
  if ('id' in (input as unknown as Record<string, unknown>)) throw new Error('memory_add does not accept id; IDs are generated by the tool.');
  assertSafeText(input.content);
  const desiredScope = input.scope ?? context.scope;
  const fields = projectFields(desiredScope, context);
  if (input.kind === 'project_profile' && fields.scope === 'project') return upsertProjectProfile(db, input, context);
  return insertMemoryRow(db, input, context, fields);
}

export function getMemoryRaw(db: Db, id: string): MemoryRecord | undefined {
  return db.prepare('SELECT * FROM memories WHERE id=?').get(id) as MemoryRecord | undefined;
}

export function getMemory(db: Db, id: string): MemoryRecord | undefined {
  const now = nowIso();
  db.prepare('UPDATE memories SET last_accessed_at=?, access_count=access_count+1 WHERE id=?').run(now, id);
  return getMemoryRaw(db, id);
}

export function updateMemory(db: Db, id: string, patch: { content?: string; tags?: string[]; confidence?: number; importance?: number; status?: MemoryStatus }, context: ResolvedContext): MemoryRecord {
  const old = getMemoryRaw(db, id);
  if (!old) throw new Error(`Memory not found: ${id}`);
  if (patch.content) assertSafeText(patch.content);
  const content = patch.content ? normalizeMemoryText(patch.content) : old.content;
  const tags = patch.tags ? jsonString(normalizeTags(patch.tags)) : old.tags;
  const contentHash = sha256(JSON.stringify({ title: old.title, summary: old.summary, content, tags }));
  const syncStatus = old.scope === 'project' && context.config?.cloud.enabled ? 'pending' : old.sync_status;
  db.prepare(`UPDATE memories SET content=?, tags=?, confidence=?, importance=?, status=?, version=version+1, sync_status=?, content_hash=?, updated_at=? WHERE id=?`).run(
    content, tags, patch.confidence ?? old.confidence, patch.importance ?? old.importance, patch.status ?? old.status, syncStatus, contentHash, nowIso(), id
  );
  replaceMemoryEntities(db, id, `${old.title ?? ''}\n${old.summary ?? ''}\n${content}`);
  return getMemoryRaw(db, id)!;
}

export function archiveMemory(db: Db, id: string, context: ResolvedContext, reason?: string): MemoryRecord {
  const mem = updateMemory(db, id, { status: 'archived' }, context);
  if (reason) {
    const meta = JSON.parse(mem.metadata_json || '{}');
    meta.archive_reason = reason;
    db.prepare('UPDATE memories SET metadata_json=? WHERE id=?').run(JSON.stringify(meta), id);
  }
  return getMemoryRaw(db, id)!;
}

export function listMemories(db: Db, opts: { scope?: MemoryScope; project_mode?: 'current'|'all'|'selected'; project_name?: string; kind?: string; limit?: number }, context: ResolvedContext): MemoryRecord[] {
  const where = ['status = ?'];
  const args: unknown[] = ['active'];
  if (opts.scope) { where.push('scope = ?'); args.push(opts.scope); }
  if ((opts.scope === 'project' || !opts.scope) && opts.project_mode !== 'all') {
    if (opts.project_mode === 'selected' && opts.project_name) { where.push('(scope != \'project\' OR project_name = ?)'); args.push(opts.project_name); }
    else if (context.scope === 'project') { where.push('(scope != \'project\' OR project_id = ?)'); args.push(context.project_id); }
  }
  if (opts.kind) { where.push('kind = ?'); args.push(opts.kind); }
  args.push(opts.limit ?? 50);
  return db.prepare(`SELECT * FROM memories WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`).all(...(args as any[])) as unknown as MemoryRecord[];
}
