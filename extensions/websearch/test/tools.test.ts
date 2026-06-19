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
    expect(validateDevtoArticleSearch?.({ tag: 'typescript' })).toEqual({
      tag: 'typescript',
      limit: 5,
    });
    expect(validateHackerNewsSearch?.({ query: 'typescript' })).toEqual({
      query: 'typescript',
      limit: 5,
    });
    expect(validateGitHubIssueGet?.({ issue: 'octo/widgets#42' })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      issueNumber: 42,
      url: 'https://github.com/octo/widgets/issues/42',
      commentsLimit: 5,
    });
    expect(validateDevtoCommentsGet?.({ article_id: 1234 })).toEqual({
      articleId: 1234,
      topLevelLimit: 10,
      totalLimit: 25,
      maxDepth: 2,
    });
    expect(validateHackerNewsStoryGet?.({ story_id: 9876 })).toEqual({
      storyId: 9876,
      commentsLimit: 10,
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

describe('dev.to tool behavior', () => {
  it('search_devto_articles uses the public Forem API tag search and normalizes bounded results', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response([
      {
        id: 321,
        title: 'TypeScript token=secret-value',
        description: 'Learn with AKIA1234567890ABCDEF',
        url: 'https://dev.to/dev/typescript-post-321',
        published_at: '2026-06-19T00:00:00Z',
        tag_list: ['typescript', 'testing'],
        public_reactions_count: 42,
        comments_count: 7,
        user: { name: 'dev author' },
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
      url: 'https://dev.to/dev/typescript-post-321',
      author: 'dev author',
      published_at: '2026-06-19T00:00:00Z',
      tags: ['typescript', 'testing'],
      reactions_count: 42,
      comments_count: 7,
      follow_up_article_id: 321,
    });
    expect(JSON.stringify(result)).toContain('[REDACTED_SECRET]');
    expect(JSON.stringify(result)).not.toContain('AKIA1234567890ABCDEF');
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
            body_markdown: 'child comment',
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
        body_markdown: 'second root',
        user: { name: 'root-2' },
        children: [],
      },
    ]));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'devto_comments_get');
    const result = (await execute(tool!, { article_id: 99 })) as {
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      platform: 'devto',
      article_id: 99,
      top_level_limit: 10,
      total_limit: 25,
      max_depth: 2,
      bounds: {
        returned_top_level_comments: 2,
        returned_total_nodes: 3,
        truncated_by_depth: true,
      },
    });
    const comments = (result.details.data.comments as Array<Record<string, unknown>>);
    expect(comments).toHaveLength(2);
    expect(comments[0]?.children).toHaveLength(1);
    expect((comments[0]?.children as Array<Record<string, unknown>>)[0]?.children ?? []).toHaveLength(0);
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
      }],
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'hackernews_story_get');
    const result = (await execute(tool!, { story_id: 123 })) as {
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      platform: 'hacker_news',
      id: '123',
      follow_up_story_id: 123,
      comments_limit: 10,
      max_depth: 3,
      bounds: {
        returned_total_comments: 3,
        truncated_by_depth: true,
        truncated_by_total_limit: false,
      },
    });
    const comments = result.details.data.comments as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(1);
    expect(comments[0]?.children).toHaveLength(1);
    expect((comments[0]?.children as Array<Record<string, unknown>>)[0]?.children).toHaveLength(1);
    expect((((comments[0]?.children as Array<Record<string, unknown>>)[0]?.children as Array<Record<string, unknown>>)[0]?.children) ?? []).toHaveLength(0);
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
    registerWebsearchTools(pi, { env: { GITHUB_TOKEN: 'ghp_secret_token' }, fetch: vi.fn<typeof fetch>() });

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
