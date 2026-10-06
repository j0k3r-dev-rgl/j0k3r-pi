import type { DatabaseSync } from 'node:sqlite';
import { withDatabase } from '../storage/db.ts';
import { E5Client, E5ClientError } from '../client/e5-client.ts';
import type { Scope, SearchMode, SearchOptions, SearchResultEnvelope } from '../types.ts';
import { encodeScope } from '../identity.ts';
import type { SearchContext, SearchCursorData } from './types.ts';
import {
  hashSearchQuery,
  computeSearchDatasetFingerprint,
  decodeSearchCursor,
  RETRIEVAL_PROFILE_VERSION,
} from './cursor.ts';
import {
  getQueryMeaningfulTerms,
} from './tokenizer.ts';
import {
  executeSemanticSearch,
  executeLexicalSearch,
  executeHybridSearch,
  type RankingResult,
} from './ranking.ts';
import { formatSearchPage } from './page.ts';

export async function searchMemories(
  dbPath: string,
  options: SearchOptions,
  deps?: { client?: E5Client; context?: SearchContext },
): Promise<SearchResultEnvelope> {
  const signal = options.signal ?? deps?.context?.signal;
  if (signal?.aborted) {
    const err = new Error('Operation was cancelled');
    err.name = 'AbortError';
    throw err;
  }

  deps?.context?.assertActive?.();

  // Validate query
  if (typeof options.query !== 'string' || options.query.trim().length === 0) {
    throw new Error('invalid_input: Query must be a non-empty string');
  }

  const requestedMode: SearchMode = options.mode ?? 'hybrid';
  if (requestedMode !== 'hybrid' && requestedMode !== 'semantic' && requestedMode !== 'fts5') {
    throw new Error(`invalid_input: Invalid search mode '${requestedMode}'`);
  }

  // Validate scope
  if (!options.scope || (options.scope.kind !== 'global' && options.scope.kind !== 'project')) {
    throw new Error('invalid_input: Invalid scope');
  }
  if (options.scope.kind === 'project' && (!options.scope.project || typeof options.scope.project !== 'string')) {
    throw new Error('invalid_input: Invalid project in scope');
  }

  const explicitGlobal = !!options.explicitGlobal;
  const scopeKey = encodeScope(options.scope);
  const queryHash = hashSearchQuery(options.query);
  const meaningfulTerms = getQueryMeaningfulTerms(options.query);

  let cursorData: SearchCursorData | undefined;
  if (options.cursor) {
    cursorData = decodeSearchCursor(options.cursor);
    if (cursorData.scope_key !== scopeKey || cursorData.explicit_global !== explicitGlobal) {
      throw new Error('cursor_scope_mismatch: Cursor scope does not match current search scope');
    }
    if (cursorData.query_hash !== queryHash) {
      throw new Error('cursor_expired: Query mismatch between cursor and current query');
    }
    if (cursorData.requested_mode !== requestedMode) {
      throw new Error('cursor_expired: Requested mode mismatch between cursor and current query');
    }
    if (cursorData.profile_version !== RETRIEVAL_PROFILE_VERSION) {
      throw new Error('cursor_expired: Profile version mismatch');
    }
  }

  const warnings: string[] = [];
  let actualMode: SearchMode = requestedMode;
  let queryVector: number[] | null = null;

  // E5 Query Embedding (only for semantic or hybrid)
  if (requestedMode === 'fts5') {
    actualMode = 'fts5';
  } else {
    const client = deps?.client ?? new E5Client();
    try {
      if (signal?.aborted) {
        const err = new Error('Operation was cancelled');
        err.name = 'AbortError';
        throw err;
      }
      deps?.context?.assertActive?.();

      const embedRes = await client.embedQuery(options.query, signal);
      queryVector = embedRes.chunks[0].embedding;
      actualMode = requestedMode;
    } catch (err: unknown) {
      if (signal?.aborted) {
        const abortErr = new Error('Operation was cancelled');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      deps?.context?.assertActive?.();

      if (err instanceof E5ClientError && err.category === 'unavailable') {
        // Only unavailable triggers visible fallback to fts5
        actualMode = 'fts5';
        warnings.push('semantic_unavailable');
      } else {
        // input_error, integration_error, cancelled -> propagate directly without fallback
        throw err;
      }
    }
  }

  if (cursorData && cursorData.actual_mode !== actualMode) {
    throw new Error('cursor_expired: Actual retrieval mode changed between requests');
  }

  if (signal?.aborted) {
    const err = new Error('Operation was cancelled');
    err.name = 'AbortError';
    throw err;
  }
  deps?.context?.assertActive?.();

  // SQLite read transaction
  return withDatabase(dbPath, (db: DatabaseSync) => {
    db.exec('BEGIN DEFERRED;');
    try {
      const currentFingerprint = computeSearchDatasetFingerprint(db, options.scope, explicitGlobal);

      if (cursorData) {
        if (cursorData.dataset_fingerprint !== currentFingerprint) {
          throw new Error('cursor_dataset_modified: Dataset modified since cursor creation; restart search');
        }
      }

      let rankingRes: RankingResult;
      if (actualMode === 'fts5') {
        rankingRes = executeLexicalSearch(db, meaningfulTerms, options.scope, explicitGlobal);
      } else if (actualMode === 'semantic') {
        rankingRes = executeSemanticSearch(db, queryVector!, options.scope, explicitGlobal);
      } else {
        rankingRes = executeHybridSearch(db, queryVector!, meaningfulTerms, options.scope, explicitGlobal);
      }

      if (rankingRes.candidateBudgetReached) {
        warnings.push('candidate_budget_reached');
      }

      const offset = cursorData ? cursorData.offset : 0;
      const envelope = formatSearchPage({
        requestedMode,
        actualMode,
        scope: options.scope,
        scopeKey,
        explicitGlobal,
        admittedMemories: rankingRes.memories,
        offset,
        warnings,
        queryHash,
        datasetFingerprint: currentFingerprint,
        meaningfulTerms,
      });

      db.exec('COMMIT;');
      return envelope;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  });
}

export class SearchService {
  private readonly dbPath: string;
  private readonly client?: E5Client;

  constructor(
    dbPath: string,
    client?: E5Client,
  ) {
    this.dbPath = dbPath;
    this.client = client;
  }

  async search(options: SearchOptions, context?: SearchContext): Promise<SearchResultEnvelope> {
    return searchMemories(this.dbPath, options, { client: this.client, context });
  }
}
