import type { DatabaseSync } from 'node:sqlite';
import type { Scope } from '../types.ts';
import { encodeScope } from '../identity.ts';
import {
  CANONICAL_MODEL,
  CANONICAL_REVISION,
  CANONICAL_DIMENSIONS,
} from '../client/e5-client.ts';
import type { AdmittedMemory } from './types.ts';
import {
  computeTextCoverage,
  buildFts5MatchExpression,
} from './tokenizer.ts';

export interface RankingResult {
  memories: AdmittedMemory[];
  candidateBudgetReached: boolean;
}

const RRF_K = 60;
const SEMANTIC_SIMILARITY_FLOOR = 0.86;
const HYBRID_LEXICAL_COSINE_FLOOR = 0.82;
const LEXICAL_COVERAGE_FLOOR = 0.35;
const MAX_VECTOR_CHUNKS_BUDGET = 200;
const MAX_LEXICAL_CANDIDATES_BUDGET = 100;

export function registerCoverageFunction(db: DatabaseSync): void {
  db.function('memory_literal_coverage', { deterministic: true }, (title, content, termsJson) => {
    try {
      const terms = JSON.parse(String(termsJson)) as string[];
      return computeTextCoverage(terms, String(title ?? ''), String(content ?? ''));
    } catch {
      return 0;
    }
  });
}

function vectorToBuffer(vector: number[]): Uint8Array {
  const floatArr = new Float32Array(vector);
  return new Uint8Array(floatArr.buffer);
}

export function executeSemanticSearch(
  db: DatabaseSync,
  vector: number[],
  scope: Scope,
  explicitGlobal: boolean,
): RankingResult {
  const isGlobal = explicitGlobal || scope.kind === 'global';
  const scopeSql = isGlobal ? '' : 'AND m.scope_key = ?';
  const scopeParams = isGlobal ? [] : [encodeScope(scope)];

  const queryVectorBuffer = vectorToBuffer(vector);

  const sql = `
    SELECT
      c.id AS chunk_id,
      c.memory_id,
      c.chunk_index,
      c.chunk_text,
      c.start_char,
      c.end_char,
      c.token_count,
      c.content_version,
      m.title,
      m.content,
      m.scope_key,
      m.type,
      m.updated_at,
      vec_distance_cosine(v.embedding, ?) AS distance
    FROM chunks c
    JOIN memories m ON m.id = c.memory_id
    JOIN memory_vectors v ON v.rowid = c.id
    WHERE m.deleted_at IS NULL
      AND m.indexing_status = 'indexed'
      AND c.content_version = m.content_version
      AND c.model_id = ?
      AND c.model_revision = ?
      AND c.dimensions = ?
      AND c.normalized = 1
      ${scopeSql}
    ORDER BY distance ASC, m.id ASC, c.chunk_index ASC, c.id ASC
    LIMIT ${MAX_VECTOR_CHUNKS_BUDGET};
  `;

  const rows = db.prepare(sql).all(
    queryVectorBuffer,
    CANONICAL_MODEL,
    CANONICAL_REVISION,
    CANONICAL_DIMENSIONS,
    ...scopeParams,
  ) as Array<{
    chunk_id: number;
    memory_id: number;
    chunk_index: number;
    chunk_text: string;
    start_char: number;
    end_char: number;
    token_count: number;
    content_version: number;
    title: string;
    content: string;
    scope_key: string;
    type: string;
    updated_at: string;
    distance: number;
  }>;

  const candidateBudgetReached = rows.length === MAX_VECTOR_CHUNKS_BUDGET;

  // Best-chunk deduplication per memory
  const memoryBest = new Map<number, {
    memory: AdmittedMemory;
    distance: number;
    chunkIndex: number;
    chunkId: number;
  }>();

  for (const row of rows) {
    const similarity = 1 - row.distance;
    if (similarity < SEMANTIC_SIMILARITY_FLOOR) {
      continue;
    }

    const existing = memoryBest.get(row.memory_id);
    if (!existing || row.distance < existing.distance || (row.distance === existing.distance && row.chunk_index < existing.chunkIndex)) {
      memoryBest.set(row.memory_id, {
        memory: {
          id: row.memory_id,
          title: row.title,
          content: row.content,
          scope_key: row.scope_key,
          type: row.type,
          updated_at: row.updated_at,
          score: similarity,
          best_chunk: {
            chunk_index: row.chunk_index,
            chunk_text: row.chunk_text,
            start_char: row.start_char,
            end_char: row.end_char,
          },
        },
        distance: row.distance,
        chunkIndex: row.chunk_index,
        chunkId: row.chunk_id,
      });
    }
  }

  // Sort admitted memories: similarity DESC (distance ASC), then memory id ASC
  const admitted = Array.from(memoryBest.values())
    .sort((a, b) => a.distance - b.distance || a.memory.id - b.memory.id)
    .map((item) => item.memory);

  return { memories: admitted, candidateBudgetReached };
}

