import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute } from './helpers.js';

function createClients(fetchResult?: unknown) {
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
      exa: { search: vi.fn().mockResolvedValue({ items: [] }) },
      parallel: { search: vi.fn().mockResolvedValue({ items: [] }) },
      fetch: { fetch: vi.fn().mockResolvedValue(fetchResult) },
    },
  };
}

describe('web_fetch', () => {
  it('registers and returns the selected page content with the confirmed contract', async () => {
    const clients = createClients({
      url: 'https://example.com/start',
      final_url: 'https://example.com/docs',
      status: 200,
      content_type: 'text/html; charset=utf-8',
      title: 'Docs page',
      text: 'Docs page\n\nInstall with npm.',
      excerpt: 'Docs page Install with npm.',
      links: [{ text: 'Migration guide', url: 'https://example.com/migration' }],
      fetched_at: '2026-06-20T12:00:00.000Z',
      bytes_read: 247,
      truncated: false,
      redirects: [{ url: 'https://example.com/start', status: 302, location: 'https://example.com/docs' }],
    });
    const pi = createMockPi();

    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), clients: { web: clients.web } });

    const tool = pi.tools.find((entry) => entry.name === 'web_fetch');
    const result = (await execute(tool!, { url: 'https://example.com/start', maxBytes: 4096 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { url: string; final_url: string; links: unknown[]; bytes_read: number; truncated: boolean } };
    };

    expect(tool).toBeDefined();
    expect(clients.web.fetch.fetch).toHaveBeenCalledWith({ url: 'https://example.com/start', maxBytes: 4096 }, undefined);
    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      url: 'https://example.com/start',
      final_url: 'https://example.com/docs',
      bytes_read: 247,
      truncated: false,
    });
    expect(result.details.data.links).toEqual([{ text: 'Migration guide', url: 'https://example.com/migration' }]);
    expect(result.content[0]?.text).toContain('web_fetch read https://example.com/docs');
    expect(result.content[0]?.text).toContain('Docs page');
  });

  it('uses a 2 MB default maxBytes and rejects values over 5 MB', async () => {
    const clients = createClients({
      url: 'https://example.com/docs',
      final_url: 'https://example.com/docs',
      status: 200,
      content_type: 'text/plain',
      text: 'ok',
      excerpt: 'ok',
      links: [],
      fetched_at: '2026-06-20T12:00:00.000Z',
      bytes_read: 2,
      truncated: false,
      redirects: [],
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), clients: { web: clients.web } });
    const tool = pi.tools.find((entry) => entry.name === 'web_fetch');

    await execute(tool!, { url: 'https://example.com/docs' });
    expect(clients.web.fetch.fetch).toHaveBeenCalledWith({ url: 'https://example.com/docs', maxBytes: 2 * 1024 * 1024 }, undefined);

    const tooLarge = await execute(tool!, { url: 'https://example.com/docs', maxBytes: 5 * 1024 * 1024 + 1 }) as { isError?: boolean; content: Array<{ text: string }> };
    expect(tooLarge.isError).toBe(true);
    expect(tooLarge.content[0]?.text).toContain('maxBytes must be at most 5242880');
  });
});
