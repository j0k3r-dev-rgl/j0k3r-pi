import { arxivPaperParameters } from '../../schemas/research/arxiv.js';
import { truncateText } from '../../security.js';
import { arxivPaperSummary } from '../../summaries/research/arxiv.js';
import type { NormalizedResearchItem, PiToolResult, RawArxivEntry, RegisterWebsearchToolsDeps, ResearchClients, ResearchDetailResult } from '../../types.js';
import { FULL_TOOL_CONTENT, buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { signalFromContext, type ExecuteContext } from '../common/index.js';
import { asInput, normalizeDoi, requiredString, researchClientsFromDeps, withFollowup } from './common.js';

export const arxivResearchToolNames = ['arxiv_paper_get'] as const;

function validateArxivPaperGet(value: unknown): { paper: string } {
  return { paper: requiredString(asInput(value).paper, 'paper') };
}

function arxivId(rawId: string | undefined): string | undefined {
  return rawId?.replace(/^https?:\/\/arxiv\.org\/abs\//i, '').trim() || undefined;
}

export function normalizeArxivEntry(raw: RawArxivEntry, sourceRank: number): NormalizedResearchItem {
  const id = arxivId(raw.id) ?? `arxiv-${sourceRank}`;
  const pdfUrl = raw.links?.find((link) => link.title === 'pdf' || link.type === 'application/pdf')?.href
    ?? (id.startsWith('arxiv-') ? undefined : `https://arxiv.org/pdf/${id}`);
  const url = raw.links?.find((link) => link.rel === 'alternate')?.href ?? raw.id;
  const year = raw.published ? Number(raw.published.slice(0, 4)) : undefined;
  return withFollowup({
    source: 'arxiv',
    kind: 'preprint',
    id,
    arxiv_id: id,
    title: truncateText(raw.title, 300),
    url,
    doi: normalizeDoi(raw.doi),
    year: Number.isFinite(year) ? year : undefined,
    published_at: raw.published,
    updated_at: raw.updated,
    authors: raw.authors?.slice(0, 12),
    summary: raw.summary,
    abstract: raw.summary,
    open_access: true,
    pdf_url: pdfUrl,
    categories: raw.categories,
    source_rank: sourceRank,
    rank: 0,
    metadata: { arxiv_url: raw.id },
  }, id);
}

async function getArxivPaper(input: { paper: string }, clients: ResearchClients, signal?: AbortSignal): Promise<ResearchDetailResult | undefined> {
  const raw = await clients.arxiv.getPaper(input, signal);
  return raw ? { ...normalizeArxivEntry(raw, 1), rank: 1 } : undefined;
}

export const arxivResearchTools: WebsearchToolModule<typeof arxivResearchToolNames[number]> = {
  names: arxivResearchToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'arxiv_paper_get',
      description: 'Fetch one arXiv paper by arXiv id or URL.',
      parameters: arxivPaperParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<ResearchDetailResult>> {
        try {
          const input = validateArxivPaperGet(params);
          const data = await getArxivPaper(input, researchClientsFromDeps(deps), signalFromContext(context));
          if (!data) return buildFailure({ code: 'not_found', category: 'not_found', message: 'arXiv paper was not found.', recoverable: true, provider: 'arxiv' });
          return buildSuccess(arxivPaperSummary(data), data, FULL_TOOL_CONTENT);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