export function executeLexicalSearch(
  db: DatabaseSync,
  meaningfulTerms: string[],
  scope: Scope,
  explicitGlobal: boolean,
): RankingResult {
  if (meaningfulTerms.length === 0) {
    return { memories: [], candidateBudgetReached: false };
  }

  registerCoverageFunction(db);

  const isGlobal = explicitGlobal || scope.kind === 'global';
  const scopeSql = isGlobal ? '' : 'AND m.scope_key = ?';
  const scopeParams = isGlobal ? [] : [encodeScope(scope)];

  const termsJson = JSON.stringify(meaningfulTerms);
  const ftsExpr = buildFts5MatchExpression(meaningfulTerms);

  let rows: Array<{
    id: number;
    title: string;
    content: string;
    scope_key: string;
    type: string;
    updated_at: string;
    bm25_rank: number;
    coverage: number;
  }>;

  if (ftsExpr) {
    const sql = `
      SELECT
        m.id,
        m.title,
        m.content,
        m.scope_key,
        m.type,
        m.updated_at,
        bm25(memory_fts) AS bm25_rank,
        memory_literal_coverage(m.title, m.content, ?) AS coverage
      FROM memory_fts
      JOIN memories m ON m.id = memory_fts.rowid
      WHERE memory_fts MATCH ?
        AND m.deleted_at IS NULL
        ${scopeSql}
        AND memory_literal_coverage(m.title, m.content, ?) >= ${LEXICAL_COVERAGE_FLOOR}
      ORDER BY bm25_rank ASC, m.id ASC
      LIMIT ${MAX_LEXICAL_CANDIDATES_BUDGET};
    `;
    rows = db.prepare(sql).all(termsJson, ftsExpr, ...scopeParams, termsJson) as typeof rows;
  } else {
    const sql = `
      SELECT
        m.id,
        m.title,
        m.content,
        m.scope_key,
        m.type,
        m.updated_at,
        0.0 AS bm25_rank,
        memory_literal_coverage(m.title, m.content, ?) AS coverage
      FROM memories m
      WHERE m.deleted_at IS NULL
        ${scopeSql}
        AND memory_literal_coverage(m.title, m.content, ?) >= ${LEXICAL_COVERAGE_FLOOR}
      ORDER BY m.id ASC
      LIMIT ${MAX_LEXICAL_CANDIDATES_BUDGET};
    `;
    rows = db.prepare(sql).all(termsJson, ...scopeParams, termsJson) as typeof rows;
  }

  const candidateBudgetReached = rows.length === MAX_LEXICAL_CANDIDATES_BUDGET;

  const memories: AdmittedMemory[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    scope_key: row.scope_key,
    type: row.type,
    updated_at: row.updated_at,
    score: row.bm25_rank,
    coverage: row.coverage,
  }));

  return { memories, candidateBudgetReached };
}

