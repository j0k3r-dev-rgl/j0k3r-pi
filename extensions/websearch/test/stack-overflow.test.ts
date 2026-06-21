import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from './legacy-tools.js';
import { createMockPi, execute, response } from './helpers.js';

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
        answers_tool: 'discussion_answers_get',
        answers_ref: '12345',
        comments_tool: 'discussion_comments_get',
        comments_ref: '12345',
      },
      availability: { status: 'available' },
    });
    expect(result.content[0]?.text).toContain('Question detail');
    expect(result.content[0]?.text).toContain('question_id: 12345');
    expect(result.content[0]?.text).toContain('accepted_answer_id: 456');
    expect(result.content[0]?.text).toContain('use discussion_answers_get with question: 12345');
    expect(result.content[0]?.text).toContain('use discussion_comments_get with question: 12345');
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
