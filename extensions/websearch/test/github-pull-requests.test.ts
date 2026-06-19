import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute } from './helpers.js';

function baseClients(githubOverrides: Record<string, unknown>) {
  return {
    stackExchange: {
      searchQuestions: vi.fn(),
      getQuestion: vi.fn(),
      getAnswers: vi.fn(),
      getQuestionComments: vi.fn(),
    },
    github: {
      searchIssues: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn(),
      listIssueComments: vi.fn().mockResolvedValue([]),
      listIssueTimelineEvents: vi.fn().mockResolvedValue([]),
      searchPullRequests: vi.fn().mockResolvedValue([]),
      getPullRequest: vi.fn(),
      listPullRequestReviewComments: vi.fn().mockResolvedValue([]),
      listPullRequestReviews: vi.fn().mockResolvedValue([]),
      ...githubOverrides,
    },
    devto: {
      searchArticles: vi.fn(),
      getComments: vi.fn(),
    },
    hackerNews: {
      searchStories: vi.fn(),
      getStory: vi.fn(),
    },
  };
}

const relatedTimeline = [{ event: 'cross-referenced', source: { issue: {
  number: 50963,
  html_url: 'https://github.com/nodejs/node/issues/50963',
  repository_url: 'https://api.github.com/repos/nodejs/node',
  title: 'enable corepack by default',
  state: 'closed',
} } }, { event: 'cross-referenced', source: { issue: {
  number: 51994,
  html_url: 'https://github.com/nodejs/node/pull/51994',
  repository_url: 'https://api.github.com/repos/nodejs/node',
  title: 'doc: add policy for executables',
  state: 'closed',
  pull_request: { url: 'https://api.github.com/repos/nodejs/node/pulls/51994' },
} } }];

