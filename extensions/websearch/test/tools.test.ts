import { describe, expect, it, vi } from 'vitest';
import * as validation from '../src/validation.js';
import { registerWebsearchTools, WEBSEARCH_TOOL_NAMES } from '../src/tools.js';

type Tool = {
  name: string;
  description: string;
  parameters: { type: string; [key: string]: unknown };
  execute: (...args: unknown[]) => Promise<unknown> | unknown;
};

type MockPi = {
  tools: Tool[];
  registerTool: (tool: Tool) => void;
};

function createMockPi(): MockPi {
  const tools: Tool[] = [];
  return {
    tools,
    registerTool(tool: Tool) {
      tools.push(tool);
    },
  };
}

async function execute(tool: Tool, params: Record<string, unknown>) {
  return tool.execute('id', params, undefined, undefined, {});
}

function response(jsonBody: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(jsonBody), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

describe('websearch stack overflow validation', () => {
  it('applies search/question/answers defaults and bounds', () => {
    expect(validation.validateStackOverflowSearch({ query: 'TypeScript fetch' })).toEqual({
      query: 'TypeScript fetch',
      limit: 5,
    });

    expect(validation.validateStackOverflowQuestionRef({ question: 'https://stackoverflow.com/questions/12345/example' })).toEqual({
      questionId: '12345',
      url: 'https://stackoverflow.com/questions/12345/example',
    });

    expect(validation.validateStackOverflowAnswers({ question: '12345' })).toEqual({
      questionId: '12345',
      url: 'https://stackoverflow.com/questions/12345',
      limit: 10,
    });

    expect((validation as Record<string, any>).validateStackOverflowComments({ question: '12345', commentsLimit: 3, commentsOffset: 6 })).toEqual({
      questionId: '12345',
      url: 'https://stackoverflow.com/questions/12345',
      commentsLimit: 3,
      commentsOffset: 6,
    });

    expect(() => validation.validateStackOverflowSearch({ query: 'oops', limit: 11 })).toThrow(/at most 10/i);
    expect(() => validation.validateStackOverflowAnswers({ question: '12345', limit: 31 })).toThrow(/at most 30/i);
    expect(() => (validation as Record<string, any>).validateStackOverflowComments({ question: '12345', commentsLimit: 31 })).toThrow(/at most 30/i);
  });
});

describe('websearch community-platform validation contracts', () => {
  it('exports shared search defaults and platform-specific comment bounds', () => {
    const contracts = validation as Record<string, unknown>;

    expect(contracts.SEARCH_DEFAULT_LIMIT).toBe(5);
    expect(contracts.SEARCH_MAX_LIMIT).toBe(10);
    expect(contracts.GITHUB_COMMENTS_DEFAULT_LIMIT).toBe(5);
    expect(contracts.GITHUB_COMMENTS_MAX_LIMIT).toBe(20);
    expect(contracts.DEVTO_TOP_LEVEL_COMMENTS_DEFAULT_LIMIT).toBe(10);
    expect(contracts.DEVTO_TOTAL_COMMENTS_MAX).toBe(25);
    expect(contracts.DEVTO_MAX_DEPTH).toBe(2);
    expect(contracts.HN_COMMENTS_DEFAULT_LIMIT).toBe(10);
    expect(contracts.HN_COMMENTS_MAX_LIMIT).toBe(25);
    expect(contracts.HN_MAX_DEPTH).toBe(3);
  });

  it('parses GitHub issue references from URLs and owner/repo#number refs', () => {
    const validateGitHubIssueRef = (validation as Record<string, unknown>).validateGitHubIssueRef as
      | ((value: unknown) => unknown)
      | undefined;

    expect(validateGitHubIssueRef).toBeTypeOf('function');
    expect(validateGitHubIssueRef?.({ issue: 'https://github.com/octo/widgets/issues/42' })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      issueNumber: 42,
      url: 'https://github.com/octo/widgets/issues/42',
    });
    expect(validateGitHubIssueRef?.({ issue: 'octo/widgets#42' })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      issueNumber: 42,
      url: 'https://github.com/octo/widgets/issues/42',
    });
  });

  it('defaults and caps search/detail requests for GitHub, Dev.to, and Hacker News', () => {
    const contracts = validation as Record<string, unknown>;
    const validateGitHubIssueSearch = contracts.validateGitHubIssueSearch as ((value: unknown) => unknown) | undefined;
    const validateGitHubIssueGet = contracts.validateGitHubIssueGet as ((value: unknown) => unknown) | undefined;
    const validateDevtoArticleSearch = contracts.validateDevtoArticleSearch as ((value: unknown) => unknown) | undefined;
    const validateDevtoCommentsGet = contracts.validateDevtoCommentsGet as ((value: unknown) => unknown) | undefined;
    const validateHackerNewsSearch = contracts.validateHackerNewsSearch as ((value: unknown) => unknown) | undefined;
    const validateHackerNewsStoryGet = contracts.validateHackerNewsStoryGet as ((value: unknown) => unknown) | undefined;

    expect(validateGitHubIssueSearch).toBeTypeOf('function');
    expect(validateGitHubIssueGet).toBeTypeOf('function');
    expect(validateDevtoArticleSearch).toBeTypeOf('function');
    expect(validateDevtoCommentsGet).toBeTypeOf('function');
    expect(validateHackerNewsSearch).toBeTypeOf('function');
    expect(validateHackerNewsStoryGet).toBeTypeOf('function');

    expect(validateGitHubIssueSearch?.({ query: 'vitest repo:octo/widgets' })).toEqual({
      query: 'vitest repo:octo/widgets',
      limit: 5,
    });
    expect(validateGitHubIssueSearch?.({ query: 'vitest', repo: 'octo/widgets', state: 'all' })).toEqual({
      query: 'vitest',
      repo: 'octo/widgets',
      state: 'all',
      limit: 5,
    });
    expect(() => validateGitHubIssueSearch?.({ query: 'vitest', repo: 'octo' })).toThrow(/repo must be an owner\/repo reference/i);
    expect(validateDevtoArticleSearch?.({ tag: 'typescript' })).toEqual({
      tag: 'typescript',
      limit: 5,
    });
    expect(validateHackerNewsSearch?.({ query: 'typescript' })).toEqual({
      query: 'typescript',
      limit: 5,
    });
    expect(validateGitHubIssueGet?.({ issue: 'octo/widgets#42', commentsLimit: 3, commentsOffset: 6 })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      issueNumber: 42,
      url: 'https://github.com/octo/widgets/issues/42',
      commentsLimit: 3,
      commentsOffset: 6,
    });
    expect(validateDevtoCommentsGet?.({ article_id: 1234, topLevelLimit: 2, topLevelOffset: 4 })).toEqual({
      articleId: 1234,
      topLevelLimit: 2,
      topLevelOffset: 4,
      totalLimit: 25,
      maxDepth: 2,
    });
    expect(validateHackerNewsStoryGet?.({ story_id: 9876, commentsLimit: 2, commentsOffset: 4 })).toEqual({
      storyId: 9876,
      commentsLimit: 2,
      commentsOffset: 4,
      maxDepth: 3,
    });

    expect(() => validateGitHubIssueSearch?.({ query: 'oops', limit: 11 })).toThrow(/at most 10/i);
    expect(() => validateGitHubIssueGet?.({ issue: 'octo/widgets#42', commentsLimit: 21 })).toThrow(/at most 20/i);
    expect(() => validateDevtoCommentsGet?.({ article_id: 1234, topLevelLimit: 26 })).toThrow(/at most 25/i);
    expect(() => validateHackerNewsStoryGet?.({ story_id: 9876, commentsLimit: 26 })).toThrow(/at most 25/i);
  });
});

