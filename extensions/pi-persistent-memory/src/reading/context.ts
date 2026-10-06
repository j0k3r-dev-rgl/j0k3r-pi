import type { DatabaseSync } from 'node:sqlite';
import { withDatabase } from '../storage/db.ts';
import { encodeScope } from '../identity.ts';
import type { Scope, Memory } from '../types.ts';
import {
  encodeReadingCursor,
  decodeReadingCursor,
  computeContextDatasetFingerprint,
  type ContextCursorData,
} from './cursor.ts';

export interface ReadMemoryContextOptions {
  sessionScope: Scope;
  sessionId: string;
  global?: boolean;
  cursor?: string;
  pageSize?: number;
  isWithinBudget?: (result: ContextResult) => boolean;
}

export interface ContextItem {
  id: number;
  title: string;
  type: string;
  scope_key: string;
  updated_at: string;
  excerpt: string;
  kind: 'session_summary' | 'project_summary' | 'recent_memory';
  guidance: string;
  title_abbreviated?: boolean;
}

export interface ContextResult {
  items: ContextItem[];
  has_more: boolean;
  next_cursor: string | null;
  scope: {
    kind: 'global' | 'project';
    project?: string;
    explicit_global: boolean;
  };
}

function truncateCodePoints(text: string, maxCodePoints: number): { text: string; truncated: boolean } {
  const codePoints = Array.from(text);
  if (codePoints.length <= maxCodePoints) {
    return { text, truncated: false };
  }
  return {
    text: codePoints.slice(0, maxCodePoints).join('') + '...',
    truncated: true,
  };
}

function extractExcerpt(text: string, maxChars: number = 200): string {
  const codePoints = Array.from(text.trim());
  if (codePoints.length <= maxChars) {
    return text.trim();
  }
  return codePoints.slice(0, maxChars).join('') + '...';
}

