import type { EuropePmcClient, EuropePmcSearchResult, RawEuropePmcWork, WebsearchRuntime } from '../../types.js';
import { providerRequestFailure, readJsonObject } from '../common/index.js';

const EUROPE_PMC_SEARCH_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

class FetchEuropePmcClient implements EuropePmcClient {
  constructor(private readonly runtime: WebsearchRuntime) {}

  async searchWorks(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawEuropePmcWork[]> {
    const url = new URL(EUROPE_PMC_SEARCH_URL);
    url.searchParams.set('query', input.query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('pageSize', String(input.limit));
    url.searchParams.set('resultType', 'core');

    try {
      const payload = await readJsonObject<EuropePmcSearchResult>('europe_pmc', await this.runtime.fetch(url.toString(), { method: 'GET', signal }));
      const items = payload.resultList?.result;
      return Array.isArray(items) ? items : [];
    } catch (error) {
      throw providerRequestFailure('europe_pmc', error, 'Europe PMC request failed.');
    }
  }
}

export function createEuropePmcClient(runtime: WebsearchRuntime): EuropePmcClient {
  return new FetchEuropePmcClient(runtime);
}