describe('github pull request tool behavior', () => {
  it('search_github_pull_requests returns compact PR metadata, merged state, snippets, and relations', async () => {
    const searchPullRequests = vi.fn().mockResolvedValue([{
      id: 1,
      number: 51918,
      html_url: 'https://github.com/nodejs/node/pull/51918',
      repository_url: 'https://api.github.com/repos/nodejs/node',
      title: 'doc: add policy for distribution',
      user: { login: 'GeoffreyBooth' },
      state: 'closed',
      comments: 18,
      labels: [{ name: 'doc' }, { name: 'npm' }],
      body: 'This PR records package manager policy consensus and links Corepack discussions.',
      pull_request: {
        html_url: 'https://github.com/nodejs/node/pull/51918',
        merged_at: '2024-03-03T02:15:14Z',
      },
    }]);
    const listIssueTimelineEvents = vi.fn().mockResolvedValue(relatedTimeline);
    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      createClients: () => baseClients({ searchPullRequests, listIssueTimelineEvents }),
    });

    const tool = pi.tools.find((entry) => entry.name === 'search_github_pull_requests');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { repo: 'nodejs/node', query: 'corepack packageManager', state: 'merged', limit: 1 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { items: Array<Record<string, unknown>>; state: string } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.state).toBe('merged');
    expect(result.details.data.items[0]).toMatchObject({
      platform: 'github',
      number: 51918,
      repository: 'nodejs/node',
      follow_up_ref: 'nodejs/node#51918',
      state: 'closed',
      merged: true,
      merged_at: '2024-03-03T02:15:14Z',
      comments_count: 18,
      labels: ['doc', 'npm'],
      related_issues: [{ ref: 'nodejs/node#50963' }],
      related_pull_requests: [{ ref: 'nodejs/node#51994' }],
    });
    expect(result.content[0]?.text).toContain('1. doc: add policy for distribution — nodejs/node#51918');
    expect(result.content[0]?.text).toContain('merged: true');
    expect(result.content[0]?.text).toContain('merged_at: 2024-03-03T02:15:14Z');
    expect(result.content[0]?.text).toContain('related issues: nodejs/node#50963 (closed)');
    expect(result.content[0]?.text).toContain('related PRs: nodejs/node#51994 (closed)');
    expect(searchPullRequests).toHaveBeenCalledWith({ repo: 'nodejs/node', query: 'corepack packageManager', state: 'merged', limit: 1 }, undefined);
    expect(listIssueTimelineEvents).toHaveBeenCalledWith(expect.objectContaining({ owner: 'nodejs', repo: 'node', issueNumber: 51918 }), undefined);
  });

  it('github_pull_request_get returns full PR detail, comments, review comments, reviews, and relations', async () => {
    const getPullRequest = vi.fn().mockResolvedValue({
      id: 1,
      number: 51918,
      html_url: 'https://github.com/nodejs/node/pull/51918',
      repository_url: 'https://api.github.com/repos/nodejs/node',
      title: 'doc: add policy for distribution',
      user: { login: 'GeoffreyBooth' },
      state: 'closed',
      merged: true,
      merged_at: '2024-03-03T02:15:14Z',
      comments: 18,
      review_comments: 37,
      commits: 8,
      changed_files: 1,
      additions: 27,
      deletions: 0,
      base: { ref: 'main', repo: { full_name: 'nodejs/node' } },
      head: { ref: 'package-manager-policy', repo: { full_name: 'GeoffreyBooth/node' } },
      labels: [{ name: 'doc' }, { name: 'npm' }],
      body: 'Full PR body describing Corepack package manager policy.',
    });
    const listIssueComments = vi.fn().mockResolvedValue([{ id: 1972198772, html_url: 'https://github.com/nodejs/node/pull/51918#issuecomment-1972198772', user: { login: 'GeoffreyBooth' }, created_at: '2024-03-01T00:19:38Z', body: 'Conversation comment from PR.' }]);
    const listPullRequestReviewComments = vi.fn().mockResolvedValue([{ id: 1506824294, html_url: 'https://github.com/nodejs/node/pull/51918#discussion_r1506824294', user: { login: 'aduh95' }, path: 'doc/contributing/distribution.md', commit_id: 'abc123', created_at: '2024-02-29T00:09:44Z', body: 'Review comment on changed line.' }]);
    const listPullRequestReviews = vi.fn().mockResolvedValue([{ id: 1907684220, html_url: 'https://github.com/nodejs/node/pull/51918#pullrequestreview-1907684220', user: { login: 'darcyclarke' }, state: 'APPROVED', submitted_at: '2024-03-01T00:00:00Z', body: 'LGTM' }]);
    const listIssueTimelineEvents = vi.fn().mockResolvedValue(relatedTimeline);
    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      createClients: () => baseClients({ getPullRequest, listIssueComments, listPullRequestReviewComments, listPullRequestReviews, listIssueTimelineEvents }),
    });

    const tool = pi.tools.find((entry) => entry.name === 'github_pull_request_get');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { pull_request: 'nodejs/node#51918', commentsLimit: 1, commentsOffset: 0, reviewCommentsLimit: 1, reviewCommentsOffset: 0 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      platform: 'github',
      number: 51918,
      repository: 'nodejs/node',
      follow_up_ref: 'nodejs/node#51918',
      merged: true,
      merged_at: '2024-03-03T02:15:14Z',
      review_comments_count: 37,
      commits_count: 8,
      changed_files_count: 1,
      base_ref: 'main',
      head_ref: 'package-manager-policy',
      comments: [{ author: 'GeoffreyBooth', body: 'Conversation comment from PR.' }],
      review_comments: [{ author: 'aduh95', path: 'doc/contributing/distribution.md', body: 'Review comment on changed line.' }],
      reviews: [{ author: 'darcyclarke', state: 'APPROVED', body: 'LGTM' }],
      related_issues: [{ ref: 'nodejs/node#50963' }],
      related_pull_requests: [{ ref: 'nodejs/node#51994' }],
    });
    expect(result.content[0]?.text).toContain('doc: add policy for distribution');
    expect(result.content[0]?.text).toContain('merged: true');
    expect(result.content[0]?.text).toContain('base: nodejs/node:main');
    expect(result.content[0]?.text).toContain('head: GeoffreyBooth/node:package-manager-policy');
    expect(result.content[0]?.text).toContain('Related issues');
    expect(result.content[0]?.text).toContain('- nodejs/node#50963 — enable corepack by default (closed)');
    expect(result.content[0]?.text).toContain('Reviews');
    expect(result.content[0]?.text).toContain('- darcyclarke APPROVED: LGTM');
    expect(result.content[0]?.text).toContain('Comments offset 0 limit 1');
    expect(result.content[0]?.text).toContain('1. GeoffreyBooth: Conversation comment from PR.');
    expect(result.content[0]?.text).toContain('Review comments offset 0 limit 1');
    expect(result.content[0]?.text).toContain('1. aduh95 on doc/contributing/distribution.md: Review comment on changed line.');
    expect(getPullRequest).toHaveBeenCalledWith(expect.objectContaining({ owner: 'nodejs', repo: 'node', pullNumber: 51918 }), undefined);
    expect(listIssueComments).toHaveBeenCalledWith(expect.objectContaining({ owner: 'nodejs', repo: 'node', issueNumber: 51918, limit: 1, offset: 0 }), undefined);
    expect(listPullRequestReviewComments).toHaveBeenCalledWith(expect.objectContaining({ owner: 'nodejs', repo: 'node', pullNumber: 51918, limit: 1, offset: 0 }), undefined);
  });

  it('uses gh api search with is:merged for merged PR searches', async () => {
    const commandRunner = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('search/issues')) {
        return { stdout: JSON.stringify({ items: [] }), stderr: '' };
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

    const tool = pi.tools.find((entry) => entry.name === 'search_github_pull_requests');
    await execute(tool!, { repo: 'nodejs/node', query: 'corepack packageManager', state: 'merged', limit: 5 });

    const ghArgs = commandRunner.mock.calls[0]?.[1] ?? [];
    expect(ghArgs).toContain('q=corepack packageManager is:pr repo:nodejs/node is:merged');
    expect(ghArgs.join(' ')).not.toContain('state:merged');
  });

  it('uses gh api endpoints for pull request detail, comments, review comments, reviews, and timeline', async () => {
    const commandRunner = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('repos/nodejs/node/pulls/51918/comments')) {
        return { stdout: JSON.stringify([{ id: 1506824294, html_url: 'https://github.com/nodejs/node/pull/51918#discussion_r1506824294', user: { login: 'aduh95' }, path: 'doc/contributing/distribution.md', body: 'Review comment from gh api.' }]), stderr: '' };
      }
      if (command.includes('repos/nodejs/node/pulls/51918/reviews')) {
        return { stdout: JSON.stringify([{ id: 1907684220, html_url: 'https://github.com/nodejs/node/pull/51918#pullrequestreview-1907684220', user: { login: 'darcyclarke' }, state: 'APPROVED', body: 'Approved from gh api.' }]), stderr: '' };
      }
      if (command.includes('repos/nodejs/node/issues/51918/comments')) {
        return { stdout: JSON.stringify([{ id: 1972198772, html_url: 'https://github.com/nodejs/node/pull/51918#issuecomment-1972198772', user: { login: 'GeoffreyBooth' }, body: 'Conversation comment from gh api.' }]), stderr: '' };
      }
      if (command.includes('repos/nodejs/node/issues/51918/timeline')) {
        return { stdout: JSON.stringify(relatedTimeline), stderr: '' };
      }
      if (command.includes('repos/nodejs/node/pulls/51918')) {
        return { stdout: JSON.stringify({
          id: 1,
          number: 51918,
          html_url: 'https://github.com/nodejs/node/pull/51918',
          repository_url: 'https://api.github.com/repos/nodejs/node',
          title: 'doc: add policy for distribution',
          state: 'closed',
          merged: true,
          merged_at: '2024-03-03T02:15:14Z',
          comments: 18,
          review_comments: 37,
          commits: 8,
          changed_files: 1,
          base: { ref: 'main', repo: { full_name: 'nodejs/node' } },
          head: { ref: 'package-manager-policy', repo: { full_name: 'GeoffreyBooth/node' } },
          body: 'Full PR body from gh api.',
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

    const tool = pi.tools.find((entry) => entry.name === 'github_pull_request_get');
    const result = (await execute(tool!, { pull_request: 'nodejs/node#51918', commentsLimit: 1, commentsOffset: 0, reviewCommentsLimit: 1, reviewCommentsOffset: 0 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.content[0]?.text).toContain('Full PR body from gh api.');
    expect(result.content[0]?.text).toContain('Conversation comment from gh api.');
    expect(result.content[0]?.text).toContain('Review comment from gh api.');
    expect(result.content[0]?.text).toContain('Approved from gh api.');
    const commands = commandRunner.mock.calls.map((call) => call[1].join(' ')).join('\n');
    expect(commands).toContain('repos/nodejs/node/pulls/51918');
    expect(commands).toContain('repos/nodejs/node/issues/51918/comments');
    expect(commands).toContain('repos/nodejs/node/pulls/51918/comments');
    expect(commands).toContain('repos/nodejs/node/pulls/51918/reviews');
    expect(commands).toContain('repos/nodejs/node/issues/51918/timeline');
  });

});
