import { openAlexWorkParameters } from '../../schemas/research/openalex.js';
import { truncateText } from '../../security.js';
import { openAlexWorkSummary } from '../../summaries/research/openalex.js';
import type { NormalizedResearchItem, PiToolResult, RawOpenAlexWork, RegisterWebsearchToolsDeps, ResearchClients, ResearchDetailResult } from '../../types.js';
import { FULL_TOOL_CONTENT, buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { signalFromContext, type ExecuteContext } from '../common/index.js';
import { asInput, normalizeDoi, numberValue, recordValue, requiredString, researchClientsFromDeps, stringValue, withFollowup } from './common.js';

export const openAlexResearchToolNames = ['openalex_work_get'] as const;

function validateOpenAlexWorkGet(value: unknown): { work: string } {
  return { work: requiredString(asInput(value).work, 'work') };
}

function reconstructOpenAlexAbstract(index: unknown): string | undefined {
  const data = recordValue(index);
  if (!data) return undefined;
  const entries: Array<{ word: string; position: number }> = [];
  for (const [word, positions] of Object.entries(data)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (typeof position === 'number' && Number.isInteger(position)) entries.push({ word, position });
    }
  }
  if (entries.length === 0) return undefined;
  return entries.sort((a, b) => a.position - b.position).map((entry) => entry.word).join(' ');
}

function openAlexAuthors(raw: Record<string, unknown>): string[] | undefined {
  const authorships = Array.isArray(raw.authorships) ? raw.authorships : [];
  const authors = authorships
    .map((entry) => stringValue(recordValue(recordValue(entry)?.author)?.display_name))
    .filter((author): author is string => Boolean(author));
  return authors.length > 0 ? authors.slice(0, 12) : undefined;
}

function openAlexPrimaryLocation(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  return recordValue(raw.primary_location);
}

function openAlexVenue(raw: Record<string, unknown>): string | undefined {
  const source = recordValue(openAlexPrimaryLocation(raw)?.source);
  return stringValue(source?.display_name);
}

export function normalizeOpenAlexWork(raw: RawOpenAlexWork, sourceRank: number): NormalizedResearchItem {
  const primaryLocation = openAlexPrimaryLocation(raw);
  const openAccess = recordValue(raw.open_access);
  const abstract = reconstructOpenAlexAbstract(raw.abstract_inverted_index);
  const id = stringValue(raw.id) ?? normalizeDoi(raw.doi) ?? `openalex-${sourceRank}`;
  return withFollowup({
    source: 'openalex',
    kind: 'work',
    id,
    title: truncateText(stringValue(raw.title) ?? stringValue(raw.display_name), 300),
    url: stringValue(primaryLocation?.landing_page_url) ?? stringValue(raw.id) ?? normalizeDoi(raw.doi),
    doi: normalizeDoi(raw.doi) ?? normalizeDoi(recordValue(raw.ids)?.doi),
    year: numberValue(raw.publication_year),
    published_at: stringValue(raw.publication_date),
    authors: openAlexAuthors(raw),
    summary: abstract,
    abstract,
    citation_count: numberValue(raw.cited_by_count),
    open_access: typeof openAccess?.is_oa === 'boolean' ? openAccess.is_oa : undefined,
    pdf_url: stringValue(primaryLocation?.pdf_url) ?? stringValue(openAccess?.oa_url),
    venue: openAlexVenue(raw),
    source_rank: sourceRank,
    rank: 0,
    metadata: {
      type: stringValue(raw.type),
      relevance_score: numberValue(raw.relevance_score),
      openalex_id: stringValue(raw.id),
    },
  }, id);
}

async function getOpenAlexWork(input: { work: string }, clients: ResearchClients, signal?: AbortSignal): Promise<ResearchDetailResult | undefined> {
  const raw = await clients.openAlex.getWork(input, signal);
  return raw ? { ...normalizeOpenAlexWork(raw, 1), rank: 1 } : undefined;
}

export const openAlexResearchTools: WebsearchToolModule<typeof openAlexResearchToolNames[number]> = {
  names: openAlexResearchToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'openalex_work_get',
      description: 'Fetch one OpenAlex work by OpenAlex id, URL, DOI, or DOI URL.',
      parameters: openAlexWorkParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<ResearchDetailResult>> {
        try {
          const input = validateOpenAlexWorkGet(params);
          const data = await getOpenAlexWork(input, researchClientsFromDeps(deps), signalFromContext(context));
          if (!data) return buildFailure({ code: 'not_found', category: 'not_found', message: 'OpenAlex work was not found.', recoverable: true, provider: 'openalex' });
          return buildSuccess(openAlexWorkSummary(data), data, FULL_TOOL_CONTENT);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
