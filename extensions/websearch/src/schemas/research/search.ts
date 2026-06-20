import { Type } from 'typebox';
import { boundedSearchLimitSchema } from '../common/index.js';

export const researchSearchParameters = Type.Object({
  query: Type.String({ description: 'Academic/research query to run across research sources.' }),
  source: Type.Optional(Type.Union([
    Type.Literal('all'),
    Type.Literal('openalex'),
    Type.Literal('arxiv'),
    Type.Literal('crossref'),
    Type.Literal('europe_pmc'),
    Type.Literal('semantic_scholar'),
  ], {
    description: 'Optional source filter. Omit or use all for OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar fan-out.',
  })),
  limit: boundedSearchLimitSchema,
});
