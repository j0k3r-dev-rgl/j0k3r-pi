import type { ToolError } from '../common/index.js';
import type { WebFetchClient } from './fetch.js';

export type WebSearchProvider = 'exa' | 'parallel';
export type WebSearchMode = 'fast' | 'auto' | 'deep';

export type WebSearchFilters = {
  includeDomains?: string[];
  excludeDomains?: string[];
  afterDate?: string;
  beforeDate?: string;
  location?: string;
  mode?: WebSearchMode;
};

export type WebSearchRequest = {
  query: string;
  limit: number;
} & WebSearchFilters;

export type WebSearchFilterApplication = {
  native: string[];
  query_hint: string[];
  unsupported: string[];
};

export type RawWebSearchItem = {
  title?: string;
  url?: string;
  snippet?: string;
  published_at?: string;
  author?: string;
  score?: number;
};

export type RawWebSearchMetadata = Record<string, unknown> & {
  filter_application?: WebSearchFilterApplication;
};

export type RawWebSearchResponse = {
  items: RawWebSearchItem[];
  metadata?: RawWebSearchMetadata;
};

export type NormalizedWebSearchItem = {
  rank: number;
  source: WebSearchProvider;
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
  published_at?: string;
  author?: string;
  score?: number;
};

export type WebSearchSourceError = {
  source: WebSearchProvider;
  error: ToolError;
};

export type WebSearchResult = {
  query: string;
  limit: number;
  filters?: WebSearchFilters;
  selected_provider?: WebSearchProvider;
  providers_tried: WebSearchProvider[];
  fallback_used: boolean;
  source_errors: WebSearchSourceError[];
  provider_metadata: Partial<Record<WebSearchProvider, RawWebSearchMetadata>>;
  items: NormalizedWebSearchItem[];
};

export interface WebSearchClient {
  search(input: WebSearchRequest, signal?: AbortSignal): Promise<RawWebSearchResponse>;
}

export type WebClients = {
  exa: WebSearchClient;
  parallel: WebSearchClient;
  fetch: WebFetchClient;
};
