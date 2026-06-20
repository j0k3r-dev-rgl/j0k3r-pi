import { crossrefWorkParameters } from '../../schemas/research/crossref.js';
import { crossrefWorkReferencesParameters } from '../../schemas/research/graph.js';
import { truncateText } from '../../security.js';
import { crossrefWorkSummary } from '../../summaries/research/crossref.js';
import { researchGraphSummary } from '../../summaries/research/graph.js';
import type { NormalizedResearchItem, PiToolResult, RawCrossrefReference, RawCrossrefWork, RegisterWebsearchToolsDeps, ResearchClients, ResearchDetailResult, ResearchGraphResult } from '../../types.js';
import { FULL_TOOL_CONTENT, buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { signalFromContext, type ExecuteContext } from '../common/index.js';
import { asInput, firstString, namesFromAuthorRecords, normalizeDoi, numberValue, optionalBoundedLimit, optionalOffset, recordValue, requiredString, researchClientsFromDeps, stringValue, withFollowup, yearFromDateParts } from './common.js';

export const crossrefResearchToolNames = ['crossref_work_get', 'crossref_work_references_get'] as const;

function validateCrossrefWorkGet(value: unknown): { doi: string } {
  return { doi: requiredString(asInput(value).doi, 'doi') };
}

function validateCrossrefReferences(value: unknown): { doi: string; limit: number; offset: number } {
  const input = asInput(value);
  return { doi: requiredString(input.doi, 'doi'), limit: optionalBoundedLimit(input), offset: optionalOffset(input) };
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

function normalizeCrossrefReference(raw: RawCrossrefReference, sourceRank: number): NormalizedResearchItem {
  const doi = normalizeDoi(raw.DOI ?? raw.doi);
  const title = firstString(raw.articleTitle ?? raw.title) ?? stringValue(raw.unstructured) ?? doi ?? stringValue(raw.key);
  return withFollowup({
    source: 'crossref',
    kind: 'work',
    id: doi ?? stringValue(raw.key) ?? `crossref-reference-${sourceRank}`,
    title: truncateText(title, 300),
    url: doi ? `https://doi.org/${doi}` : undefined,
    doi,
    year: numberValue(raw.year),
    authors: stringValue(raw.author) ? [stringValue(raw.author)!] : undefined,
    summary: stringValue(raw.unstructured),
    venue: stringValue(raw['journal-title']),
    source_rank: sourceRank,
    rank: sourceRank,
    metadata: { key: stringValue(raw.key), raw },
  }, doi);
}

async function getCrossrefReferences(input: { doi: string; limit: number; offset: number }, clients: ResearchClients, signal?: AbortSignal): Promise<ResearchGraphResult> {
  const response = await clients.crossref.getWorkReferences(input, signal);
  const items = response.references.map((item, index) => normalizeCrossrefReference(item, input.offset + index + 1));
  return {
    source: 'crossref',
    relation: 'references',
    subject: input.doi,
    limit: input.limit,
    offset: input.offset,
    total: response.total,
    next_offset: input.offset + input.limit < response.total ? input.offset + input.limit : undefined,
    items,
    metadata: { source_work: response.work },
  };
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

    registerTool(pi, {
      name: 'crossref_work_references_get',
      description: 'Fetch deposited outbound reference metadata for one Crossref work. Crossref REST does not expose a verified inbound citations list endpoint.',
      parameters: crossrefWorkReferencesParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<ResearchGraphResult>> {
        try {
          const input = validateCrossrefReferences(params);
          const data = await getCrossrefReferences(input, researchClientsFromDeps(deps), signalFromContext(context));
          return buildSuccess(researchGraphSummary('crossref_work_references_get', data), data, 12000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
