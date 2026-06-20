import type { RawSemanticScholarPaper, SemanticScholarClient, SemanticScholarSearchResult, WebsearchRuntime } from '../../types.js';
import { providerRequestFailure, readJsonObject } from '../common/index.js';

const SEMANTIC_SCHOLAR_SEARCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const SEMANTIC_SCHOLAR_FIELDS = [
  'paperId',
  'title',
  'url',
  'year',
  'authors',
  'abstract',
  'citationCount',
  'referenceCount',
  'openAccessPdf',
  'externalIds',
  'tldr',
].join(',');

class FetchSemanticScholarClient implements SemanticScholarClient {
  constructor(private readonly runtime: WebsearchRuntime) {}

  async searchPapers(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawSemanticScholarPaper[]> {
    const url = new URL(SEMANTIC_SCHOLAR_SEARCH_URL);
    url.searchParams.set('query', input.query);
    url.searchParams.set('limit', String(input.limit));
    url.searchParams.set('fields', SEMANTIC_SCHOLAR_FIELDS);
    const apiKey = this.runtime.env.SEMANTIC_SCHOLAR_API_KEY;
    const headers = apiKey ? { 'x-api-key': apiKey } : undefined;

    try {
      const payload = await readJsonObject<SemanticScholarSearchResult>('semantic_scholar', await this.runtime.fetch(url.toString(), { method: 'GET', signal, headers }));
      return Array.isArray(payload.data) ? payload.data : [];
    } catch (error) {
      throw providerRequestFailure('semantic_scholar', error, 'Semantic Scholar request failed.');
    }
  }
}

export function createSemanticScholarClient(runtime: WebsearchRuntime): SemanticScholarClient {
  return new FetchSemanticScholarClient(runtime);
}