export function executeHybridSearch(
  db: DatabaseSync,
  vector: number[],
  meaningfulTerms: string[],
  scope: Scope,
  explicitGlobal: boolean,
): RankingResult {
  const semResult = executeSemanticSearch(db, vector, scope, explicitGlobal);
  const lexResult = executeLexicalSearch(db, meaningfulTerms, scope, explicitGlobal);

  const candidateBudgetReached = semResult.candidateBudgetReached || lexResult.candidateBudgetReached;

  const queryVectorBuffer = vectorToBuffer(vector);

  // Map semantic candidates by memory id
  const semCandidatesMap = new Map<number, AdmittedMemory>();
  for (const m of semResult.memories) {
    semCandidatesMap.set(m.id, m);
  }

  // Evaluate lexical candidates: each must have a valid current chunk with cosine >= 0.82
  const chunkCheckStmt = db.prepare(`
    SELECT
      c.id AS chunk_id,
      c.chunk_index,
      c.chunk_text,
      c.start_char,
      c.end_char,
      vec_distance_cosine(v.embedding, ?) AS distance
    FROM chunks c
    JOIN memory_vectors v ON v.rowid = c.id
    JOIN memories m ON m.id = c.memory_id
    WHERE c.memory_id = ?
      AND m.deleted_at IS NULL
      AND m.indexing_status = 'indexed'
      AND c.content_version = m.content_version
      AND c.model_id = ?
      AND c.model_revision = ?
      AND c.dimensions = ?
      AND c.normalized = 1
    ORDER BY distance ASC, c.chunk_index ASC, c.id ASC
    LIMIT 1;
  `);

  const admittedLexical: AdmittedMemory[] = [];

  for (const lexMem of lexResult.memories) {
    let bestSimilarity: number;
    let bestChunk: AdmittedMemory['best_chunk'];

    if (semCandidatesMap.has(lexMem.id)) {
      const semMem = semCandidatesMap.get(lexMem.id)!;
      bestSimilarity = semMem.score;
      bestChunk = semMem.best_chunk;
    } else {
      const chunkRow = chunkCheckStmt.get(
        queryVectorBuffer,
        lexMem.id,
        CANONICAL_MODEL,
        CANONICAL_REVISION,
        CANONICAL_DIMENSIONS,
      ) as {
        chunk_id: number;
        chunk_index: number;
        chunk_text: string;
        start_char: number;
        end_char: number;
        distance: number;
      } | undefined;

      if (!chunkRow) {
        // Missing valid vectors -> no hybrid lexical admission
        continue;
      }

      bestSimilarity = 1 - chunkRow.distance;
      bestChunk = {
        chunk_index: chunkRow.chunk_index,
        chunk_text: chunkRow.chunk_text,
        start_char: chunkRow.start_char,
        end_char: chunkRow.end_char,
      };
    }

    if (bestSimilarity >= HYBRID_LEXICAL_COSINE_FLOOR) {
      admittedLexical.push({
        ...lexMem,
        best_chunk: bestChunk,
      });
    }
  }

  // RRF computation: RRF = sum(1 / (60 + rank))
  const rrfScores = new Map<number, {
    memory: AdmittedMemory;
    rrf: number;
  }>();

  // 1. Semantic contribution
  semResult.memories.forEach((mem, index) => {
    const rank = index + 1; // 1-based rank
    const contribution = 1 / (RRF_K + rank);
    const existing = rrfScores.get(mem.id);
    if (existing) {
      existing.rrf += contribution;
    } else {
      rrfScores.set(mem.id, {
        memory: { ...mem },
        rrf: contribution,
      });
    }
  });

  // 2. Lexical contribution
  admittedLexical.forEach((mem, index) => {
    const rank = index + 1; // 1-based rank
    const contribution = 1 / (RRF_K + rank);
    const existing = rrfScores.get(mem.id);
    if (existing) {
      existing.rrf += contribution;
      if (!existing.memory.coverage && mem.coverage) {
        existing.memory.coverage = mem.coverage;
      }
    } else {
      rrfScores.set(mem.id, {
        memory: { ...mem },
        rrf: contribution,
      });
    }
  });

  // Final sorting: RRF score DESC, then memory ID ASC
  const fusedMemories = Array.from(rrfScores.values())
    .sort((a, b) => b.rrf - a.rrf || a.memory.id - b.memory.id)
    .map((item) => ({
      ...item.memory,
      score: item.rrf,
    }));

  return { memories: fusedMemories, candidateBudgetReached };
}
