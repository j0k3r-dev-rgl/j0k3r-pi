import type { OpenAlexGraphResponse, OpenAlexSearchResult, OpenAlexClient, RawOpenAlexWork, WebsearchRuntime } from '../../types.js';
import { providerRequestFailure, readJsonObject } from '../common/index.js';

const OPENALEX_WORKS_URL = 'https://api.openalex.org/works';
const OPENALEX_SELECT = [
  'id',
  'doi',
  'title',
  'display_name',
  'publication_year',
  'publication_date',
  'authorships',
  'primary_location',
  'open_access',
  'cited_by_count',
  'cited_by_api_url',
  'referenced_works',
  'referenced_works_count',
  'related_works',
  'abstract_inverted_index',
  'type',
  'ids',
  'relevance_score',
].join(',');

function openAlexLookupId(work: string): string {
  const trimmed = work.trim();
  const openAlexMatch = /openalex\.org\/(W\d+)/i.exec(trimmed);
  if (openAlexMatch?.[1]) return openAlexMatch[1];
  const doiMatch = /(?:doi\.org\/|^doi:)(10\..+)$/i.exec(trimmed);
  if (doiMatch?.[1]) return `https://doi.org/${doiMatch[1]}`;
  if (/^10\./i.test(trimmed)) return `https://doi.org/${trimmed}`;
  return trimmed;
}

function openAlexBareWorkId(work: string): string | undefined {
  const trimmed = work.trim();
  const match = /(?:openalex\.org\/)?(W\d+)/i.exec(trimmed);
  return match?.[1]?.toUpperCase();
}

function openAlexIdsFilter(ids: string[]): string {
  return ids
    .map((id) => openAlexBareWorkId(id) ?? id.trim())
    .filter(Boolean)
    .join('|');
}

function graphResponse(payload: OpenAlexSearchResult): OpenAlexGraphResponse {
  const items = Array.isArray(payload.results) ? payload.results : [];
  const total = typeof payload.meta?.count === 'number' ? payload.meta.count : undefined;
  return { meta: payload.meta, results: items, total };
}

class FetchOpenAlexClient implements OpenAlexClient {
  constructor(private readonly runtime: WebsearchRuntime) {}

  async searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawOpenAlexWork[]> {
    const url = new URL(OPENALEX_WORKS_URL);
    url.searchParams.set('search', input.query);
    url.searchParams.set('per-page', String(input.limit));
    url.searchParams.set('select', OPENALEX_SELECT);
    const mailto = this.runtime.env.OPENALEX_MAILTO ?? this.runtime.env.CROSSREF_MAILTO;
    if (mailto) url.searchParams.set('mailto', mailto);

    try {
      const payload = await readJsonObject<OpenAlexSearchResult>('openalex', await this.runtime.fetch(url.toString(), { method: 'GET', signal }));
      return Array.isArray(payload.results) ? payload.results : [];
    } catch (error) {
      throw providerRequestFailure('openalex', error, 'OpenAlex request failed.');
    }
  }

  async getWork(input: { work: string }, signal?: AbortSignal): Promise<RawOpenAlexWork | undefined> {
    const lookupId = openAlexLookupId(input.work);
    const url = new URL(`${OPENALEX_WORKS_URL}/${encodeURIComponent(lookupId)}`);
    url.searchParams.set('select', OPENALEX_SELECT);
    const mailto = this.runtime.env.OPENALEX_MAILTO ?? this.runtime.env.CROSSREF_MAILTO;
    if (mailto) url.searchParams.set('mailto', mailto);

    try {
      return await readJsonObject<RawOpenAlexWork>('openalex', await this.runtime.fetch(url.toString(), { method: 'GET', signal }));
    } catch (error) {
      throw providerRequestFailure('openalex', error, 'OpenAlex work detail request failed.');
    }
  }

  async getWorkCitations(input: { work: string; limit: number; page: number }, signal?: AbortSignal): Promise<OpenAlexGraphResponse> {
    let workId = openAlexBareWorkId(input.work);
    if (!workId) {
      const work = await this.getWork({ work: input.work }, signal);
      workId = openAlexBareWorkId(String(work?.id ?? ''));
    }
    if (!workId) return { results: [], total: 0 };
    const url = new URL(OPENALEX_WORKS_URL);
    url.searchParams.set('filter', `referenced_works:${workId}`);
    url.searchParams.set('per-page', String(input.limit));
    url.searchParams.set('page', String(input.page));
    url.searchParams.set('select', OPENALEX_SELECT);
    const mailto = this.runtime.env.OPENALEX_MAILTO ?? this.runtime.env.CROSSREF_MAILTO;
    if (mailto) url.searchParams.set('mailto', mailto);

    try {
      return graphResponse(await readJsonObject<OpenAlexSearchResult>('openalex', await this.runtime.fetch(url.toString(), { method: 'GET', signal })));
    } catch (error) {
      throw providerRequestFailure('openalex', error, 'OpenAlex citations request failed.');
    }
  }

  async getWorkReferences(input: { work: string; limit: number; page: number }, signal?: AbortSignal): Promise<OpenAlexGraphResponse> {
    const work = await this.getWork({ work: input.work }, signal);
    const referencedWorks = Array.isArray(work?.referenced_works) ? work.referenced_works.map(String) : [];
    const start = (input.page - 1) * input.limit;
    const selectedIds = referencedWorks.slice(start, start + input.limit);
    if (selectedIds.length === 0) return { results: [], total: referencedWorks.length || (typeof work?.referenced_works_count === 'number' ? work.referenced_works_count : 0), meta: { source_work: work } };
    const url = new URL(OPENALEX_WORKS_URL);
    url.searchParams.set('filter', `ids.openalex:${openAlexIdsFilter(selectedIds)}`);
    url.searchParams.set('per-page', String(input.limit));
    url.searchParams.set('select', OPENALEX_SELECT);
    const mailto = this.runtime.env.OPENALEX_MAILTO ?? this.runtime.env.CROSSREF_MAILTO;
    if (mailto) url.searchParams.set('mailto', mailto);

    try {
      const response = graphResponse(await readJsonObject<OpenAlexSearchResult>('openalex', await this.runtime.fetch(url.toString(), { method: 'GET', signal })));
      return { ...response, total: referencedWorks.length || response.total, meta: { ...response.meta, source_work: work } };
    } catch (error) {
      throw providerRequestFailure('openalex', error, 'OpenAlex references request failed.');
    }
  }
}

export function createOpenAlexClient(runtime: WebsearchRuntime): OpenAlexClient {
  return new FetchOpenAlexClient(runtime);
}
