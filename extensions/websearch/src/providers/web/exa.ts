import type { RawWebSearchItem, RawWebSearchMetadata, RawWebSearchResponse, WebSearchClient, WebsearchRuntime } from '../../types.js';
import { providerRequestFailure, readText } from '../common/index.js';
import { extractMcpTextPayload, mcpHeaders } from './mcp.js';

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';

function fieldValue(block: string, field: string): string | undefined {
  const match = new RegExp(`^${field}:\\s*(.+)$`, 'im').exec(block);
  const value = match?.[1]?.trim();
  if (!value || value.toLowerCase() === 'n/a') return undefined;
  return value;
}

function exaMetadata(contentMeta?: Record<string, unknown>): RawWebSearchMetadata | undefined {
  const metadata: RawWebSearchMetadata = {};
  if (typeof contentMeta?.searchTime === 'number') metadata.search_time_ms = contentMeta.searchTime;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
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

function parseExaText(text: string, limit: number): RawWebSearchItem[] {
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

export class ExaMcpSearchClient implements WebSearchClient {
  constructor(private readonly runtime: WebsearchRuntime) {}

  async search(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawWebSearchResponse> {
    try {
      const response = await this.runtime.fetch(EXA_MCP_URL, {
        method: 'POST',
        headers: mcpHeaders(this.runtime.env.EXA_API_KEY),
        signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'web_search_exa',
            arguments: {
              query: input.query,
              type: 'fast',
              numResults: input.limit,
              livecrawl: 'fallback',
              contextMaxCharacters: 5000,
            },
          },
        }),
      });
      const body = await readText('exa', response);
      const payload = extractMcpTextPayload('exa', body);
      return { items: parseExaText(payload.text, input.limit), metadata: exaMetadata(payload.contentMeta) };
    } catch (error) {
      throw providerRequestFailure('exa', error, 'Exa MCP search request failed.');
    }
  }
}

export function createExaMcpSearchClient(runtime: WebsearchRuntime): WebSearchClient {
  return new ExaMcpSearchClient(runtime);
}
