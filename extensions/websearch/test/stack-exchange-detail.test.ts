import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute, response } from './helpers.js';

describe('stack exchange network detail tools', () => {
  it('discussion_get fetches one network question by URL and returns answer/comment followups', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      items: [{
        question_id: 535083,
        accepted_answer_id: 535084,
        link: 'https://unix.stackexchange.com/questions/535083/nginx-emerg-getpwnam-nginx-failed',
        title: 'nginx getpwnam failed on Unix Linux',
        score: 12,
        answer_count: 2,
        is_answered: true,
        tags: ['linux', 'nginx'],
        owner: { display_name: 'ops user' },
        creation_date: 1710000000,
        body: '<p>Unix Linux question body with nginx user troubleshooting details.</p>',
      }],
      quota_remaining: 299,
    }));
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: { STACK_EXCHANGE_KEY: 'se-key' }, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'discussion_get');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { source: 'unix_linux', question: 'https://unix.stackexchange.com/questions/535083/nginx-emerg-getpwnam-nginx-failed' })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      platform: 'unix_linux',
      site: 'unix',
      question_id: '535083',
      title: 'nginx getpwnam failed on Unix Linux',
      body: 'Unix Linux question body with nginx user troubleshooting details.',
      follow_up: {
        answers_tool: 'discussion_answers_get',
        answers_ref: 'unix:535083',
        comments_tool: 'discussion_comments_get',
        comments_ref: 'unix:535083',
      },
    });
    expect(result.content[0]?.text).toContain('site: unix');
    expect(result.content[0]?.text).toContain('use discussion_answers_get with question: unix:535083');
    expect(result.content[0]?.text).toContain('use discussion_comments_get with question: unix:535083');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('/questions/535083');
    expect(url).toContain('site=unix');
    expect(url).toContain('filter=withbody');
    expect(url).toContain('key=se-key');
  });

  it('discussion_answers_get fetches network answers by source-prefixed id', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      items: [{
        answer_id: 9001,
        question_id: 535083,
        link: 'https://unix.stackexchange.com/a/9001',
        score: 8,
        is_accepted: true,
        owner: { display_name: 'answerer' },
        creation_date: 1710000100,
        body: '<p>Create the nginx user or change the configured user directive.</p>',
      }],
    }));
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'discussion_answers_get');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { source: 'unix_linux', question: 'unix:535083', limit: 3 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { platform: string; site: string; questionId: string; limit: number; answers: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({ platform: 'unix_linux', site: 'unix', questionId: '535083', limit: 3 });
    expect(result.details.data.answers[0]).toMatchObject({ platform: 'unix_linux', site: 'unix', accepted: true, body: 'Create the nginx user or change the configured user directive.' });
    expect(result.content[0]?.text).toContain('[accepted] answerer');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('/questions/535083/answers');
    expect(url).toContain('site=unix');
    expect(url).toContain('pagesize=3');
  });

  it('discussion_comments_get fetches network comments with pagination metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      items: [{
        comment_id: 77,
        post_id: 535083,
        score: 2,
        owner: { display_name: 'commenter' },
        creation_date: 1710000200,
        body: '<p>Check whether the nginx user exists before restarting.</p>',
      }],
      has_more: true,
    }));
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'discussion_comments_get');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { source: 'unix_linux', question: '535083', commentsLimit: 1, commentsOffset: 2 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      platform: 'unix_linux',
      site: 'unix',
      question_id: '535083',
      comments_limit: 1,
      comments_offset: 2,
      has_more_comments: true,
      next_comments_offset: 3,
    });
    expect(result.content[0]?.text).toContain('Stack Exchange comments for unix question 535083');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('/questions/535083/comments');
    expect(url).toContain('site=unix');
    expect(url).toContain('pagesize=1');
    expect(url).toContain('page=3');
  });
});
