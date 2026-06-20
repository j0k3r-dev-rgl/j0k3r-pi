export type EuropePmcArticleGetRequest = { article: string };
export type EuropePmcGraphRequest = { article: string; limit: number; page: number };

export type RawEuropePmcWork = Record<string, unknown>;

export type EuropePmcSearchResult = {
  hitCount?: number;
  resultList?: {
    result?: RawEuropePmcWork[];
  };
};

export type EuropePmcGraphResponse = {
  hitCount?: number;
  request?: Record<string, unknown>;
  citationList?: { citation?: RawEuropePmcWork[] };
  referenceList?: { reference?: RawEuropePmcWork[] };
  resolvedArticle?: RawEuropePmcWork;
};

export interface EuropePmcClient {
  searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawEuropePmcWork[]>;
  getArticle(input: EuropePmcArticleGetRequest, signal?: AbortSignal): Promise<RawEuropePmcWork | undefined>;
  getArticleCitations(input: EuropePmcGraphRequest, signal?: AbortSignal): Promise<EuropePmcGraphResponse>;
  getArticleReferences(input: EuropePmcGraphRequest, signal?: AbortSignal): Promise<EuropePmcGraphResponse>;
}
