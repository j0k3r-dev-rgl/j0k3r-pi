import type { SourceError } from '../common/index.js';

export type ResearchSource = 'openalex' | 'arxiv' | 'crossref' | 'europe_pmc' | 'semantic_scholar';
export type ResearchSearchSource = ResearchSource | 'all';

export type ResearchSearchRequest = {
  query: string;
  source: ResearchSearchSource;
  limit: number;
};

export type RawOpenAlexWork = Record<string, unknown>;

export type OpenAlexSearchResult = {
  meta?: Record<string, unknown>;
  results?: RawOpenAlexWork[];
};

export type RawCrossrefWork = Record<string, unknown>;

export type CrossrefSearchResult = {
  message?: {
    items?: RawCrossrefWork[];
    ['total-results']?: number;
  };
};

export type RawEuropePmcWork = Record<string, unknown>;

export type EuropePmcSearchResult = {
  hitCount?: number;
  resultList?: {
    result?: RawEuropePmcWork[];
  };
};

export type RawSemanticScholarPaper = Record<string, unknown>;

export type SemanticScholarSearchResult = {
  total?: number;
  data?: RawSemanticScholarPaper[];
};

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

export interface ResearchClients {
  openAlex: OpenAlexClient;
  arxiv: ArxivClient;
  crossref: CrossrefClient;
  europePmc: EuropePmcClient;
  semanticScholar: SemanticScholarClient;
}

export interface OpenAlexClient {
  searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawOpenAlexWork[]>;
}

export interface ArxivClient {
  searchPapers(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawArxivEntry[]>;
}

export interface CrossrefClient {
  searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawCrossrefWork[]>;
}

export interface EuropePmcClient {
  searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawEuropePmcWork[]>;
}

export interface SemanticScholarClient {
  searchPapers(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawSemanticScholarPaper[]>;
}

export type NormalizedResearchItem = {
  source: ResearchSource;
  kind: 'work' | 'preprint' | 'article' | 'paper';
  id: string;
  title?: string;
  url?: string;
  doi?: string;
  arxiv_id?: string;
  pmid?: string;
  pmcid?: string;
  year?: number;
  published_at?: string;
  updated_at?: string;
  authors?: string[];
  summary?: string;
  abstract?: string;
  citation_count?: number;
  reference_count?: number;
  open_access?: boolean;
  pdf_url?: string;
  venue?: string;
  categories?: string[];
  source_rank: number;
  rank: number;
  metadata?: Record<string, unknown>;
};

export type ResearchSearchResult = {
  query: string;
  selected_source: ResearchSearchSource;
  limit: number;
  sources_searched: ResearchSource[];
  available_sources: ResearchSource[];
  source_errors: Array<SourceError<ResearchSource>>;
  items: NormalizedResearchItem[];
};
