import { withDatabase } from '../storage/db.ts';
import { initSchema } from '../storage/schema.ts';
import {
  getUserMessage,
  searchUserMessages,
  type UserMessageRecord,
} from '../storage/history-store.ts';
import {
  encodeHistoryCursor,
  decodeHistoryCursor,
  validateHistorySearchCursor,
  validateHistoryGetCursor,
  hashHistorySearchQuery,
} from './cursor.ts';
import {
  MAX_TOOL_RESULT_BYTES,
  measureSerializedToolResult,
} from '../tools/result-helper.ts';

export interface HistorySearchArgs {
  query?: string;
  session_id?: string;
  limit?: number;
  cursor?: string;
}

export interface HistorySearchResultItem {
  id: number;
  session_id: string;
  created_at: string;
  excerpt: string;
}

export interface HistorySearchResult {
  records: HistorySearchResultItem[];
  count: number;
  has_more: boolean;
  next_cursor: string | null;
}

export interface HistoryGetArgs {
  id: number;
  cursor?: string;
}

export interface HistoryGetResult {
  id: number;
  session_id: string;
  created_at: string;
  content: string;
  offset: number;
  total_bytes: number;
  has_more: boolean;
  next_cursor: string | null;
}

export function searchHistory(
  dbPath: string,
  projectKey: string,
  args: HistorySearchArgs,
): HistorySearchResult {
  const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);

  let beforeId: number | undefined;
  if (args.cursor) {
    const rawCursor = decodeHistoryCursor(args.cursor);
    const validated = validateHistorySearchCursor(rawCursor, projectKey, args.query, args.session_id);
    beforeId = validated.before_id;
  }

  // Fetch limit + 1 records from store to detect has_more cleanly
  const records = withDatabase(dbPath, (db) => {
    initSchema(db);
    return searchUserMessages(db, {
      projectKey,
      sessionId: args.session_id,
      query: args.query,
      beforeId,
      limit: limit + 1,
    });
  });

  const hasDbMore = records.length > limit;
  const candidateRecords = records.slice(0, limit);

  // Incrementally admit records while staying within MAX_TOOL_RESULT_BYTES
  const admittedItems: HistorySearchResultItem[] = [];
  let nextCursor: string | null = null;
  let hasMore = hasDbMore;

  const queryHash = args.query ? hashHistorySearchQuery(args.query) : undefined;

  for (let i = 0; i < candidateRecords.length; i++) {
    const rec = candidateRecords[i];
    // Create excerpt: first 200 chars or first paragraph
    const excerpt = rec.content.length > 200 ? rec.content.slice(0, 200) + '...' : rec.content;

    const candidateItem: HistorySearchResultItem = {
      id: rec.id,
      session_id: rec.session_id,
      created_at: rec.created_at,
      excerpt,
    };

    const trialList = [...admittedItems, candidateItem];
    const trialData = {
      records: trialList,
      count: trialList.length,
      has_more: true,
      next_cursor: encodeHistoryCursor({
        op: 'history_search',
        project_key: projectKey,
        query_hash: queryHash,
        session_id: args.session_id,
        before_id: candidateItem.id,
      }),
    };

    const details = {
      action: 'search',
      count: trialList.length,
      has_more: true,
    };

    const measuredBytes = measureSerializedToolResult(trialData, details, false);
    if (measuredBytes > MAX_TOOL_RESULT_BYTES && admittedItems.length > 0) {
      // Must stop admitting to prevent exceeding byte budget
      hasMore = true;
      const lastAdmitted = admittedItems[admittedItems.length - 1];
      nextCursor = encodeHistoryCursor({
        op: 'history_search',
        project_key: projectKey,
        query_hash: queryHash,
        session_id: args.session_id,
        before_id: lastAdmitted.id,
      });
      break;
    }

    admittedItems.push(candidateItem);
  }

  if (!nextCursor && hasMore && admittedItems.length > 0) {
    const lastAdmitted = admittedItems[admittedItems.length - 1];
    nextCursor = encodeHistoryCursor({
      op: 'history_search',
      project_key: projectKey,
      query_hash: queryHash,
      session_id: args.session_id,
      before_id: lastAdmitted.id,
    });
  }

  return {
    records: admittedItems,
    count: admittedItems.length,
    has_more: hasMore,
    next_cursor: hasMore ? nextCursor : null,
  };
}

