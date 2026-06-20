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
}

export function createOpenAlexClient(runtime: WebsearchRuntime): OpenAlexClient {
  return new FetchOpenAlexClient(runtime);
}
