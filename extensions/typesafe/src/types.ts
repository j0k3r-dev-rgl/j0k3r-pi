export type QuestionType = 'choice' | 'noul' | 'score' | 'Choice' | 'Noul' | 'Score';

export interface ChoiceQuestion {
  type: 'choice' | 'Choice';
  instructions: string | Record<string, unknown> | unknown[];
  criteria: Record<string, string | null> | string[];
}

export interface NoulQuestion {
  type: 'noul' | 'Noul';
  instructions: string | Record<string, unknown> | unknown[];
  criteria?: { true?: string; false?: string };
}

export interface ScoreQuestion {
  type: 'score' | 'Score';
  instructions: string | Record<string, unknown> | unknown[];
  criteria: string[] | Array<{ level: number; description: string }>;
}

export type QuestionDefinition = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

export interface ScoreAnswer {
  type: 'score';
  score: number;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export type AnswerDefinition = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface SystemOneRequest {
  state: Record<string, unknown> | string | unknown[];
  questions: Record<string, QuestionDefinition>;
  model?: string;
}

export interface SystemOneUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface SystemOneResponse {
  id?: string;
  model: string;
  answers: Record<string, AnswerDefinition>;
  responses: Record<string, AnswerDefinition>;
  usage: SystemOneUsage;
  latency_ms: number;
}

export interface RequestOptions {
  timeout?: number;
  signal?: AbortSignal;
  apiKey?: string;
  endpoint?: string;
  model?: string;
}

// Custom error classes
export class TypeSafeError extends Error {
  readonly code: string;
  constructor(message: string, code = 'TYPESAFE_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class AuthError extends TypeSafeError {
  constructor(message = 'Missing or invalid TypeSafe API key. Please set TYPESAFE_API_KEY.') {
    super(message, 'AUTH_ERROR');
  }
}

export class TimeoutError extends TypeSafeError {
  constructor(message = 'TypeSafe request timed out.') {
    super(message, 'TIMEOUT_ERROR');
  }
}

export class RateLimitError extends TypeSafeError {
  constructor(message = 'TypeSafe rate limit exceeded (429).') {
    super(message, 'RATE_LIMIT_ERROR');
  }
}

export class ApiError extends TypeSafeError {
  readonly status?: number;
  readonly details?: unknown;
  constructor(message: string, status?: number, details?: unknown) {
    super(message, 'API_ERROR');
    this.status = status;
    this.details = details;
  }
}

export class NetworkError extends TypeSafeError {
  constructor(message: string) {
    super(message, 'NETWORK_ERROR');
  }
}

// Telemetry types for SQLite storage
export interface EvaluationRecord {
  id: string;
  session_id?: string;
  source: 'shadow-triage' | 'evaluate-tool' | 'benchmark';
  created_at: string;
  latency_ms: number;
  model: string;
  state_json: string;
  questions_json: string;
  response_json?: string;
  input_tokens?: number;
  output_tokens?: number;
  error?: string;
  shadow_actual_route?: string;
  shadow_predicted_route?: string;
  shadow_agreement?: number;
  metadata_json?: string;
}

export interface TelemetryQueryOptions {
  limit?: number;
  offset?: number;
  session_id?: string;
  source?: string;
  discrepancies_only?: boolean;
  since?: string;
}

export interface TelemetryQueryResult {
  total: number;
  records: EvaluationRecord[];
  limit: number;
  offset: number;
  has_more: boolean;
  continuation_offset?: number;
}
