import type { RawSemanticScholarPaper, SemanticScholarClient, SemanticScholarGraphResponse, SemanticScholarSearchResult, WebsearchRuntime } from '../../types.js';
import { providerRequestFailure, readJsonObject } from '../common/index.js';

const SEMANTIC_SCHOLAR_SEARCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const SEMANTIC_SCHOLAR_PAPER_URL = 'https://api.semanticscholar.org/graph/v1/paper';
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

const SEMANTIC_SCHOLAR_GRAPH_FIELDS = [
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
].join(',');

function semanticScholarLookupId(paper: string): string {
  const trimmed = paper.trim();
  const urlMatch = /semanticscholar\.org\/paper\/(?:[^/]+\/)?([a-f0-9]{32,}|[A-Za-z0-9_-]+)/i.exec(trimmed);
  if (urlMatch?.[1]) return urlMatch[1];
  const doiMatch = /(?:doi\.org\/|^doi:)(10\..+)$/i.exec(trimmed);
  if (doiMatch?.[1]) return `DOI:${doiMatch[1]}`;
  if (/^10\./i.test(trimmed)) return `DOI:${trimmed}`;
  if (/^\d{4}\.\d{4,5}(v\d+)?$/i.test(trimmed)) return `ARXIV:${trimmed.replace(/v\d+$/i, '')}`;
  const arxivMatch = /^arxiv:(\d{4}\.\d{4,5})(?:v\d+)?$/i.exec(trimmed);
  if (arxivMatch?.[1]) return `ARXIV:${arxivMatch[1]}`;
  return trimmed;
}

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

  async getPaper(input: { paper: string }, signal?: AbortSignal): Promise<RawSemanticScholarPaper | undefined> {
    const url = new URL(`${SEMANTIC_SCHOLAR_PAPER_URL}/${encodeURIComponent(semanticScholarLookupId(input.paper))}`);
    url.searchParams.set('fields', SEMANTIC_SCHOLAR_FIELDS);
    const apiKey = this.runtime.env.SEMANTIC_SCHOLAR_API_KEY;
    const headers = apiKey ? { 'x-api-key': apiKey } : undefined;

    try {
      return await readJsonObject<RawSemanticScholarPaper>('semantic_scholar', await this.runtime.fetch(url.toString(), { method: 'GET', signal, headers }));
    } catch (error) {
      throw providerRequestFailure('semantic_scholar', error, 'Semantic Scholar paper detail request failed.');
    }
  }

  async getPaperCitations(input: { paper: string; limit: number; offset: number }, signal?: AbortSignal): Promise<SemanticScholarGraphResponse> {
    return this.getPaperGraph(input, 'citations', signal);
  }

  async getPaperReferences(input: { paper: string; limit: number; offset: number }, signal?: AbortSignal): Promise<SemanticScholarGraphResponse> {
    return this.getPaperGraph(input, 'references', signal);
  }

  private async getPaperGraph(input: { paper: string; limit: number; offset: number }, relation: 'citations' | 'references', signal?: AbortSignal): Promise<SemanticScholarGraphResponse> {
    const url = new URL(`${SEMANTIC_SCHOLAR_PAPER_URL}/${encodeURIComponent(semanticScholarLookupId(input.paper))}/${relation}`);
    url.searchParams.set('fields', SEMANTIC_SCHOLAR_GRAPH_FIELDS);
    url.searchParams.set('limit', String(input.limit));
    url.searchParams.set('offset', String(input.offset));
    const apiKey = this.runtime.env.SEMANTIC_SCHOLAR_API_KEY;
    const headers = apiKey ? { 'x-api-key': apiKey } : undefined;

    try {
      return await readJsonObject<SemanticScholarGraphResponse>('semantic_scholar', await this.runtime.fetch(url.toString(), { method: 'GET', signal, headers }));
    } catch (error) {
      throw providerRequestFailure('semantic_scholar', error, `Semantic Scholar ${relation} request failed.`);
    }
  }
}

export function createSemanticScholarClient(runtime: WebsearchRuntime): SemanticScholarClient {
  return new FetchSemanticScholarClient(runtime);
}
