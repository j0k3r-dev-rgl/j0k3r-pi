import type { SourceError } from '../common/index.js';
import type { NormalizedResearchItem } from './item.js';
import type { ResearchSearchSource, ResearchSource } from './sources.js';

export type ResearchSearchRequest = {
  query: string;
  source: ResearchSearchSource;
  limit: number;
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
