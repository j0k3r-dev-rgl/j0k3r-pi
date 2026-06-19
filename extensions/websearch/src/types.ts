export type ToolContent = {
  type: 'text';
  text: string;
};

export type Provider = 'stack_overflow';

export type ToolError = {
  code:
    | 'validation_error'
    | 'missing_configuration'
    | 'provider_error'
    | 'rate_limited'
    | 'quota_exhausted'
    | 'not_found'
    | 'source_unavailable'
    | 'cancelled'
    | 'timeout';
  message: string;
  recoverable: boolean;
  retry_after_seconds?: number;
  backoff_seconds?: number;
  provider?: Provider;
};

export type ToolResponse<T> =
  | { status: 'success'; data: T }
  | { status: 'failure'; error: ToolError };

export type PiToolResult<T> = {
  content: ToolContent[];
  details: ToolResponse<T>;
  isError?: true;
};

export type AvailabilityStatus = 'available' | 'deleted' | 'removed' | 'private' | 'unavailable';

export type Availability = {
  status: AvailabilityStatus;
  reason?: string;
};

export type StackOverflowQuestionRef = {
  questionId: string;
  url: string;
};

export type StackOverflowSearchRequest = {
  query: string;
  limit: number;
};

export type StackOverflowAnswersRequest = StackOverflowQuestionRef & {
  limit: number;
};

export type StackOverflowRawQuestion = Record<string, unknown>;
export type StackOverflowRawAnswer = Record<string, unknown>;

export type NormalizedStackOverflowQuestion = {
  platform: 'stack_overflow';
  id: string;
  question_id: string;
  url: string;
  title?: string;
  score?: number;
  answer_count?: number;
  tags?: string[];
  author?: string;
  created_at?: string;
  snippet?: string;
  body?: string;
  availability: Availability;
};

export type NormalizedStackOverflowAnswer = {
  platform: 'stack_overflow';
  id: string;
  answer_id: string;
  question_id?: string;
  url?: string;
  score?: number;
  accepted?: boolean;
  author?: string;
  created_at?: string;
  body?: string;
  availability: Availability;
};

export type StackOverflowSearchResult = {
  query: string;
  limit: number;
  items: NormalizedStackOverflowQuestion[];
};

export type StackOverflowAnswersResult = {
  questionId: string;
  limit: number;
  answers: NormalizedStackOverflowAnswer[];
};

export interface StackExchangeClient {
  searchQuestions(input: StackOverflowSearchRequest, signal?: AbortSignal): Promise<StackOverflowRawQuestion[]>;
  getQuestion(input: StackOverflowQuestionRef, signal?: AbortSignal): Promise<StackOverflowRawQuestion | null>;
  getAnswers(input: StackOverflowAnswersRequest, signal?: AbortSignal): Promise<StackOverflowRawAnswer[]>;
}

export interface WebsearchClients {
  stackExchange: StackExchangeClient;
}

export interface RegisterWebsearchToolsDeps {
  clients?: Partial<WebsearchClients>;
  createClients?: (runtime: WebsearchRuntime) => WebsearchClients;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
}

export type WebsearchRuntime = {
  env: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
};
