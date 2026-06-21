import { describe, expect, it, vi } from 'vitest';
import { createExaMcpSearchClient, createParallelMcpSearchClient } from '../src/providers/web/index.js';
import type { WebsearchRuntime } from '../src/types.js';

function runtime(fetchImpl: typeof fetch, env: Record<string, string | undefined> = {}): WebsearchRuntime {
  return {
    env,
    fetch: fetchImpl,
    config: { request: { timeoutMs: 1000, maxRetries: 0 } },
  } as WebsearchRuntime;
}

function mcpResponse(text: string, extras: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text, _meta: extras.contentMeta }], structuredContent: extras.structuredContent },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('web MCP providers', () => {
  it('calls Exa MCP and parses title/url result blocks', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(mcpResponse(`Title: Next.js 16\nURL: https://nextjs.org/blog/next-16\nPublished: 2025-10-21\nHighlights: Official release notes.\n\nTitle: Upgrade guide\nURL: https://nextjs.org/docs/app/guides/upgrading/version-16\nHighlights: Upgrade instructions.`, { contentMeta: { searchTime: 123.4 } }));
    const client = createExaMcpSearchClient(runtime(fetchImpl, { EXA_API_KEY: 'exa-test-key' }));

    const results = await client.search({ query: 'nextjs 16 release notes', limit: 2 });

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('https://mcp.exa.ai/mcp'), expect.objectContaining({ method: 'POST' }));
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ 'x-api-key': 'exa-test-key' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      method: 'tools/call',
      params: { name: 'web_search_exa', arguments: { query: 'nextjs 16 release notes', numResults: 2 } },
    });
    expect(results).toEqual({
      items: [
        { title: 'Next.js 16', url: 'https://nextjs.org/blog/next-16', published_at: '2025-10-21', author: undefined, snippet: undefined },
        { title: 'Upgrade guide', url: 'https://nextjs.org/docs/app/guides/upgrading/version-16', published_at: undefined, author: undefined, snippet: undefined },
      ],
      metadata: { search_time_ms: 123.4 },
    });
  });

  it('uses Exa advanced MCP search and parses JSON-in-text results for normalized native filters', async () => {
    const advancedPayload = {
      requestId: 'exa_advanced_123',
      searchTime: 321.5,
      results: [
        {
          title: 'URL: URL() constructor - Web APIs | MDN',
          url: 'https://developer.mozilla.org/en-US/docs/Web/API/URL/URL',
          text: 'The URL() constructor returns a newly created URL object.',
          publishedDate: '2025-11-09',
          author: 'MDN Contributors',
          score: 0.98,
        },
      ],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(mcpResponse(JSON.stringify(advancedPayload)));
    const client = createExaMcpSearchClient(runtime(fetchImpl));

    const results = await client.search({
      query: 'URL constructor documentation',
      limit: 3,
      includeDomains: ['developer.mozilla.org'],
      excludeDomains: ['w3schools.com'],
      afterDate: '2025-01-01',
      beforeDate: '2025-12-31',
      location: 'US',
      mode: 'deep',
    });

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('tools=web_search_exa'), expect.objectContaining({ method: 'POST' }));
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      method: 'tools/call',
      params: {
        name: 'web_search_advanced_exa',
        arguments: {
          query: 'URL constructor documentation',
          numResults: 3,
          type: 'deep',
          includeDomains: ['developer.mozilla.org'],
          excludeDomains: ['w3schools.com'],
          startPublishedDate: '2025-01-01',
          endPublishedDate: '2025-12-31',
          userLocation: 'US',
        },
      },
    });
    expect(results.items).toEqual([
      {
        title: 'URL: URL() constructor - Web APIs | MDN',
        url: 'https://developer.mozilla.org/en-US/docs/Web/API/URL/URL',
        snippet: 'The URL() constructor returns a newly created URL object.',
        published_at: '2025-11-09',
        author: 'MDN Contributors',
        score: 0.98,
      },
    ]);
    expect(results.metadata).toMatchObject({
      search_time_ms: 321.5,
      filter_application: { native: ['mode', 'includeDomains', 'excludeDomains', 'afterDate', 'beforeDate', 'location'] },
    });
  });

  it('calls Parallel MCP and parses JSON results from the text content', async () => {
    const parallelPayload = {
      search_id: 'search_test_123',
      session_id: 'session_test_456',
      warnings: ['low confidence'],
      usage: [{ name: 'sku_search', count: 1 }],
      results: [
        { title: 'Rootless mode', url: 'https://docs.docker.com/engine/security/rootless/', excerpts: ['Run the Docker daemon as a non-root user.'], publish_date: '2025-01-01' },
        { title: 'Tips', url: 'https://docs.docker.com/engine/security/rootless/tips/', excerpts: ['Networking tips.'] },
      ],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(mcpResponse(JSON.stringify(parallelPayload), { structuredContent: parallelPayload }));
    const client = createParallelMcpSearchClient(runtime(fetchImpl, { PARALLEL_API_KEY: 'parallel-test-key' }));

    const results = await client.search({ query: 'docker rootless networking', limit: 1 });

    expect(fetchImpl).toHaveBeenCalledWith('https://search.parallel.ai/mcp', expect.objectContaining({ method: 'POST' }));
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ authorization: 'Bearer parallel-test-key' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      method: 'tools/call',
      params: { name: 'web_search', arguments: { objective: 'docker rootless networking', search_queries: ['docker rootless networking'] } },
    });
    expect(results).toEqual({
      items: [
        { title: 'Rootless mode', url: 'https://docs.docker.com/engine/security/rootless/', published_at: '2025-01-01', snippet: 'Run the Docker daemon as a non-root user.' },
      ],
      metadata: {
        search_id: 'search_test_123',
        session_id: 'session_test_456',
        warnings: ['low confidence'],
        usage: [{ name: 'sku_search', count: 1 }],
      },
    });
  });

  it('degrades normalized filters into Parallel MCP objective and query hints', async () => {
    const parallelPayload = {
      results: [
        { title: 'MDN URL', url: 'https://developer.mozilla.org/en-US/docs/Web/API/URL/URL', excerpts: ['URL constructor docs.'] },
      ],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(mcpResponse(JSON.stringify(parallelPayload), { structuredContent: parallelPayload }));
    const client = createParallelMcpSearchClient(runtime(fetchImpl));

    await client.search({
      query: 'URL constructor documentation',
      limit: 5,
      includeDomains: ['developer.mozilla.org'],
      excludeDomains: ['w3schools.com'],
      afterDate: '2025-01-01',
      beforeDate: '2025-12-31',
      location: 'US',
      mode: 'deep',
    });

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.params.name).toBe('web_search');
    expect(body.params.arguments.objective).toContain('Only include results from these domains: developer.mozilla.org.');
    expect(body.params.arguments.objective).toContain('Exclude results from these domains: w3schools.com.');
    expect(body.params.arguments.objective).toContain('Prefer results published on or after 2025-01-01.');
    expect(body.params.arguments.objective).toContain('Prefer results published on or before 2025-12-31.');
    expect(body.params.arguments.objective).toContain('Prefer results relevant to location US.');
    expect(body.params.arguments.search_queries[0]).toContain('site:developer.mozilla.org');
    expect(body.params.arguments.search_queries[0]).toContain('-site:w3schools.com');
    expect(body.params.arguments.search_queries[0]).toContain('after:2025-01-01');
    expect(body.params.arguments.search_queries[0]).toContain('before:2025-12-31');
  });
});
