import type { DatabaseSync } from 'node:sqlite';
import { withDatabase } from '../storage/db.ts';
import { encodeScope } from '../identity.ts';
import type { Scope } from '../types.ts';
import {
  encodeReadingCursor,
  decodeReadingCursor,
  computeDeletedDatasetFingerprint,
  type DeletedCursorData,
} from './cursor.ts';

export interface ReadDeletedListOptions {
  sessionScope: Scope;
  global?: boolean;
  cursor?: string;
  pageSize?: number;
  isWithinBudget?: (result: DeletedListResult) => boolean;
}

export interface DeletedItem {
  id: number;
  title: string;
  type: string;
  scope_key: string;
  deleted_at: string;
  title_abbreviated?: boolean;
}

export interface DeletedListResult {
  items: DeletedItem[];
  has_more: boolean;
  next_cursor: string | null;
  total?: number;
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

export function readDeletedList(
  dbPath: string,
  options: ReadDeletedListOptions,
  deps?: { assertActive?: () => void },
): DeletedListResult {
  deps?.assertActive?.();

  const isGlobal = !!options.global;
  const pageSize = options.pageSize ?? 5;
  const scopeKey = isGlobal ? null : encodeScope(options.sessionScope);
  const scopeType = isGlobal ? 'all' : 'scope';

  let currentFingerprint = '';
  let offset = 0;

  if (options.cursor) {
    const cursorData = decodeReadingCursor<DeletedCursorData>(options.cursor, 'deleted_list');
    if (cursorData.scope_type !== scopeType || cursorData.scope_key !== scopeKey) {
      throw new Error('cursor_scope_mismatch: Cursor scope does not match requested scope');
    }
    offset = cursorData.offset;

    withDatabase(dbPath, (db) => {
      deps?.assertActive?.();
      currentFingerprint = computeDeletedDatasetFingerprint(db, scopeType, scopeKey);
    });

    if (cursorData.dataset_fingerprint !== currentFingerprint) {
      throw new Error('cursor_expired: Deleted memory dataset modified since cursor was created');
    }
  } else {
    withDatabase(dbPath, (db) => {
      deps?.assertActive?.();
      currentFingerprint = computeDeletedDatasetFingerprint(db, scopeType, scopeKey);
    });
  }

  let items: DeletedItem[] = [];
  let hasMore = false;
  let nextCursor: string | null = null;

  withDatabase(dbPath, (db) => {
    deps?.assertActive?.();
    const query = scopeType === 'scope'
      ? 'SELECT id, title, type, scope_key, deleted_at FROM memories WHERE deleted_at IS NOT NULL AND scope_key = ? ORDER BY deleted_at DESC, id DESC LIMIT ? OFFSET ?;'
      : 'SELECT id, title, type, scope_key, deleted_at FROM memories WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC LIMIT ? OFFSET ?;';

    const params = scopeType === 'scope'
      ? [scopeKey, pageSize + 1, offset]
      : [pageSize + 1, offset];

    const rows = db.prepare(query).all(...params) as unknown as Array<{ id: number; title: string; type: string; scope_key: string; deleted_at: string }>;

    for (const r of rows) {
      if (items.length >= pageSize) break;

      const { text: safeTitle, truncated: titleTruncated } = truncateCodePoints(r.title, 80);
      const candItem: DeletedItem = {
        id: r.id,
        title: safeTitle,
        type: r.type,
        scope_key: r.scope_key,
        deleted_at: r.deleted_at,
        title_abbreviated: titleTruncated ? true : undefined,
      };

      const trialItems = [...items, candItem];
      const trialHasMore = rows.length > trialItems.length;
      const trialCursor = trialHasMore
        ? encodeReadingCursor({
            op: 'deleted_list',
            scope_type: scopeType,
            scope_key: scopeKey,
            offset: offset + trialItems.length,
            dataset_fingerprint: currentFingerprint,
          })
        : null;

      const trialResult: DeletedListResult = {
        items: trialItems,
        has_more: trialHasMore,
        next_cursor: trialCursor,
      };

      if (options.isWithinBudget && !options.isWithinBudget(trialResult)) {
        if (items.length > 0) {
          break;
        }
        items.push(candItem);
        break;
      }

      items.push(candItem);
    }

    hasMore = rows.length > items.length;
    nextCursor = hasMore && items.length > 0
      ? encodeReadingCursor({
          op: 'deleted_list',
          scope_type: scopeType,
          scope_key: scopeKey,
          offset: offset + items.length,
          dataset_fingerprint: currentFingerprint,
        })
      : null;
  });

  return {
    items,
    has_more: hasMore,
    next_cursor: nextCursor,
  };
}
