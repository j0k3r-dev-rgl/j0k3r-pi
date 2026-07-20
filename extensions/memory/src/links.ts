import type { Db } from './db.js';
import { generateGenericId } from './ids.js';
import { getMemoryRaw } from './memory-store.js';
import type { MemoryLinkInput, MemoryLinkRecord, MemoryLinkRelation, MemoryRecord } from './types.js';
import { jsonString, nowIso, parseJson } from './utils.js';

export const MEMORY_LINK_RELATIONS: readonly MemoryLinkRelation[] = [
  'supports',
  'supersedes',
  'contradicts',
  'derived_from',
  'related_to',
  'implements',
] as const;

function sameProjectBoundary(a: MemoryRecord, b: MemoryRecord): boolean {
  return a.scope === b.scope && a.project_id === b.project_id && a.project_name === b.project_name;
}

function compactLink(row: Record<string, unknown>): MemoryLinkRecord {
  return {
    id: String(row.id),
    from_memory_id: String(row.from_memory_id),
    to_memory_id: String(row.to_memory_id),
    relation_type: row.relation_type as MemoryLinkRelation,
    created_at: String(row.created_at),
    metadata_json: parseJson<Record<string, unknown>>(typeof row.metadata_json === 'string' ? row.metadata_json : null, {}),
  };
}

export function addMemoryLink(db: Db, input: MemoryLinkInput): { link: MemoryLinkRecord; created: boolean; warning?: string } {
  if (!MEMORY_LINK_RELATIONS.includes(input.relation_type)) throw new Error(`unsupported relation_type: ${input.relation_type}`);

  const from = getMemoryRaw(db, input.from_memory_id);
  if (!from) throw new Error(`from memory not found: ${input.from_memory_id}`);

  const to = getMemoryRaw(db, input.to_memory_id);
  if (!to) throw new Error(`to memory not found: ${input.to_memory_id}`);

  if (from.id === to.id) throw new Error(`self links are not allowed: ${from.id}`);
  if (!sameProjectBoundary(from, to)) throw new Error(`cross-project links are not allowed: ${from.id} -> ${to.id}`);

  const existing = db.prepare('SELECT * FROM memory_links WHERE from_memory_id=? AND to_memory_id=? AND relation_type=?').get(from.id, to.id, input.relation_type) as Record<string, unknown> | undefined;
  if (existing) return { link: compactLink(existing), created: false, warning: 'duplicate link; returned existing link' };

  if (input.relation_type === 'implements' || input.relation_type === 'supersedes') {
    const reverse = db.prepare('SELECT * FROM memory_links WHERE from_memory_id=? AND to_memory_id=? AND relation_type=?').get(to.id, from.id, input.relation_type) as Record<string, unknown> | undefined;
    if (reverse) throw new Error(`mutual ${input.relation_type} links are not allowed: ${to.id} -> ${from.id}`);
  }

  const row = {
    id: generateGenericId('link'),
    from_memory_id: from.id,
    to_memory_id: to.id,
    relation_type: input.relation_type,
    created_at: nowIso(),
    metadata_json: jsonString(input.metadata_json ?? {}),
  };
  db.prepare('INSERT INTO memory_links(id,from_memory_id,to_memory_id,relation_type,created_at,metadata_json) VALUES(?,?,?,?,?,?)').run(
    row.id,
    row.from_memory_id,
    row.to_memory_id,
    row.relation_type,
    row.created_at,
    row.metadata_json,
  );
  return { link: compactLink(row), created: true };
}
