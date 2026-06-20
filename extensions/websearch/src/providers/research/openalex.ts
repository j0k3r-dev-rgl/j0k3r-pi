import type { OpenAlexSearchResult, OpenAlexClient, RawOpenAlexWork, WebsearchRuntime } from '../../types.js';
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
}

export function createOpenAlexClient(runtime: WebsearchRuntime): OpenAlexClient {
  return new FetchOpenAlexClient(runtime);
}
