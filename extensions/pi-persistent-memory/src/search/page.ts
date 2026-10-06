import type { Scope, SearchMode, SearchResultEnvelope, SearchMemoryResult } from '../types.ts';
import { decodeScope } from '../identity.ts';
import type { AdmittedMemory } from './types.ts';
import { encodeSearchCursor, RETRIEVAL_PROFILE_VERSION } from './cursor.ts';

export const MAX_MEMORIES_PER_PAGE = 5;
export const MAX_ENVELOPE_BYTES = 6144;

export interface PageFormatOptions {
  requestedMode: SearchMode;
  actualMode: SearchMode;
  scope: Scope;
  scopeKey: string;
  explicitGlobal: boolean;
  admittedMemories: AdmittedMemory[];
  offset: number;
  warnings?: string[];
  queryHash: string;
  datasetFingerprint: string;
  meaningfulTerms?: string[];
}

/**
 * Slices a string safely by Unicode code points, preventing invalid UTF-8 surrogate halves.
 */
function sliceCodePoints(text: string, start: number, count: number): string {
  const codePoints = Array.from(text);
  return codePoints.slice(start, start + count).join('');
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

function extractLexicalExcerpt(
  title: string,
  content: string,
  meaningfulTerms: string[] = [],
): { excerpt: string; field: 'title' | 'content'; start: number; end: number } {
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();

  for (const term of meaningfulTerms) {
    const tIdx = titleLower.indexOf(term);
    if (tIdx !== -1) {
      const snippet = sliceCodePoints(title, Math.max(0, tIdx - 20), 80);
      return { excerpt: snippet, field: 'title', start: tIdx, end: tIdx + term.length };
    }
    const cIdx = contentLower.indexOf(term);
    if (cIdx !== -1) {
      const snippet = sliceCodePoints(content, Math.max(0, cIdx - 20), 80);
      return { excerpt: snippet, field: 'content', start: cIdx, end: cIdx + term.length };
    }
  }

  // Fallback to beginning of content or title
  const fallback = content.trim().length > 0 ? content : title;
  const snippet = sliceCodePoints(fallback, 0, 80);
  return {
    excerpt: snippet,
    field: content.trim().length > 0 ? 'content' : 'title',
    start: 0,
    end: Math.min(snippet.length, 80),
  };
}

export function formatSearchPage(options: PageFormatOptions): SearchResultEnvelope {
  const {
    requestedMode,
    actualMode,
    scope,
    scopeKey,
    explicitGlobal,
    admittedMemories,
    offset,
    warnings = [],
    queryHash,
    datasetFingerprint,
    meaningfulTerms = [],
  } = options;

  const totalAdmitted = admittedMemories.length;
  const candidateSlice = admittedMemories.slice(offset, offset + MAX_MEMORIES_PER_PAGE);

  const scopeDisplay = {
    kind: scope.kind,
    project: scope.kind === 'project' ? scope.project : undefined,
    explicit_global: explicitGlobal,
  };

  const results: SearchMemoryResult[] = [];

  for (let i = 0; i < candidateSlice.length; i++) {
    const mem = candidateSlice[i];
    let decodedScope: Scope;
    try {
      decodedScope = decodeScope(mem.scope_key);
    } catch {
      decodedScope = scope;
    }

    // Determine excerpt
    let excerptText: string;
    let excerptField: 'title' | 'content' = 'content';
    let excerptStart = 0;
    let excerptEnd = 0;

    if (mem.best_chunk) {
      const { text: truncatedChunk } = truncateCodePoints(mem.best_chunk.chunk_text, 100);
      excerptText = truncatedChunk;
      excerptField = mem.best_chunk.start_char < mem.title.length ? 'title' : 'content';
      excerptStart = mem.best_chunk.start_char;
      excerptEnd = mem.best_chunk.end_char;
    } else {
      const lexExcerpt = extractLexicalExcerpt(mem.title, mem.content, meaningfulTerms);
      excerptText = lexExcerpt.excerpt;
      excerptField = lexExcerpt.field;
      excerptStart = lexExcerpt.start;
      excerptEnd = lexExcerpt.end;
    }

    // Abbreviate oversized title / excerpt
    const { text: safeTitle, truncated: titleTruncated } = truncateCodePoints(mem.title, 80);
    const { text: safeExcerpt, truncated: excerptTruncated } = truncateCodePoints(excerptText, 120);

    const isAbbreviated = titleTruncated || excerptTruncated;

    const resultItem: SearchMemoryResult = {
      id: mem.id,
      title: safeTitle,
      scope: decodedScope,
      type: mem.type,
      updated_at: mem.updated_at,
      score: Math.round(mem.score * 10000) / 10000,
      excerpt: safeExcerpt,
      excerpt_meta: {
        field: excerptField,
        start: excerptStart,
        end: excerptEnd,
      },
    };

    if (isAbbreviated) {
      resultItem.abbreviated = true;
      resultItem.guidance = 'Use memory_get with id for full content';
    }

    // Test adding resultItem to results while checking envelope size
    const prospectiveCount = results.length + 1;
    const prospectiveHasMore = offset + prospectiveCount < totalAdmitted;
    const prospectiveCursor = prospectiveHasMore
      ? encodeSearchCursor({
          op: 'search',
          query_hash: queryHash,
          requested_mode: requestedMode,
          actual_mode: actualMode,
          scope_key: scopeKey,
          explicit_global: explicitGlobal,
          profile_version: RETRIEVAL_PROFILE_VERSION,
          dataset_fingerprint: datasetFingerprint,
          offset: offset + prospectiveCount,
        })
      : null;

    const trialEnvelope: SearchResultEnvelope = {
      status: 'ok',
      requested_mode: requestedMode,
      actual_mode: actualMode,
      scope: scopeDisplay,
      results: [...results, resultItem],
      has_more: prospectiveHasMore,
      next_cursor: prospectiveCursor,
      warnings,
    };

    const trialBytes = Buffer.byteLength(JSON.stringify(trialEnvelope), 'utf8');

    if (trialBytes <= MAX_ENVELOPE_BYTES) {
      results.push(resultItem);
    } else {
      // If trialBytes > MAX_ENVELOPE_BYTES, attempt further truncation of current item
      const { text: miniTitle } = truncateCodePoints(mem.title, 30);
      const { text: miniExcerpt } = truncateCodePoints(safeExcerpt, 40);
      const miniItem: SearchMemoryResult = {
        ...resultItem,
        title: miniTitle,
        excerpt: miniExcerpt,
        abbreviated: true,
        guidance: 'Use memory_get with id for full content',
      };

      const miniTrialEnvelope: SearchResultEnvelope = {
        ...trialEnvelope,
        results: [...results, miniItem],
      };

      const miniTrialBytes = Buffer.byteLength(JSON.stringify(miniTrialEnvelope), 'utf8');
      if (miniTrialBytes <= MAX_ENVELOPE_BYTES) {
        results.push(miniItem);
      } else {
        // Cannot fit even abbreviated; stop adding items to this page
        break;
      }
    }
  }

  // Check edge case: zero items fit and offset < totalAdmitted
  if (results.length === 0 && candidateSlice.length > 0) {
    throw new Error('envelope_limit_exceeded: Response envelope exceeds 6144 bytes budget; refine query or scope');
  }

  const hasMore = offset + results.length < totalAdmitted;
  const nextCursor = hasMore
    ? encodeSearchCursor({
        op: 'search',
        query_hash: queryHash,
        requested_mode: requestedMode,
        actual_mode: actualMode,
        scope_key: scopeKey,
        explicit_global: explicitGlobal,
        profile_version: RETRIEVAL_PROFILE_VERSION,
        dataset_fingerprint: datasetFingerprint,
        offset: offset + results.length,
      })
    : null;

  return {
    status: 'ok',
    requested_mode: requestedMode,
    actual_mode: actualMode,
    scope: scopeDisplay,
    results,
    has_more: hasMore,
    next_cursor: nextCursor,
    warnings,
  };
}
