import type { CrossrefClient, CrossrefSearchResult, RawCrossrefWork, WebsearchRuntime } from '../../types.js';
import { providerRequestFailure, readJsonObject } from '../common/index.js';

const CROSSREF_WORKS_URL = 'https://api.crossref.org/works';

class FetchCrossrefClient implements CrossrefClient {
  constructor(private readonly runtime: WebsearchRuntime) {}

  async searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawCrossrefWork[]> {
    const url = new URL(CROSSREF_WORKS_URL);
    url.searchParams.set('query', input.query);
    url.searchParams.set('rows', String(input.limit));
    const mailto = this.runtime.env.CROSSREF_MAILTO ?? this.runtime.env.OPENALEX_MAILTO;
    if (mailto) url.searchParams.set('mailto', mailto);

    try {
      const payload = await readJsonObject<CrossrefSearchResult>('crossref', await this.runtime.fetch(url.toString(), { method: 'GET', signal }));
      const items = payload.message?.items;
      return Array.isArray(items) ? items : [];
    } catch (error) {
      throw providerRequestFailure('crossref', error, 'Crossref request failed.');
    }
  }
}

export function createCrossrefClient(runtime: WebsearchRuntime): CrossrefClient {
  return new FetchCrossrefClient(runtime);
}
