import type { WebsearchConfig } from '../config.js';
import type { DevtoClient } from './discussions/devto.js';
import type { GitHubClient } from './discussions/github.js';
import type { HackerNewsClient } from './discussions/hackernews.js';
import type { ResearchClients } from './research/index.js';
import type { StackExchangeClient } from './discussions/stack-overflow.js';

export type ToolContent = {
  type: 'text';
  text: string;
};

export type Provider = 'stack_overflow' | 'github' | 'devto' | 'hacker_news' | 'openalex' | 'arxiv' | 'crossref' | 'europe_pmc' | 'semantic_scholar';

export type ErrorCategory =
  | 'validation'
  | 'rate_limit'
  | 'quota_exhausted'
  | 'auth'
  | 'not_found'
  | 'provider_unavailable'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'provider_payload'
  | 'unexpected';

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
  category?: ErrorCategory;
  status?: number;
  request_id?: string;
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

export interface WebsearchClients {
  stackExchange: StackExchangeClient;
  github: GitHubClient;
  devto: DevtoClient;
  hackerNews: HackerNewsClient;
  research?: ResearchClients;
}

export type CommandRunnerResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = (file: string, args: string[], options?: { signal?: AbortSignal }) => Promise<CommandRunnerResult>;

export interface RegisterWebsearchToolsDeps {
  clients?: Partial<WebsearchClients>;
  createClients?: (runtime: WebsearchRuntime) => WebsearchClients;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  commandRunner?: CommandRunner;
  config?: WebsearchConfig;
}

export type WebsearchRuntime = {
  env: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  config: WebsearchConfig;
  commandRunner?: CommandRunner;
};
