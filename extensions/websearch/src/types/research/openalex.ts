export type OpenAlexWorkGetRequest = { work: string };

export type RawOpenAlexWork = Record<string, unknown>;

export type OpenAlexSearchResult = {
  meta?: Record<string, unknown>;
  results?: RawOpenAlexWork[];
};

export interface OpenAlexClient {
  searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawOpenAlexWork[]>;
  getWork(input: OpenAlexWorkGetRequest, signal?: AbortSignal): Promise<RawOpenAlexWork | undefined>;
}
