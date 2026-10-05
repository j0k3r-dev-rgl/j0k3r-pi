import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { withDatabase } from '../storage/db.ts';
import {
  createMemory,
  replaceMemory,
  saveMemoryAtomic,
  publishValidatedChunks,
  markPendingReason,
} from '../storage/memory-store.ts';
import { E5Client, E5ClientError } from '../client/e5-client.ts';
import type { Memory } from '../types.ts';

export interface SaveMemoryInput {
  id?: number;
  topicKey?: string | null;
  title: string;
  content: string;
  type: string;
}

export interface SaveMemoryContext {
  sessionId: string;
  invokingParentSessionId?: string | null;
  invocationId?: string | null;
}

export interface SaveMemoryOptions {
  client?: E5Client;
  signal?: AbortSignal;
  assertActive?: () => void;
}

export interface SaveMemoryResult {
  memory: Memory;
  committed: boolean;
  indexed: boolean;
  stale?: boolean;
  error?: { category: string; code: string; message: string };
}

export type ReindexTarget =
  | { target: 'id'; id: number; scopeKey: string; cursor?: string }
  | { target: 'scope_pending'; scopeKey: string; cursor?: string }
  | { target: 'all_pending'; scopeKey: string; explicitAllProjects?: boolean; cursor?: string };

export interface ReindexOutcome {
  id: number;
  status: 'indexed' | 'failed' | 'stale' | 'skipped';
  reason?: string;
}

export interface ReindexResult {
  requested_scope: string;
  actual_scope: string;
  processed: number;
  succeeded: number;
  failed: number;
  stale: number;
  remaining: number;
  outcomes: ReindexOutcome[];
  has_more: boolean;
  next_cursor: string | null;
  notice: string;
  cancelled?: boolean;
}

interface CursorData {
  op: 'reindex';
  scope_type: 'scope' | 'all';
  scope_key: string | null;
  high_water_id: number;
  last_id: number;
  dataset_fingerprint: string;
}

function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

function decodeCursor(cursorStr: string): CursorData {
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.op !== 'reindex' || typeof parsed?.high_water_id !== 'number' || typeof parsed?.last_id !== 'number') {
      throw new Error('invalid_cursor_payload');
    }
    return parsed;
  } catch (err: any) {
    throw new Error(`cursor_invalid: Failed to decode cursor (${err.message})`);
  }
}

