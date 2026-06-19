import { describe, expect, it, vi } from 'vitest';
import {
  validateStackOverflowAnswers,
  validateStackOverflowQuestionRef,
  validateStackOverflowSearch,
} from '../src/validation.js';
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
    expect(validateStackOverflowSearch({ query: 'TypeScript fetch' })).toEqual({
      query: 'TypeScript fetch',
      limit: 5,
    });

    expect(validateStackOverflowQuestionRef({ question: 'https://stackoverflow.com/questions/12345/example' })).toEqual({
      questionId: '12345',
      url: 'https://stackoverflow.com/questions/12345/example',
    });

    expect(validateStackOverflowAnswers({ question: '12345' })).toEqual({
      questionId: '12345',
      url: 'https://stackoverflow.com/questions/12345',
      limit: 10,
    });

    expect(() => validateStackOverflowSearch({ query: 'oops', limit: 11 })).toThrow(/at most 10/i);
    expect(() => validateStackOverflowAnswers({ question: '12345', limit: 31 })).toThrow(/at most 30/i);
  });
});

describe('websearch tool registration', () => {
  it('registers exactly three Stack Overflow tools', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi);

    expect(WEBSEARCH_TOOL_NAMES).toEqual([
      'search_stack_overflow',
      'stack_overflow_question_get',
      'stack_overflow_answers_get',
    ]);
    expect(pi.tools.map((tool) => tool.name)).toEqual(WEBSEARCH_TOOL_NAMES);
    expect(pi.tools).toHaveLength(3);

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
        tags: ['typescript', 'fetch'],
        owner: { display_name: 'dev' },
        creation_date: 1710000000,
        body_markdown: 'question body',
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
      tags: ['typescript', 'fetch'],
      author: 'dev',
      availability: { status: 'available' },
    });
    expect(result.content[0]?.text).toContain('How to test fetch?');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('https://api.stackexchange.com/2.3/search/advanced');
    expect(url).toContain('site=stackoverflow');
    expect(url).toContain('pagesize=5');
    expect(url).toContain('key=so-key');
  });

  it('stack_overflow_question_get requests a body-capable filter and returns body content', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      items: [{
        question_id: 12345,
        link: 'https://stackoverflow.com/questions/12345/example',
        title: 'Question detail',
        score: 3,
        tags: ['node.js'],
        owner: { display_name: 'asker' },
        creation_date: 1710000000,
        body_markdown: 'full question body',
      }],
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'stack_overflow_question_get');
    const result = (await execute(tool!, { question: 'https://stackoverflow.com/questions/12345/example' })) as {
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      id: '12345',
      body: 'full question body',
      availability: { status: 'available' },
    });
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
        body_markdown: 'answer body',
      }],
    }));

    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: successFetch });
    const tool = pi.tools.find((entry) => entry.name === 'stack_overflow_answers_get');
    const result = (await execute(tool!, { question: '12345' })) as {
      details: { status: 'success'; data: { limit: number; answers: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.limit).toBe(10);
    expect(result.details.data.answers[0]).toMatchObject({
      id: '456',
      answer_id: '456',
      question_id: '12345',
      accepted: true,
      body: 'answer body',
    });
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
});
