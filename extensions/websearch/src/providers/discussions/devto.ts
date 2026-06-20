import { ProviderFailure, fetchProviderErrorFromError, providerErrorFromResponse } from '../../security.js';
import type {
  DevtoArticleSearchRequest,
  DevtoClient,
  DevtoCommentsRequest,
  DevtoRawArticle,
  DevtoRawComment,
  WebsearchRuntime,
} from '../../types.js';

const DEVTO_API_BASE = 'https://dev.to/api';

async function readJsonArray<T>(provider: 'devto', response: Response): Promise<T[]> {
  if (!response.ok) {
    throw new ProviderFailure(providerErrorFromResponse(provider, response));
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new ProviderFailure({
      code: 'provider_error',
      category: 'provider_payload',
      message: 'devto returned an unexpected payload shape.',
      recoverable: true,
      provider,
    });
  }
  return payload as T[];
}

class FetchDevtoClient implements DevtoClient {
  constructor(private readonly fetchImpl: typeof fetch) {}

  async searchArticles(input: DevtoArticleSearchRequest, signal?: AbortSignal): Promise<DevtoRawArticle[]> {
    const url = new URL(`${DEVTO_API_BASE}/articles`);
    url.searchParams.set('tag', input.tag);
    url.searchParams.set('per_page', String(input.limit));

    try {
      return await readJsonArray<DevtoRawArticle>('devto', await this.fetchImpl(url.toString(), { method: 'GET', signal }));
    } catch (error) {
      if (error instanceof ProviderFailure) {
        throw error;
      }
      throw new ProviderFailure(fetchProviderErrorFromError('devto', error, 'Dev.to request failed.'));
    }
  }

  async getComments(input: DevtoCommentsRequest, signal?: AbortSignal): Promise<DevtoRawComment[]> {
    const url = new URL(`${DEVTO_API_BASE}/comments`);
    url.searchParams.set('a_id', String(input.articleId));

    try {
      return await readJsonArray<DevtoRawComment>('devto', await this.fetchImpl(url.toString(), { method: 'GET', signal }));
    } catch (error) {
      if (error instanceof ProviderFailure) {
        throw error;
      }
      throw new ProviderFailure(fetchProviderErrorFromError('devto', error, 'Dev.to request failed.'));
    }
  }
}

export function createDevtoClient(runtime: WebsearchRuntime): DevtoClient {
  return new FetchDevtoClient(runtime.fetch);
}
