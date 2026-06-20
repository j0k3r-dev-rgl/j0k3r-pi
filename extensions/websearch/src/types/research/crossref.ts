export type CrossrefWorkGetRequest = { doi: string };

export type RawCrossrefWork = Record<string, unknown>;

export type CrossrefSearchResult = {
  message?: {
    items?: RawCrossrefWork[];
    ['total-results']?: number;
  };
};

export interface CrossrefClient {
  searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawCrossrefWork[]>;
  getWork(input: CrossrefWorkGetRequest, signal?: AbortSignal): Promise<RawCrossrefWork | undefined>;
}