describe('websearch tool registration', () => {
  it('registers the exact nine-tool inventory without excluded-provider tools', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi);

    expect(WEBSEARCH_TOOL_NAMES).toEqual([
      'search_stack_overflow',
      'stack_overflow_question_get',
      'stack_overflow_answers_get',
      'stack_overflow_comments_get',
      'search_github_issues',
      'github_issue_get',
      'search_devto_articles',
      'devto_comments_get',
      'search_hackernews',
      'hackernews_story_get',
    ]);
    expect(pi.tools.map((tool) => tool.name)).toEqual(WEBSEARCH_TOOL_NAMES);
    expect(pi.tools).toHaveLength(10);
    const excludedProviderPattern = new RegExp(`red${'dit'}`, 'i');
    expect(pi.tools.map((tool) => tool.name).join(' ')).not.toMatch(excludedProviderPattern);

    for (const tool of pi.tools) {
      expect(tool.parameters.type).toBe('object');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.execute).toBe('function');
    }
  });
});

describe('stack overflow tool behavior', () => {
  it('search_stack_overflow uses the public Stack Exchange API with optional key and normalizes results', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      items: [{
        question_id: 12345,
        link: 'https://stackoverflow.com/questions/12345/example',
        title: 'How to test fetch?',
        score: 7,
        answer_count: 2,
        is_answered: true,
        view_count: 123,
        tags: ['typescript', 'fetch'],
        owner: { display_name: 'dev' },
        creation_date: 1710000000,
        last_activity_date: 1710000300,
        body: `<p>${'Question body with enough semantic detail about fetch timeouts under concurrency. '.repeat(8)}</p>`,
      }, {
        question_id: 67890,
        link: 'https://stackoverflow.com/questions/67890/example-two',
        title: 'How to return from a Promise&#39;s catch/then block with &quot;quotes&quot;?',
        score: 11,
        answer_count: 4,
        is_answered: true,
        view_count: 456,
        tags: ['javascript', 'promise'],
        owner: { display_name: 'async dev' },
        creation_date: 1710000500,
        last_activity_date: 1710000600,
        body: `<p>${'Second result semantic snippet about Promise error handling. '.repeat(6)}</p>`,
      }],
      quota_remaining: 99,
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: { STACK_EXCHANGE_KEY: 'so-key' }, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'search_stack_overflow');
    const result = (await execute(tool!, { query: 'test fetch' })) as {
      content: Array<{ type: 'text'; text: string }>;
      details: { status: 'success'; data: { items: Array<Record<string, unknown>>; limit: number } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.limit).toBe(5);
    expect(result.details.data.items[0]).toMatchObject({
      platform: 'stack_overflow',
      id: '12345',
      question_id: '12345',
      url: 'https://stackoverflow.com/questions/12345/example',
      title: 'How to test fetch?',
      score: 7,
      answer_count: 2,
      is_answered: true,
      view_count: 123,
      tags: ['typescript', 'fetch'],
      author: 'dev',
      created_at: '2024-03-09T16:00:00.000Z',
      last_activity_at: '2024-03-09T16:05:00.000Z',
      snippet: expect.stringContaining('Question body with enough semantic detail about fetch timeouts under concurrency.'),
      availability: { status: 'available' },
    });
    expect(result.content[0]?.text).toContain('snippet: Question body with enough semantic detail about fetch timeouts under concurrency.');
    expect(result.content[0]?.text).toContain('question_id: 12345');
    expect(result.content[0]?.text).toContain('score: 7');
    expect(result.content[0]?.text).toContain('answers: 2');
    expect(result.content[0]?.text).toContain('answered: yes');
    expect(result.content[0]?.text).toContain('tags: typescript, fetch');
    expect(result.content[0]?.text).toContain('How to test fetch?');
    expect(result.details.data.items[1]).toMatchObject({
      title: 'How to return from a Promise\'s catch/then block with "quotes"?',
    });
    expect(result.content[0]?.text).toContain('2. How to return from a Promise\'s catch/then block with "quotes"?');
    expect(result.content[0]?.text).not.toContain('&#39;');
    expect(result.content[0]?.text).not.toContain('&quot;');
    expect(result.content[0]?.text).toContain('question_id: 67890');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('https://api.stackexchange.com/2.3/search/advanced');
    expect(url).toContain('site=stackoverflow');
    expect(url).toContain('pagesize=5');
    expect(url).toContain('filter=withbody');
    expect(url).toContain('key=so-key');
  });

  it('stack_overflow_question_get requests a body-capable filter and returns body content', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      items: [{
        question_id: 12345,
        accepted_answer_id: 456,
        link: 'https://stackoverflow.com/questions/12345/example',
        title: 'Question detail',
        score: 3,
        answer_count: 1,
        is_answered: true,
        tags: ['node.js'],
        owner: { display_name: 'asker' },
        creation_date: 1710000000,
        body: `<p>${'Full question body with semantic details about AbortController timeouts. '.repeat(12)}final sentence should remain visible.</p>`,
      }],
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'stack_overflow_question_get');
    const result = (await execute(tool!, { question: 'https://stackoverflow.com/questions/12345/example' })) as {
      content: Array<{ type: 'text'; text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      id: '12345',
      body: `${'Full question body with semantic details about AbortController timeouts. '.repeat(12)}final sentence should remain visible.`,
      accepted_answer_id: '456',
      follow_up: {
        answers_tool: 'stack_overflow_answers_get',
        answers_ref: '12345',
        comments_tool: 'stack_overflow_comments_get',
        comments_ref: '12345',
      },
      availability: { status: 'available' },
    });
    expect(result.content[0]?.text).toContain('Question detail');
    expect(result.content[0]?.text).toContain('question_id: 12345');
    expect(result.content[0]?.text).toContain('accepted_answer_id: 456');
    expect(result.content[0]?.text).toContain('use stack_overflow_answers_get with question: 12345');
    expect(result.content[0]?.text).toContain('use stack_overflow_comments_get with question: 12345');
    expect(result.content[0]?.text).toContain('Full question body with semantic details about AbortController timeouts.');
    expect(result.content[0]?.text).toContain('final sentence should remain visible.');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('/questions/12345');
    expect(url).toContain('filter=');
  });

  it('stack_overflow_answers_get defaults to ten answers, preserves accepted metadata, and maps backoff/quota', async () => {
    const successFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      items: [{
        answer_id: 456,
        question_id: 12345,
        link: 'https://stackoverflow.com/a/456',
        score: 12,
        is_accepted: true,
        owner: { display_name: 'answerer' },
        creation_date: 1710000100,
        body: `<p>${'Answer body with concurrency guidance and retry advice. '.repeat(120)}don&#39;t truncate this final answer sentence.</p>`,
      }],
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: successFetch });
    const tool = pi.tools.find((entry) => entry.name === 'stack_overflow_answers_get');
    const result = (await execute(tool!, { question: '12345' })) as {
      content: Array<{ type: 'text'; text: string }>;
      details: { status: 'success'; data: { limit: number; answers: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.limit).toBe(10);
    expect(result.details.data.answers[0]).toMatchObject({
      id: '456',
      answer_id: '456',
      question_id: '12345',
      accepted: true,
      body: `${'Answer body with concurrency guidance and retry advice. '.repeat(120)}don't truncate this final answer sentence.`,
    });
    expect(result.content[0]?.text).toContain('[accepted]');
    expect(result.content[0]?.text).toContain('Answer body with concurrency guidance and retry advice.');
    expect(result.content[0]?.text).toContain("don't truncate this final answer sentence.");
    expect(result.content[0]?.text).not.toContain('<p>');
    expect(successFetch.mock.calls[0]?.[0].toString()).toContain('/questions/12345/answers');
    expect(successFetch.mock.calls[0]?.[0].toString()).toContain('pagesize=10');

    const backoffFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      backoff: 9,
      error_id: 502,
      error_name: 'throttle_violation',
      error_message: 'slow down',
      items: [],
    }));
    const backoffPi = createMockPi();
    registerWebsearchTools(backoffPi, { env: {}, fetch: backoffFetch });
    const backoffTool = backoffPi.tools.find((entry) => entry.name === 'stack_overflow_answers_get');
    const backoffResult = (await execute(backoffTool!, { question: '12345' })) as {
      details: { status: 'failure'; error: { code: string; provider?: string; backoff_seconds?: number } };
      isError?: boolean;
    };

    expect(backoffResult.details.status).toBe('failure');
    expect(backoffResult.details.error).toMatchObject({
      code: 'rate_limited',
      provider: 'stack_overflow',
      backoff_seconds: 9,
    });
    expect(backoffResult.isError).toBe(true);

    const quotaFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      quota_remaining: 0,
      items: [],
    }));
    const quotaPi = createMockPi();
    registerWebsearchTools(quotaPi, { env: {}, fetch: quotaFetch });
    const quotaTool = quotaPi.tools.find((entry) => entry.name === 'stack_overflow_answers_get');
    const quotaResult = (await execute(quotaTool!, { question: '12345' })) as {
      details: { status: 'failure'; error: { code: string; provider?: string; recoverable: boolean } };
      isError?: boolean;
    };

    expect(quotaResult.details.status).toBe('failure');
    expect(quotaResult.details.error).toMatchObject({
      code: 'quota_exhausted',
      provider: 'stack_overflow',
      recoverable: true,
    });
    expect(quotaResult.isError).toBe(true);
  });

  it('stack_overflow_comments_get returns bounded readable comments with offset metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      items: [{
        comment_id: 999,
        post_id: 12345,
        score: 4,
        owner: { display_name: 'Jonas K&#246;lker' },
        creation_date: 1710000200,
        body: '<p>Comment body with <code>inline code</code>, don&#39;t lose entities, use links with &hellip;, and semantic context.</p>',
      }],
      has_more: true,
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });
    const tool = pi.tools.find((entry) => entry.name === 'stack_overflow_comments_get');
    const result = (await execute(tool!, { question: '12345', commentsLimit: 1, commentsOffset: 2 })) as {
      content: Array<{ type: 'text'; text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      platform: 'stack_overflow',
      question_id: '12345',
      comments_limit: 1,
      comments_offset: 2,
      has_more_comments: true,
      next_comments_offset: 3,
      comments: [{
        id: '999',
        comment_id: '999',
        post_id: '12345',
        score: 4,
        author: 'Jonas Kölker',
        created_at: '2024-03-09T16:03:20.000Z',
        body: "Comment body with inline code, don't lose entities, use links with …, and semantic context.",
      }],
    });
    expect(result.content[0]?.text).toContain('Stack Overflow comments for question 12345');
    expect(result.content[0]?.text).toContain("3. Jonas Kölker: Comment body with inline code, don't lose entities, use links with …, and semantic context.");
    expect(result.content[0]?.text).not.toContain('&hellip;');
    expect(result.content[0]?.text).toContain('next_comments_offset: 3');
    expect(result.content[0]?.text).not.toContain('<p>');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('/questions/12345/comments');
    expect(url).toContain('pagesize=1');
    expect(url).toContain('page=3');
    expect(url).toContain('filter=withbody');
  });
});

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
      config: { github: { provider: 'api' } },
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
      config: { github: { provider: 'gh' } },
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
      config: { github: { provider: 'gh' } },
      commandRunner,
    });

    const searchTool = pi.tools.find((entry) => entry.name === 'search_github_issues');
    const searchResult = (await execute(searchTool!, { repo: 'nodejs/node', query: 'fetch abort timeout', state: 'closed', limit: 1 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { items: Array<Record<string, unknown>> } };
    };
    expect(searchResult.details.status).toBe('success');
    expect(searchResult.content[0]?.text).toContain('nodejs/node#10');

    const detailTool = pi.tools.find((entry) => entry.name === 'github_issue_get');
    const detailResult = (await execute(detailTool!, { issue: 'nodejs/node#10', commentsLimit: 1, commentsOffset: 0 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };
    expect(detailResult.details.status).toBe('success');
    expect(detailResult.content[0]?.text).toContain('Full issue body from gh api.');
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
      config: { github: { provider: 'gh' } },
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
      config: { github: { provider: 'gh' } },
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
    expect(result.content[0]?.text).toContain('Comments offset 2 limit 1');
    expect(result.content[0]?.text).toContain('3. commenter: First returned comment after offset.');
    expect(listIssueComments).toHaveBeenCalledWith(expect.objectContaining({ owner: 'nodejs', repo: 'node', issueNumber: 10, limit: 1, offset: 2 }), undefined);
  });
});

