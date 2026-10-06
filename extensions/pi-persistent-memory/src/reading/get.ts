import type { DatabaseSync } from 'node:sqlite';
import { withDatabase } from '../storage/db.ts';
import { encodeScope } from '../identity.ts';
import type { Scope, Memory } from '../types.ts';
import {
  encodeReadingCursor,
  decodeReadingCursor,
  type GetCursorData,
} from './cursor.ts';
import {
  measureSerializedToolResult,
  MAX_TOOL_RESULT_BYTES,
} from '../tools/result-helper.ts';

export interface ReadMemoryDetailOptions {
  id: number;
  global?: boolean;
  cursor?: string;
  sessionScope: Scope;
  maxChunkBytes?: number;
}

export interface MemoryDetailResult {
  id: number;
  title: string;
  content: string;
  type: string;
  scope_key: string;
  content_version: number;
  created_at: string;
  updated_at: string;
  field: 'title' | 'content';
  offset: number;
  total_field_bytes: number;
  page_bytes: number;
  has_more: boolean;
  next_cursor: string | null;
  title_abbreviated?: boolean;
  title_guidance?: string;
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

export function readMemoryDetail(
  dbPath: string,
  options: ReadMemoryDetailOptions,
  deps?: { assertActive?: () => void },
): MemoryDetailResult {
  deps?.assertActive?.();

  if (!Number.isSafeInteger(options.id) || options.id <= 0) {
    throw new Error('invalid_input: id must be a positive integer');
  }

  const isGlobal = !!options.global;
  const expectedScopeKey = encodeScope(options.sessionScope);

  let mem: Memory | undefined;
  withDatabase(dbPath, (db) => {
    deps?.assertActive?.();
    const row = db.prepare('SELECT * FROM memories WHERE id = ?;').get(options.id) as Memory | undefined;
    if (!row) {
      throw new Error(`target_not_found: Memory ${options.id} not found in scope ${options.sessionScope.kind}`);
    }
    if (row.deleted_at !== null) {
      throw new Error(`target_deleted: Memory ${options.id} is deleted and cannot be read with memory_get`);
    }
    if (!isGlobal && row.scope_key !== expectedScopeKey) {
      throw new Error(`target_not_found: Memory ${options.id} not found in scope ${options.sessionScope.kind}`);
    }
    mem = row;
  });

  const row = mem!;
  let cursorData: GetCursorData | undefined;

  if (options.cursor) {
    cursorData = decodeReadingCursor<GetCursorData>(options.cursor, 'get');
    if (cursorData.id !== row.id) {
      throw new Error('cursor_invalid: Cursor memory ID does not match requested ID');
    }
    if (cursorData.global !== isGlobal) {
      throw new Error('cursor_invalid: Cursor global flag does not match request');
    }
    if (!isGlobal && cursorData.scope_key !== expectedScopeKey) {
      throw new Error('cursor_scope_mismatch: Cursor scope does not match authorized scope');
    }
    if (cursorData.content_version !== row.content_version) {
      throw new Error('cursor_expired: Memory was modified since page was requested');
    }
  }

  const titleBytes = Buffer.byteLength(row.title, 'utf8');
  const contentBytes = Buffer.byteLength(row.content, 'utf8');
  const titlePagingThreshold = options.maxChunkBytes ?? 300;
  const titleNeedsPaging = titleBytes > titlePagingThreshold;

  // Single page check when no cursor provided and maxChunkBytes is default:
  if (!options.cursor && !options.maxChunkBytes) {
    const singleTrialDetail: MemoryDetailResult = {
      id: row.id,
      title: row.title,
      content: row.content,
      type: row.type,
      scope_key: row.scope_key,
      content_version: row.content_version,
      created_at: row.created_at,
      updated_at: row.updated_at,
      field: 'content',
      offset: 0,
      total_field_bytes: contentBytes,
      page_bytes: contentBytes,
      has_more: false,
      next_cursor: null,
    };
    const singleTrialDetails = {
      id: row.id,
      field: 'content',
      offset: 0,
      has_more: false,
      next_cursor: null,
    };
    if (measureSerializedToolResult(singleTrialDetail, singleTrialDetails) <= MAX_TOOL_RESULT_BYTES) {
      return singleTrialDetail;
    }
  }

  let currentField: 'title' | 'content';
  let currentOffset: number;

  if (cursorData) {
    currentField = cursorData.field;
    currentOffset = cursorData.offset;
  } else {
    currentField = titleNeedsPaging ? 'title' : 'content';
    currentOffset = 0;
  }

  if (currentField === 'title') {
    const titleCodePoints = Array.from(row.title);
    let low = currentOffset + 1;
    let high = titleCodePoints.length;
    let bestEnd = currentOffset + 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const trialSlice = titleCodePoints.slice(currentOffset, mid).join('');
      const isComplete = mid >= titleCodePoints.length;
      const hasMore = !isComplete || row.content.length > 0;
      const nextCursor = hasMore
        ? encodeReadingCursor({
            op: 'get',
            id: row.id,
            content_version: row.content_version,
            global: isGlobal,
            scope_key: row.scope_key,
            field: isComplete ? 'content' : 'title',
            offset: isComplete ? 0 : mid,
          })
        : null;

      const trialDetail: MemoryDetailResult = {
        id: row.id,
        title: trialSlice,
        content: '',
        type: row.type,
        scope_key: row.scope_key,
        content_version: row.content_version,
        created_at: row.created_at,
        updated_at: row.updated_at,
        field: 'title',
        offset: currentOffset,
        total_field_bytes: titleBytes,
        page_bytes: Buffer.byteLength(trialSlice, 'utf8'),
        has_more: hasMore,
        next_cursor: nextCursor,
      };
      const trialDetails = {
        id: row.id,
        field: 'title',
        offset: currentOffset,
        has_more: hasMore,
        next_cursor: nextCursor,
      };

      const fitsBudget = measureSerializedToolResult(trialDetail, trialDetails) <= MAX_TOOL_RESULT_BYTES;
      const fitsChunkBytes = options.maxChunkBytes
        ? Buffer.byteLength(trialSlice, 'utf8') <= options.maxChunkBytes
        : true;

      if (fitsBudget && fitsChunkBytes) {
        bestEnd = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const slice = titleCodePoints.slice(currentOffset, bestEnd).join('');
    const isComplete = bestEnd >= titleCodePoints.length;
    const hasMore = !isComplete || row.content.length > 0;
    const nextCursor = hasMore
      ? encodeReadingCursor({
          op: 'get',
          id: row.id,
          content_version: row.content_version,
          global: isGlobal,
          scope_key: row.scope_key,
          field: isComplete ? 'content' : 'title',
          offset: isComplete ? 0 : bestEnd,
        })
      : null;

    return {
      id: row.id,
      title: slice,
      content: '',
      type: row.type,
      scope_key: row.scope_key,
      content_version: row.content_version,
      created_at: row.created_at,
      updated_at: row.updated_at,
      field: 'title',
      offset: currentOffset,
      total_field_bytes: titleBytes,
      page_bytes: Buffer.byteLength(slice, 'utf8'),
      has_more: hasMore,
      next_cursor: nextCursor,
    };
  }

  // Field is 'content'
  const isTitleAbbrev = titleNeedsPaging;
  const safeTitle = isTitleAbbrev ? truncateCodePoints(row.title, 60).text : row.title;
  const titleGuidance = isTitleAbbrev ? "Title exceeds page budget; full title was paged via field: 'title'" : undefined;

  const contentCodePoints = Array.from(row.content);
  if (contentCodePoints.length === 0) {
    return {
      id: row.id,
      title: safeTitle,
      content: '',
      type: row.type,
      scope_key: row.scope_key,
      content_version: row.content_version,
      created_at: row.created_at,
      updated_at: row.updated_at,
      field: 'content',
      offset: currentOffset,
      total_field_bytes: contentBytes,
      page_bytes: 0,
      has_more: false,
      next_cursor: null,
      title_abbreviated: isTitleAbbrev ? true : undefined,
      title_guidance: titleGuidance,
    };
  }

  let low = currentOffset + 1;
  let high = contentCodePoints.length;
  let bestEnd = currentOffset + 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const trialSlice = contentCodePoints.slice(currentOffset, mid).join('');
    const isComplete = mid >= contentCodePoints.length;
    const hasMore = !isComplete;
    const nextCursor = hasMore
      ? encodeReadingCursor({
          op: 'get',
          id: row.id,
          content_version: row.content_version,
          global: isGlobal,
          scope_key: row.scope_key,
          field: 'content',
          offset: mid,
        })
      : null;

    const trialDetail: MemoryDetailResult = {
      id: row.id,
      title: safeTitle,
      content: trialSlice,
      type: row.type,
      scope_key: row.scope_key,
      content_version: row.content_version,
      created_at: row.created_at,
      updated_at: row.updated_at,
      field: 'content',
      offset: currentOffset,
      total_field_bytes: contentBytes,
      page_bytes: Buffer.byteLength(trialSlice, 'utf8'),
      has_more: hasMore,
      next_cursor: nextCursor,
      title_abbreviated: isTitleAbbrev ? true : undefined,
      title_guidance: titleGuidance,
    };
    const trialDetails = {
      id: row.id,
      field: 'content',
      offset: currentOffset,
      has_more: hasMore,
      next_cursor: nextCursor,
    };

    const fitsBudget = measureSerializedToolResult(trialDetail, trialDetails) <= MAX_TOOL_RESULT_BYTES;
    const fitsChunkBytes = options.maxChunkBytes
      ? Buffer.byteLength(trialSlice, 'utf8') <= options.maxChunkBytes
      : true;

    if (fitsBudget && fitsChunkBytes) {
      bestEnd = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const slice = contentCodePoints.slice(currentOffset, bestEnd).join('');
  const isComplete = bestEnd >= contentCodePoints.length;
  const hasMore = !isComplete;
  const nextCursor = hasMore
    ? encodeReadingCursor({
        op: 'get',
        id: row.id,
        content_version: row.content_version,
        global: isGlobal,
        scope_key: row.scope_key,
        field: 'content',
        offset: bestEnd,
      })
    : null;

  return {
    id: row.id,
    title: safeTitle,
    content: slice,
    type: row.type,
    scope_key: row.scope_key,
    content_version: row.content_version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    field: 'content',
    offset: currentOffset,
    total_field_bytes: contentBytes,
    page_bytes: Buffer.byteLength(slice, 'utf8'),
    has_more: hasMore,
    next_cursor: nextCursor,
    title_abbreviated: isTitleAbbrev ? true : undefined,
    title_guidance: titleGuidance,
  };
}
