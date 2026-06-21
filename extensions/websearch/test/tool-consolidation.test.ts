import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute, response } from './helpers.js';

function createDiscussionClients(overrides: Record<string, unknown> = {}) {
  return {
    stackExchange: {
      searchQuestions: vi.fn().mockResolvedValue([]),
      getQuestion: vi.fn(),
      getAnswers: vi.fn(),
      getQuestionComments: vi.fn(),
      ...(overrides.stackExchange as Record<string, unknown> | undefined),
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
      listReleases: vi.fn().mockResolvedValue([]),
      getReleaseByTag: vi.fn(),
      searchDiscussions: vi.fn().mockResolvedValue([]),
      getDiscussion: vi.fn(),
      getRepository: vi.fn(),
      getRepositoryReadme: vi.fn(),
      getFile: vi.fn(),
      searchCode: vi.fn().mockResolvedValue([]),
      ...(overrides.github as Record<string, unknown> | undefined),
    },
    devto: { searchArticles: vi.fn().mockResolvedValue([]), getComments: vi.fn(), ...(overrides.devto as Record<string, unknown> | undefined) },
    hackerNews: { searchStories: vi.fn().mockResolvedValue([]), getStory: vi.fn(), ...(overrides.hackerNews as Record<string, unknown> | undefined) },
  };
}

