import { Type } from 'typebox';
import type { PiToolResult, RegisterWebsearchToolsDeps } from '../../types.js';
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, ValidationError } from '../../validation.js';
import { buildFailure, buildSuccess, toToolError } from '../result.js';
import { registerTool, type WebsearchToolModule } from '../registry.js';

const researchSources = ['all'] as const;
type ResearchSource = typeof researchSources[number];

type ResearchSearchInput = {
  query: string;
  source: ResearchSource;
  limit: number;
};

type ResearchSearchResult = {
  query: string;
  selected_source: ResearchSource;
  limit: number;
  sources_searched: string[];
  available_sources: string[];
  items: Array<Record<string, unknown>>;
  note: string;
};

export const researchSearchParameters = Type.Object({
  query: Type.String({ description: 'Academic/research query. Providers such as OpenAlex, Semantic Scholar, and arXiv can be added behind this tool.' }),
  source: Type.Optional(Type.Literal('all', { description: 'Optional research source filter. Only all is available until academic providers are configured.' })),
  limit: Type.Optional(Type.Number({ description: `Maximum results to return, 1-${SEARCH_MAX_LIMIT}.` })),
});

export const researchToolNames = ['research_search'] as const;

function asInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function validateResearchSearch(value: unknown): ResearchSearchInput {
  const input = asInput(value);
  const query = input.query;
  if (typeof query !== 'string' || query.trim() === '') throw new ValidationError('query is required.');
  const source = input.source;
  if (source !== undefined && source !== null && source !== '' && source !== 'all') {
    throw new ValidationError('source must be all until research providers are configured.');
  }
  const limitValue = input.limit;
  let limit = SEARCH_DEFAULT_LIMIT;
  if (limitValue !== undefined && limitValue !== null && limitValue !== '') {
    if (typeof limitValue !== 'number' || !Number.isInteger(limitValue)) throw new ValidationError('limit must be an integer.');
    if (limitValue < 1) throw new ValidationError('limit must be at least 1.');
    if (limitValue > SEARCH_MAX_LIMIT) throw new ValidationError(`limit must be at most ${SEARCH_MAX_LIMIT}.`);
    limit = limitValue;
  }
  return { query: query.trim(), source: 'all', limit };
}

function researchSummary(data: ResearchSearchResult): string {
  return `No research sources are configured yet for research_search. Query: "${data.query}". Add academic providers behind src/tools/research/ to enable OpenAlex, Semantic Scholar, arXiv, or similar sources.`;
}

export const researchTools: WebsearchToolModule<typeof researchToolNames[number]> = {
  names: researchToolNames,
  register(pi: any, _deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'research_search',
      description: 'Search academic/research sources with unified bounded read-only results. Currently a parent tool scaffold for future research providers.',
      parameters: researchSearchParameters,
      async execute(_id: string, params: unknown): Promise<PiToolResult<ResearchSearchResult>> {
        try {
          const input = validateResearchSearch(params);
          const data: ResearchSearchResult = {
            query: input.query,
            selected_source: input.source,
            limit: input.limit,
            sources_searched: [],
            available_sources: [],
            items: [],
            note: 'No research sources are configured yet.',
          };
          return buildSuccess(researchSummary(data), data, 4000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