export function getHistoryDetail(
  dbPath: string,
  projectKey: string,
  args: HistoryGetArgs,
): HistoryGetResult {
  if (typeof args.id !== 'number' || !Number.isSafeInteger(args.id) || args.id <= 0) {
    throw new Error('input_error: Valid positive integer id is required for action=get');
  }

  let byteOffset = 0;
  if (args.cursor) {
    const rawCursor = decodeHistoryCursor(args.cursor);
    const validated = validateHistoryGetCursor(rawCursor, projectKey, args.id);
    byteOffset = validated.byte_offset;
  }

  const record = withDatabase(dbPath, (db) => {
    initSchema(db);
    return getUserMessage(db, args.id, projectKey);
  });

  if (!record) {
    // Fail-closed: message does not exist or belongs to different project
    throw new Error(`not_found: Message ${args.id} not found`);
  }

  const contentBuffer = Buffer.from(record.content, 'utf8');
  const totalBytes = contentBuffer.length;

  if (byteOffset >= totalBytes && totalBytes > 0) {
    throw new Error('cursor_invalid: Cursor offset exceeds message content length');
  }

  // Slice content along code points while ensuring serialized result <= MAX_TOOL_RESULT_BYTES
  // Let's decode from byteOffset
  const remainingString = contentBuffer.subarray(byteOffset).toString('utf8');
  const codePoints = Array.from(remainingString);

  let chunk = '';
  let chunkByteLength = 0;

  for (let i = 0; i < codePoints.length; i++) {
    const cp = codePoints[i];
    const candidateChunk = chunk + cp;
    const candidateBytes = Buffer.byteLength(candidateChunk, 'utf8');
    const trialNextOffset = byteOffset + candidateBytes;
    const trialHasMore = trialNextOffset < totalBytes;

    const trialNextCursor = trialHasMore
      ? encodeHistoryCursor({
          op: 'history_get',
          project_key: projectKey,
          id: record.id,
          byte_offset: trialNextOffset,
        })
      : null;

    const trialData: HistoryGetResult = {
      id: record.id,
      session_id: record.session_id,
      created_at: record.created_at,
      content: candidateChunk,
      offset: byteOffset,
      total_bytes: totalBytes,
      has_more: trialHasMore,
      next_cursor: trialNextCursor,
    };

    const details = {
      action: 'get',
      id: record.id,
      offset: byteOffset,
      has_more: trialHasMore,
    };

    const measuredBytes = measureSerializedToolResult(trialData, details, false);
    if (measuredBytes > MAX_TOOL_RESULT_BYTES && chunk.length > 0) {
      break;
    }

    chunk = candidateChunk;
    chunkByteLength = candidateBytes;
  }

  const nextByteOffset = byteOffset + chunkByteLength;
  const hasMore = nextByteOffset < totalBytes;
  const nextCursor = hasMore
    ? encodeHistoryCursor({
        op: 'history_get',
        project_key: projectKey,
        id: record.id,
        byte_offset: nextByteOffset,
      })
    : null;

  // Final safety check against MAX_TOOL_RESULT_BYTES
  while (chunk.length > 0) {
    const finalData: HistoryGetResult = {
      id: record.id,
      session_id: record.session_id,
      created_at: record.created_at,
      content: chunk,
      offset: byteOffset,
      total_bytes: totalBytes,
      has_more: hasMore,
      next_cursor: nextCursor,
    };
    const finalDetails = {
      action: 'get',
      id: record.id,
      offset: byteOffset,
      total_bytes: totalBytes,
      has_more: hasMore,
      next_cursor: nextCursor,
    };
    if (measureSerializedToolResult(finalData, finalDetails, false) <= MAX_TOOL_RESULT_BYTES) {
      break;
    }
    // Trim code points from end until fits
    const cps = Array.from(chunk);
    cps.pop();
    chunk = cps.join('');
  }

  const finalChunkBytes = Buffer.byteLength(chunk, 'utf8');
  const finalNextOffset = byteOffset + finalChunkBytes;
  const finalHasMore = finalNextOffset < totalBytes;
  const finalNextCursor = finalHasMore
    ? encodeHistoryCursor({
        op: 'history_get',
        project_key: projectKey,
        id: record.id,
        byte_offset: finalNextOffset,
      })
    : null;

  return {
    id: record.id,
    session_id: record.session_id,
    created_at: record.created_at,
    content: chunk,
    offset: byteOffset,
    total_bytes: totalBytes,
    has_more: finalHasMore,
    next_cursor: finalNextCursor,
  };
}
