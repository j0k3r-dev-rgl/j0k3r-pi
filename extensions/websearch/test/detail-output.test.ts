import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute, response } from './helpers.js';

const longGitHubBody = `${'GitHub issue body sentence with important context. '.repeat(360)}GITHUB_FINAL_SENTENCE_KEEP_ME`;
const longArxivAbstract = `${'Arxiv abstract sentence with retrieval details. '.repeat(220)}ARXIV_FINAL_SENTENCE_KEEP_ME`;
const longHackerNewsBody = `${'Hacker News story body with local-first details. '.repeat(260)}HN_STORY_FINAL_SENTENCE_KEEP_ME`;
const longHackerNewsComment = `${'Hacker News comment with implementation details. '.repeat(140)}HN_COMMENT_FINAL_SENTENCE_KEEP_ME`;

function arxivXml(summary: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2604.15484v1</id>
    <published>2026-04-15T00:00:00Z</published>
    <updated>2026-04-16T00:00:00Z</updated>
    <title>Long abstract paper</title>
    <summary>${summary}</summary>
    <author><name>Researcher</name></author>
    <link href="http://arxiv.org/abs/2604.15484v1" rel="alternate" type="text/html" />
  </entry>
</feed>`;
}

describe('detail tool output completeness', () => {
  it('github_issue_get exposes the full available issue body in details and content', async () => {
    const clients = {
      stackExchange: { searchQuestions: vi.fn(), getQuestion: vi.fn(), getAnswers: vi.fn(), getQuestionComments: vi.fn() },
      github: {
        searchIssues: vi.fn().mockResolvedValue([]),
        getIssue: vi.fn().mockResolvedValue({
          id: 1,
          number: 42,
          html_url: 'https://github.com/acme/repo/issues/42',
          repository_url: 'https://api.github.com/repos/acme/repo',
          title: 'Long issue detail',
          state: 'open',
          comments: 0,
          body: longGitHubBody,
        }),
        listIssueComments: vi.fn().mockResolvedValue([]),
        listIssueTimelineEvents: vi.fn().mockResolvedValue([]),
        searchPullRequests: vi.fn().mockResolvedValue([]),
        getPullRequest: vi.fn(),
        listPullRequestReviewComments: vi.fn().mockResolvedValue([]),
        listPullRequestReviews: vi.fn().mockResolvedValue([]),
        listReleases: vi.fn().mockResolvedValue([]),
        getReleaseByTag: vi.fn(),
      },
      devto: { searchArticles: vi.fn(), getComments: vi.fn() },
      hackerNews: { searchStories: vi.fn(), getStory: vi.fn() },
    };
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    const result = (await execute(pi.tools.find((tool) => tool.name === 'github_issue_get')!, { issue: 'acme/repo#42' })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { body?: string } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.body).toContain('GITHUB_FINAL_SENTENCE_KEEP_ME');
    expect(result.content[0]?.text).toContain('GITHUB_FINAL_SENTENCE_KEEP_ME');
    expect(result.content[0]?.text).not.toMatch(/…$/);
  });

  it('arxiv_paper_get exposes the full available abstract in details and content', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(arxivXml(longArxivAbstract), { status: 200, headers: { 'content-type': 'application/atom+xml' } }));
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const result = (await execute(pi.tools.find((tool) => tool.name === 'arxiv_paper_get')!, { paper: '2604.15484v1' })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { abstract?: string; summary?: string } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.abstract).toContain('ARXIV_FINAL_SENTENCE_KEEP_ME');
    expect(result.details.data.summary).toContain('ARXIV_FINAL_SENTENCE_KEEP_ME');
    expect(result.content[0]?.text).toContain('ARXIV_FINAL_SENTENCE_KEEP_ME');
    expect(result.content[0]?.text).not.toMatch(/…$/);
  });

  it('hackernews_story_get exposes full bounded story/comment text returned by the provider', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      id: 123,
      title: 'Long HN story',
      author: 'pg',
      text: longHackerNewsBody,
      children: [{
        id: 456,
        author: 'commenter',
        text: longHackerNewsComment,
        children: [],
      }],
    }));
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const result = (await execute(pi.tools.find((tool) => tool.name === 'hackernews_story_get')!, { story_id: 123, commentsLimit: 1 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { body?: string; comments: Array<{ body?: string }> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.body).toContain('HN_STORY_FINAL_SENTENCE_KEEP_ME');
    expect(result.details.data.comments[0]?.body).toContain('HN_COMMENT_FINAL_SENTENCE_KEEP_ME');
    expect(result.content[0]?.text).toContain('HN_STORY_FINAL_SENTENCE_KEEP_ME');
    expect(result.content[0]?.text).toContain('HN_COMMENT_FINAL_SENTENCE_KEEP_ME');
    expect(result.content[0]?.text).not.toMatch(/…$/);
  });
});
