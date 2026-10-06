import type { Scope, SearchMode, SearchMemoryResult, SearchResultEnvelope, SearchOptions } from '../types.ts';

export type { Scope, SearchMode, SearchMemoryResult, SearchResultEnvelope, SearchOptions };

export interface SearchCursorData {
  op: 'search';
  query_hash: string;
  requested_mode: SearchMode;
  actual_mode: SearchMode;
  scope_key: string;
  explicit_global: boolean;
  profile_version: number;
  dataset_fingerprint: string;
  offset: number;
}

export interface CandidateMemory {
  id: number;
  title: string;
  content: string;
  scope_key: string;
  type: string;
  updated_at: string;
  score: number;
  best_chunk?: {
    chunk_index: number;
    chunk_text: string;
    start_char: number;
    end_char: number;
  };
  coverage?: number;
}

export interface AdmittedMemory {
  id: number;
  title: string;
  content: string;
  scope_key: string;
  type: string;
  updated_at: string;
  score: number;
  best_chunk?: {
    chunk_index: number;
    chunk_text: string;
    start_char: number;
    end_char: number;
  };
  coverage?: number;
}

export interface SearchContext {
  signal?: AbortSignal;
  assertActive?: () => void;
}
