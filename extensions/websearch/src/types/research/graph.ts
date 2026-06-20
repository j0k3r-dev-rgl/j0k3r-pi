import type { NormalizedResearchItem } from './item.js';
import type { ResearchSource } from './sources.js';

export type ResearchGraphRelation = 'citations' | 'references';

export type ResearchGraphResult = {
  source: ResearchSource;
  relation: ResearchGraphRelation;
  subject: string;
  limit: number;
  offset?: number;
  page?: number;
  total?: number;
  next_offset?: number;
  next_page?: number;
  items: NormalizedResearchItem[];
  metadata?: Record<string, unknown>;
};
