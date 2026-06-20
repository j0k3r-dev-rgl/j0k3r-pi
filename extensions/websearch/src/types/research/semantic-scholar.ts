export type SemanticScholarPaperGetRequest = { paper: string };

export type RawSemanticScholarPaper = Record<string, unknown>;

export type SemanticScholarSearchResult = {
  total?: number;
  data?: RawSemanticScholarPaper[];
};

export interface SemanticScholarClient {
  searchPapers(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawSemanticScholarPaper[]>;
  getPaper(input: SemanticScholarPaperGetRequest, signal?: AbortSignal): Promise<RawSemanticScholarPaper | undefined>;
}
