import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from './legacy-tools.js';
import { createMockPi, execute } from './helpers.js';

function baseClients(githubOverrides: Record<string, unknown>) {
  return {
    stackExchange: { searchQuestions: vi.fn(), getQuestion: vi.fn(), getAnswers: vi.fn(), getQuestionComments: vi.fn() },
    github: {
      searchIssues: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn(),
      listIssueComments: vi.fn().mockResolvedValue([]),
      listIssueTimelineEvents: vi.fn().mockResolvedValue([]),
      searchPullRequests: vi.fn().mockResolvedValue([]),
      getPullRequest: vi.fn(),
      listPullRequestReviewComments: vi.fn().mockResolvedValue([]),
      listPullRequestReviews: vi.fn().mockResolvedValue([]),
      listReleases: vi.fn().mockResolvedValue([]),
      getReleaseByTag: vi.fn(),
      searchDiscussions: vi.fn().mockResolvedValue([]),
      getDiscussion: vi.fn(),
      ...githubOverrides,
    },
    devto: { searchArticles: vi.fn(), getComments: vi.fn() },
    hackerNews: { searchStories: vi.fn(), getStory: vi.fn() },
  };
}

const discussionPayload = {
  id: 'D_kwDOA1',
  number: 99,
  title: 'How should agent memory work?',
  url: 'https://github.com/acme/widgets/discussions/99',
  bodyText: 'We are discussing sqlite-backed agent memory and search.',
  author: { login: 'maintainer', url: 'https://github.com/maintainer' },
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-03T00:00:00Z',
  publishedAt: '2026-02-01T00:00:00Z',
  upvoteCount: 12,
  answerChosenAt: '2026-02-02T00:00:00Z',
  closed: false,
  locked: false,
  category: { name: 'Q&A', slug: 'q-a', emoji: '💬' },
  repository: { nameWithOwner: 'acme/widgets' },
  comments: { totalCount: 2 },
  labels: { nodes: [{ name: 'memory' }] },
  answer: {
    id: 'DC_answer',
    url: 'https://github.com/acme/widgets/discussions/99#discussioncomment-answer',
    bodyText: 'Use a compact index plus source artifacts.',
    author: { login: 'maintainer' },
    createdAt: '2026-02-02T00:00:00Z',
    updatedAt: '2026-02-02T00:00:00Z',
    upvoteCount: 4,
  },
  text_matches: [{ fragment: 'sqlite-backed agent memory' }],
};

const discussionDetailPayload = {
  ...discussionPayload,
  comments: {
    totalCount: 2,
    nodes: [{
      id: 'DC_1',
      url: 'https://github.com/acme/widgets/discussions/99#discussioncomment-1',
      bodyText: 'I would index decisions and validation commands.',
      author: { login: 'contributor' },
      createdAt: '2026-02-01T12:00:00Z',
      updatedAt: '2026-02-01T12:00:00Z',
      upvoteCount: 3,
    }, {
      id: 'DC_answer',
      url: 'https://github.com/acme/widgets/discussions/99#discussioncomment-answer',
      bodyText: 'Use a compact index plus source artifacts.',
      author: { login: 'maintainer' },
      createdAt: '2026-02-02T00:00:00Z',
      updatedAt: '2026-02-02T00:00:00Z',
      upvoteCount: 4,
    }],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
};

describe('github discussions tools', () => {
  it('github_discussion_search returns bounded normalized discussion results', async () => {
    const searchDiscussions = vi.fn().mockResolvedValue([discussionPayload]);
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => baseClients({ searchDiscussions }) });

    const tool = pi.tools.find((entry) => entry.name === 'github_discussion_search');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { query: 'agent memory sqlite', repo: 'acme/widgets', limit: 3 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { items: Array<Record<string, unknown>>; limit: number } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.limit).toBe(3);
    expect(result.details.data.items[0]).toMatchObject({
      platform: 'github',
      repository: 'acme/widgets',
      number: 99,
      title: 'How should agent memory work?',
      category: 'Q&A',
      category_slug: 'q-a',
      upvote_count: 12,
      comments_count: 2,
      answered: true,
      snippet: 'sqlite-backed agent memory',
      follow_up_ref: 'acme/widgets#99',
    });
    expect(result.content[0]?.text).toContain('1. How should agent memory work? — acme/widgets#99');
    expect(result.content[0]?.text).toContain('answered: true');
    expect(searchDiscussions).toHaveBeenCalledWith({ query: 'agent memory sqlite', repo: 'acme/widgets', limit: 3 }, undefined);
  });

  it('github_discussion_get returns one discussion with bounded comments and answer marker', async () => {
    const getDiscussion = vi.fn().mockResolvedValue(discussionDetailPayload);
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => baseClients({ getDiscussion }) });

    const tool = pi.tools.find((entry) => entry.name === 'github_discussion_get');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { discussion: 'https://github.com/acme/widgets/discussions/99', commentsLimit: 2, commentsOffset: 0 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: Record<string, unknown> & { comments: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      repository: 'acme/widgets',
      number: 99,
      body: 'We are discussing sqlite-backed agent memory and search.',
      answer: { id: 'DC_answer', is_answer: true },
      comments_limit: 2,
      comments_offset: 0,
    });
    expect(result.details.data.comments).toHaveLength(2);
    expect(result.details.data.comments[1]).toMatchObject({ id: 'DC_answer', is_answer: true });
    expect(result.content[0]?.text).toContain('How should agent memory work?');
    expect(result.content[0]?.text).toContain('Comments offset 0 limit 2');
    expect(getDiscussion).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets', discussionNumber: 99, url: 'https://github.com/acme/widgets/discussions/99', commentsLimit: 2, commentsOffset: 0 }, undefined);
  });

  it('uses gh api graphql for discussion search and get when configured', async () => {
    const commandRunner = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('searchQuery=agent memory repo:acme/widgets')) {
        return { stdout: JSON.stringify({ data: { search: { edges: [{ node: discussionPayload, textMatches: [{ fragment: 'agent memory' }] }] } } }), stderr: '' };
      }
      if (command.includes('owner=acme') && command.includes('name=widgets') && command.includes('number=99')) {
        return { stdout: JSON.stringify({ data: { repository: { discussion: discussionDetailPayload } } }), stderr: '' };
      }
      throw new Error(`unexpected gh command: ${command}`);
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      commandRunner,
      config: { github: { provider: 'gh' }, request: { timeoutMs: 120_000, maxRetries: 1 } },
    });

    const searchTool = pi.tools.find((entry) => entry.name === 'github_discussion_search');
    const getTool = pi.tools.find((entry) => entry.name === 'github_discussion_get');
    const searchResult = (await execute(searchTool!, { query: 'agent memory', repo: 'acme/widgets', limit: 1 })) as { details: { status: string } };
    const getResult = (await execute(getTool!, { discussion: 'acme/widgets#99', commentsLimit: 2 })) as { details: { status: string } };

    expect(searchResult.details.status).toBe('success');
    expect(getResult.details.status).toBe('success');
    expect(commandRunner).toHaveBeenCalledWith('gh', expect.arrayContaining(['api', 'graphql', '-f', expect.stringMatching(/^query=/), '-F', 'searchQuery=agent memory repo:acme/widgets', '-F', 'first=1']), expect.anything());
    expect(commandRunner).toHaveBeenCalledWith('gh', expect.arrayContaining(['api', 'graphql', '-f', expect.stringMatching(/^query=/), '-F', 'owner=acme', '-F', 'name=widgets', '-F', 'number=99']), expect.anything());
  });
});
