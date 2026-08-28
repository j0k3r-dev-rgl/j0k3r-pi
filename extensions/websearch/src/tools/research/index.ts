import { researchSearchParameters } from '../../schemas/research/search.js';
import { researchSearchSummary } from '../../summaries/research/search.js';
import type {
  NormalizedResearchItem,
  PiToolResult,
  RegisterWebsearchToolsDeps,
  ResearchClients,
  ResearchSearchRequest,
  ResearchSearchResult,
  ResearchSearchSource,
  ResearchSource,
  ToolError,
} from '../../types.js';
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, ValidationError } from '../../validation.js';
import { interleaveGroups } from '../common/index.js';
import { buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { signalFromContext, type ExecuteContext } from '../common/index.js';
import { normalizeArxivEntry, arxivResearchToolNames, arxivResearchTools } from './arxiv.js';
import { asInput, researchClientsFromDeps } from './common.js';
import { normalizeCrossrefWork, crossrefResearchToolNames, crossrefResearchTools } from './crossref.js';
import { normalizeEuropePmcWork, europePmcResearchToolNames, europePmcResearchTools } from './europe-pmc.js';
import { normalizeOpenAlexWork, openAlexResearchToolNames, openAlexResearchTools } from './openalex.js';
import { normalizeSemanticScholarPaper, semanticScholarResearchToolNames, semanticScholarResearchTools } from './semantic-scholar.js';

const researchSources = ['all', 'openalex', 'arxiv', 'crossref', 'europe_pmc', 'semantic_scholar'] as const;
const availableResearchSources: ResearchSource[] = ['openalex', 'arxiv', 'crossref', 'europe_pmc', 'semantic_scholar'];
const sourceToolModules = [
  openAlexResearchTools,
  arxivResearchTools,
  crossrefResearchTools,
  europePmcResearchTools,
  semanticScholarResearchTools,
] as const satisfies readonly WebsearchToolModule[];

export const researchToolNames = [
  'research_search',
  ...openAlexResearchToolNames,
  ...arxivResearchToolNames,
  ...crossrefResearchToolNames,
  ...europePmcResearchToolNames,
  ...semanticScholarResearchToolNames,
] as const;

function validateResearchSearch(value: unknown): ResearchSearchRequest {
  const input = asInput(value);
  const query = input.query;
  if (typeof query !== 'string' || query.trim() === '') throw new ValidationError('query is required.');
  const sourceValue = input.source;
  let source: ResearchSearchSource = 'all';
  if (sourceValue !== undefined && sourceValue !== null && sourceValue !== '') {
    if (typeof sourceValue !== 'string' || !(researchSources as readonly string[]).includes(sourceValue)) {
      throw new ValidationError(`source must be one of: ${researchSources.join(', ')}.`);
    }
    source = sourceValue as ResearchSearchSource;
  }
  const limitValue = input.limit;
  let limit = SEARCH_DEFAULT_LIMIT;
  if (limitValue !== undefined && limitValue !== null && limitValue !== '') {
    if (typeof limitValue !== 'number' || !Number.isInteger(limitValue)) throw new ValidationError('limit must be an integer.');
    if (limitValue < 1) throw new ValidationError('limit must be at least 1.');
    if (limitValue > SEARCH_MAX_LIMIT) throw new ValidationError(`limit must be at most ${SEARCH_MAX_LIMIT}.`);
    limit = limitValue;
  }
  return { query: query.trim(), source, limit };
}

function concreteSources(source: ResearchSearchSource): ResearchSource[] {
  return source === 'all' ? [...availableResearchSources] : [source];
}

async function searchOneSource(source: ResearchSource, input: ResearchSearchRequest, clients: ResearchClients, signal?: AbortSignal): Promise<NormalizedResearchItem[]> {
  if (source === 'openalex') {
    const raw = await clients.openAlex.searchWorks({ query: input.query, limit: input.limit }, signal);
    return raw.map((item, index) => normalizeOpenAlexWork(item, index + 1));
  }
  if (source === 'arxiv') {
    const raw = await clients.arxiv.searchPapers({ query: input.query, limit: input.limit }, signal);
    return raw.map((item, index) => normalizeArxivEntry(item, index + 1));
  }
  if (source === 'crossref') {
    const raw = await clients.crossref.searchWorks({ query: input.query, limit: input.limit }, signal);
    return raw.map((item, index) => normalizeCrossrefWork(item, index + 1));
  }
  if (source === 'europe_pmc') {
    const raw = await clients.europePmc.searchWorks({ query: input.query, limit: input.limit }, signal);
    return raw.map((item, index) => normalizeEuropePmcWork(item, index + 1));
  }
  const raw = await clients.semanticScholar.searchPapers({ query: input.query, limit: input.limit }, signal);
  return raw.map((item, index) => normalizeSemanticScholarPaper(item, index + 1));
}

function addRank(items: NormalizedResearchItem[]): NormalizedResearchItem[] {
  return items.map((item, index) => ({ ...item, rank: index + 1 }));
}

export const researchTools: WebsearchToolModule<typeof researchToolNames[number]> = {
  names: researchToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'research_search',
      label: 'Research Search',
      description: 'Search academic/research sources with unified bounded read-only results. Supports fan-out across OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar or a single source filter.',
      promptSnippet: 'Search academic sources such as OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar.',
      promptGuidelines: [
        'Use research_search for scholarly literature discovery instead of web_search when the user asks for papers, articles, citations, authors, DOIs, or academic sources.',
        'Use research_search source filters when the user names a specific academic index or repository.',
      ],
      parameters: researchSearchParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<ResearchSearchResult>> {
        try {
          const input = validateResearchSearch(params);
          const sources = concreteSources(input.source);
          const clients = researchClientsFromDeps(deps);
          const signal = signalFromContext(context);
          const settled = await Promise.all(sources.map(async (source) => {
            try {
              return { source, items: await searchOneSource(source, input, clients, signal), error: undefined };
            } catch (error) {
              return { source, items: [] as NormalizedResearchItem[], error: toToolError(error) };
            }
          }));
          const sourceErrors = settled
            .filter((entry): entry is { source: ResearchSource; items: NormalizedResearchItem[]; error: ToolError } => Boolean(entry.error))
            .map((entry) => ({ source: entry.source, error: entry.error }));
          const items = addRank(interleaveGroups(settled.map((entry) => entry.items), input.limit));
          const data: ResearchSearchResult = {
            query: input.query,
            selected_source: input.source,
            limit: input.limit,
            sources_searched: sources,
            available_sources: availableResearchSources,
            source_errors: sourceErrors,
            items,
          };
          return buildSuccess(researchSearchSummary(data), data, 12000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    for (const module of sourceToolModules) {
      module.register(pi, deps);
    }
  },
};
