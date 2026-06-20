export type SemanticScholarPaperGetRequest = { paper: string };
export type SemanticScholarGraphRequest = { paper: string; limit: number; offset: number };

export type RawSemanticScholarPaper = Record<string, unknown>;

export type SemanticScholarSearchResult = {
  total?: number;
  data?: RawSemanticScholarPaper[];
};

export type SemanticScholarGraphResponse = {
  offset?: number;
  next?: number;
  data?: Array<{ citingPaper?: RawSemanticScholarPaper; citedPaper?: RawSemanticScholarPaper }>;
};

export interface SemanticScholarClient {
  searchPapers(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawSemanticScholarPaper[]>;
  getPaper(input: SemanticScholarPaperGetRequest, signal?: AbortSignal): Promise<RawSemanticScholarPaper | undefined>;
  getPaperCitations(input: SemanticScholarGraphRequest, signal?: AbortSignal): Promise<SemanticScholarGraphResponse>;
  getPaperReferences(input: SemanticScholarGraphRequest, signal?: AbortSignal): Promise<SemanticScholarGraphResponse>;
}
