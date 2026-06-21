import { createWebClients } from '../../providers/web/index.js';
import { webFetchParameters, webSearchParameters } from '../../schemas/web/index.js';
import { webFetchSummary, webSearchSummary } from '../../summaries/web/index.js';
import { WEB_FETCH_DEFAULT_MAX_BYTES, WEB_FETCH_MAX_BYTES } from '../../types.js';
import type {
  NormalizedWebSearchItem,
  PiToolResult,
  RawWebSearchItem,
  RawWebSearchMetadata,
  RawWebSearchResponse,
  RegisterWebsearchToolsDeps,
  WebFetchRequest,
  WebFetchResult,
  ToolError,
  WebClients,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '../../types.js';
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, ValidationError } from '../../validation.js';
import { buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { clientsFromDeps, runtimeFromDeps, signalFromContext, type ExecuteContext } from '../common/index.js';

export const webToolNames = ['web_search', 'web_fetch'] as const;

function asInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function validateWebSearch(value: unknown): WebSearchRequest {
  const input = asInput(value);
  const query = input.query;
  if (typeof query !== 'string' || query.trim() === '') throw new ValidationError('query is required.');
  const limitValue = input.limit;
  let limit = SEARCH_DEFAULT_LIMIT;
  if (limitValue !== undefined && limitValue !== null && limitValue !== '') {
    if (typeof limitValue !== 'number' || !Number.isInteger(limitValue)) throw new ValidationError('limit must be an integer.');
    if (limitValue < 1) throw new ValidationError('limit must be at least 1.');
    if (limitValue > SEARCH_MAX_LIMIT) throw new ValidationError(`limit must be at most ${SEARCH_MAX_LIMIT}.`);
    limit = limitValue;
  }
  return { query: query.trim(), limit };
}

function validateWebFetch(value: unknown): WebFetchRequest {
  const input = asInput(value);
  const url = input.url;
  if (typeof url !== 'string' || url.trim() === '') throw new ValidationError('url is required.');
  const maxBytesValue = input.maxBytes;
  let maxBytes = WEB_FETCH_DEFAULT_MAX_BYTES;
  if (maxBytesValue !== undefined && maxBytesValue !== null && maxBytesValue !== '') {
    if (typeof maxBytesValue !== 'number' || !Number.isInteger(maxBytesValue)) throw new ValidationError('maxBytes must be an integer.');
    if (maxBytesValue < 1) throw new ValidationError('maxBytes must be at least 1.');
    if (maxBytesValue > WEB_FETCH_MAX_BYTES) throw new ValidationError(`maxBytes must be at most ${WEB_FETCH_MAX_BYTES}.`);
    maxBytes = maxBytesValue;
  }
  return { url: url.trim(), maxBytes };
}

function webClientsFromDeps(deps: RegisterWebsearchToolsDeps): WebClients {
  if (deps.clients?.web) return deps.clients.web;
  const clients = clientsFromDeps(deps);
  if (clients.web) return clients.web;
  return createWebClients(runtimeFromDeps(deps));
}

function domainFromUrl(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

function normalizeItems(provider: WebSearchProvider, items: RawWebSearchItem[], limit: number): NormalizedWebSearchItem[] {
  return items.flatMap((item) => {
    const title = item.title?.trim();
    const url = item.url?.trim();
    if (!title || !url) return [];
    return [{
      rank: 0,
      source: provider,
      title,
      url,
      domain: domainFromUrl(url),
      snippet: item.snippet?.trim() || undefined,
      published_at: item.published_at?.trim() || undefined,
      author: item.author?.trim() || undefined,
      score: item.score,
    }];
  }).slice(0, limit).map((item, index) => ({ ...item, rank: index + 1 }));
}

function normalizeRawResponse(response: RawWebSearchResponse | RawWebSearchItem[]): RawWebSearchResponse {
  return Array.isArray(response) ? { items: response } : response;
}

function providerMetadata(provider: WebSearchProvider, metadata: RawWebSearchMetadata | undefined): Partial<Record<WebSearchProvider, RawWebSearchMetadata>> {
  return metadata && Object.keys(metadata).length > 0 ? { [provider]: metadata } : {};
}

type ProviderAttempt = {
  provider: WebSearchProvider;
  search: WebClients[WebSearchProvider]['search'];
};

async function runWebSearch(input: WebSearchRequest, clients: WebClients, signal?: AbortSignal): Promise<WebSearchResult> {
  const providers: ProviderAttempt[] = [
    { provider: 'exa', search: clients.exa.search.bind(clients.exa) },
    { provider: 'parallel', search: clients.parallel.search.bind(clients.parallel) },
  ];
  const providersTried: WebSearchProvider[] = [];
  const sourceErrors: WebSearchResult['source_errors'] = [];

  for (const entry of providers) {
    providersTried.push(entry.provider);
    try {
      const rawResponse = normalizeRawResponse(await entry.search(input, signal));
      const items = normalizeItems(entry.provider, rawResponse.items, input.limit);
      if (items.length > 0) {
        return {
          query: input.query,
          limit: input.limit,
          selected_provider: entry.provider,
          providers_tried: providersTried,
          fallback_used: entry.provider !== 'exa',
          source_errors: sourceErrors,
          provider_metadata: providerMetadata(entry.provider, rawResponse.metadata),
          items,
        };
      }
      if (entry.provider === 'exa') {
        sourceErrors.push({
          source: 'exa',
          error: {
            code: 'source_unavailable',
            category: 'provider_unavailable',
            message: 'exa returned no usable web search results.',
            recoverable: true,
            provider: 'exa',
          },
        });
      }
    } catch (error) {
      const toolError = toToolError(error);
      sourceErrors.push({ source: entry.provider, error: { ...toolError, provider: toolError.provider ?? entry.provider } as ToolError });
    }
  }

  return {
    query: input.query,
    limit: input.limit,
    providers_tried: providersTried,
    fallback_used: providersTried.includes('parallel'),
    source_errors: sourceErrors,
    provider_metadata: {},
    items: [],
  };
}

export const webTools: WebsearchToolModule<typeof webToolNames[number]> = {
  names: webToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'web_search',
      description: 'Search the general web using the V1 hosted provider chain: Exa primary with Parallel fallback. Returns bounded normalized results with provider errors when fallback is needed.',
      parameters: webSearchParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<WebSearchResult>> {
        try {
          const input = validateWebSearch(params);
          const clients = webClientsFromDeps(deps);
          const data = await runWebSearch(input, clients, signalFromContext(context));
          return buildSuccess(webSearchSummary(data), data, 12000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'web_fetch',
      description: 'Fetch one HTTPS page safely for agent reading. Enforces SSRF protections, bounded bytes, redirects, and text-like content extraction without JavaScript or subresources.',
      parameters: webFetchParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<WebFetchResult>> {
        try {
          const input = validateWebFetch(params);
          const clients = webClientsFromDeps(deps);
          const data = await clients.fetch.fetch(input, signalFromContext(context));
          return buildSuccess(webFetchSummary(data), data, 12000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