export function readMemoryContext(
  dbPath: string,
  options: ReadMemoryContextOptions,
  deps?: { assertActive?: () => void },
): ContextResult {
  deps?.assertActive?.();

  const isGlobal = !!options.global;
  const pageSize = options.pageSize ?? 5;
  const sessionScopeKey = encodeScope(options.sessionScope);
  const scopeType = isGlobal ? 'all' : 'scope';
  const sessionSummaryKey = `session/${options.sessionId}/summary`;

  let currentFingerprint = '';
  let offset = 0;

  if (options.cursor) {
    const cursorData = decodeReadingCursor<ContextCursorData>(options.cursor, 'context');
    if (cursorData.scope_type !== scopeType || cursorData.scope_key !== (isGlobal ? null : sessionScopeKey)) {
      throw new Error('cursor_scope_mismatch: Cursor scope does not match requested context scope');
    }
    if (cursorData.session_id !== options.sessionId) {
      throw new Error('cursor_session_mismatch: Cursor session does not match current session');
    }
    offset = cursorData.offset;

    withDatabase(dbPath, (db) => {
      deps?.assertActive?.();
      currentFingerprint = computeContextDatasetFingerprint(db, scopeType, isGlobal ? null : sessionScopeKey);
    });

    if (cursorData.dataset_fingerprint !== currentFingerprint) {
      throw new Error('cursor_expired: Active memory dataset modified since cursor was created');
    }
  } else {
    withDatabase(dbPath, (db) => {
      deps?.assertActive?.();
      currentFingerprint = computeContextDatasetFingerprint(db, scopeType, isGlobal ? null : sessionScopeKey);
    });
  }

  const allOrderedCandidates: ContextItem[] = [];

  withDatabase(dbPath, (db) => {
    deps?.assertActive?.();
    const seenIds = new Set<number>();
    const seenTopics = new Set<string>();

    // 1. Current native session's active session_summary first
    const sessionSummaryRow = (isGlobal
      ? db.prepare('SELECT * FROM memories WHERE topic_key = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 1;').get(sessionSummaryKey)
      : db.prepare('SELECT * FROM memories WHERE topic_key = ? AND scope_key = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 1;').get(sessionSummaryKey, sessionScopeKey)
    ) as Memory | undefined;

    if (sessionSummaryRow) {
      seenIds.add(sessionSummaryRow.id);
      if (sessionSummaryRow.topic_key) seenTopics.add(sessionSummaryRow.topic_key);
      const { text: safeTitle, truncated: titleTruncated } = truncateCodePoints(sessionSummaryRow.title, 80);
      allOrderedCandidates.push({
        id: sessionSummaryRow.id,
        title: safeTitle,
        type: sessionSummaryRow.type,
        scope_key: sessionSummaryRow.scope_key,
        updated_at: sessionSummaryRow.updated_at,
        excerpt: extractExcerpt(sessionSummaryRow.content),
        kind: 'session_summary',
        guidance: 'Untrusted reference. Use memory_get(id) for complete content.',
        title_abbreviated: titleTruncated ? true : undefined,
      });
    }

    // 2. Latest project_summary second (if in project scope)
    if (options.sessionScope.kind === 'project') {
      const projectSummaryRow = db.prepare(
        'SELECT * FROM memories WHERE type = \'project_summary\' AND scope_key = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 1;'
      ).get(sessionScopeKey) as Memory | undefined;

      if (projectSummaryRow && !seenIds.has(projectSummaryRow.id)) {
        seenIds.add(projectSummaryRow.id);
        if (projectSummaryRow.topic_key) seenTopics.add(projectSummaryRow.topic_key);
        const { text: safeTitle, truncated: titleTruncated } = truncateCodePoints(projectSummaryRow.title, 80);
        allOrderedCandidates.push({
          id: projectSummaryRow.id,
          title: safeTitle,
          type: projectSummaryRow.type,
          scope_key: projectSummaryRow.scope_key,
          updated_at: projectSummaryRow.updated_at,
          excerpt: extractExcerpt(projectSummaryRow.content),
          kind: 'project_summary',
          guidance: 'Untrusted reference. Use memory_get(id) for complete content.',
          title_abbreviated: titleTruncated ? true : undefined,
        });
      }
    }

    // 3. Recent active authorized memories
    const recentQuery = isGlobal
      ? 'SELECT * FROM memories WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC;'
      : 'SELECT * FROM memories WHERE deleted_at IS NULL AND scope_key = ? ORDER BY updated_at DESC, id DESC;';

    const recentRows = (isGlobal
      ? db.prepare(recentQuery).all()
      : db.prepare(recentQuery).all(sessionScopeKey)
    ) as unknown as Memory[];

    for (const row of recentRows) {
      if (seenIds.has(row.id)) continue;
      if (row.topic_key && seenTopics.has(row.topic_key)) continue;

      seenIds.add(row.id);
      if (row.topic_key) seenTopics.add(row.topic_key);

      const { text: safeTitle, truncated: titleTruncated } = truncateCodePoints(row.title, 80);
      allOrderedCandidates.push({
        id: row.id,
        title: safeTitle,
        type: row.type,
        scope_key: row.scope_key,
        updated_at: row.updated_at,
        excerpt: extractExcerpt(row.content),
        kind: 'recent_memory',
        guidance: 'Untrusted reference. Use memory_get(id) for complete content.',
        title_abbreviated: titleTruncated ? true : undefined,
      });
    }
  });

  const availableSlice = allOrderedCandidates.slice(offset);
  const pagedItems: ContextItem[] = [];

  for (const cand of availableSlice) {
    if (pagedItems.length >= pageSize) break;

    const trialItems = [...pagedItems, cand];
    const trialHasMore = offset + trialItems.length < allOrderedCandidates.length;
    const trialCursor = trialHasMore
      ? encodeReadingCursor({
          op: 'context',
          scope_type: scopeType,
          scope_key: isGlobal ? null : sessionScopeKey,
          session_id: options.sessionId,
          offset: offset + trialItems.length,
          dataset_fingerprint: currentFingerprint,
        })
      : null;

    const trialResult: ContextResult = {
      items: trialItems,
      has_more: trialHasMore,
      next_cursor: trialCursor,
      scope: {
        kind: options.sessionScope.kind,
        project: options.sessionScope.kind === 'project' ? options.sessionScope.project : undefined,
        explicit_global: isGlobal,
      },
    };

    if (options.isWithinBudget && !options.isWithinBudget(trialResult)) {
      if (pagedItems.length > 0) {
        break;
      }
      // If even first item didn't fit, add it anyway to avoid empty loop
      pagedItems.push(cand);
      break;
    }

    pagedItems.push(cand);
  }

  const hasMore = offset + pagedItems.length < allOrderedCandidates.length;
  let nextCursor: string | null = null;

  if (hasMore && pagedItems.length > 0) {
    nextCursor = encodeReadingCursor({
      op: 'context',
      scope_type: scopeType,
      scope_key: isGlobal ? null : sessionScopeKey,
      session_id: options.sessionId,
      offset: offset + pagedItems.length,
      dataset_fingerprint: currentFingerprint,
    });
  }

  return {
    items: pagedItems,
    has_more: hasMore,
    next_cursor: nextCursor,
    scope: {
      kind: options.sessionScope.kind,
      project: options.sessionScope.kind === 'project' ? options.sessionScope.project : undefined,
      explicit_global: isGlobal,
    },
  };
}
