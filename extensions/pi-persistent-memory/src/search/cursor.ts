import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Scope } from '../types.ts';
import { encodeScope } from '../identity.ts';
import type { SearchCursorData, SearchMode } from './types.ts';

export const RETRIEVAL_PROFILE_VERSION = 1;

export function hashSearchQuery(query: string): string {
  const normalized = query.trim().toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function encodeSearchCursor(data: SearchCursorData): string {
  const json = JSON.stringify(data);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeSearchCursor(raw: string): SearchCursorData {
  if (typeof raw !== 'string' || !raw) {
    throw new Error('invalid_cursor: Empty or non-string cursor');
  }

  let parsed: unknown;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid_cursor: Malformed cursor encoding (${msg})`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('invalid_cursor: Cursor payload must be an object');
  }

  const p = parsed as Record<string, unknown>;
  if (p.op !== 'search') {
    throw new Error(`invalid_cursor: Invalid operation '${String(p.op)}', expected 'search'`);
  }

  if (typeof p.query_hash !== 'string' || !p.query_hash) {
    throw new Error('invalid_cursor: Missing or invalid query_hash');
  }

  if (p.requested_mode !== 'hybrid' && p.requested_mode !== 'semantic' && p.requested_mode !== 'fts5') {
    throw new Error('invalid_cursor: Invalid requested_mode');
  }

  if (p.actual_mode !== 'hybrid' && p.actual_mode !== 'semantic' && p.actual_mode !== 'fts5') {
    throw new Error('invalid_cursor: Invalid actual_mode');
  }

  if (typeof p.scope_key !== 'string' || !p.scope_key) {
    throw new Error('invalid_cursor: Missing or invalid scope_key');
  }

  if (typeof p.explicit_global !== 'boolean') {
    throw new Error('invalid_cursor: Missing or invalid explicit_global flag');
  }

  if (typeof p.profile_version !== 'number' || !Number.isSafeInteger(p.profile_version)) {
    throw new Error('invalid_cursor: Missing or invalid profile_version');
  }

  if (typeof p.dataset_fingerprint !== 'string' || !p.dataset_fingerprint) {
    throw new Error('invalid_cursor: Missing or invalid dataset_fingerprint');
  }

  if (typeof p.offset !== 'number' || !Number.isSafeInteger(p.offset) || p.offset < 0) {
    throw new Error('invalid_cursor: Missing or invalid non-negative offset');
  }

  return {
    op: 'search',
    query_hash: p.query_hash,
    requested_mode: p.requested_mode as SearchMode,
    actual_mode: p.actual_mode as SearchMode,
    scope_key: p.scope_key,
    explicit_global: p.explicit_global,
    profile_version: p.profile_version,
    dataset_fingerprint: p.dataset_fingerprint,
    offset: p.offset,
  };
}

export function computeSearchDatasetFingerprint(
  db: DatabaseSync,
  scope: Scope,
  explicitGlobal: boolean,
): string {
  const hash = createHash('sha256');

  const isGlobal = explicitGlobal || scope.kind === 'global';
  const sql = isGlobal
    ? `
      SELECT
        m.id,
        m.scope_key,
        m.title,
        m.content,
        m.type,
        m.content_version,
        m.updated_at,
        m.deleted_at,
        m.indexing_status,
        c.id AS chunk_id,
        c.chunk_index,
        c.token_count,
        c.content_version AS chunk_content_version,
        c.model_id,
        c.model_revision,
        c.dimensions,
        c.normalized,
        v.embedding
      FROM memories m
      LEFT JOIN chunks c ON c.memory_id = m.id AND c.content_version = m.content_version
      LEFT JOIN memory_vectors v ON v.rowid = c.id
      ORDER BY m.id ASC, c.chunk_index ASC, c.id ASC;
    `
    : `
      SELECT
        m.id,
        m.scope_key,
        m.title,
        m.content,
        m.type,
        m.content_version,
        m.updated_at,
        m.deleted_at,
        m.indexing_status,
        c.id AS chunk_id,
        c.chunk_index,
        c.token_count,
        c.content_version AS chunk_content_version,
        c.model_id,
        c.model_revision,
        c.dimensions,
        c.normalized,
        v.embedding
      FROM memories m
      LEFT JOIN chunks c ON c.memory_id = m.id AND c.content_version = m.content_version
      LEFT JOIN memory_vectors v ON v.rowid = c.id
      WHERE m.scope_key = ?
      ORDER BY m.id ASC, c.chunk_index ASC, c.id ASC;
    `;

  const rows = (isGlobal ? db.prepare(sql).all() : db.prepare(sql).all(encodeScope(scope))) as Array<{
    id: number;
    scope_key: string;
    title: string;
    content: string;
    type: string;
    content_version: number;
    updated_at: string;
    deleted_at: string | null;
    indexing_status: string;
    chunk_id: number | null;
    chunk_index: number | null;
    token_count: number | null;
    chunk_content_version: number | null;
    model_id: string | null;
    model_revision: string | null;
    dimensions: number | null;
    normalized: number | null;
    embedding: Uint8Array | null;
  }>;

  for (const row of rows) {
    hash.update(`${row.id}:${row.scope_key}:${row.title}:${row.content}:${row.type}:${row.content_version}:${row.updated_at}:${String(row.deleted_at)}:${row.indexing_status}:`);
    if (row.chunk_id !== null) {
      hash.update(`${row.chunk_id}:${row.chunk_index}:${row.token_count}:${row.chunk_content_version}:${row.model_id}:${row.model_revision}:${row.dimensions}:${row.normalized}:`);
      if (row.embedding) {
        hash.update(row.embedding);
      }
    }
  }

  return hash.digest('hex');
}
