import type { ResearchSource } from './sources.js';

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
  followup_tool?: string;
  followup_ref?: string | number;
};

export type ResearchDetailResult = NormalizedResearchItem;
