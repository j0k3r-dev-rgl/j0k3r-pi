import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute, response } from './helpers.js';

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
