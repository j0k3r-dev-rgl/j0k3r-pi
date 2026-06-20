import { crossrefWorkParameters } from '../../schemas/research/crossref.js';
import { truncateText } from '../../security.js';
import { crossrefWorkSummary } from '../../summaries/research/crossref.js';
import type { NormalizedResearchItem, PiToolResult, RawCrossrefWork, RegisterWebsearchToolsDeps, ResearchClients, ResearchDetailResult } from '../../types.js';
import { FULL_TOOL_CONTENT, buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { signalFromContext, type ExecuteContext } from '../common/index.js';
import { asInput, firstString, namesFromAuthorRecords, normalizeDoi, numberValue, recordValue, requiredString, researchClientsFromDeps, stringValue, withFollowup, yearFromDateParts } from './common.js';

export const crossrefResearchToolNames = ['crossref_work_get'] as const;

function validateCrossrefWorkGet(value: unknown): { doi: string } {
  return { doi: requiredString(asInput(value).doi, 'doi') };
}

export function normalizeCrossrefWork(raw: RawCrossrefWork, sourceRank: number): NormalizedResearchItem {
  const published = recordValue(raw.published) ?? recordValue(raw['published-print']) ?? recordValue(raw['published-online']) ?? recordValue(raw.issued);
  const doi = normalizeDoi(raw.DOI);
  return withFollowup({
    source: 'crossref',
    kind: 'work',
    id: doi ?? stringValue(raw.URL) ?? `crossref-${sourceRank}`,
    title: truncateText(firstString(raw.title), 300),
    url: stringValue(raw.URL) ?? (doi ? `https://doi.org/${doi}` : undefined),
    doi,
    year: yearFromDateParts(published),
    published_at: yearFromDateParts(published)?.toString(),
    authors: namesFromAuthorRecords(raw.author),
    citation_count: numberValue(raw['is-referenced-by-count']),
    reference_count: Array.isArray(raw.reference) ? raw.reference.length : numberValue(raw['reference-count']) ?? numberValue(raw['references-count']),
    venue: firstString(raw['container-title']),
    source_rank: sourceRank,
    rank: 0,
    metadata: { type: stringValue(raw.type), publisher: stringValue(raw.publisher), score: numberValue(raw.score) },
  }, doi);
}

async function getCrossrefWork(input: { doi: string }, clients: ResearchClients, signal?: AbortSignal): Promise<ResearchDetailResult | undefined> {
  const raw = await clients.crossref.getWork(input, signal);
  return raw ? { ...normalizeCrossrefWork(raw, 1), rank: 1 } : undefined;
}

export const crossrefResearchTools: WebsearchToolModule<typeof crossrefResearchToolNames[number]> = {
  names: crossrefResearchToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'crossref_work_get',
      description: 'Fetch one Crossref work by DOI or DOI URL.',
      parameters: crossrefWorkParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<ResearchDetailResult>> {
        try {
          const input = validateCrossrefWorkGet(params);
          const data = await getCrossrefWork(input, researchClientsFromDeps(deps), signalFromContext(context));
          if (!data) return buildFailure({ code: 'not_found', category: 'not_found', message: 'Crossref work was not found.', recoverable: true, provider: 'crossref' });
          return buildSuccess(crossrefWorkSummary(data), data, FULL_TOOL_CONTENT);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
