import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface GetCursorData {
  op: 'get';
  id: number;
  content_version: number;
  global: boolean;
  scope_key: string;
  field: 'title' | 'content';
  offset: number;
}

export interface DeletedCursorData {
  op: 'deleted_list';
  scope_type: 'scope' | 'all';
  scope_key: string | null;
  offset: number;
  dataset_fingerprint: string;
}

export interface ContextCursorData {
  op: 'context';
  scope_type: 'scope' | 'all';
  scope_key: string | null;
  session_id: string;
  offset: number;
  dataset_fingerprint: string;
}

export function encodeReadingCursor(data: any): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

export function decodeReadingCursor<T extends { op: string }>(raw: string, expectedOp: string): T {
  try {
    const jsonStr = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object' || parsed.op !== expectedOp) {
      throw new Error(`Invalid cursor: expected op '${expectedOp}'`);
    }
    return parsed as T;
  } catch (err: any) {
    throw new Error(`cursor_invalid: Failed to decode cursor (${err.message})`);
  }
}

export function computeDeletedDatasetFingerprint(
  db: DatabaseSync,
  scopeType: 'scope' | 'all',
  scopeKey: string | null,
): string {
  const query = scopeType === 'scope'
    ? 'SELECT id, updated_at, deleted_at FROM memories WHERE deleted_at IS NOT NULL AND scope_key = ? ORDER BY id;'
    : 'SELECT id, updated_at, deleted_at FROM memories WHERE deleted_at IS NOT NULL ORDER BY id;';

  const rows = scopeType === 'scope'
    ? (db.prepare(query).all(scopeKey) as Array<{ id: number; updated_at: string; deleted_at: string }>)
    : (db.prepare(query).all() as Array<{ id: number; updated_at: string; deleted_at: string }>);

  const hash = createHash('sha256');
  for (const r of rows) {
    hash.update(`${r.id}:${r.updated_at}:${r.deleted_at}\n`);
  }
  return hash.digest('hex');
}

export function computeContextDatasetFingerprint(
  db: DatabaseSync,
  scopeType: 'scope' | 'all',
  scopeKey: string | null,
): string {
  const query = scopeType === 'scope'
    ? 'SELECT id, content_version, updated_at FROM memories WHERE deleted_at IS NULL AND scope_key = ? ORDER BY id;'
    : 'SELECT id, content_version, updated_at FROM memories WHERE deleted_at IS NULL ORDER BY id;';

  const rows = scopeType === 'scope'
    ? (db.prepare(query).all(scopeKey) as Array<{ id: number; content_version: number; updated_at: string }>)
    : (db.prepare(query).all() as Array<{ id: number; content_version: number; updated_at: string }>);

  const hash = createHash('sha256');
  for (const r of rows) {
    hash.update(`${r.id}:${r.content_version}:${r.updated_at}\n`);
  }
  return hash.digest('hex');
}
