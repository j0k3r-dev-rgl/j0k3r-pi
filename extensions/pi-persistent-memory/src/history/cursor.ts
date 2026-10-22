import { createHash } from 'node:crypto';

export interface HistorySearchCursor {
  op: 'history_search';
  project_key: string;
  query_hash?: string;
  session_id?: string;
  before_id: number;
}

export interface HistoryGetCursor {
  op: 'history_get';
  project_key: string;
  id: number;
  byte_offset: number;
}

export type HistoryCursorData = HistorySearchCursor | HistoryGetCursor;

export function hashHistorySearchQuery(query: string): string {
  const normalized = query.trim().toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function encodeHistoryCursor(data: HistoryCursorData): string {
  const json = JSON.stringify(data);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeHistoryCursor(raw: string): HistoryCursorData {
  if (typeof raw !== 'string' || !raw) {
    throw new Error('cursor_invalid: Empty or non-string cursor');
  }

  let parsed: unknown;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`cursor_invalid: Malformed cursor encoding (${msg})`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('cursor_invalid: Cursor payload must be an object');
  }

  const p = parsed as Record<string, unknown>;
  if (p.op === 'history_search') {
    if (typeof p.project_key !== 'string' || !p.project_key) {
      throw new Error('cursor_invalid: Missing or invalid project_key in search cursor');
    }
    if (p.query_hash !== undefined && (typeof p.query_hash !== 'string' || !p.query_hash)) {
      throw new Error('cursor_invalid: Invalid query_hash in search cursor');
    }
    if (p.session_id !== undefined && (typeof p.session_id !== 'string' || !p.session_id)) {
      throw new Error('cursor_invalid: Invalid session_id in search cursor');
    }
    if (typeof p.before_id !== 'number' || !Number.isSafeInteger(p.before_id) || p.before_id <= 0) {
      throw new Error('cursor_invalid: Missing or invalid positive before_id in search cursor');
    }
    return {
      op: 'history_search',
      project_key: p.project_key,
      query_hash: p.query_hash as string | undefined,
      session_id: p.session_id as string | undefined,
      before_id: p.before_id,
    };
  }

  if (p.op === 'history_get') {
    if (typeof p.project_key !== 'string' || !p.project_key) {
      throw new Error('cursor_invalid: Missing or invalid project_key in get cursor');
    }
    if (typeof p.id !== 'number' || !Number.isSafeInteger(p.id) || p.id <= 0) {
      throw new Error('cursor_invalid: Missing or invalid positive id in get cursor');
    }
    if (typeof p.byte_offset !== 'number' || !Number.isSafeInteger(p.byte_offset) || p.byte_offset < 0) {
      throw new Error('cursor_invalid: Missing or invalid non-negative byte_offset in get cursor');
    }
    return {
      op: 'history_get',
      project_key: p.project_key,
      id: p.id,
      byte_offset: p.byte_offset,
    };
  }

  throw new Error(`cursor_invalid: Unsupported operation '${String(p.op)}'`);
}

export function validateHistorySearchCursor(
  cursor: HistoryCursorData,
  serverResolvedProjectKey: string,
  query?: string,
  sessionId?: string,
): HistorySearchCursor {
  if (cursor.op !== 'history_search') {
    throw new Error(`cursor_invalid: Expected history_search cursor, got '${cursor.op}'`);
  }

  if (cursor.project_key !== serverResolvedProjectKey) {
    throw new Error('cursor_scope_mismatch: Cursor project does not match active project');
  }

  if (query) {
    const expectedHash = hashHistorySearchQuery(query);
    if (cursor.query_hash !== expectedHash) {
      throw new Error('cursor_invalid: Search query does not match cursor');
    }
  } else if (cursor.query_hash !== undefined) {
    throw new Error('cursor_invalid: Cursor was created with a query filter, but no query was provided');
  }

  if (sessionId) {
    if (cursor.session_id !== sessionId) {
      throw new Error('cursor_invalid: Session filter does not match cursor');
    }
  } else if (cursor.session_id !== undefined) {
    throw new Error('cursor_invalid: Cursor was created with a session filter, but none was provided');
  }

  return cursor;
}

export function validateHistoryGetCursor(
  cursor: HistoryCursorData,
  serverResolvedProjectKey: string,
  requestedId: number,
): HistoryGetCursor {
  if (cursor.op !== 'history_get') {
    throw new Error(`cursor_invalid: Expected history_get cursor, got '${cursor.op}'`);
  }

  if (cursor.project_key !== serverResolvedProjectKey) {
    throw new Error('cursor_scope_mismatch: Cursor project does not match active project');
  }

  if (cursor.id !== requestedId) {
    throw new Error('cursor_invalid: Requested message ID does not match cursor');
  }

  return cursor;
}
