export type EuropePmcArticleGetRequest = { article: string };

export type RawEuropePmcWork = Record<string, unknown>;

export type EuropePmcSearchResult = {
  hitCount?: number;
  resultList?: {
    result?: RawEuropePmcWork[];
  };
};

export interface EuropePmcClient {
  searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawEuropePmcWork[]>;
  getArticle(input: EuropePmcArticleGetRequest, signal?: AbortSignal): Promise<RawEuropePmcWork | undefined>;
}
