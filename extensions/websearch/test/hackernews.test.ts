import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute, response } from './helpers.js';

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
