import type { CrossrefClient, CrossrefReferencesResponse, CrossrefSearchResult, RawCrossrefWork, WebsearchRuntime } from '../../types.js';
import { providerRequestFailure, readJsonObject } from '../common/index.js';

const CROSSREF_WORKS_URL = 'https://api.crossref.org/works';

function normalizeDoiInput(doi: string): string {
  return doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '');
}

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

  async getWork(input: { doi: string }, signal?: AbortSignal): Promise<RawCrossrefWork | undefined> {
    const url = new URL(`${CROSSREF_WORKS_URL}/${encodeURIComponent(normalizeDoiInput(input.doi))}`);
    const mailto = this.runtime.env.CROSSREF_MAILTO ?? this.runtime.env.OPENALEX_MAILTO;
    if (mailto) url.searchParams.set('mailto', mailto);

    try {
      const payload = await readJsonObject<CrossrefSearchResult>('crossref', await this.runtime.fetch(url.toString(), { method: 'GET', signal }));
      return payload.message as RawCrossrefWork | undefined;
    } catch (error) {
      throw providerRequestFailure('crossref', error, 'Crossref work detail request failed.');
    }
  }

  async getWorkReferences(input: { doi: string; limit: number; offset: number }, signal?: AbortSignal): Promise<CrossrefReferencesResponse> {
    const work = await this.getWork({ doi: input.doi }, signal);
    const references = Array.isArray(work?.reference) ? work.reference.slice(input.offset, input.offset + input.limit).filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))) : [];
    const total = Array.isArray(work?.reference) ? work.reference.length : 0;
    return { work, references, total };
  }
}

export function createCrossrefClient(runtime: WebsearchRuntime): CrossrefClient {
  return new FetchCrossrefClient(runtime);
}
