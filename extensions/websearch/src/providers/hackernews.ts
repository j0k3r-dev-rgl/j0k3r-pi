import { ProviderFailure, fetchProviderErrorFromError, providerErrorFromResponse } from '../security.js';
import type {
  HackerNewsClient,
  HackerNewsRawItem,
  HackerNewsRawStory,
  HackerNewsSearchRequest,
  HackerNewsStoryRequest,
  WebsearchRuntime,
} from '../types.js';

const HN_ALGOLIA_API_BASE = 'https://hn.algolia.com/api/v1';

function objectLike(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function readSearchHits(response: Response): Promise<HackerNewsRawStory[]> {
  if (!response.ok) {
    throw new ProviderFailure(providerErrorFromResponse('hacker_news', response));
  }
  const payload = objectLike(await response.json());
  const hits = payload?.hits;
  if (!Array.isArray(hits)) {
    throw new ProviderFailure({
      code: 'provider_error',
      category: 'provider_payload',
      message: 'hacker_news returned an unexpected payload shape.',
      recoverable: true,
      provider: 'hacker_news',
    });
  }
  return hits as HackerNewsRawStory[];
}

async function readStory(response: Response): Promise<HackerNewsRawItem | null> {
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new ProviderFailure(providerErrorFromResponse('hacker_news', response));
  }
  const payload = objectLike(await response.json());
  if (!payload) {
    throw new ProviderFailure({
      code: 'provider_error',
      category: 'provider_payload',
      message: 'hacker_news returned an unexpected payload shape.',
      recoverable: true,
      provider: 'hacker_news',
    });
  }
  return payload as HackerNewsRawItem;
}

class FetchHackerNewsClient implements HackerNewsClient {
  constructor(private readonly fetchImpl: typeof fetch) {}

  async searchStories(input: HackerNewsSearchRequest, signal?: AbortSignal): Promise<HackerNewsRawStory[]> {
    const url = new URL(`${HN_ALGOLIA_API_BASE}/search`);
    url.searchParams.set('query', input.query);
    url.searchParams.set('tags', 'story');
    url.searchParams.set('hitsPerPage', String(input.limit));

    try {
      return await readSearchHits(await this.fetchImpl(url.toString(), { method: 'GET', signal }));
    } catch (error) {
      if (error instanceof ProviderFailure) {
        throw error;
      }
      throw new ProviderFailure(fetchProviderErrorFromError('hacker_news', error, 'Hacker News request failed.'));
    }
  }

  async getStory(input: HackerNewsStoryRequest, signal?: AbortSignal): Promise<HackerNewsRawItem | null> {
    const url = new URL(`${HN_ALGOLIA_API_BASE}/items/${encodeURIComponent(String(input.storyId))}`);

    try {
      return await readStory(await this.fetchImpl(url.toString(), { method: 'GET', signal }));
    } catch (error) {
      if (error instanceof ProviderFailure) {
        throw error;
      }
      throw new ProviderFailure(fetchProviderErrorFromError('hacker_news', error, 'Hacker News request failed.'));
    }
  }
}

export function createHackerNewsClient(runtime: WebsearchRuntime): HackerNewsClient {
  return new FetchHackerNewsClient(runtime.fetch);
}
