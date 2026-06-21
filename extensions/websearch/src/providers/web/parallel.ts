import type { RawWebSearchItem, RawWebSearchMetadata, RawWebSearchResponse, WebSearchClient, WebsearchRuntime } from '../../types.js';
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

function parallelMetadata(payload: ParallelMcpPayload | undefined): RawWebSearchMetadata | undefined {
  if (!payload) return undefined;
  const record = payload as Record<string, unknown>;
  const metadata: RawWebSearchMetadata = {};
  if (typeof record.search_id === 'string' && record.search_id.trim()) metadata.search_id = record.search_id.trim();
  if (typeof record.session_id === 'string' && record.session_id.trim()) metadata.session_id = record.session_id.trim();
  if (Array.isArray(record.warnings)) metadata.warnings = record.warnings;
  if (Array.isArray(record.usage)) metadata.usage = record.usage;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export class ParallelMcpSearchClient implements WebSearchClient {
  constructor(private readonly runtime: WebsearchRuntime) {}

  async search(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawWebSearchResponse> {
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
              objective: input.query,
              search_queries: [input.query],
            },
          },
        }),
      });
      const body = await readText('parallel', response);
      const mcpPayload = extractMcpTextPayload('parallel', body);
      const payload = parallelPayloadFromStructured(mcpPayload.structuredContent) ?? parallelPayloadFromText(mcpPayload.text);
      return { items: parseParallelItems(payload, input.limit), metadata: parallelMetadata(payload) };
    } catch (error) {
      throw providerRequestFailure('parallel', error, 'Parallel MCP search request failed.');
    }
  }
}

export function createParallelMcpSearchClient(runtime: WebsearchRuntime): WebSearchClient {
  return new ParallelMcpSearchClient(runtime);
}
