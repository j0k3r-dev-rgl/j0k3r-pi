export type OpenAlexWorkGetRequest = { work: string };
export type OpenAlexGraphRequest = { work: string; limit: number; page: number };

export type RawOpenAlexWork = Record<string, unknown>;

export type OpenAlexSearchResult = {
  meta?: Record<string, unknown>;
  results?: RawOpenAlexWork[];
};

export type OpenAlexGraphResponse = {
  meta?: Record<string, unknown>;
  results: RawOpenAlexWork[];
  total?: number;
};

export interface OpenAlexClient {
  searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawOpenAlexWork[]>;
  getWork(input: OpenAlexWorkGetRequest, signal?: AbortSignal): Promise<RawOpenAlexWork | undefined>;
  getWorkCitations(input: OpenAlexGraphRequest, signal?: AbortSignal): Promise<OpenAlexGraphResponse>;
  getWorkReferences(input: OpenAlexGraphRequest, signal?: AbortSignal): Promise<OpenAlexGraphResponse>;
}
