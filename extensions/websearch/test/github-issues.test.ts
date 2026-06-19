import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute } from './helpers.js';

describe('github issue tool behavior', () => {
  it('search_github_issues treats state all as no state filter', async () => {
    const searchIssues = vi.fn().mockResolvedValue([]);
    const pi = createMockPi();
    registerWebsearchTools(pi, {
      createClients: () => ({
        stackExchange: {
          searchQuestions: vi.fn(),
          getQuestion: vi.fn(),
          getAnswers: vi.fn(),
          getQuestionComments: vi.fn(),
        },
        github: {
          searchIssues,
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
        devto: {
          searchArticles: vi.fn(),
          getComments: vi.fn(),
        },
        hackerNews: {
          searchStories: vi.fn(),
          getStory: vi.fn(),
        },
      }),
      env: {},
      fetch: vi.fn<typeof fetch>(),
      config: { github: { provider: 'api' }, request: { timeoutMs: 120_000, maxRetries: 1 } },
    });

    const tool = pi.tools.find((entry) => entry.name === 'search_github_issues');
    await execute(tool!, { repo: 'nodejs/node', query: 'corepack', state: 'all', limit: 5 });

    expect(searchIssues).toHaveBeenCalledWith({ repo: 'nodejs/node', query: 'corepack', state: 'all', limit: 5 }, undefined);
  });

  it('search_github_issues returns multiple reusable issue refs with metadata and semantic snippets', async () => {
    const searchIssues = vi.fn().mockResolvedValue([{
      id: 1,
      number: 10,
      html_url: 'https://github.com/nodejs/node/issues/10',
      repository_url: 'https://api.github.com/repos/nodejs/node',
      title: 'Fetch abort timeout behavior',
      user: { login: 'reporter' },
      state: 'closed',
      comments: 4,
      score: 2,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      labels: [{ name: 'bug' }, { name: 'fetch' }],
      body: `<!-- template noise -->\n${'First issue semantic body about fetch abort timeout. '.repeat(12)}`,
    }, {
      id: 2,
      number: 11,
      html_url: 'https://github.com/nodejs/node/issues/11',
      repository_url: 'https://api.github.com/repos/nodejs/node',
      title: 'AbortSignal timeout should reject',
      user: { login: 'maintainer' },
      state: 'open',
      comments: 7,
      score: 1,
      created_at: '2026-01-03T00:00:00Z',
      updated_at: '2026-01-04T00:00:00Z',
      labels: [{ name: 'question' }],
      body: 'Second issue semantic snippet about AbortSignal timeout rejection.',
    }]);

    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      createClients: () => ({
        stackExchange: {
          searchQuestions: vi.fn(),
          getQuestion: vi.fn(),
          getAnswers: vi.fn(),
          getQuestionComments: vi.fn(),
        },
        github: {
          searchIssues,
          getIssue: vi.fn(),
          listIssueComments: vi.fn(),
          listIssueTimelineEvents: vi.fn().mockResolvedValue([{ event: 'cross-referenced', source: { issue: {
            number: 42,
            html_url: 'https://github.com/nodejs/node/pull/42',
            repository_url: 'https://api.github.com/repos/nodejs/node',
            title: 'Fix fetch abort behavior',
            state: 'closed',
            pull_request: { url: 'https://api.github.com/repos/nodejs/node/pulls/42' },
          } } }, { event: 'cross-referenced', source: { issue: {
            number: 43,
            html_url: 'https://github.com/nodejs/node/issues/43',
            repository_url: 'https://api.github.com/repos/nodejs/node',
            title: 'Related AbortSignal discussion',
            state: 'open',
          } } }]),
          searchPullRequests: vi.fn().mockResolvedValue([]),
          getPullRequest: vi.fn(),
          listPullRequestReviewComments: vi.fn().mockResolvedValue([]),
          listPullRequestReviews: vi.fn().mockResolvedValue([]),
          listReleases: vi.fn().mockResolvedValue([]),
          getReleaseByTag: vi.fn(),
        },
        devto: {
          searchArticles: vi.fn(),
          getComments: vi.fn(),
        },
        hackerNews: {
          searchStories: vi.fn(),
          getStory: vi.fn(),
        },
      }),
    });

    const tool = pi.tools.find((entry) => entry.name === 'search_github_issues');
    const result = (await execute(tool!, { repo: 'nodejs/node', query: 'fetch abort timeout', state: 'closed', limit: 2 })) as {
      content: Array<{ type: 'text'; text: string }>;
      details: { status: 'success'; data: { items: Array<Record<string, unknown>>; limit: number } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.limit).toBe(2);
    expect(result.details.data.items[0]).toMatchObject({
      platform: 'github',
      number: 10,
      repository: 'nodejs/node',
      follow_up_ref: 'nodejs/node#10',
      state: 'closed',
      comments_count: 4,
      labels: ['bug', 'fetch'],
      snippet: expect.stringContaining('First issue semantic body about fetch abort timeout.'),
    });
    expect(result.content[0]?.text).toContain('1. Fetch abort timeout behavior — nodejs/node#10');
    expect(result.content[0]?.text).toContain('state: closed');
    expect(result.content[0]?.text).toContain('comments: 4');
    expect(result.content[0]?.text).toContain('labels: bug, fetch');
    expect(result.content[0]?.text).toContain('snippet: First issue semantic body about fetch abort timeout.');
    expect(result.content[0]?.text).toContain('related PRs: nodejs/node#42 (closed)');
    expect(result.content[0]?.text).toContain('related issues: nodejs/node#43 (open)');
    expect(result.content[0]?.text).toContain('2. AbortSignal timeout should reject — nodejs/node#11');
    expect(result.content[0]?.text).toContain('question');
    expect(result.content[0]?.text).not.toContain('template noise');
    expect(searchIssues).toHaveBeenCalledWith({ repo: 'nodejs/node', query: 'fetch abort timeout', state: 'closed', limit: 2 }, undefined);
  });

  it('omits the state qualifier for GitHub issue search when state is all', async () => {
    const commandRunner = vi.fn(async (_file: string, _args: string[]) => ({ stdout: JSON.stringify({ items: [] }), stderr: '' }));
    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      config: { github: { provider: 'gh' }, request: { timeoutMs: 120_000, maxRetries: 1 } },
      commandRunner,
    });

    const searchTool = pi.tools.find((entry) => entry.name === 'search_github_issues');
    await execute(searchTool!, { repo: 'nodejs/node', query: 'corepack', state: 'all', limit: 5 });

    const ghArgs = commandRunner.mock.calls[0]?.[1] ?? [];
    expect(ghArgs).toContain('q=corepack is:issue repo:nodejs/node');
    expect(ghArgs.join(' ')).not.toContain('state:all');
    expect(ghArgs.join(' ')).not.toContain('state:open');
    expect(ghArgs.join(' ')).not.toContain('state:closed');
  });

  it('uses gh api for GitHub issue search/detail when github provider is gh', async () => {
    const commandRunner = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('search/issues')) {
        return { stdout: JSON.stringify({ items: [{
          id: 1,
          number: 10,
          html_url: 'https://github.com/nodejs/node/issues/10',
          repository_url: 'https://api.github.com/repos/nodejs/node',
          title: 'Fetch abort timeout behavior',
          state: 'closed',
          comments: 2,
          labels: [{ name: 'bug' }],
          body: 'Issue snippet from gh api.',
        }] }), stderr: '' };
      }
      if (command.includes('repos/nodejs/node/issues/10/comments')) {
        return { stdout: JSON.stringify([{ id: 100, html_url: 'https://github.com/nodejs/node/issues/10#issuecomment-100', user: { login: 'commenter' }, created_at: '2026-01-04T00:00:00Z', body: 'Comment from gh api.' }]), stderr: '' };
      }
      if (command.includes('repos/nodejs/node/issues/10/timeline')) {
        return { stdout: JSON.stringify([{ event: 'cross-referenced', source: { issue: {
          number: 42,
          html_url: 'https://github.com/nodejs/node/pull/42',
          repository_url: 'https://api.github.com/repos/nodejs/node',
          title: 'Fix fetch abort behavior',
          state: 'closed',
          pull_request: { url: 'https://api.github.com/repos/nodejs/node/pulls/42' },
        } } }]), stderr: '' };
      }
      if (command.includes('repos/nodejs/node/issues/10')) {
        return { stdout: JSON.stringify({
          id: 1,
          number: 10,
          html_url: 'https://github.com/nodejs/node/issues/10',
          repository_url: 'https://api.github.com/repos/nodejs/node',
          title: 'Fetch abort timeout behavior',
          user: { login: 'reporter' },
          state: 'closed',
          comments: 2,
          labels: [{ name: 'bug' }],
          body: 'Full issue body from gh api.',
        }), stderr: '' };
      }
      throw new Error(`unexpected gh command: ${command}`);
    });

    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      config: { github: { provider: 'gh' }, request: { timeoutMs: 120_000, maxRetries: 1 } },
      commandRunner,
    });

    const searchTool = pi.tools.find((entry) => entry.name === 'search_github_issues');
    const searchResult = (await execute(searchTool!, { repo: 'nodejs/node', query: 'fetch abort timeout', state: 'closed', limit: 1 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { items: Array<Record<string, unknown>> } };
    };
    expect(searchResult.details.status).toBe('success');
    expect(searchResult.content[0]?.text).toContain('nodejs/node#10');
    expect(searchResult.content[0]?.text).toContain('related PRs: nodejs/node#42 (closed)');

    const detailTool = pi.tools.find((entry) => entry.name === 'github_issue_get');
    const detailResult = (await execute(detailTool!, { issue: 'nodejs/node#10', commentsLimit: 1, commentsOffset: 0 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };
    expect(detailResult.details.status).toBe('success');
    expect(detailResult.content[0]?.text).toContain('Full issue body from gh api.');
    expect(detailResult.content[0]?.text).toContain('Related pull requests');
    expect(detailResult.content[0]?.text).toContain('- nodejs/node#42 — Fix fetch abort behavior (closed)');
    expect(detailResult.content[0]?.text).toContain('1. commenter: Comment from gh api.');
    expect(commandRunner).toHaveBeenCalledWith('gh', expect.arrayContaining(['api']), expect.anything());
  });

  it('honors non-page-aligned GitHub comment offsets with the gh provider', async () => {
    const page1 = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      html_url: `https://github.com/nodejs/node/issues/50963#issuecomment-${index + 1}`,
      user: { login: `author-${index + 1}` },
      created_at: '2026-01-04T00:00:00Z',
      body: `Comment ${index + 1}`,
    }));
    page1[98] = { ...page1[98], user: { login: 'wesleytodd' }, body: 'Correct comment 99' };
    page1[99] = { ...page1[99], user: { login: 'GeoffreyBooth' }, body: 'Correct comment 100' };
    const page2 = [
      { id: 101, html_url: 'https://github.com/nodejs/node/issues/50963#issuecomment-101', user: { login: 'mcollina' }, created_at: '2026-01-04T00:00:00Z', body: 'Correct comment 101' },
      { id: 102, html_url: 'https://github.com/nodejs/node/issues/50963#issuecomment-102', user: { login: 'GeoffreyBooth' }, created_at: '2026-01-04T00:00:00Z', body: 'Correct comment 102' },
      { id: 103, html_url: 'https://github.com/nodejs/node/issues/50963#issuecomment-103', user: { login: 'aduh95' }, created_at: '2026-01-04T00:00:00Z', body: 'Correct comment 103' },
    ];
    const commandRunner = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(' ');
      const isComments = command.includes('repos/nodejs/node/issues/50963/comments');
      if (isComments && args.includes('page=1')) {
        return { stdout: JSON.stringify(page1), stderr: '' };
      }
      if (isComments && args.includes('page=2')) {
        return { stdout: JSON.stringify(page2), stderr: '' };
      }
      if (command.includes('repos/nodejs/node/issues/50963/timeline')) {
        return { stdout: JSON.stringify([]), stderr: '' };
      }
      if (command.includes('repos/nodejs/node/issues/50963')) {
        return { stdout: JSON.stringify({
          id: 50963,
          number: 50963,
          html_url: 'https://github.com/nodejs/node/issues/50963',
          repository_url: 'https://api.github.com/repos/nodejs/node',
          title: 'enable corepack by default',
          user: { login: 'reporter' },
          state: 'closed',
          comments: 133,
          labels: [],
          body: 'Corepack issue body.',
        }), stderr: '' };
      }
      throw new Error(`unexpected gh command: ${command}`);
    });

    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      config: { github: { provider: 'gh' }, request: { timeoutMs: 120_000, maxRetries: 1 } },
      commandRunner,
    });

    const detailTool = pi.tools.find((entry) => entry.name === 'github_issue_get');
    const result = (await execute(detailTool!, { issue: 'nodejs/node#50963', commentsLimit: 5, commentsOffset: 98 })) as {
      content: Array<{ text: string }>;
    };

    expect(result.content[0]?.text).toContain('Comments offset 98 limit 5');
    expect(result.content[0]?.text).toContain('99. wesleytodd: Correct comment 99');
    expect(result.content[0]?.text).toContain('100. GeoffreyBooth: Correct comment 100');
    expect(result.content[0]?.text).toContain('101. mcollina: Correct comment 101');
    expect(result.content[0]?.text).toContain('102. GeoffreyBooth: Correct comment 102');
    expect(result.content[0]?.text).toContain('103. aduh95: Correct comment 103');
    expect(commandRunner).toHaveBeenCalledWith('gh', expect.arrayContaining(['-f', 'per_page=100', '-f', 'page=1']), expect.anything());
    expect(commandRunner).toHaveBeenCalledWith('gh', expect.arrayContaining(['-f', 'per_page=100', '-f', 'page=2']), expect.anything());
  });

  it('returns a clear recoverable error when gh is missing for the gh provider', async () => {
    const missingGh = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT', stderr: '' });
    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      config: { github: { provider: 'gh' }, request: { timeoutMs: 120_000, maxRetries: 1 } },
      commandRunner: vi.fn().mockRejectedValue(missingGh),
    });

    const tool = pi.tools.find((entry) => entry.name === 'search_github_issues');
    const result = (await execute(tool!, { repo: 'nodejs/node', query: 'fetch', limit: 1 })) as {
      isError?: boolean;
      details: { status: 'failure'; error: Record<string, unknown> };
    };

    expect(result.isError).toBe(true);
    expect(result.details.error).toMatchObject({
      provider: 'github',
      category: 'provider_unavailable',
      recoverable: true,
    });
    expect(String(result.details.error.message)).toContain('GitHub CLI (`gh`) is required');
  });

  it('github_issue_get returns full readable issue body and bounded comments with offset metadata', async () => {
    const getIssue = vi.fn().mockResolvedValue({
      id: 1,
      number: 10,
      html_url: 'https://github.com/nodejs/node/issues/10',
      repository_url: 'https://api.github.com/repos/nodejs/node',
      title: 'Fetch abort timeout behavior',
      user: { login: 'reporter' },
      state: 'closed',
      comments: 4,
      score: 2,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      closed_at: '2026-01-03T00:00:00Z',
      labels: [{ name: 'bug' }, { name: 'fetch' }],
      body: `${'Full issue body about fetch abort timeout. '.repeat(80)}final issue sentence should remain visible.`,
    });
    const listIssueComments = vi.fn().mockResolvedValue([{
      id: 100,
      html_url: 'https://github.com/nodejs/node/issues/10#issuecomment-100',
      user: { login: 'commenter' },
      created_at: '2026-01-04T00:00:00Z',
      updated_at: '2026-01-05T00:00:00Z',
      body: 'First returned comment after offset.',
    }]);
    const listIssueTimelineEvents = vi.fn().mockResolvedValue([{ event: 'cross-referenced', source: { issue: {
      number: 42,
      html_url: 'https://github.com/nodejs/node/pull/42',
      repository_url: 'https://api.github.com/repos/nodejs/node',
      title: 'Fix fetch abort behavior',
      state: 'closed',
      pull_request: { url: 'https://api.github.com/repos/nodejs/node/pulls/42' },
    } } }, { event: 'cross-referenced', source: { issue: {
      number: 43,
      html_url: 'https://github.com/nodejs/node/issues/43',
      repository_url: 'https://api.github.com/repos/nodejs/node',
      title: 'Related AbortSignal discussion',
      state: 'open',
    } } }]);

    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      createClients: () => ({
        stackExchange: {
          searchQuestions: vi.fn(),
          getQuestion: vi.fn(),
          getAnswers: vi.fn(),
          getQuestionComments: vi.fn(),
        },
        github: {
          searchIssues: vi.fn(),
          getIssue,
          listIssueComments,
          listIssueTimelineEvents,
          searchPullRequests: vi.fn().mockResolvedValue([]),
          getPullRequest: vi.fn(),
          listPullRequestReviewComments: vi.fn().mockResolvedValue([]),
          listPullRequestReviews: vi.fn().mockResolvedValue([]),
          listReleases: vi.fn().mockResolvedValue([]),
          getReleaseByTag: vi.fn(),
        },
        devto: {
          searchArticles: vi.fn(),
          getComments: vi.fn(),
        },
        hackerNews: {
          searchStories: vi.fn(),
          getStory: vi.fn(),
        },
      }),
    });

    const tool = pi.tools.find((entry) => entry.name === 'github_issue_get');
    const result = (await execute(tool!, { issue: 'nodejs/node#10', commentsLimit: 1, commentsOffset: 2 })) as {
      content: Array<{ type: 'text'; text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      platform: 'github',
      number: 10,
      repository: 'nodejs/node',
      follow_up_ref: 'nodejs/node#10',
      state: 'closed',
      comments_count: 4,
      labels: ['bug', 'fetch'],
      comments_limit: 1,
      comments_offset: 2,
      next_comments_offset: 3,
      related_pull_requests: [{ ref: 'nodejs/node#42', type: 'pull_request' }],
      related_issues: [{ ref: 'nodejs/node#43', type: 'issue' }],
      comments: [{
        id: '100',
        author: 'commenter',
        body: 'First returned comment after offset.',
      }],
    });
    expect(result.content[0]?.text).toContain('Fetch abort timeout behavior');
    expect(result.content[0]?.text).toContain('nodejs/node#10');
    expect(result.content[0]?.text).toContain('state: closed');
    expect(result.content[0]?.text).toContain('labels: bug, fetch');
    expect(result.content[0]?.text).toContain('Full issue body about fetch abort timeout.');
    expect(result.content[0]?.text).toContain('final issue sentence should remain visible.');
    expect(result.content[0]?.text).toContain('Related pull requests');
    expect(result.content[0]?.text).toContain('- nodejs/node#42 — Fix fetch abort behavior (closed)');
    expect(result.content[0]?.text).toContain('Related issues');
    expect(result.content[0]?.text).toContain('- nodejs/node#43 — Related AbortSignal discussion (open)');
    expect(result.content[0]?.text).toContain('Comments offset 2 limit 1');
    expect(result.content[0]?.text).toContain('3. commenter: First returned comment after offset.');
    expect(listIssueComments).toHaveBeenCalledWith(expect.objectContaining({ owner: 'nodejs', repo: 'node', issueNumber: 10, limit: 1, offset: 2 }), undefined);
    expect(listIssueTimelineEvents).toHaveBeenCalledWith(expect.objectContaining({ owner: 'nodejs', repo: 'node', issueNumber: 10 }), undefined);
  });
});
