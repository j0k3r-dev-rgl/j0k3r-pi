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
  WebSearchFilters,
  WebSearchMode,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '../../types.js';
import { SEARCH_MAX_LIMIT, ValidationError } from '../../validation.js';
import { buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { clientsFromDeps, runtimeFromDeps, signalFromContext, type ExecuteContext } from '../common/index.js';

export const webToolNames = ['web_search', 'web_fetch'] as const;

const WEB_SEARCH_DEFAULT_LIMIT = 10;
const WEB_SEARCH_FILTER_KEYS = ['includeDomains', 'excludeDomains', 'afterDate', 'beforeDate', 'location', 'mode'] as const;

function asInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function validateWebSearch(value: unknown): WebSearchRequest {
  const input = asInput(value);
  const query = input.query;
  if (typeof query !== 'string' || query.trim() === '') throw new ValidationError('query is required.');
  const limitValue = input.limit;
  let limit = WEB_SEARCH_DEFAULT_LIMIT;
  if (limitValue !== undefined && limitValue !== null && limitValue !== '') {
    if (typeof limitValue !== 'number' || !Number.isInteger(limitValue)) throw new ValidationError('limit must be an integer.');
    if (limitValue < 1) throw new ValidationError('limit must be at least 1.');
    if (limitValue > SEARCH_MAX_LIMIT) throw new ValidationError(`limit must be at most ${SEARCH_MAX_LIMIT}.`);
    limit = limitValue;
  }
  const filters = validateWebSearchFilters(input);
  return { query: query.trim(), limit, ...filters };
}

function validateWebSearchFilters(input: Record<string, unknown>): WebSearchFilters {
  const filters: WebSearchFilters = {};
  const includeDomains = optionalDomainList(input, 'includeDomains');
  const excludeDomains = optionalDomainList(input, 'excludeDomains');
  const afterDate = optionalDate(input, 'afterDate');
  const beforeDate = optionalDate(input, 'beforeDate');
  const location = optionalLocation(input, 'location');
  const mode = optionalSearchMode(input, 'mode');

  if (afterDate && beforeDate && afterDate > beforeDate) {
    throw new ValidationError('afterDate must be on or before beforeDate.');
  }
  if (includeDomains.length) filters.includeDomains = includeDomains;
  if (excludeDomains.length) filters.excludeDomains = excludeDomains;
  if (afterDate) filters.afterDate = afterDate;
  if (beforeDate) filters.beforeDate = beforeDate;
  if (location) filters.location = location;
  if (mode) filters.mode = mode;
  return filters;
}

function optionalDomainList(input: Record<string, unknown>, key: 'includeDomains' | 'excludeDomains'): string[] {
  const value = input[key];
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw new ValidationError(`${key} must be an array of domains.`);
  if (value.length > 20) throw new ValidationError(`${key} must include at most 20 domains.`);
  const domains = value.map((entry) => normalizeDomain(entry, key));
  return [...new Set(domains)];
}

function normalizeDomain(value: unknown, key: string): string {
  if (typeof value !== 'string') throw new ValidationError(`${key} entries must be strings.`);
  let domain = value.trim().toLowerCase();
  if (!domain) throw new ValidationError(`${key} entries must not be empty.`);
  if (/^https?:\/\//i.test(domain)) {
    try {
      domain = new URL(domain).hostname.toLowerCase();
    } catch {
      throw new ValidationError(`${key} entries must be domains or valid http(s) URLs.`);
    }
  }
  domain = domain.replace(/^www\./, '');
  if (domain.includes('/') || domain.includes('@') || domain.includes(':') || !/^\.?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain)) {
    throw new ValidationError(`${key} entries must be valid domains.`);
  }
  return domain;
}

function optionalDate(input: Record<string, unknown>, key: 'afterDate' | 'beforeDate'): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${key} must be a YYYY-MM-DD string.`);
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError(`${key} must be a YYYY-MM-DD string.`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new ValidationError(`${key} must be a valid YYYY-MM-DD date.`);
  return date;
}

function optionalLocation(input: Record<string, unknown>, key: 'location'): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ValidationError('location must be a two-letter country code.');
  const location = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(location)) throw new ValidationError('location must be a two-letter country code.');
  return location;
}

function optionalSearchMode(input: Record<string, unknown>, key: 'mode'): WebSearchMode | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (value !== 'fast' && value !== 'auto' && value !== 'deep') throw new ValidationError('mode must be "fast", "auto", or "deep".');
  return value;
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

function filtersForResult(input: WebSearchRequest): WebSearchFilters | undefined {
  const filters: WebSearchFilters = {};
  for (const key of WEB_SEARCH_FILTER_KEYS) {
    const value = input[key];
    if (value !== undefined) (filters as Record<string, unknown>)[key] = value;
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
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
          filters: filtersForResult(input),
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
    filters: filtersForResult(input),
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
      label: 'Web Search',
      description: 'Search the general web using the V1 hosted provider chain: Exa primary with Parallel fallback. Supports optional normalized filters; providers apply them natively when possible or as query hints. Returns bounded normalized results with provider errors when fallback is needed.',
      promptSnippet: 'Search the general web with hosted providers and bounded normalized results.',
      promptGuidelines: [
        'Use web_search for current general web discovery when a targeted documentation, research, GitHub, or discussion tool is not a better fit.',
        'Use web_search filters to narrow recency, domains, or result type when the user asks for current web sources.',
      ],
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
      label: 'Web Fetch',
      description: 'Fetch one HTTPS page safely for agent reading. Enforces SSRF protections, bounded bytes, redirects, and text-like content extraction without JavaScript or subresources.',
      promptSnippet: 'Fetch one HTTPS page safely for bounded text extraction.',
      promptGuidelines: [
        'Use web_fetch when you already have a specific HTTPS URL and need its readable page text or metadata.',
        'Do not use web_fetch for broad discovery; use web_search, discussion_search, research_search, or github_code_search first when you need to find candidate URLs.',
      ],
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
