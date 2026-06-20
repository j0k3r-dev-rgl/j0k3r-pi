import { semanticScholarPaperGraphParameters } from '../../schemas/research/graph.js';
import { semanticScholarPaperParameters } from '../../schemas/research/semantic-scholar.js';
import { truncateText } from '../../security.js';
import { researchGraphSummary } from '../../summaries/research/graph.js';
import { semanticScholarPaperSummary } from '../../summaries/research/semantic-scholar.js';
import type { NormalizedResearchItem, PiToolResult, RawSemanticScholarPaper, RegisterWebsearchToolsDeps, ResearchClients, ResearchDetailResult, ResearchGraphResult } from '../../types.js';
import { FULL_TOOL_CONTENT, buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { signalFromContext, type ExecuteContext } from '../common/index.js';
import { asInput, normalizeDoi, numberValue, optionalBoundedLimit, optionalOffset, recordValue, requiredString, researchClientsFromDeps, stringValue, withFollowup } from './common.js';

export const semanticScholarResearchToolNames = ['semantic_scholar_paper_get', 'semantic_scholar_paper_citations_get', 'semantic_scholar_paper_references_get'] as const;

function validateSemanticScholarPaperGet(value: unknown): { paper: string } {
  return { paper: requiredString(asInput(value).paper, 'paper') };
}

function validateSemanticScholarGraph(value: unknown): { paper: string; limit: number; offset: number } {
  const input = asInput(value);
  return { paper: requiredString(input.paper, 'paper'), limit: optionalBoundedLimit(input), offset: optionalOffset(input) };
}

export function normalizeSemanticScholarPaper(raw: RawSemanticScholarPaper, sourceRank: number): NormalizedResearchItem {
  const externalIds = recordValue(raw.externalIds);
  const doi = normalizeDoi(externalIds?.DOI ?? externalIds?.doi);
  const arxiv = stringValue(externalIds?.ArXiv ?? externalIds?.arXiv);
  const tldr = stringValue(recordValue(raw.tldr)?.text);
  const authors = Array.isArray(raw.authors)
    ? raw.authors.map((entry) => stringValue(recordValue(entry)?.name)).filter((name): name is string => Boolean(name)).slice(0, 12)
    : undefined;
  return withFollowup({
    source: 'semantic_scholar',
    kind: 'paper',
    id: stringValue(raw.paperId) ?? doi ?? `semantic-scholar-${sourceRank}`,
    title: truncateText(stringValue(raw.title), 300),
    url: stringValue(raw.url),
    doi,
    arxiv_id: arxiv,
    year: numberValue(raw.year),
    authors,
    summary: tldr ?? stringValue(raw.abstract),
    abstract: stringValue(raw.abstract),
    citation_count: numberValue(raw.citationCount),
    reference_count: numberValue(raw.referenceCount),
    open_access: Boolean(recordValue(raw.openAccessPdf)?.url) || undefined,
    pdf_url: stringValue(recordValue(raw.openAccessPdf)?.url),
    source_rank: sourceRank,
    rank: 0,
    metadata: { tldr, external_ids: externalIds },
  }, stringValue(raw.paperId) ?? doi ?? arxiv);
}

async function getSemanticScholarPaper(input: { paper: string }, clients: ResearchClients, signal?: AbortSignal): Promise<ResearchDetailResult | undefined> {
  const raw = await clients.semanticScholar.getPaper(input, signal);
  return raw ? { ...normalizeSemanticScholarPaper(raw, 1), rank: 1 } : undefined;
}

async function getSemanticScholarGraph(input: { paper: string; limit: number; offset: number }, relation: 'citations' | 'references', clients: ResearchClients, signal?: AbortSignal): Promise<ResearchGraphResult> {
  const response = relation === 'citations'
    ? await clients.semanticScholar.getPaperCitations(input, signal)
    : await clients.semanticScholar.getPaperReferences(input, signal);
  const rawItems = (response.data ?? []).map((entry) => relation === 'citations' ? entry.citingPaper : entry.citedPaper).filter((item): item is RawSemanticScholarPaper => Boolean(item));
  const items = rawItems.map((item, index) => ({ ...normalizeSemanticScholarPaper(item, input.offset + index + 1), rank: input.offset + index + 1 }));
  return {
    source: 'semantic_scholar',
    relation,
    subject: input.paper,
    limit: input.limit,
    offset: input.offset,
    next_offset: response.next,
    items,
    metadata: { response_offset: response.offset },
  };
}

export const semanticScholarResearchTools: WebsearchToolModule<typeof semanticScholarResearchToolNames[number]> = {
  names: semanticScholarResearchToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'semantic_scholar_paper_get',
      description: 'Fetch one Semantic Scholar paper by paper id, URL, DOI, arXiv id, or prefixed external id. Uses SEMANTIC_SCHOLAR_API_KEY when present.',
      parameters: semanticScholarPaperParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<ResearchDetailResult>> {
        try {
          const input = validateSemanticScholarPaperGet(params);
          const data = await getSemanticScholarPaper(input, researchClientsFromDeps(deps), signalFromContext(context));
          if (!data) return buildFailure({ code: 'not_found', category: 'not_found', message: 'Semantic Scholar paper was not found.', recoverable: true, provider: 'semantic_scholar' });
          return buildSuccess(semanticScholarPaperSummary(data), data, FULL_TOOL_CONTENT);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'semantic_scholar_paper_citations_get',
      description: 'Fetch papers that cite one Semantic Scholar paper using the Graph API citations endpoint. Uses SEMANTIC_SCHOLAR_API_KEY when present.',
      parameters: semanticScholarPaperGraphParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<ResearchGraphResult>> {
        try {
          const input = validateSemanticScholarGraph(params);
          const data = await getSemanticScholarGraph(input, 'citations', researchClientsFromDeps(deps), signalFromContext(context));
          return buildSuccess(researchGraphSummary('semantic_scholar_paper_citations_get', data), data, 12000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'semantic_scholar_paper_references_get',
      description: 'Fetch referenced papers for one Semantic Scholar paper using the Graph API references endpoint. Uses SEMANTIC_SCHOLAR_API_KEY when present.',
      parameters: semanticScholarPaperGraphParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<ResearchGraphResult>> {
        try {
          const input = validateSemanticScholarGraph(params);
          const data = await getSemanticScholarGraph(input, 'references', researchClientsFromDeps(deps), signalFromContext(context));
          return buildSuccess(researchGraphSummary('semantic_scholar_paper_references_get', data), data, 12000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