describe('public tool consolidation routers', () => {
  it('discussion_get opens selected discussions through source-specific internals without exposing legacy tools', async () => {
    const clients = createDiscussionClients({
      stackExchange: {
        getQuestion: vi.fn().mockResolvedValue({ question_id: 42, link: 'https://serverfault.com/q/42', title: 'nginx detail', body: 'body', site: 'serverfault' }),
      },
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    expect(pi.tools.find((tool) => tool.name === 'stack_exchange_question_get')).toBeUndefined();
    const result = await execute(pi.tools.find((tool) => tool.name === 'discussion_get')!, { source: 'server_fault', ref: 'serverfault:42' }) as any;

    expect(result.details.status).toBe('success');
    expect(clients.stackExchange.getQuestion).toHaveBeenCalledWith(expect.objectContaining({ questionId: '42', site: 'serverfault' }), undefined);
    expect(result.details.data).toMatchObject({ title: 'nginx detail', site: 'serverfault' });
  });

  it('discussion_answers_get and discussion_comments_get route Stack Exchange network questions', async () => {
    const clients = createDiscussionClients({
      stackExchange: {
        getAnswers: vi.fn().mockResolvedValue([{ answer_id: 1, question_id: 42, body: 'answer body', score: 5 }]),
        getQuestionComments: vi.fn().mockResolvedValue({ hasMore: false, items: [{ comment_id: 2, post_id: 42, body: 'comment body', score: 1 }] }),
      },
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    const answers = await execute(pi.tools.find((tool) => tool.name === 'discussion_answers_get')!, { source: 'unix_linux', ref: 'unix:42', limit: 1 }) as any;
    const comments = await execute(pi.tools.find((tool) => tool.name === 'discussion_comments_get')!, { source: 'unix_linux', ref: 'unix:42', commentsLimit: 1 }) as any;

    expect(answers.details.status).toBe('success');
    expect(comments.details.status).toBe('success');
    expect(clients.stackExchange.getAnswers).toHaveBeenCalledWith(expect.objectContaining({ questionId: '42', limit: 1, site: 'unix' }), undefined);
    expect(clients.stackExchange.getQuestionComments).toHaveBeenCalledWith(expect.objectContaining({ questionId: '42', commentsLimit: 1, commentsOffset: 0, site: 'unix' }), undefined);
  });

  it('research_get and research_graph_get replace provider-specific public research detail tools', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname === '/works/W123') return response({ id: 'https://openalex.org/W123', title: 'OpenAlex detail', publication_year: 2026 });
      expect(url.pathname).toBe('/works');
      expect(url.searchParams.get('filter')).toBe('referenced_works:W123');
      return response({ meta: { count: 1, page: 1, per_page: 1 }, results: [{ id: 'https://openalex.org/W999', title: 'Citing work' }] });
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    expect(pi.tools.find((tool) => tool.name === 'openalex_work_get')).toBeUndefined();
    const detail = await execute(pi.tools.find((tool) => tool.name === 'research_get')!, { source: 'openalex', ref: 'W123' }) as any;
    const graph = await execute(pi.tools.find((tool) => tool.name === 'research_graph_get')!, { source: 'openalex', graph: 'citations', ref: 'W123', limit: 1 }) as any;

    expect(detail.details.status).toBe('success');
    expect(detail.details.data).toMatchObject({ source: 'openalex', title: 'OpenAlex detail', followup_tool: 'research_get' });
    expect(graph.details.status).toBe('success');
    expect(graph.details.data.relation).toBe('citations');
    expect(graph.details.data.items[0]).toMatchObject({ source: 'openalex', title: 'Citing work', followup_tool: 'research_get' });
  });

  it('grouped public tool schemas expose source-specific variants', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>() });

    const discussionGet = pi.tools.find((tool) => tool.name === 'discussion_get')!.parameters as any;
    expect(discussionGet.oneOf).toBeDefined();
    const hackerNewsGetBranch = discussionGet.oneOf.find((branch: any) => branch.properties?.source?.const === 'hacker_news');
    expect(hackerNewsGetBranch.properties.story_id).toBeDefined();
    expect(hackerNewsGetBranch.properties.reviewCommentsLimit).toBeUndefined();

    const discussionComments = pi.tools.find((tool) => tool.name === 'discussion_comments_get')!.parameters as any;
    const devtoCommentsBranch = discussionComments.oneOf.find((branch: any) => branch.properties?.source?.const === 'devto');
    expect(devtoCommentsBranch.properties.article_id).toBeDefined();
    expect(devtoCommentsBranch.properties.pull_request).toBeUndefined();

    const researchGraph = pi.tools.find((tool) => tool.name === 'research_graph_get')!.parameters as any;
    const crossrefBranch = researchGraph.oneOf.find((branch: any) => branch.properties?.source?.const === 'crossref');
    expect(crossrefBranch.properties.graph.const).toBe('references');
    expect(JSON.stringify(crossrefBranch)).not.toContain('citations');
  });

  it('github_get routes repo/file/release operations while github_code_search stays public', async () => {
    const clients = createDiscussionClients({
      github: {
        getRepository: vi.fn().mockResolvedValue({ full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', name: 'widgets', owner: { login: 'acme' }, description: 'repo detail' }),
        getRepositoryReadme: vi.fn().mockResolvedValue({ name: 'README.md', path: 'README.md', content: Buffer.from('readme body').toString('base64'), encoding: 'base64', html_url: 'https://github.com/acme/widgets/blob/main/README.md' }),
        getFile: vi.fn().mockResolvedValue({ name: 'tool.ts', path: 'src/tool.ts', content: Buffer.from('export {};').toString('base64'), encoding: 'base64', html_url: 'https://github.com/acme/widgets/blob/main/src/tool.ts' }),
        listReleases: vi.fn().mockResolvedValue([]),
        getReleaseByTag: vi.fn().mockResolvedValue({ tag_name: 'v1.0.0', name: 'v1.0.0', html_url: 'https://github.com/acme/widgets/releases/tag/v1.0.0' }),
        searchCode: vi.fn().mockResolvedValue([]),
      },
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    expect(pi.tools.find((tool) => tool.name === 'github_repo_get')).toBeUndefined();
    expect(pi.tools.find((tool) => tool.name === 'github_code_search')).toBeDefined();

    const repo = await execute(pi.tools.find((tool) => tool.name === 'github_get')!, { kind: 'repo', repo: 'acme/widgets' }) as any;
    const file = await execute(pi.tools.find((tool) => tool.name === 'github_get')!, { kind: 'file', ref: 'acme/widgets:src/tool.ts' }) as any;
    const release = await execute(pi.tools.find((tool) => tool.name === 'github_get')!, { kind: 'release', repo: 'acme/widgets', tag: 'v1.0.0' }) as any;

    expect(repo.details.status).toBe('success');
    expect(file.details.status).toBe('success');
    expect(release.details.status).toBe('success');
    expect(clients.github.getRepository).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets' }, undefined);
    expect(clients.github.getFile).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', repo: 'widgets', path: 'src/tool.ts' }), undefined);
    expect(clients.github.getReleaseByTag).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', repo: 'widgets', tag: 'v1.0.0' }), undefined);
  });

  it('github_get keeps selected target refs distinct from file git refs and release tags', async () => {
    const clients = createDiscussionClients({
      github: {
        getFile: vi.fn().mockResolvedValue({ name: 'tool.ts', path: 'src/tool.ts', content: Buffer.from('export {};').toString('base64'), encoding: 'base64', html_url: 'https://github.com/acme/widgets/blob/main/src/tool.ts' }),
        getReleaseByTag: vi.fn().mockResolvedValue({ tag_name: 'v1.0.0', name: 'v1.0.0', html_url: 'https://github.com/acme/widgets/releases/tag/v1.0.0' }),
      },
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });
    const tool = pi.tools.find((entry) => entry.name === 'github_get')!;

    await execute(tool, { kind: 'file', repo: 'acme/widgets', path: 'src/tool.ts', ref: 'ignored-target-ref' });
    await execute(tool, { kind: 'file', repo: 'acme/widgets', path: 'src/tool.ts', git_ref: 'v2' });
    const releaseWithRefOnly = await execute(tool, { kind: 'release', repo: 'acme/widgets', ref: 'v1.0.0' }) as any;

    expect(clients.github.getFile).toHaveBeenNthCalledWith(1, expect.objectContaining({ owner: 'acme', repo: 'widgets', path: 'src/tool.ts', ref: undefined }), undefined);
    expect(clients.github.getFile).toHaveBeenNthCalledWith(2, expect.objectContaining({ owner: 'acme', repo: 'widgets', path: 'src/tool.ts', ref: 'v2' }), undefined);
    expect(releaseWithRefOnly.details.status).toBe('failure');
    expect(clients.github.getReleaseByTag).not.toHaveBeenCalled();
  });

  it('discussion_comments_get returns comment-focused GitHub results instead of full entity details', async () => {
    const clients = createDiscussionClients({
      github: {
        getIssue: vi.fn().mockResolvedValue({
          id: 1,
          number: 42,
          html_url: 'https://github.com/acme/widgets/issues/42',
          repository_url: 'https://api.github.com/repos/acme/widgets',
          title: 'Issue title should not be projected',
          state: 'open',
          comments: 1,
          body: 'ISSUE_BODY_SHOULD_NOT_BE_IN_COMMENTS_RESULT',
        }),
        listIssueComments: vi.fn().mockResolvedValue([{ id: 100, html_url: 'https://github.com/acme/widgets/issues/42#issuecomment-100', body: 'comment body' }]),
        listIssueTimelineEvents: vi.fn().mockResolvedValue([]),
      },
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });

    const result = await execute(pi.tools.find((tool) => tool.name === 'discussion_comments_get')!, { source: 'github_issue', ref: 'acme/widgets#42', commentsLimit: 1 }) as any;

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({ platform: 'github', source: 'github_issue', repository: 'acme/widgets', number: 42, comments_returned: 1 });
    expect(result.details.data.comments[0]).toMatchObject({ body: 'comment body' });
    expect(result.details.data.body).toBeUndefined();
    expect(result.details.data.title).toBeUndefined();
    expect(result.content[0].text).not.toContain('ISSUE_BODY_SHOULD_NOT_BE_IN_COMMENTS_RESULT');
  });
});
