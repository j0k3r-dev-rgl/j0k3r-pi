import type { EuropePmcClient, EuropePmcGraphResponse, EuropePmcSearchResult, RawEuropePmcWork, WebsearchRuntime } from '../../types.js';
import { providerRequestFailure, readJsonObject } from '../common/index.js';

const EUROPE_PMC_SEARCH_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

function articleQuery(article: string): string {
  const trimmed = article.trim();
  const pmcidMatch = /(?:europepmc\.org\/article\/PMC\/|^)(PMC\d+)$/i.exec(trimmed);
  if (pmcidMatch?.[1]) return `PMCID:${pmcidMatch[1].toUpperCase()}`;
  const doiMatch = /(?:doi\.org\/|^doi:)(10\..+)$/i.exec(trimmed);
  if (doiMatch?.[1]) return `DOI:${doiMatch[1]}`;
  if (/^10\./i.test(trimmed)) return `DOI:${trimmed}`;
  const europePmcMatch = /europepmc\.org\/article\/([A-Z]+)\/(\w+)/i.exec(trimmed);
  if (europePmcMatch?.[1] && europePmcMatch?.[2]) return `EXT_ID:${europePmcMatch[2]} AND SRC:${europePmcMatch[1].toUpperCase()}`;
  if (/^\d+$/.test(trimmed)) return `EXT_ID:${trimmed} AND SRC:MED`;
  return trimmed;
}

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

  async getArticle(input: { article: string }, signal?: AbortSignal): Promise<RawEuropePmcWork | undefined> {
    const url = new URL(EUROPE_PMC_SEARCH_URL);
    url.searchParams.set('query', articleQuery(input.article));
    url.searchParams.set('format', 'json');
    url.searchParams.set('pageSize', '1');
    url.searchParams.set('resultType', 'core');

    try {
      const payload = await readJsonObject<EuropePmcSearchResult>('europe_pmc', await this.runtime.fetch(url.toString(), { method: 'GET', signal }));
      const items = payload.resultList?.result;
      return Array.isArray(items) ? items[0] : undefined;
    } catch (error) {
      throw providerRequestFailure('europe_pmc', error, 'Europe PMC article detail request failed.');
    }
  }

  async getArticleCitations(input: { article: string; limit: number; page: number }, signal?: AbortSignal): Promise<EuropePmcGraphResponse> {
    return this.getArticleGraph(input, 'citations', signal);
  }

  async getArticleReferences(input: { article: string; limit: number; page: number }, signal?: AbortSignal): Promise<EuropePmcGraphResponse> {
    return this.getArticleGraph(input, 'references', signal);
  }

  private async getArticleGraph(input: { article: string; limit: number; page: number }, relation: 'citations' | 'references', signal?: AbortSignal): Promise<EuropePmcGraphResponse> {
    const article = await this.getArticle({ article: input.article }, signal);
    const source = String(article?.source ?? '').trim();
    const id = String(article?.id ?? article?.pmid ?? article?.pmcid ?? '').trim();
    if (!source || !id) return { hitCount: 0, resolvedArticle: article };
    const url = new URL(`https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(source)}/${encodeURIComponent(id)}/${relation}`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('pageSize', String(input.limit));
    url.searchParams.set('page', String(input.page));

    try {
      const payload = await readJsonObject<EuropePmcGraphResponse>('europe_pmc', await this.runtime.fetch(url.toString(), { method: 'GET', signal }));
      return { ...payload, resolvedArticle: article };
    } catch (error) {
      throw providerRequestFailure('europe_pmc', error, `Europe PMC ${relation} request failed.`);
    }
  }
}

export function createEuropePmcClient(runtime: WebsearchRuntime): EuropePmcClient {
  return new FetchEuropePmcClient(runtime);
}
