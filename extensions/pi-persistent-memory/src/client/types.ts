export type ErrorCategory = 'unavailable' | 'input_error' | 'integration_error' | 'cancelled';

export interface ValidatedChunk {
  chunk_index: number;
  text: string;
  start: number;
  end: number;
  token_count: number;
  embedding: number[];
}

export interface ValidatedEmbeddingResult {
  model: string;
  model_revision: string;
  dimensions: number;
  normalization: string;
  max_input_tokens: number;
  chunks: ValidatedChunk[];
}

export type HealthStatus =
  | { state: 'ready'; model: string; model_revision: string; dimensions: number; normalization: string; max_input_tokens: number }
  | { state: 'not_ready'; message: string }
  | { state: 'incompatible'; message: string }
  | { state: 'unavailable'; message: string };
