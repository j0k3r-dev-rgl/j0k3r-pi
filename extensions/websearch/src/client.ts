import type {
  StackExchangeClient,
  StackOverflowAnswersRequest,
  StackOverflowQuestionRef,
  StackOverflowRawAnswer,
  StackOverflowRawQuestion,
  StackOverflowSearchRequest,
  WebsearchClients,
  WebsearchRuntime,
} from './types.js';
import { ProviderFailure, providerErrorFromResponse, stackExchangePayloadError } from './security.js';

const STACK_EXCHANGE_API_BASE = 'https://api.stackexchange.com/2.3';
export const STACK_EXCHANGE_BODY_FILTER = 'withbody';

type StackExchangeConfig = {
  key?: string;
};

async function readStackExchangeJson(response: Response): Promise<{ items?: unknown[] }> {
  if (!response.ok) {
    throw new ProviderFailure(providerErrorFromResponse('stack_overflow', response));
  }
  const payload = await response.json() as { items?: unknown[] };
  const payloadError = stackExchangePayloadError(payload);
  if (payloadError) {
    throw new ProviderFailure(payloadError);
  }
  return payload;
}

class DirectFetchStackExchangeClient implements StackExchangeClient {
  constructor(
    private readonly config: StackExchangeConfig,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async searchQuestions(input: StackOverflowSearchRequest, signal?: AbortSignal): Promise<StackOverflowRawQuestion[]> {
    const url = this.url('/search/advanced');
    url.searchParams.set('q', input.query);
    url.searchParams.set('pagesize', String(input.limit));
    url.searchParams.set('order', 'desc');
    url.searchParams.set('sort', 'relevance');
    return this.items(url, signal) as Promise<StackOverflowRawQuestion[]>;
  }

  async getQuestion(input: StackOverflowQuestionRef, signal?: AbortSignal): Promise<StackOverflowRawQuestion | null> {
    const url = this.url(`/questions/${encodeURIComponent(input.questionId)}`);
    url.searchParams.set('filter', STACK_EXCHANGE_BODY_FILTER);
    return ((await this.items(url, signal)) as StackOverflowRawQuestion[])[0] ?? null;
  }

  async getAnswers(input: StackOverflowAnswersRequest, signal?: AbortSignal): Promise<StackOverflowRawAnswer[]> {
    const url = this.url(`/questions/${encodeURIComponent(input.questionId)}/answers`);
    url.searchParams.set('pagesize', String(input.limit));
    url.searchParams.set('order', 'desc');
    url.searchParams.set('sort', 'votes');
    url.searchParams.set('filter', STACK_EXCHANGE_BODY_FILTER);
    return this.items(url, signal) as Promise<StackOverflowRawAnswer[]>;
  }

  private url(path: string): URL {
    const url = new URL(`${STACK_EXCHANGE_API_BASE}${path}`);
    url.searchParams.set('site', 'stackoverflow');
    if (this.config.key) {
      url.searchParams.set('key', this.config.key);
    }
    return url;
  }

  private async items(url: URL, signal?: AbortSignal): Promise<unknown[]> {
    const payload = await readStackExchangeJson(await this.fetchImpl(url.toString(), { method: 'GET', signal }));
    return payload.items ?? [];
  }
}

export function createStackExchangeClient(runtime: WebsearchRuntime): StackExchangeClient {
  return new DirectFetchStackExchangeClient({ key: runtime.env.STACK_EXCHANGE_KEY }, runtime.fetch);
}

export function createWebsearchClients(runtime: WebsearchRuntime): WebsearchClients {
  return {
    stackExchange: createStackExchangeClient(runtime),
  };
}
