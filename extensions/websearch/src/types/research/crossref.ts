export type CrossrefWorkGetRequest = { doi: string };
export type CrossrefReferencesRequest = { doi: string; limit: number; offset: number };

export type RawCrossrefWork = Record<string, unknown>;
export type RawCrossrefReference = Record<string, unknown>;

export type CrossrefSearchResult = {
  message?: {
    items?: RawCrossrefWork[];
    ['total-results']?: number;
  };
};

export type CrossrefReferencesResponse = {
  work?: RawCrossrefWork;
  references: RawCrossrefReference[];
  total: number;
};

export interface CrossrefClient {
  searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawCrossrefWork[]>;
  getWork(input: CrossrefWorkGetRequest, signal?: AbortSignal): Promise<RawCrossrefWork | undefined>;
  getWorkReferences(input: CrossrefReferencesRequest, signal?: AbortSignal): Promise<CrossrefReferencesResponse>;
}