describe('dev.to tool behavior', () => {
  it('search_devto_articles uses the public Forem API tag search and normalizes bounded results', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response([
      {
        id: 321,
        title: 'TypeScript token=secret-value',
        description: `${'Learn with AKIA1234567890ABCDEF and enough semantic context. '.repeat(6)}`,
        url: 'https://dev.to/dev/typescript-post-321',
        published_at: '2026-06-19T00:00:00Z',
        tag_list: ['typescript', 'testing'],
        public_reactions_count: 42,
        comments_count: 7,
        reading_time_minutes: 5,
        user: { name: 'dev author' },
      },
      {
        id: 654,
        title: 'Second JavaScript article',
        description: 'Second article semantic description.',
        url: 'https://dev.to/dev/second-javascript-article-654',
        published_at: '2026-06-19T01:00:00Z',
        tag_list: ['javascript', 'webdev'],
        public_reactions_count: 3,
        comments_count: 1,
        reading_time_minutes: 2,
        user: { username: 'second-dev' },
      },
    ]));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'search_devto_articles');
    const result = (await execute(tool!, { tag: 'typescript' })) as {
      content: Array<{ type: 'text'; text: string }>;
      details: { status: 'success'; data: { tag: string; limit: number; items: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({ tag: 'typescript', limit: 5 });
    expect(result.details.data.items[0]).toMatchObject({
      platform: 'devto',
      id: '321',
      article_id: 321,
      url: 'https://dev.to/dev/typescript-post-321',
      author: 'dev author',
      published_at: '2026-06-19T00:00:00Z',
      tags: ['typescript', 'testing'],
      reactions_count: 42,
      comments_count: 7,
      reading_time_minutes: 5,
      follow_up_article_id: 321,
    });
    expect(JSON.stringify(result)).toContain('[REDACTED_SECRET]');
    expect(JSON.stringify(result)).not.toContain('AKIA1234567890ABCDEF');
    expect(result.content[0]?.text).toContain('1. TypeScript token=[REDACTED_SECRET] — article_id: 321');
    expect(result.content[0]?.text).toContain('author: dev author');
    expect(result.content[0]?.text).toContain('reactions: 42');
    expect(result.content[0]?.text).toContain('comments: 7');
    expect(result.content[0]?.text).toContain('reading: 5 min');
    expect(result.content[0]?.text).toContain('tags: typescript, testing');
    expect(result.content[0]?.text).toContain('snippet: Learn with [REDACTED_SECRET] and enough semantic context.');
    expect(result.content[0]?.text).toContain('2. Second JavaScript article — article_id: 654');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('https://dev.to/api/articles');
    expect(url).toContain('tag=typescript');
    expect(url).toContain('per_page=5');
  });

  it('devto_comments_get bounds top-level comments and nested depth', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response([
      {
        id_code: 'c1',
        created_at: '2026-06-19T00:00:00Z',
        body_markdown: 'root comment',
        user: { name: 'root' },
        children: [
          {
            id_code: 'c1-1',
            created_at: '2026-06-19T00:01:00Z',
            body_html: '<p>child <strong>comment</strong></p>',
            user: { name: 'child' },
            children: [
              {
                id_code: 'c1-1-1',
                created_at: '2026-06-19T00:02:00Z',
                body_markdown: 'too deep comment',
                user: { name: 'too-deep' },
                children: [],
              },
            ],
          },
        ],
      },
      {
        id_code: 'c2',
        created_at: '2026-06-19T00:03:00Z',
        body_html: '<p>second root with &hellip;</p>',
        user: { name: 'root-2' },
        children: [],
      },
    ]));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'devto_comments_get');
    const result = (await execute(tool!, { article_id: 99, topLevelLimit: 1, topLevelOffset: 1 })) as {
      content: Array<{ type: 'text'; text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      platform: 'devto',
      article_id: 99,
      top_level_limit: 1,
      top_level_offset: 1,
      total_limit: 25,
      max_depth: 2,
      has_more_top_level_comments: false,
      bounds: {
        returned_top_level_comments: 1,
        returned_total_nodes: 1,
        truncated_by_depth: false,
      },
    });
    const comments = (result.details.data.comments as Array<Record<string, unknown>>);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: 'c2',
      author: 'root-2',
      body: 'second root with …',
      children: [],
    });
    expect(result.content[0]?.text).toContain('Dev.to comments for article 99');
    expect(result.content[0]?.text).toContain('2. root-2: second root with …');
    expect(result.content[0]?.text).toContain('top_level_offset: 1');
    expect(result.content[0]?.text).not.toContain('<p>');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('https://dev.to/api/comments');
    expect(url).toContain('a_id=99');
  });

  it('maps Dev.to provider failures to structured errors without raw payload echo', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('rate limited token=secret-value', {
      status: 429,
      headers: { 'retry-after': '12', 'x-request-id': 'req-secret' },
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });
    const tool = pi.tools.find((entry) => entry.name === 'search_devto_articles');
    const result = (await execute(tool!, { tag: 'typescript' })) as {
      details: { status: 'failure'; error: Record<string, unknown> };
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({
      status: 'failure',
      error: {
        provider: 'devto',
        category: 'rate_limit',
        retry_after_seconds: 12,
        recoverable: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });
});

describe('hacker news tool behavior', () => {
  it('search_hackernews uses the Algolia story search API and normalizes bounded results', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      hits: [{
        objectID: '123',
        title: 'Show HN token=secret-value',
        author: 'pg',
        created_at: '2026-06-19T00:00:00Z',
        points: 99,
        num_comments: 12,
        story_text: 'Body with AKIA1234567890ABCDEF',
        url: 'https://example.com/hn-story',
      }],
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'search_hackernews');
    const result = (await execute(tool!, { query: 'typescript' })) as {
      content: Array<{ type: 'text'; text: string }>;
      details: { status: 'success'; data: { query: string; limit: number; items: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({ query: 'typescript', limit: 5 });
    expect(result.details.data.items[0]).toMatchObject({
      platform: 'hacker_news',
      id: '123',
      url: 'https://example.com/hn-story',
      title: 'Show HN token=[REDACTED_SECRET]',
      author: 'pg',
      created_at: '2026-06-19T00:00:00Z',
      points: 99,
      comments_count: 12,
      follow_up_story_id: 123,
    });
    expect(result.content[0]?.text).toContain('1. Show HN token=[REDACTED_SECRET] — story_id: 123');
    expect(result.content[0]?.text).toContain('points: 99');
    expect(result.content[0]?.text).toContain('comments: 12');
    expect(result.content[0]?.text).toContain('author: pg');
    expect(result.content[0]?.text).toContain('snippet: Body with [REDACTED_SECRET]');
    expect(JSON.stringify(result)).toContain('[REDACTED_SECRET]');
    expect(JSON.stringify(result)).not.toContain('AKIA1234567890ABCDEF');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('https://hn.algolia.com/api/v1/search');
    expect(url).toContain('query=typescript');
    expect(url).toContain('tags=story');
    expect(url).toContain('hitsPerPage=5');
  });

  it('hackernews_story_get preserves nested comments best-effort within total/depth bounds', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      id: 123,
      title: 'HN detail',
      author: 'pg',
      created_at: '2026-06-19T00:00:00Z',
      points: 50,
      text: 'story body',
      children: [{
        id: 0,
        author: 'skip-me',
        created_at: '2026-06-19T00:00:30Z',
        text: 'skipped comment',
        children: [],
      }, {
        id: 1,
        author: 'a',
        created_at: '2026-06-19T00:01:00Z',
        text: 'root comment',
        children: [{
          id: 2,
          author: 'b',
          created_at: '2026-06-19T00:02:00Z',
          text: 'child comment',
          children: [{
            id: 3,
            author: 'c',
            created_at: '2026-06-19T00:03:00Z',
            text: 'grandchild comment',
            children: [{
              id: 4,
              author: 'd',
              created_at: '2026-06-19T00:04:00Z',
              text: 'too deep comment',
              children: [],
            }],
          }],
        }],
      }, {
        id: 5,
        author: 'second-top-level',
        created_at: '2026-06-19T00:05:00Z',
        text: 'second top-level comment',
        children: [],
      }, {
        id: 6,
        author: 'third-top-level',
        created_at: '2026-06-19T00:06:00Z',
        text: 'third top-level comment',
        children: [],
      }],
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'hackernews_story_get');
    const result = (await execute(tool!, { story_id: 123, commentsLimit: 2, commentsOffset: 1 })) as {
      content: Array<{ type: 'text'; text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      platform: 'hacker_news',
      id: '123',
      follow_up_story_id: 123,
      comments_limit: 2,
      comments_offset: 1,
      max_depth: 3,
      next_comments_offset: 3,
      bounds: {
        returned_top_level_comments: 2,
        returned_total_comments: 4,
        truncated_by_depth: true,
        truncated_by_total_limit: false,
      },
    });
    const comments = result.details.data.comments as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(2);
    expect(comments[0]?.children).toHaveLength(1);
    expect(comments[1]).toMatchObject({ author: 'second-top-level', body: 'second top-level comment', children: [] });
    expect(result.content[0]?.text).toContain('HN detail');
    expect(result.content[0]?.text).toContain('story_id: 123');
    expect(result.content[0]?.text).toContain('Comments offset 1 limit 2');
    expect(result.content[0]?.text).toContain('2. a: root comment');
    expect(result.content[0]?.text).toContain('↳ b: child comment');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('https://hn.algolia.com/api/v1/items/123');
  });

  it('maps Hacker News provider failures to structured errors without raw payload echo', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('busy token=secret-value', {
      status: 429,
      headers: { 'retry-after': '7', 'x-request-id': 'hn-secret' },
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });
    const tool = pi.tools.find((entry) => entry.name === 'search_hackernews');
    const result = (await execute(tool!, { query: 'typescript' })) as {
      details: { status: 'failure'; error: Record<string, unknown> };
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({
      status: 'failure',
      error: {
        provider: 'hacker_news',
        category: 'rate_limit',
        retry_after_seconds: 7,
        recoverable: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });
});

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
      config: { github: { provider: 'gh' } },
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
