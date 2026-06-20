export type ArxivPaperGetRequest = { paper: string };

export type RawArxivEntry = {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  updated?: string;
  authors?: string[];
  categories?: string[];
  links?: Array<{ href?: string; rel?: string; title?: string; type?: string }>;
  doi?: string;
};

export interface ArxivClient {
  searchPapers(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawArxivEntry[]>;
  getPaper(input: ArxivPaperGetRequest, signal?: AbortSignal): Promise<RawArxivEntry | undefined>;
}
