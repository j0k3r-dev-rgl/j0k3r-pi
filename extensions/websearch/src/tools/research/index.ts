import { createResearchClients } from '../../providers/research/index.js';
import { researchSearchParameters } from '../../schemas/research/index.js';
import { truncateText } from '../../security.js';
import { researchSearchSummary } from '../../summaries/research/index.js';
import type {
  NormalizedResearchItem,
  PiToolResult,
  RawArxivEntry,
  RawCrossrefWork,
  RawEuropePmcWork,
  RawOpenAlexWork,
  RawSemanticScholarPaper,
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
import { buildFailure, buildSuccess, toToolError } from '../result.js';
import { registerTool, type WebsearchToolModule } from '../registry.js';
import { runtimeFromDeps, signalFromContext, type ExecuteContext } from '../runtime.js';

const researchSources = ['all', 'openalex', 'arxiv', 'crossref', 'europe_pmc', 'semantic_scholar'] as const;
const availableResearchSources: ResearchSource[] = ['openalex', 'arxiv', 'crossref', 'europe_pmc', 'semantic_scholar'];

export const researchToolNames = ['research_search'] as const;

function asInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

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

function researchClientsFromDeps(deps: RegisterWebsearchToolsDeps): ResearchClients {
  if (deps.clients?.research) return deps.clients.research;
  return createResearchClients(runtimeFromDeps(deps));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function normalizeDoi(value: unknown): string | undefined {
  const raw = stringValue(value);
  return raw?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim() || undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return stringValue(value);
  if (Array.isArray(value)) return value.map(stringValue).find(Boolean);
  return undefined;
}

function yearFromDateParts(value: unknown): number | undefined {
  const parts = recordValue(value)?.['date-parts'];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return undefined;
  return numberValue(parts[0][0]);
}

function namesFromAuthorRecords(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.map((entry) => {
    const record = recordValue(entry);
    const literal = stringValue(record?.name);
    if (literal) return literal;
    return [stringValue(record?.given), stringValue(record?.family)].filter(Boolean).join(' ').trim() || undefined;
  }).filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.slice(0, 12) : undefined;
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

function normalizeOpenAlexWork(raw: RawOpenAlexWork, sourceRank: number): NormalizedResearchItem {
  const primaryLocation = openAlexPrimaryLocation(raw);
  const openAccess = recordValue(raw.open_access);
  const abstract = reconstructOpenAlexAbstract(raw.abstract_inverted_index);
  const id = stringValue(raw.id) ?? normalizeDoi(raw.doi) ?? `openalex-${sourceRank}`;
  return {
    source: 'openalex',
    kind: 'work',
    id,
    title: truncateText(stringValue(raw.title) ?? stringValue(raw.display_name), 300),
    url: stringValue(primaryLocation?.landing_page_url) ?? stringValue(raw.id) ?? normalizeDoi(raw.doi),
    doi: normalizeDoi(raw.doi) ?? normalizeDoi(recordValue(raw.ids)?.doi),
    year: numberValue(raw.publication_year),
    published_at: stringValue(raw.publication_date),
    authors: openAlexAuthors(raw),
    summary: truncateText(abstract, 300),
    abstract: truncateText(abstract, 4000),
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
  };
}

function arxivId(rawId: string | undefined): string | undefined {
  return rawId?.replace(/^https?:\/\/arxiv\.org\/abs\//i, '').trim() || undefined;
}

function normalizeArxivEntry(raw: RawArxivEntry, sourceRank: number): NormalizedResearchItem {
  const id = arxivId(raw.id) ?? `arxiv-${sourceRank}`;
  const pdfUrl = raw.links?.find((link) => link.title === 'pdf' || link.type === 'application/pdf')?.href
    ?? (id.startsWith('arxiv-') ? undefined : `https://arxiv.org/pdf/${id}`);
  const url = raw.links?.find((link) => link.rel === 'alternate')?.href ?? raw.id;
  const year = raw.published ? Number(raw.published.slice(0, 4)) : undefined;
  return {
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
    summary: truncateText(raw.summary, 300),
    abstract: truncateText(raw.summary, 4000),
    open_access: true,
    pdf_url: pdfUrl,
    categories: raw.categories,
    source_rank: sourceRank,
    rank: 0,
    metadata: { arxiv_url: raw.id },
  };
}

function normalizeCrossrefWork(raw: RawCrossrefWork, sourceRank: number): NormalizedResearchItem {
  const published = recordValue(raw.published) ?? recordValue(raw['published-print']) ?? recordValue(raw['published-online']) ?? recordValue(raw.issued);
  const doi = normalizeDoi(raw.DOI);
  return {
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
  };
}

function normalizeEuropePmcWork(raw: RawEuropePmcWork, sourceRank: number): NormalizedResearchItem {
  const id = stringValue(raw.id) ?? stringValue(raw.pmid) ?? stringValue(raw.doi) ?? `europe-pmc-${sourceRank}`;
  const doi = normalizeDoi(raw.doi);
  const pmcid = stringValue(raw.pmcid);
  const url = pmcid ? `https://europepmc.org/article/PMC/${pmcid.replace(/^PMC/i, '')}` : stringValue(raw.pmid) ? `https://europepmc.org/article/MED/${raw.pmid}` : doi ? `https://doi.org/${doi}` : undefined;
  const authors = stringValue(raw.authorString)?.split(/,\s*/).map((author) => author.trim()).filter(Boolean).slice(0, 12);
  return {
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
  };
}

function normalizeSemanticScholarPaper(raw: RawSemanticScholarPaper, sourceRank: number): NormalizedResearchItem {
  const externalIds = recordValue(raw.externalIds);
  const doi = normalizeDoi(externalIds?.DOI ?? externalIds?.doi);
  const arxiv = stringValue(externalIds?.ArXiv ?? externalIds?.arXiv);
  const tldr = stringValue(recordValue(raw.tldr)?.text);
  const authors = Array.isArray(raw.authors)
    ? raw.authors.map((entry) => stringValue(recordValue(entry)?.name)).filter((name): name is string => Boolean(name)).slice(0, 12)
    : undefined;
  return {
    source: 'semantic_scholar',
    kind: 'paper',
    id: stringValue(raw.paperId) ?? doi ?? `semantic-scholar-${sourceRank}`,
    title: truncateText(stringValue(raw.title), 300),
    url: stringValue(raw.url),
    doi,
    arxiv_id: arxiv,
    year: numberValue(raw.year),
    authors,
    summary: truncateText(tldr ?? stringValue(raw.abstract), 300),
    abstract: truncateText(stringValue(raw.abstract), 4000),
    citation_count: numberValue(raw.citationCount),
    reference_count: numberValue(raw.referenceCount),
    open_access: Boolean(recordValue(raw.openAccessPdf)?.url) || undefined,
    pdf_url: stringValue(recordValue(raw.openAccessPdf)?.url),
    source_rank: sourceRank,
    rank: 0,
    metadata: { tldr, external_ids: externalIds },
  };
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
      description: 'Search academic/research sources with unified bounded read-only results. Supports fan-out across OpenAlex and arXiv or a single source filter.',
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
  },
};
