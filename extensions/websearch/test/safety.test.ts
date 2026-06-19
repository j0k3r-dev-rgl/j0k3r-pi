import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute, response } from './helpers.js';

describe('websearch output safety', () => {
  it('redacts secret-like values across Stack Overflow content and details', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      items: [{
        question_id: 12345,
        link: 'https://stackoverflow.com/questions/12345/example',
        title: 'token=secret-value',
        owner: { display_name: 'dev' },
        creation_date: 1710000000,
        body_markdown: 'AWS key AKIA1234567890ABCDEF and password=hunter2',
      }],
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });
    const tool = pi.tools.find((entry) => entry.name === 'search_stack_overflow');
    const result = (await execute(tool!, { query: 'secrets' })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { items: Array<Record<string, unknown>> } };
    };

    expect(JSON.stringify(result)).toContain('[REDACTED_SECRET]');
    expect(JSON.stringify(result)).not.toContain('AKIA1234567890ABCDEF');
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(result.content[0]?.text).not.toContain('secret-value');
  });

  it('returns structured recoverable GitHub errors without echoing headers or tokens', async () => {
    const pi = createMockPi();
    const commandRunner = vi.fn().mockRejectedValue(Object.assign(new Error('provider failed token=secret-value'), {
      stderr: 'provider failed bearer ghp_secret_token token=secret-value',
    }));
    registerWebsearchTools(pi, {
      env: { GITHUB_TOKEN: 'ghp_secret_token' },
      fetch: vi.fn<typeof fetch>(),
      config: { github: { provider: 'gh' }, request: { timeoutMs: 120_000, maxRetries: 1 } },
      commandRunner,
    });

    const tool = pi.tools.find((entry) => entry.name === 'search_github_issues');
    expect(tool).toBeDefined();
    if (!tool) {
      return;
    }

    const result = (await execute(tool, { query: 'vitest' })) as {
      content: Array<{ text: string }>;
      details: { status: 'failure'; error: Record<string, unknown> } | { status: 'success'; data: unknown };
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({
      status: 'failure',
      error: {
        category: expect.stringMatching(/^(validation|rate_limit|quota_exhausted|auth|not_found|provider_unavailable|network|timeout|cancelled|provider_payload|unexpected)$/),
        provider: 'github',
        recoverable: expect.any(Boolean),
        message: expect.any(String),
      },
    });
    expect(JSON.stringify(result)).toContain('[REDACTED_SECRET]');
    expect(JSON.stringify(result)).not.toContain('ghp_secret_token');
    expect(JSON.stringify(result)).not.toContain('authorization');
  });

  it('maps generic timeout and abort failures into sanitized structured errors', async () => {
    const timeoutPi = createMockPi();
    registerWebsearchTools(timeoutPi, {
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
          searchIssues: vi.fn().mockRejectedValue(new Error('provider timeout token=secret-value')),
          getIssue: vi.fn(),
          listIssueComments: vi.fn(),
          listIssueTimelineEvents: vi.fn(),
          searchPullRequests: vi.fn(),
          getPullRequest: vi.fn(),
          listPullRequestReviewComments: vi.fn(),
          listPullRequestReviews: vi.fn(),
          listReleases: vi.fn(),
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

    const timeoutTool = timeoutPi.tools.find((entry) => entry.name === 'search_github_issues');
    const timeoutResult = (await execute(timeoutTool!, { query: 'vitest' })) as {
      details: { status: 'failure'; error: Record<string, unknown> };
      isError?: boolean;
    };

    expect(timeoutResult.isError).toBe(true);
    expect(timeoutResult.details).toMatchObject({
      status: 'failure',
      error: {
        code: 'timeout',
        category: 'timeout',
        message: 'provider timeout token=[REDACTED_SECRET]',
        recoverable: true,
      },
    });

    const abortPi = createMockPi();
    registerWebsearchTools(abortPi, {
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
          searchArticles: vi.fn().mockRejectedValue({ name: 'AbortError' }),
          getComments: vi.fn(),
        },
        hackerNews: {
          searchStories: vi.fn(),
          getStory: vi.fn(),
        },
      }),
    });

    const abortTool = abortPi.tools.find((entry) => entry.name === 'search_devto_articles');
    const abortResult = (await execute(abortTool!, { tag: 'typescript' })) as {
      details: { status: 'failure'; error: Record<string, unknown> };
      isError?: boolean;
    };

    expect(abortResult.isError).toBe(true);
    expect(abortResult.details).toMatchObject({
      status: 'failure',
      error: {
        code: 'cancelled',
        category: 'cancelled',
        message: 'Request was cancelled.',
        recoverable: true,
      },
    });
  });

  it('uses keyed and keyless GitHub clients, and returns compact normalized content/details for all new providers', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const createClients = vi.fn(() => ({
      stackExchange: {
        searchQuestions: vi.fn(),
        getQuestion: vi.fn(),
        getAnswers: vi.fn(),
        getQuestionComments: vi.fn(),
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
      },
      devto: {
        searchArticles: vi.fn().mockResolvedValue([]),
        getComments: vi.fn(),
      },
      hackerNews: {
        searchStories: vi.fn().mockResolvedValue([]),
        getStory: vi.fn(),
      },
    }));

    const keyedPi = createMockPi();
    registerWebsearchTools(keyedPi, { env: { GITHUB_TOKEN: 'ghp_keyed_token' }, fetch: fetchMock, createClients });
    const keylessPi = createMockPi();
    registerWebsearchTools(keylessPi, { env: {}, fetch: fetchMock, createClients });

    const keyedGitHubSearch = keyedPi.tools.find((entry) => entry.name === 'search_github_issues');
    const devtoSearch = keyedPi.tools.find((entry) => entry.name === 'search_devto_articles');
    const hnSearch = keyedPi.tools.find((entry) => entry.name === 'search_hackernews');

    expect(keyedGitHubSearch).toBeDefined();
    expect(devtoSearch).toBeDefined();
    expect(hnSearch).toBeDefined();
    if (!keyedGitHubSearch || !devtoSearch || !hnSearch) {
      return;
    }

    const githubResult = (await execute(keyedGitHubSearch, { query: 'vitest' })) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const devtoResult = (await execute(devtoSearch, { tag: 'typescript' })) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    const hnResult = (await execute(hnSearch, { query: 'typescript' })) as { content: Array<{ text: string }>; details: Record<string, unknown> };

    expect(createClients).toHaveBeenCalledTimes(3);
    expect(githubResult.content[0]?.text.length ?? 0).toBeLessThan(500);
    expect(devtoResult.content[0]?.text.length ?? 0).toBeLessThan(500);
    expect(hnResult.content[0]?.text.length ?? 0).toBeLessThan(500);
    expect(githubResult.details).toMatchObject({ status: 'success', data: expect.anything() });
    expect(devtoResult.details).toMatchObject({ status: 'success', data: expect.anything() });
    expect(hnResult.details).toMatchObject({ status: 'success', data: expect.anything() });
  });
});
