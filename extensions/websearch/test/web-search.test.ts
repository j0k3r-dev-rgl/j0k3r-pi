import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { ProviderFailure } from '../src/security.js';
import { createMockPi, execute } from './helpers.js';

function createClients(overrides: Record<string, unknown> = {}) {
  return {
    stackExchange: { searchQuestions: vi.fn().mockResolvedValue([]), getQuestion: vi.fn(), getAnswers: vi.fn(), getQuestionComments: vi.fn() },
    github: {
      searchIssues: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn(),
      listIssueComments: vi.fn(),
      listIssueTimelineEvents: vi.fn().mockResolvedValue([]),
      searchPullRequests: vi.fn().mockResolvedValue([]),
      getPullRequest: vi.fn(),
      listPullRequestReviewComments: vi.fn().mockResolvedValue([]),
      listPullRequestReviews: vi.fn().mockResolvedValue([]),
      listReleases: vi.fn().mockResolvedValue([]),
      getReleaseByTag: vi.fn(),
    },
    devto: { searchArticles: vi.fn().mockResolvedValue([]), getComments: vi.fn() },
    hackerNews: { searchStories: vi.fn().mockResolvedValue([]), getStory: vi.fn() },
    web: {
      exa: { search: vi.fn().mockResolvedValue([]) },
      parallel: { search: vi.fn().mockResolvedValue([]) },
      fetch: { fetch: vi.fn() },
    },
    ...(overrides as Record<string, unknown>),
  };
}

describe('web_search', () => {
  it('uses Exa as the primary provider and does not call Parallel when Exa returns results', async () => {
    const exaSearch = vi.fn().mockResolvedValue({
      items: [
        { title: 'Next.js 16', url: 'https://nextjs.org/blog/next-16', snippet: 'Official release notes.', published_at: '2025-10-21' },
      ],
      metadata: { search_time_ms: 123.4 },
    });
    const parallelSearch = vi.fn().mockResolvedValue({
      items: [
        { title: 'Fallback result', url: 'https://example.com/fallback' },
      ],
      metadata: { search_id: 'unused' },
    });
    const clients = createClients({ web: { exa: { search: exaSearch }, parallel: { search: parallelSearch }, fetch: { fetch: vi.fn() } } });
    const pi = createMockPi();

    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    const tool = pi.tools.find((entry) => entry.name === 'web_search');
    const result = (await execute(tool!, { query: 'nextjs 16 release notes', limit: 5 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { selected_provider: string; providers_tried: string[]; fallback_used: boolean; source_errors: unknown[]; provider_metadata: Record<string, unknown>; items: Array<Record<string, unknown>> } };
    };

    expect(tool).toBeDefined();
    expect(exaSearch).toHaveBeenCalledWith({ query: 'nextjs 16 release notes', limit: 5 }, undefined);
    expect(parallelSearch).not.toHaveBeenCalled();
    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      selected_provider: 'exa',
      providers_tried: ['exa'],
      fallback_used: false,
      source_errors: [],
    });
    expect(result.details.data.items[0]).toMatchObject({
      rank: 1,
      source: 'exa',
      title: 'Next.js 16',
      url: 'https://nextjs.org/blog/next-16',
      snippet: 'Official release notes.',
      domain: 'nextjs.org',
    });
    expect(result.details.data.provider_metadata).toEqual({ exa: { search_time_ms: 123.4 } });
    expect(result.content[0]?.text).toContain('[exa] Next.js 16');
  });

  it('falls back to Parallel when Exa fails and records the Exa source error', async () => {
    const exaSearch = vi.fn().mockRejectedValue(new ProviderFailure({
      code: 'rate_limited',
      category: 'rate_limit',
      message: 'exa rate limit reached.',
      recoverable: true,
      provider: 'exa',
      status: 429,
    }));
    const parallelSearch = vi.fn().mockResolvedValue({
      items: [
        { title: 'Docker rootless mode', url: 'https://docs.docker.com/engine/security/rootless/', snippet: 'Run Docker daemon as non-root.' },
      ],
      metadata: { search_id: 'search_parallel_123', usage: [{ name: 'sku_search', count: 1 }] },
    });
    const clients = createClients({ web: { exa: { search: exaSearch }, parallel: { search: parallelSearch }, fetch: { fetch: vi.fn() } } });
    const pi = createMockPi();

    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    const tool = pi.tools.find((entry) => entry.name === 'web_search');
    const result = (await execute(tool!, { query: 'docker rootless networking' })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { selected_provider: string; providers_tried: string[]; fallback_used: boolean; source_errors: Array<Record<string, unknown>>; provider_metadata: Record<string, unknown>; items: Array<Record<string, unknown>> } };
    };

    expect(exaSearch).toHaveBeenCalledWith({ query: 'docker rootless networking', limit: 5 }, undefined);
    expect(parallelSearch).toHaveBeenCalledWith({ query: 'docker rootless networking', limit: 5 }, undefined);
    expect(result.details.status).toBe('success');
    expect(result.details.data.selected_provider).toBe('parallel');
    expect(result.details.data.providers_tried).toEqual(['exa', 'parallel']);
    expect(result.details.data.fallback_used).toBe(true);
    expect(result.details.data.source_errors).toHaveLength(1);
    expect(result.details.data.source_errors[0]).toMatchObject({ source: 'exa', error: { code: 'rate_limited', provider: 'exa' } });
    expect(result.details.data.items[0]).toMatchObject({ source: 'parallel', title: 'Docker rootless mode', domain: 'docs.docker.com' });
    expect(result.details.data.provider_metadata).toEqual({ parallel: { search_id: 'search_parallel_123', usage: [{ name: 'sku_search', count: 1 }] } });
    expect(result.content[0]?.text).toContain('Fallback used: parallel after exa failed');
  });
});
