import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute } from './helpers.js';

function createClients(overrides: Record<string, unknown> = {}) {
  return {
    stackExchange: {
      searchQuestions: vi.fn().mockResolvedValue([]),
      getQuestion: vi.fn(),
      getAnswers: vi.fn(),
      getQuestionComments: vi.fn(),
      ...(overrides.stackExchange as Record<string, unknown> | undefined),
    },
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
      searchDiscussions: vi.fn().mockResolvedValue([]),
      getDiscussion: vi.fn(),
      ...(overrides.github as Record<string, unknown> | undefined),
    },
    devto: {
      searchArticles: vi.fn().mockResolvedValue([]),
      getComments: vi.fn(),
      ...(overrides.devto as Record<string, unknown> | undefined),
    },
    hackerNews: {
      searchStories: vi.fn().mockResolvedValue([]),
      getStory: vi.fn(),
      ...(overrides.hackerNews as Record<string, unknown> | undefined),
    },
  };
}

describe('generic websearch meta-tools', () => {
  it('discussion_search can target one selected source and returns unified discussion results', async () => {
    const searchStories = vi.fn().mockResolvedValue([{ objectID: '123', title: 'SQLite vec discussion', author: 'pg', points: 12, num_comments: 4, url: 'https://example.com/sqlite-vec', story_text: 'HN semantic snippet.' }]);
    const clients = createClients({ hackerNews: { searchStories } });
    const pi = createMockPi();

    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    const tool = pi.tools.find((entry) => entry.name === 'discussion_search');
    const result = (await execute(tool!, { query: 'sqlite vec', source: 'hacker_news', limit: 3 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { sources_searched: string[]; source_errors?: Array<Record<string, unknown>>; items: Array<Record<string, unknown>> } };
    };

    expect(searchStories).toHaveBeenCalledWith({ query: 'sqlite vec', limit: 3 }, undefined);
    expect(clients.stackExchange.searchQuestions).not.toHaveBeenCalled();
    expect(clients.github.searchIssues).not.toHaveBeenCalled();
    expect(clients.github.searchPullRequests).not.toHaveBeenCalled();
    expect(clients.github.searchDiscussions).not.toHaveBeenCalled();
    expect(clients.devto.searchArticles).not.toHaveBeenCalled();
    expect(result.details.status).toBe('success');
    expect(result.details.data.sources_searched).toEqual(['hacker_news']);
    expect(result.details.data.source_errors).toEqual([]);
    expect(result.details.data.items[0]).toMatchObject({
      source: 'hacker_news',
      kind: 'story',
      title: 'SQLite vec discussion',
      url: 'https://example.com/sqlite-vec',
      entity_id: '123',
      followup_tool: 'hackernews_story_get',
      followup_ref: 123,
    });
    expect(result.content[0]?.text).toContain('[hacker_news/story] SQLite vec discussion');
  });

  it('discussion_search maps multi-word Dev.to queries to a usable tag before searching', async () => {
    const searchArticles = vi.fn().mockResolvedValue([{ id: 10, title: 'SQLite article', url: 'https://dev.to/sqlite/10', description: 'SQLite article snippet.' }]);
    const clients = createClients({ devto: { searchArticles } });
    const pi = createMockPi();

    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    const tool = pi.tools.find((entry) => entry.name === 'discussion_search');
    const result = (await execute(tool!, { query: 'sqlite vec', source: 'devto', limit: 3 })) as {
      details: { status: 'success'; data: { items: Array<Record<string, unknown>>; source_errors: Array<Record<string, unknown>> } };
    };

    expect(searchArticles).toHaveBeenCalledWith({ tag: 'sqlite', limit: 3 }, undefined);
    expect(result.details.status).toBe('success');
    expect(result.details.data.source_errors).toEqual([]);
    expect(result.details.data.items[0]).toMatchObject({ source: 'devto', kind: 'article', title: 'SQLite article' });
  });

  it('discussion_search can target GitHub discussions as a selected source', async () => {
    const searchDiscussions = vi.fn().mockResolvedValue([{ id: 'D_42', number: 42, title: 'Agent memory discussion', url: 'https://github.com/acme/widgets/discussions/42', repository: { nameWithOwner: 'acme/widgets' }, bodyText: 'Discussion snippet.', comments: { totalCount: 2 }, upvoteCount: 5 }]);
    const clients = createClients({ github: { searchDiscussions } });
    const pi = createMockPi();

    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    const tool = pi.tools.find((entry) => entry.name === 'discussion_search');
    const result = (await execute(tool!, { query: 'agent memory', source: 'github_discussions', repo: 'acme/widgets', limit: 3 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { sources_searched: string[]; items: Array<Record<string, unknown>>; source_errors: Array<Record<string, unknown>> } };
    };

    expect(searchDiscussions).toHaveBeenCalledWith({ query: 'agent memory', limit: 3, repo: 'acme/widgets', owner: undefined }, undefined);
    expect(clients.github.searchIssues).not.toHaveBeenCalled();
    expect(clients.github.searchPullRequests).not.toHaveBeenCalled();
    expect(result.details.status).toBe('success');
    expect(result.details.data.sources_searched).toEqual(['github_discussions']);
    expect(result.details.data.source_errors).toEqual([]);
    expect(result.details.data.items[0]).toMatchObject({ source: 'github', source_query: 'github_discussions', kind: 'discussion', title: 'Agent memory discussion', followup_tool: 'github_discussion_get', followup_ref: 'acme/widgets#42' });
    expect(result.content[0]?.text).toContain('[github/discussion] Agent memory discussion');
  });

  it('discussion_search fans out across current discussion sources when source is omitted', async () => {
    const clients = createClients({
      stackExchange: { searchQuestions: vi.fn().mockResolvedValue([{ question_id: 1, link: 'https://stackoverflow.com/q/1', title: 'Stack answer', score: 5, answer_count: 1, body: 'Stack snippet.' }]) },
      github: {
        searchIssues: vi.fn().mockResolvedValue([{ number: 2, html_url: 'https://github.com/acme/repo/issues/2', repository_url: 'https://api.github.com/repos/acme/repo', title: 'Issue answer', state: 'open', comments: 1, body: 'Issue snippet.' }]),
        searchPullRequests: vi.fn().mockResolvedValue([{ number: 3, html_url: 'https://github.com/acme/repo/pull/3', repository_url: 'https://api.github.com/repos/acme/repo', title: 'PR answer', state: 'closed', comments: 2, body: 'PR snippet.' }]),
        searchDiscussions: vi.fn().mockResolvedValue([{ id: 'D_6', number: 6, url: 'https://github.com/acme/repo/discussions/6', repository: { nameWithOwner: 'acme/repo' }, title: 'Discussion answer', bodyText: 'Discussion snippet.', comments: { totalCount: 3 } }]),
        listIssueTimelineEvents: vi.fn().mockResolvedValue([]),
      },
      devto: { searchArticles: vi.fn().mockResolvedValue([{ id: 4, title: 'Article answer', url: 'https://dev.to/a/4', description: 'Article snippet.' }]) },
      hackerNews: { searchStories: vi.fn().mockResolvedValue([{ objectID: '5', title: 'HN answer', url: 'https://news.ycombinator.com/item?id=5', story_text: 'HN snippet.' }]) },
    });
    const pi = createMockPi();

    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    const tool = pi.tools.find((entry) => entry.name === 'discussion_search');
    const result = (await execute(tool!, { query: 'agent memory sqlite', limit: 10 })) as {
      details: { status: 'success'; data: { sources_searched: string[]; source_errors: Array<Record<string, unknown>>; items: Array<Record<string, unknown>> } };
    };

    expect(result.details.data.sources_searched).toEqual(['stack_overflow', 'github_issues', 'github_pull_requests', 'github_discussions', 'devto', 'hacker_news']);
    expect(result.details.data.source_errors).toEqual([]);
    expect(result.details.data.items.map((item) => `${item.source}/${item.kind}`)).toEqual([
      'stack_overflow/question',
      'github/issue',
      'github/pull_request',
      'github/discussion',
      'devto/article',
      'hacker_news/story',
    ]);
  });

  it('discussion_search returns partial fan-out results and source_errors when one source fails', async () => {
    const clients = createClients({
      stackExchange: { searchQuestions: vi.fn().mockResolvedValue([{ question_id: 1, link: 'https://stackoverflow.com/q/1', title: 'Stack answer', body: 'Stack snippet.' }]) },
      github: {
        searchIssues: vi.fn().mockResolvedValue([]),
        searchPullRequests: vi.fn().mockResolvedValue([]),
        searchDiscussions: vi.fn().mockResolvedValue([]),
        listIssueTimelineEvents: vi.fn().mockResolvedValue([]),
      },
      devto: { searchArticles: vi.fn().mockRejectedValue(new Error('devto resource was not found')) },
      hackerNews: { searchStories: vi.fn().mockResolvedValue([{ objectID: '5', title: 'HN answer', url: 'https://news.ycombinator.com/item?id=5', story_text: 'HN snippet.' }]) },
    });
    const pi = createMockPi();

    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    const tool = pi.tools.find((entry) => entry.name === 'discussion_search');
    const result = (await execute(tool!, { query: 'sqlite vec', limit: 5 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { source_errors: Array<Record<string, unknown>>; items: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.items.map((item) => `${item.source}/${item.kind}`)).toEqual(['stack_overflow/question', 'hacker_news/story']);
    expect(result.details.data.source_errors).toHaveLength(1);
    expect(result.details.data.source_errors[0]).toMatchObject({ source: 'devto', error: { code: 'provider_error' } });
    expect(result.content[0]?.text).toContain('Some sources failed: devto');
  });

  it('discussion_search interleaves sources before applying the global fan-out limit', async () => {
    const clients = createClients({
      stackExchange: { searchQuestions: vi.fn().mockResolvedValue([
        { question_id: 1, link: 'https://stackoverflow.com/q/1', title: 'Stack one', body: 'Stack snippet 1.' },
        { question_id: 2, link: 'https://stackoverflow.com/q/2', title: 'Stack two', body: 'Stack snippet 2.' },
        { question_id: 3, link: 'https://stackoverflow.com/q/3', title: 'Stack three', body: 'Stack snippet 3.' },
      ]) },
      github: {
        searchIssues: vi.fn().mockResolvedValue([{ number: 10, html_url: 'https://github.com/acme/repo/issues/10', repository_url: 'https://api.github.com/repos/acme/repo', title: 'Issue one', body: 'Issue snippet.' }]),
        searchPullRequests: vi.fn().mockResolvedValue([]),
        searchDiscussions: vi.fn().mockResolvedValue([]),
        listIssueTimelineEvents: vi.fn().mockResolvedValue([]),
      },
      hackerNews: { searchStories: vi.fn().mockResolvedValue([{ objectID: '20', title: 'HN one', url: 'https://news.ycombinator.com/item?id=20', story_text: 'HN snippet.' }]) },
    });
    const pi = createMockPi();

    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    const tool = pi.tools.find((entry) => entry.name === 'discussion_search');
    const result = (await execute(tool!, { query: 'sqlite vector search', limit: 3 })) as {
      details: { status: 'success'; data: { items: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.items.map((item) => `${item.source}/${item.kind}:${item.title}`)).toEqual([
      'stack_overflow/question:Stack one',
      'github/issue:Issue one',
      'hacker_news/story:HN one',
    ]);
  });

  it('research_search is registered as the academic parent tool', async () => {
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>() });

    const tool = pi.tools.find((entry) => entry.name === 'research_search');
    const result = (await execute(tool!, { query: 'agent memory sqlite' })) as {
      details: { status: 'success'; data: { query: string; sources_searched: string[]; available_sources: string[]; items: unknown[]; source_errors: unknown[] } };
    };

    expect(tool).toBeDefined();
    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      query: 'agent memory sqlite',
      sources_searched: ['openalex', 'arxiv', 'crossref', 'europe_pmc', 'semantic_scholar'],
      available_sources: ['openalex', 'arxiv', 'crossref', 'europe_pmc', 'semantic_scholar'],
      items: [],
    });
    expect(result.details.data.source_errors).toHaveLength(5);
  });
});
