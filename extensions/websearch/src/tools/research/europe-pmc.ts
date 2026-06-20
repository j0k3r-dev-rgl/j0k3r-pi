import { europePmcArticleParameters } from '../../schemas/research/europe-pmc.js';
import { europePmcArticleGraphParameters } from '../../schemas/research/graph.js';
import { truncateText } from '../../security.js';
import { europePmcArticleSummary } from '../../summaries/research/europe-pmc.js';
import { researchGraphSummary } from '../../summaries/research/graph.js';
import type { NormalizedResearchItem, PiToolResult, RawEuropePmcWork, RegisterWebsearchToolsDeps, ResearchClients, ResearchDetailResult, ResearchGraphResult } from '../../types.js';
import { FULL_TOOL_CONTENT, buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { signalFromContext, type ExecuteContext } from '../common/index.js';
import { asInput, normalizeDoi, numberValue, optionalBoundedLimit, optionalPage, requiredString, researchClientsFromDeps, stringValue, withFollowup } from './common.js';

export const europePmcResearchToolNames = ['europe_pmc_article_get', 'europe_pmc_article_citations_get', 'europe_pmc_article_references_get'] as const;

function validateEuropePmcArticleGet(value: unknown): { article: string } {
  return { article: requiredString(asInput(value).article, 'article') };
}

function validateEuropePmcGraph(value: unknown): { article: string; limit: number; page: number } {
  const input = asInput(value);
  return { article: requiredString(input.article, 'article'), limit: optionalBoundedLimit(input), page: optionalPage(input) };
}

export function normalizeEuropePmcWork(raw: RawEuropePmcWork, sourceRank: number): NormalizedResearchItem {
  const id = stringValue(raw.id) ?? stringValue(raw.pmid) ?? stringValue(raw.doi) ?? `europe-pmc-${sourceRank}`;
  const doi = normalizeDoi(raw.doi);
  const source = stringValue(raw.source);
  const pmid = stringValue(raw.pmid) ?? (source === 'MED' ? stringValue(raw.id) : undefined);
  const pmcid = stringValue(raw.pmcid) ?? (source === 'PMC' ? stringValue(raw.id) : undefined);
  const url = pmcid ? `https://europepmc.org/article/PMC/${pmcid.replace(/^PMC/i, '')}` : pmid ? `https://europepmc.org/article/MED/${pmid}` : doi ? `https://doi.org/${doi}` : undefined;
  const authors = stringValue(raw.authorString)?.split(/,\s*/).map((author) => author.trim()).filter(Boolean).slice(0, 12);
  return withFollowup({
    source: 'europe_pmc',
    kind: 'article',
    id,
    title: truncateText(stringValue(raw.title), 300),
    url,
    doi,
    pmid,
    pmcid,
    year: numberValue(raw.pubYear),
    authors: authors && authors.length > 0 ? authors : undefined,
    summary: stringValue(raw.abstractText),
    abstract: stringValue(raw.abstractText),
    citation_count: numberValue(raw.citedByCount),
    open_access: raw.isOpenAccess === 'Y' ? true : raw.isOpenAccess === 'N' ? false : undefined,
    venue: stringValue(raw.journalTitle),
    source_rank: sourceRank,
    rank: 0,
    metadata: { source, has_full_text: raw.hasFullText },
  }, pmcid ?? stringValue(raw.pmid) ?? doi ?? id);
}

async function getEuropePmcArticle(input: { article: string }, clients: ResearchClients, signal?: AbortSignal): Promise<ResearchDetailResult | undefined> {
  const raw = await clients.europePmc.getArticle(input, signal);
  return raw ? { ...normalizeEuropePmcWork(raw, 1), rank: 1 } : undefined;
}

async function getEuropePmcGraph(input: { article: string; limit: number; page: number }, relation: 'citations' | 'references', clients: ResearchClients, signal?: AbortSignal): Promise<ResearchGraphResult> {
  const response = relation === 'citations'
    ? await clients.europePmc.getArticleCitations(input, signal)
    : await clients.europePmc.getArticleReferences(input, signal);
  const rawItems = relation === 'citations' ? response.citationList?.citation : response.referenceList?.reference;
  const items = (rawItems ?? []).map((item, index) => ({ ...normalizeEuropePmcWork(item, index + 1), rank: index + 1 }));
  return {
    source: 'europe_pmc',
    relation,
    subject: input.article,
    limit: input.limit,
    page: input.page,
    total: numberValue(response.hitCount),
    next_page: response.hitCount !== undefined && input.page * input.limit < Number(response.hitCount) ? input.page + 1 : undefined,
    items,
    metadata: { request: response.request, resolved_article: response.resolvedArticle },
  };
}

export const europePmcResearchTools: WebsearchToolModule<typeof europePmcResearchToolNames[number]> = {
  names: europePmcResearchToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'europe_pmc_article_get',
      description: 'Fetch one Europe PMC article by DOI, PMID/external id, PMCID, or Europe PMC URL.',
      parameters: europePmcArticleParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<ResearchDetailResult>> {
        try {
          const input = validateEuropePmcArticleGet(params);
          const data = await getEuropePmcArticle(input, researchClientsFromDeps(deps), signalFromContext(context));
          if (!data) return buildFailure({ code: 'not_found', category: 'not_found', message: 'Europe PMC article was not found.', recoverable: true, provider: 'europe_pmc' });
          return buildSuccess(europePmcArticleSummary(data), data, FULL_TOOL_CONTENT);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'europe_pmc_article_citations_get',
      description: 'Fetch Europe PMC articles that cite one article using the verified Europe PMC citations endpoint.',
      parameters: europePmcArticleGraphParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<ResearchGraphResult>> {
        try {
          const input = validateEuropePmcGraph(params);
          const data = await getEuropePmcGraph(input, 'citations', researchClientsFromDeps(deps), signalFromContext(context));
          return buildSuccess(researchGraphSummary('europe_pmc_article_citations_get', data), data, 12000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'europe_pmc_article_references_get',
      description: 'Fetch references for one Europe PMC article using the verified Europe PMC references endpoint.',
      parameters: europePmcArticleGraphParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<ResearchGraphResult>> {
        try {
          const input = validateEuropePmcGraph(params);
          const data = await getEuropePmcGraph(input, 'references', researchClientsFromDeps(deps), signalFromContext(context));
          return buildSuccess(researchGraphSummary('europe_pmc_article_references_get', data), data, 12000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
