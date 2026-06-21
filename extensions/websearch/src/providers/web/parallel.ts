import type { RawWebSearchItem, RawWebSearchMetadata, RawWebSearchResponse, WebSearchClient, WebSearchFilterApplication, WebSearchRequest, WebsearchRuntime } from '../../types.js';
import { providerRequestFailure, readText } from '../common/index.js';
import { extractMcpTextPayload, mcpHeaders } from './mcp.js';

const PARALLEL_MCP_URL = 'https://search.parallel.ai/mcp';

type ParallelMcpItem = {
  title?: unknown;
  url?: unknown;
  excerpts?: unknown;
  publish_date?: unknown;
};

type ParallelMcpPayload = {
  results?: unknown;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parallelPayloadFromText(text: string): ParallelMcpPayload | undefined {
  try {
    const payload = JSON.parse(text) as unknown;
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as ParallelMcpPayload : undefined;
  } catch {
    return undefined;
  }
}

function parallelPayloadFromStructured(value: unknown): ParallelMcpPayload | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ParallelMcpPayload : undefined;
}

function parseParallelItems(payload: ParallelMcpPayload | undefined, limit: number): RawWebSearchItem[] {
  const results = Array.isArray(payload?.results) ? payload.results as ParallelMcpItem[] : [];
  return results.slice(0, limit).flatMap((item) => {
    const title = stringValue(item.title);
    const url = stringValue(item.url);
    if (!title || !url) return [];
    const excerpts = Array.isArray(item.excerpts) ? item.excerpts.map(stringValue).filter((entry): entry is string => Boolean(entry)) : [];
    return [{
      title,
      url,
      published_at: stringValue(item.publish_date),
      snippet: excerpts.join(' ').replace(/\s+/g, ' ').trim() || undefined,
    }];
  });
}

function parallelMetadata(payload: ParallelMcpPayload | undefined, filterApplication?: WebSearchFilterApplication): RawWebSearchMetadata | undefined {
  const record = payload as Record<string, unknown> | undefined;
  const metadata: RawWebSearchMetadata = {};
  if (typeof record?.search_id === 'string' && record.search_id.trim()) metadata.search_id = record.search_id.trim();
  if (typeof record?.session_id === 'string' && record.session_id.trim()) metadata.session_id = record.session_id.trim();
  if (Array.isArray(record?.warnings)) metadata.warnings = record.warnings;
  if (Array.isArray(record?.usage)) metadata.usage = record.usage;
  if (filterApplication && hasFilterApplication(filterApplication)) metadata.filter_application = filterApplication;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function hasFilterApplication(value: WebSearchFilterApplication): boolean {
  return value.native.length > 0 || value.query_hint.length > 0 || value.unsupported.length > 0;
}

function filterApplication(input: WebSearchRequest): WebSearchFilterApplication | undefined {
  const queryHint: string[] = [];
  if (input.mode) queryHint.push('mode');
  if (input.includeDomains?.length) queryHint.push('includeDomains');
  if (input.excludeDomains?.length) queryHint.push('excludeDomains');
  if (input.afterDate) queryHint.push('afterDate');
  if (input.beforeDate) queryHint.push('beforeDate');
  if (input.location) queryHint.push('location');
  const value = { native: [], query_hint: queryHint, unsupported: [] };
  return hasFilterApplication(value) ? value : undefined;
}

function parallelObjective(input: WebSearchRequest): string {
  const constraints: string[] = [];
  if (input.includeDomains?.length) constraints.push(`Only include results from these domains: ${input.includeDomains.join(', ')}.`);
  if (input.excludeDomains?.length) constraints.push(`Exclude results from these domains: ${input.excludeDomains.join(', ')}.`);
  if (input.afterDate) constraints.push(`Prefer results published on or after ${input.afterDate}.`);
  if (input.beforeDate) constraints.push(`Prefer results published on or before ${input.beforeDate}.`);
  if (input.location) constraints.push(`Prefer results relevant to location ${input.location}.`);
  if (input.mode) constraints.push(`Search mode preference: ${input.mode}.`);
  return constraints.length ? `${input.query}\n\nConstraints:\n- ${constraints.join('\n- ')}` : input.query;
}

function parallelSearchQuery(input: WebSearchRequest): string {
  const parts = [input.query];
  for (const domain of input.includeDomains ?? []) parts.push(`site:${domain}`);
  for (const domain of input.excludeDomains ?? []) parts.push(`-site:${domain}`);
  if (input.afterDate) parts.push(`after:${input.afterDate}`);
  if (input.beforeDate) parts.push(`before:${input.beforeDate}`);
  if (input.location) parts.push(input.location);
  return parts.join(' ');
}

export class ParallelMcpSearchClient implements WebSearchClient {
  constructor(private readonly runtime: WebsearchRuntime) {}

  async search(input: WebSearchRequest, signal?: AbortSignal): Promise<RawWebSearchResponse> {
    try {
      const response = await this.runtime.fetch(PARALLEL_MCP_URL, {
        method: 'POST',
        headers: mcpHeaders(this.runtime.env.PARALLEL_API_KEY),
        signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'web_search',
            arguments: {
              objective: parallelObjective(input),
              search_queries: [parallelSearchQuery(input)],
            },
          },
        }),
      });
      const body = await readText('parallel', response);
      const mcpPayload = extractMcpTextPayload('parallel', body);
      const payload = parallelPayloadFromStructured(mcpPayload.structuredContent) ?? parallelPayloadFromText(mcpPayload.text);
      return { items: parseParallelItems(payload, input.limit), metadata: parallelMetadata(payload, filterApplication(input)) };
    } catch (error) {
      throw providerRequestFailure('parallel', error, 'Parallel MCP search request failed.');
    }
  }
}

export function createParallelMcpSearchClient(runtime: WebsearchRuntime): WebSearchClient {
  return new ParallelMcpSearchClient(runtime);
}
