import { europePmcArticleParameters } from '../../schemas/research/europe-pmc.js';
import { truncateText } from '../../security.js';
import { europePmcArticleSummary } from '../../summaries/research/europe-pmc.js';
import type { NormalizedResearchItem, PiToolResult, RawEuropePmcWork, RegisterWebsearchToolsDeps, ResearchClients, ResearchDetailResult } from '../../types.js';
import { buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { signalFromContext, type ExecuteContext } from '../common/index.js';
import { asInput, normalizeDoi, numberValue, requiredString, researchClientsFromDeps, stringValue, withFollowup } from './common.js';

export const europePmcResearchToolNames = ['europe_pmc_article_get'] as const;

function validateEuropePmcArticleGet(value: unknown): { article: string } {
  return { article: requiredString(asInput(value).article, 'article') };
}

export function normalizeEuropePmcWork(raw: RawEuropePmcWork, sourceRank: number): NormalizedResearchItem {
  const id = stringValue(raw.id) ?? stringValue(raw.pmid) ?? stringValue(raw.doi) ?? `europe-pmc-${sourceRank}`;
  const doi = normalizeDoi(raw.doi);
  const pmcid = stringValue(raw.pmcid);
  const url = pmcid ? `https://europepmc.org/article/PMC/${pmcid.replace(/^PMC/i, '')}` : stringValue(raw.pmid) ? `https://europepmc.org/article/MED/${raw.pmid}` : doi ? `https://doi.org/${doi}` : undefined;
  const authors = stringValue(raw.authorString)?.split(/,\s*/).map((author) => author.trim()).filter(Boolean).slice(0, 12);
  return withFollowup({
    source: 'europe_pmc',
    kind: 'article',
    id,
    title: truncateText(stringValue(raw.title), 300),
    url,
    doi,
    pmid: stringValue(raw.pmid),
    pmcid,
    year: numberValue(raw.pubYear),
    authors: authors && authors.length > 0 ? authors : undefined,
    summary: truncateText(stringValue(raw.abstractText), 300),
    abstract: truncateText(stringValue(raw.abstractText), 4000),
    citation_count: numberValue(raw.citedByCount),
    open_access: raw.isOpenAccess === 'Y' ? true : raw.isOpenAccess === 'N' ? false : undefined,
    venue: stringValue(raw.journalTitle),
    source_rank: sourceRank,
    rank: 0,
    metadata: { source: stringValue(raw.source), has_full_text: raw.hasFullText },
  }, pmcid ?? stringValue(raw.pmid) ?? doi ?? id);
}

async function getEuropePmcArticle(input: { article: string }, clients: ResearchClients, signal?: AbortSignal): Promise<ResearchDetailResult | undefined> {
  const raw = await clients.europePmc.getArticle(input, signal);
  return raw ? { ...normalizeEuropePmcWork(raw, 1), rank: 1 } : undefined;
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
          return buildSuccess(europePmcArticleSummary(data), data, 12000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