function computeDatasetFingerprint(
  db: DatabaseSync,
  scopeType: 'scope' | 'all',
  scopeKey: string | null,
  highWaterId: number,
): string {
  const rows = scopeType === 'scope'
    ? db.prepare(`
        SELECT id, content_version, indexing_status, deleted_at
        FROM memories
        WHERE scope_key = ? AND id <= ?
        ORDER BY id ASC;
      `).all(scopeKey, highWaterId) as Array<{ id: number; content_version: number; indexing_status: string; deleted_at: string | null }>
    : db.prepare(`
        SELECT id, content_version, indexing_status, deleted_at
        FROM memories
        WHERE id <= ?
        ORDER BY id ASC;
      `).all(highWaterId) as Array<{ id: number; content_version: number; indexing_status: string; deleted_at: string | null }>;

  const serialized = rows.map((r) => `${r.id}:${r.content_version}:${r.indexing_status}:${r.deleted_at ?? ''}`).join('|');
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

export async function saveAndIndexMemory(
  dbPath: string,
  scopeKey: string,
  input: SaveMemoryInput,
  context: SaveMemoryContext,
  options?: SaveMemoryOptions,
): Promise<SaveMemoryResult> {
  options?.assertActive?.();
  if (options?.signal?.aborted) {
    throw new E5ClientError('cancelled', 'caller_cancelled', 'Operation cancelled by caller');
  }

  // Phase 1: Atomic target prevalidation and mutation in ONE BEGIN IMMEDIATE transaction
  let committedMemory: Memory;

  withDatabase(dbPath, (db) => {
    options?.assertActive?.();
    committedMemory = saveMemoryAtomic(db, scopeKey, input, context);
  });

  // DB connection is closed. Passage mapping is title + '\n' + content
  const capturedId = committedMemory!.id;
  const capturedVersion = committedMemory!.content_version;
  const passageText = `${committedMemory!.title}\n${committedMemory!.content}`;

  options?.assertActive?.();
  if (options?.signal?.aborted) {
    return {
      memory: committedMemory!,
      committed: true,
      indexed: false,
      error: { category: 'cancelled', code: 'caller_cancelled', message: 'Operation cancelled by caller' },
    };
  }

  // Phase 2: Embed via E5 outside DB/transaction
  const client = options?.client ?? new E5Client();
  let embedResult: any;
  try {
    embedResult = await client.embedPassage(passageText, options?.signal);
  } catch (err: any) {
    if (err.category === 'cancelled' || options?.signal?.aborted) {
      return {
        memory: committedMemory!,
        committed: true,
        indexed: false,
        error: { category: 'cancelled', code: err.code ?? 'caller_cancelled', message: 'Operation cancelled by caller' },
      };
    }

    // Recoverable generation error: sanitize reason and record conditionally on same version
    const sanitizedReason = `${err.category ?? 'error'}: ${err.code ?? 'unknown'}`.slice(0, 200);
    try {
      withDatabase(dbPath, (db) => {
        markPendingReason(db, capturedId, capturedVersion, sanitizedReason);
      });
    } catch {}

    return {
      memory: committedMemory!,
      committed: true,
      indexed: false,
      error: { category: err.category ?? 'error', code: err.code ?? 'unknown', message: err.message },
    };
  }

  // Phase 3: Atomically publish validated chunks in fresh transaction
  options?.assertActive?.();
  if (options?.signal?.aborted) {
    return {
      memory: committedMemory!,
      committed: true,
      indexed: false,
      error: { category: 'cancelled', code: 'caller_cancelled', message: 'Operation cancelled by caller' },
    };
  }

  let published = false;
  let stale = false;

  withDatabase(dbPath, (db) => {
    options?.assertActive?.();
    const current = db.prepare('SELECT id, scope_key, content_version, deleted_at FROM memories WHERE id = ?;').get(capturedId) as {
      id: number;
      scope_key: string;
      content_version: number;
      deleted_at: string | null;
    } | undefined;

    if (!current || current.scope_key !== scopeKey || current.deleted_at !== null || current.content_version !== capturedVersion) {
      stale = true;
      return;
    }

    options?.assertActive?.();
    publishValidatedChunks(
      db,
      capturedId,
      capturedVersion,
      {
        model_id: embedResult.model,
        model_revision: embedResult.model_revision,
        dimensions: embedResult.dimensions,
        normalized: embedResult.normalization === 'l2' ? 1 : 0,
      },
      embedResult.chunks.map((ch: any, idx: number) => ({
        chunk_index: ch.chunk_index ?? idx,
        chunk_text: ch.text,
        start_char: ch.start,
        end_char: ch.end,
        token_count: ch.token_count,
        vector: ch.embedding,
      })),
    );
    published = true;
  });

  return {
    memory: committedMemory!,
    committed: true,
    indexed: published,
    stale,
  };
}

export async function reindexMemories(
  dbPath: string,
  request: ReindexTarget,
  options?: SaveMemoryOptions,
): Promise<ReindexResult> {
  const client = options?.client ?? new E5Client();
  const outcomes: ReindexOutcome[] = [];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let stale = 0;
  let cancelled = false;

  if (request.target === 'id') {
    if (request.cursor) {
      throw new Error('cursor_not_supported_for_id: Cursor is not supported for specific ID reindex');
    }

    let memoryToReindex: Memory | undefined;
    withDatabase(dbPath, (db) => {
      const row = db.prepare('SELECT * FROM memories WHERE id = ?;').get(request.id) as Memory | undefined;
      if (!row || row.scope_key !== request.scopeKey) {
        throw new Error(`target_not_found: Memory ${request.id} not found in scope ${request.scopeKey}`);
      }
      if (row.deleted_at !== null) {
        throw new Error(`target_deleted: Memory ${request.id} is deleted and requires restore`);
      }
      memoryToReindex = row;
    });

    const mem = memoryToReindex!;
    processed = 1;
    const passageText = `${mem.title}\n${mem.content}`;

    try {
      options?.assertActive?.();
      const embedResult = await client.embedPassage(passageText, options?.signal);
      options?.assertActive?.();

      let isStale = false;
      withDatabase(dbPath, (db) => {
        options?.assertActive?.();
        const current = db.prepare('SELECT id, scope_key, content_version, deleted_at FROM memories WHERE id = ?;').get(mem.id) as {
          id: number;
          scope_key: string;
          content_version: number;
          deleted_at: string | null;
        } | undefined;

        if (!current || current.scope_key !== request.scopeKey || current.deleted_at !== null || current.content_version !== mem.content_version) {
          isStale = true;
          return;
        }

        options?.assertActive?.();
        publishValidatedChunks(
          db,
          mem.id,
          mem.content_version,
          {
            model_id: embedResult.model,
            model_revision: embedResult.model_revision,
            dimensions: embedResult.dimensions,
            normalized: embedResult.normalization === 'l2' ? 1 : 0,
          },
          embedResult.chunks.map((ch: any, idx: number) => ({
            chunk_index: ch.chunk_index ?? idx,
            chunk_text: ch.text,
            start_char: ch.start,
            end_char: ch.end,
            token_count: ch.token_count,
            vector: ch.embedding,
          })),
        );
      });

      if (isStale) {
        stale = 1;
        outcomes.push({ id: mem.id, status: 'stale', reason: 'concurrent edit detected' });
      } else {
        succeeded = 1;
        outcomes.push({ id: mem.id, status: 'indexed' });
      }
    } catch (err: any) {
      if (err.category === 'cancelled' || options?.signal?.aborted) {
        cancelled = true;
        outcomes.push({ id: mem.id, status: 'skipped', reason: 'cancelled' });
      } else {
        failed = 1;
        const sanitizedReason = `${err.category ?? 'error'}: ${err.code ?? 'unknown'}`.slice(0, 200);
        withDatabase(dbPath, (db) => {
          markPendingReason(db, mem.id, mem.content_version, sanitizedReason);
        });
        outcomes.push({ id: mem.id, status: 'failed', reason: sanitizedReason });
      }
    }

    return {
      requested_scope: request.scopeKey,
      actual_scope: request.scopeKey,
      processed,
      succeeded,
      failed,
      stale,
      remaining: failed,
      outcomes,
      has_more: false,
      next_cursor: null,
      notice: 'Specific memory reindex completed.',
      cancelled: cancelled ? true : undefined,
    };
  }

  // Bulk recovery (scope_pending or all_pending)
  if (request.target === 'all_pending' && !request.explicitAllProjects) {
    throw new Error('explicit_all_projects_required: Explicit all-project flag required for global recovery');
  }

  const scopeType = request.target === 'scope_pending' ? 'scope' : 'all';
  const scopeKey = scopeType === 'scope' ? request.scopeKey : null;

  let highWaterId = 0;
  let lastProcessedId = 0;
  let eligibleMemories: Memory[] = [];

  withDatabase(dbPath, (db) => {
    if (request.cursor) {
      const decoded = decodeCursor(request.cursor);
      if (decoded.scope_type !== scopeType || decoded.scope_key !== scopeKey) {
        throw new Error('cursor_scope_mismatch: Cursor scope does not match recovery request scope');
      }

      const currentFingerprint = computeDatasetFingerprint(db, scopeType, scopeKey, decoded.high_water_id);
      if (currentFingerprint !== decoded.dataset_fingerprint) {
        throw new Error('cursor_dataset_modified: Dataset was modified since cursor was created; restart recovery');
      }

      highWaterId = decoded.high_water_id;
      lastProcessedId = decoded.last_id;
    } else {
      const maxRow = (scopeType === 'scope'
        ? db.prepare('SELECT MAX(id) as max_id FROM memories WHERE scope_key = ?;').get(scopeKey)
        : db.prepare('SELECT MAX(id) as max_id FROM memories;').get()) as { max_id?: number } | undefined;

      highWaterId = maxRow?.max_id ?? 0;
      lastProcessedId = 0;
    }

    eligibleMemories = ((scopeType === 'scope'
      ? db.prepare(`
          SELECT * FROM memories
          WHERE scope_key = ?
            AND deleted_at IS NULL
            AND indexing_status IN ('pending', 'failed')
            AND id > ?
            AND id <= ?
          ORDER BY id ASC
          LIMIT 5;
        `).all(scopeKey, lastProcessedId, highWaterId)
      : db.prepare(`
          SELECT * FROM memories
          WHERE deleted_at IS NULL
            AND indexing_status IN ('pending', 'failed')
            AND id > ?
            AND id <= ?
          ORDER BY id ASC
          LIMIT 5;
        `).all(lastProcessedId, highWaterId)) as unknown) as Memory[];
  });

  // Strictly sequential, at most 5 memories
  for (const mem of eligibleMemories) {
    options?.assertActive?.();
    if (options?.signal?.aborted) {
      cancelled = true;
      break;
    }

    processed++;
    const passageText = `${mem.title}\n${mem.content}`;

    try {
      options?.assertActive?.();
      const embedResult = await client.embedPassage(passageText, options?.signal);
      options?.assertActive?.();

      let isStale = false;
      withDatabase(dbPath, (db) => {
        options?.assertActive?.();
        const current = db.prepare('SELECT id, scope_key, content_version, deleted_at FROM memories WHERE id = ?;').get(mem.id) as {
          id: number;
          scope_key: string;
          content_version: number;
          deleted_at: string | null;
        } | undefined;

        if (!current || current.scope_key !== mem.scope_key || current.deleted_at !== null || current.content_version !== mem.content_version) {
          isStale = true;
          return;
        }

        options?.assertActive?.();
        publishValidatedChunks(
          db,
          mem.id,
          mem.content_version,
          {
            model_id: embedResult.model,
            model_revision: embedResult.model_revision,
            dimensions: embedResult.dimensions,
            normalized: embedResult.normalization === 'l2' ? 1 : 0,
          },
          embedResult.chunks.map((ch: any, idx: number) => ({
            chunk_index: ch.chunk_index ?? idx,
            chunk_text: ch.text,
            start_char: ch.start,
            end_char: ch.end,
            token_count: ch.token_count,
            vector: ch.embedding,
          })),
        );
      });

      if (isStale) {
        stale++;
        outcomes.push({ id: mem.id, status: 'stale', reason: 'concurrent edit detected' });
      } else {
        succeeded++;
        outcomes.push({ id: mem.id, status: 'indexed' });
      }
    } catch (err: any) {
      if (err.category === 'cancelled' || options?.signal?.aborted) {
        cancelled = true;
        outcomes.push({ id: mem.id, status: 'skipped', reason: 'cancelled' });
        break;
      }

      failed++;
      const sanitizedReason = `${err.category ?? 'error'}: ${err.code ?? 'unknown'}`.slice(0, 200);
      try {
        withDatabase(dbPath, (db) => {
          markPendingReason(db, mem.id, mem.content_version, sanitizedReason);
        });
      } catch {}

      outcomes.push({ id: mem.id, status: 'failed', reason: sanitizedReason });

      // Service unavailable stops batch immediately!
      if (err.category === 'unavailable') {
        break;
      }
    }
  }

  // Compute remaining and continuation
  const lastExaminedId = outcomes.length > 0 ? outcomes[outcomes.length - 1].id : lastProcessedId;
  let remainingTotal = 0;
  let unexaminedEligibleCount = 0;
  let nextCursor: string | null = null;

  withDatabase(dbPath, (db) => {
    // Total remaining active pending/failed memories in scope (including earlier failures)
    const countRow = (scopeType === 'scope'
      ? db.prepare(`
          SELECT count(*) as cnt FROM memories
          WHERE scope_key = ? AND deleted_at IS NULL AND indexing_status IN ('pending', 'failed');
        `).get(scopeKey)
      : db.prepare(`
          SELECT count(*) as cnt FROM memories
          WHERE deleted_at IS NULL AND indexing_status IN ('pending', 'failed');
        `).get()) as { cnt?: number } | undefined;
    remainingTotal = countRow?.cnt ?? 0;

    // Unexamined eligible forward memories in high_water range
    const fwdRow = (scopeType === 'scope'
      ? db.prepare(`
          SELECT count(*) as cnt FROM memories
          WHERE scope_key = ? AND deleted_at IS NULL AND indexing_status IN ('pending', 'failed') AND id > ? AND id <= ?;
        `).get(scopeKey, lastExaminedId, highWaterId)
      : db.prepare(`
          SELECT count(*) as cnt FROM memories
          WHERE deleted_at IS NULL AND indexing_status IN ('pending', 'failed') AND id > ? AND id <= ?;
        `).get(lastExaminedId, highWaterId)) as { cnt?: number } | undefined;
    unexaminedEligibleCount = fwdRow?.cnt ?? 0;

    if (unexaminedEligibleCount > 0 && !cancelled && outcomes.length > 0) {
      const newFingerprint = computeDatasetFingerprint(db, scopeType, scopeKey, highWaterId);
      nextCursor = encodeCursor({
        op: 'reindex',
        scope_type: scopeType,
        scope_key: scopeKey,
        high_water_id: highWaterId,
        last_id: lastExaminedId,
        dataset_fingerprint: newFingerprint,
      });
    }
  });

  return {
    requested_scope: request.scopeKey,
    actual_scope: scopeType === 'all' ? '["global_all_projects"]' : request.scopeKey,
    processed,
    succeeded,
    failed,
    stale,
    remaining: remainingTotal,
    outcomes,
    has_more: unexaminedEligibleCount > 0 && nextCursor !== null,
    next_cursor: nextCursor,
    notice: 'Remaining counts include earlier failed records; pending failures require a later new recovery request.',
    cancelled: cancelled ? true : undefined,
  };
}
