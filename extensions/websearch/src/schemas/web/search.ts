import { Type } from 'typebox';
import { SEARCH_MAX_LIMIT } from '../../validation.js';

export const webSearchParameters = Type.Object({
  query: Type.String({ description: 'Web search query to run against the V1 hosted search provider chain.' }),
  limit: Type.Optional(Type.Number({ description: `Maximum results to return, 1-${SEARCH_MAX_LIMIT}. Defaults to 10.` })),
  includeDomains: Type.Optional(Type.Array(Type.String(), { description: 'Prefer or restrict results to these domains when the provider supports native domain filters; fallback providers receive query hints.' })),
  excludeDomains: Type.Optional(Type.Array(Type.String(), { description: 'Exclude these domains when the provider supports native domain filters; fallback providers receive query hints.' })),
  afterDate: Type.Optional(Type.String({ description: 'Prefer or restrict results published on or after this YYYY-MM-DD date when supported.' })),
  beforeDate: Type.Optional(Type.String({ description: 'Prefer or restrict results published on or before this YYYY-MM-DD date when supported.' })),
  location: Type.Optional(Type.String({ description: 'Two-letter country code for geo-targeting when supported, e.g. US, GB, JP.' })),
  mode: Type.Optional(Type.Union([
    Type.Literal('fast'),
    Type.Literal('auto'),
    Type.Literal('deep'),
  ], { description: 'Search mode hint. Exa receives this natively; fallback providers receive it as a query/objective hint.' })),
});
