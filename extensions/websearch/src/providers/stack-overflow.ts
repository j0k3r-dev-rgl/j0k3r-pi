import type {
  StackExchangeClient,
  StackOverflowAnswersRequest,
  StackOverflowCommentsRequest,
  StackOverflowQuestionRef,
  StackOverflowRawAnswer,
  StackOverflowRawComment,
  StackOverflowRawQuestion,
  StackOverflowSearchRequest,
  WebsearchRuntime,
} from '../types.js';
import { ProviderFailure, providerErrorFromResponse, stackExchangePayloadError } from '../security.js';

const STACK_EXCHANGE_API_BASE = 'https://api.stackexchange.com/2.3';
export const STACK_EXCHANGE_BODY_FILTER = 'withbody';

type StackExchangeConfig = {
  key?: string;
};

async function readStackExchangeJson(response: Response): Promise<{ items?: unknown[]; has_more?: boolean }> {
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
    url.searchParams.set('filter', STACK_EXCHANGE_BODY_FILTER);
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

  async getQuestionComments(input: StackOverflowCommentsRequest, signal?: AbortSignal): Promise<{ items: StackOverflowRawComment[]; hasMore: boolean }> {
    const url = this.url(`/questions/${encodeURIComponent(input.questionId)}/comments`);
    url.searchParams.set('pagesize', String(input.commentsLimit));
    url.searchParams.set('page', String(Math.floor(input.commentsOffset / input.commentsLimit) + 1));
    url.searchParams.set('order', 'asc');
    url.searchParams.set('sort', 'creation');
    url.searchParams.set('filter', STACK_EXCHANGE_BODY_FILTER);
    const payload = await this.payload(url, signal);
    return {
      items: (payload.items ?? []) as StackOverflowRawComment[],
      hasMore: payload.has_more === true,
    };
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
    const payload = await this.payload(url, signal);
    return payload.items ?? [];
  }

  private async payload(url: URL, signal?: AbortSignal): Promise<{ items?: unknown[]; has_more?: boolean }> {
    return readStackExchangeJson(await this.fetchImpl(url.toString(), { method: 'GET', signal }));
  }
}

export function createStackExchangeClient(runtime: WebsearchRuntime): StackExchangeClient {
  return new DirectFetchStackExchangeClient({ key: runtime.env.STACK_EXCHANGE_KEY }, runtime.fetch);
}
