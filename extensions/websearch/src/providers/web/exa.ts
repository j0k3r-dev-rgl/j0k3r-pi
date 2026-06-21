import type { RawWebSearchItem, RawWebSearchMetadata, RawWebSearchResponse, WebSearchClient, WebSearchFilterApplication, WebSearchRequest, WebsearchRuntime } from '../../types.js';
import { providerRequestFailure, readText } from '../common/index.js';
import { extractMcpTextPayload, mcpHeaders } from './mcp.js';

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa,web_fetch_exa';

function fieldValue(block: string, field: string): string | undefined {
  const match = new RegExp(`^${field}:\\s*(.+)$`, 'im').exec(block);
  const value = match?.[1]?.trim();
  if (!value || value.toLowerCase() === 'n/a') return undefined;
  return value;
}

function exaMetadata(contentMeta?: Record<string, unknown>, textMetadata?: RawWebSearchMetadata, filterApplication?: WebSearchFilterApplication): RawWebSearchMetadata | undefined {
  const metadata: RawWebSearchMetadata = { ...(textMetadata ?? {}) };
  if (typeof contentMeta?.searchTime === 'number') metadata.search_time_ms = contentMeta.searchTime;
  if (filterApplication && hasFilterApplication(filterApplication)) metadata.filter_application = filterApplication;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function hasFilterApplication(value: WebSearchFilterApplication): boolean {
  return value.native.length > 0 || value.query_hint.length > 0 || value.unsupported.length > 0;
}

function hasAdvancedFilters(input: WebSearchRequest): boolean {
  return Boolean(input.includeDomains?.length || input.excludeDomains?.length || input.afterDate || input.beforeDate || input.location);
}

function filterApplication(input: WebSearchRequest): WebSearchFilterApplication | undefined {
  const native: string[] = [];
  if (input.mode) native.push('mode');
  if (input.includeDomains?.length) native.push('includeDomains');
  if (input.excludeDomains?.length) native.push('excludeDomains');
  if (input.afterDate) native.push('afterDate');
  if (input.beforeDate) native.push('beforeDate');
  if (input.location) native.push('location');
  const value = { native, query_hint: [], unsupported: [] };
  return hasFilterApplication(value) ? value : undefined;
}

function exaArguments(input: WebSearchRequest): { name: 'web_search_exa' | 'web_search_advanced_exa'; arguments: Record<string, unknown> } {
  if (hasAdvancedFilters(input)) {
    const args: Record<string, unknown> = {
      query: input.query,
      type: input.mode ?? 'fast',
      numResults: input.limit,
    };
    if (input.includeDomains?.length) args.includeDomains = input.includeDomains;
    if (input.excludeDomains?.length) args.excludeDomains = input.excludeDomains;
    if (input.afterDate) args.startPublishedDate = input.afterDate;
    if (input.beforeDate) args.endPublishedDate = input.beforeDate;
    if (input.location) args.userLocation = input.location;
    return { name: 'web_search_advanced_exa', arguments: args };
  }

  return {
    name: 'web_search_exa',
    arguments: {
      query: input.query,
      type: input.mode ?? 'fast',
      numResults: input.limit,
      livecrawl: 'fallback',
      contextMaxCharacters: 5000,
    },
  };
}

function cleanSnippet(block: string): string | undefined {
  const cleaned = block
    .split(/\r?\n/)
    .filter((line) => !/^(Title|URL|Published|Author|Score|Highlights?):\s*/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || undefined;
}

function parseExaTextBlocks(text: string, limit: number): RawWebSearchItem[] {
  const results: RawWebSearchItem[] = [];
  const blocks = text.split(/(?=^Title:\s*)/gim);
  for (const block of blocks) {
    const title = fieldValue(block, 'Title');
    const url = fieldValue(block, 'URL');
    if (!title || !url) continue;
    if (results.some((item) => item.url === url)) continue;
    results.push({
      title,
      url,
      published_at: fieldValue(block, 'Published'),
      author: fieldValue(block, 'Author'),
      snippet: cleanSnippet(block),
    });
    if (results.length >= limit) break;
  }
  return results;
}

type ExaJsonPayload = {
  requestId?: unknown;
  searchTime?: unknown;
  costDollars?: unknown;
  results?: unknown;
};

type ExaJsonResult = {
  title?: unknown;
  url?: unknown;
  text?: unknown;
  snippet?: unknown;
  highlights?: unknown;
  publishedDate?: unknown;
  published_at?: unknown;
  author?: unknown;
  score?: unknown;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function snippetValue(item: ExaJsonResult): string | undefined {
  const text = stringValue(item.text) ?? stringValue(item.snippet);
  if (text) return text.replace(/\s+/g, ' ').trim();
  if (Array.isArray(item.highlights)) {
    const highlights = item.highlights.map(stringValue).filter((entry): entry is string => Boolean(entry));
    return highlights.join(' ').replace(/\s+/g, ' ').trim() || undefined;
  }
  return undefined;
}

function parseExaJson(text: string, limit: number): { items: RawWebSearchItem[]; metadata?: RawWebSearchMetadata } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const payload = parsed as ExaJsonPayload;
  const rawResults = Array.isArray(payload.results) ? payload.results as ExaJsonResult[] : [];
  const items = rawResults.flatMap((item) => {
    const title = stringValue(item.title);
    const url = stringValue(item.url);
    if (!title || !url) return [];
    return [{
      title,
      url,
      snippet: snippetValue(item),
      published_at: stringValue(item.publishedDate) ?? stringValue(item.published_at),
      author: stringValue(item.author),
      score: numberValue(item.score),
    }];
  }).slice(0, limit);

  const metadata: RawWebSearchMetadata = {};
  const searchTime = numberValue(payload.searchTime);
  const costDollars = numberValue(payload.costDollars);
  const requestId = stringValue(payload.requestId);
  if (searchTime !== undefined) metadata.search_time_ms = searchTime;
  if (costDollars !== undefined) metadata.cost_dollars = costDollars;
  if (requestId) metadata.request_id = requestId;

  return { items, metadata: Object.keys(metadata).length > 0 ? metadata : undefined };
}

function parseExaText(text: string, limit: number): { items: RawWebSearchItem[]; metadata?: RawWebSearchMetadata } {
  const json = parseExaJson(text, limit);
  if (json) return json;
  return { items: parseExaTextBlocks(text, limit) };
}

export class ExaMcpSearchClient implements WebSearchClient {
  constructor(private readonly runtime: WebsearchRuntime) {}

  async search(input: WebSearchRequest, signal?: AbortSignal): Promise<RawWebSearchResponse> {
    try {
      const tool = exaArguments(input);
      const response = await this.runtime.fetch(EXA_MCP_URL, {
        method: 'POST',
        headers: mcpHeaders(this.runtime.env.EXA_API_KEY),
        signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: tool,
        }),
      });
      const body = await readText('exa', response);
      const payload = extractMcpTextPayload('exa', body);
      const parsed = parseExaText(payload.text, input.limit);
      return { items: parsed.items, metadata: exaMetadata(payload.contentMeta, parsed.metadata, filterApplication(input)) };
    } catch (error) {
      throw providerRequestFailure('exa', error, 'Exa MCP search request failed.');
    }
  }
}

export function createExaMcpSearchClient(runtime: WebsearchRuntime): WebSearchClient {
  return new ExaMcpSearchClient(runtime);
}
