import { Octokit } from 'octokit';
import { ProviderFailure, githubProviderErrorFromError, redactText } from '../../security.js';
import type {
  GitHubClient,
  GitHubCodeSearchRequest,
  GitHubDiscussionGetRequest,
  GitHubDiscussionSearchRequest,
  GitHubFileGetRequest,
  GitHubIssueCommentsRequest,
  GitHubIssueRef,
  GitHubIssueSearchRequest,
  GitHubPullRequestRef,
  GitHubPullRequestSearchRequest,
  GitHubReleaseGetRequest,
  GitHubRawCodeSearchItem,
  GitHubRawContentFile,
  GitHubRawDiscussion,
  GitHubRawIssue,
  GitHubRawIssueComment,
  GitHubRawIssueSearchItem,
  GitHubRawIssueTimelineEvent,
  GitHubRawPullRequest,
  GitHubRawPullRequestComment,
  GitHubRawPullRequestReview,
  GitHubRawRelease,
  GitHubRawRepository,
  GitHubRepoRef,
  GitHubReleasesGetRequest,
  WebsearchRuntime,
} from '../../types.js';

function issueSearchQuery(input: GitHubIssueSearchRequest): string {
  const parts = [input.query.trim(), 'is:issue'];
  if (input.repo) {
    parts.push(`repo:${input.repo}`);
  }
  if (input.state && input.state !== 'all') {
    parts.push(`state:${input.state}`);
  }
  return parts.filter(Boolean).join(' ');
}

function pullRequestSearchQuery(input: GitHubPullRequestSearchRequest): string {
  const parts = [input.query.trim(), 'is:pr'];
  if (input.repo) {
    parts.push(`repo:${input.repo}`);
  }
  if (input.state === 'merged') {
    parts.push('is:merged');
  } else if (input.state && input.state !== 'all') {
    parts.push(`state:${input.state}`);
  }
  return parts.filter(Boolean).join(' ');
}

function codeSearchQuery(input: GitHubCodeSearchRequest): string {
  const parts = [input.query.trim()];
  if (input.repo) {
    parts.push(`repo:${input.repo}`);
  } else if (input.owner) {
    parts.push(`org:${input.owner}`);
  }
  if (input.language) {
    parts.push(`language:${JSON.stringify(input.language)}`);
  }
  if (input.path) {
    parts.push(`path:${JSON.stringify(input.path)}`);
  }
  return parts.filter(Boolean).join(' ');
}

function discussionSearchQuery(input: GitHubDiscussionSearchRequest): string {
  const parts = [input.query.trim()];
  if (input.repo) {
    parts.push(`repo:${input.repo}`);
  } else if (input.owner) {
    parts.push(`org:${input.owner}`);
  }
  return parts.filter(Boolean).join(' ');
}

const GITHUB_DISCUSSION_FIELDS = `
fragment WebsearchDiscussionFields on Discussion {
  id
  databaseId
  number
  title
  url
  bodyText
  createdAt
  updatedAt
  publishedAt
  upvoteCount
  answerChosenAt
  closed
  locked
  author { login url }
  category { name slug emoji }
  repository { nameWithOwner }
  comments { totalCount }
  labels(first: 10) { nodes { name } }
  answer { id databaseId url bodyText createdAt updatedAt upvoteCount author { login url } }
}
`;

const GITHUB_DISCUSSION_SEARCH_QUERY = `
${GITHUB_DISCUSSION_FIELDS}
query WebsearchDiscussionSearch($searchQuery: String!, $first: Int!) {
  search(query: $searchQuery, type: DISCUSSION, first: $first) {
    edges {
      textMatches { fragment property }
      node {
        ... on Discussion { ...WebsearchDiscussionFields }
      }
    }
  }
}
`;

const GITHUB_DISCUSSION_GET_QUERY = `
fragment WebsearchDiscussionCommentFields on DiscussionComment {
  id
  databaseId
  url
  bodyText
  createdAt
  updatedAt
  upvoteCount
  author { login url }
}
fragment WebsearchDiscussionDetailFields on Discussion {
  id
  databaseId
  number
  title
  url
  bodyText
  createdAt
  updatedAt
  publishedAt
  upvoteCount
  answerChosenAt
  closed
  locked
  author { login url }
  category { name slug emoji }
  repository { nameWithOwner }
  labels(first: 10) { nodes { name } }
  answer { ...WebsearchDiscussionCommentFields }
}
query WebsearchDiscussionGet($owner: String!, $name: String!, $number: Int!, $commentsFirst: Int!, $commentsAfter: String) {
  repository(owner: $owner, name: $name) {
    discussion(number: $number) {
      ...WebsearchDiscussionDetailFields
      comments(first: $commentsFirst, after: $commentsAfter) {
        totalCount
        nodes { ...WebsearchDiscussionCommentFields }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
`;

function githubContentEndpoint(owner: string, repo: string, path: string): string {
  const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
}

function ghRefArgs(ref?: string): string[] {
  return ref ? ['-f', `ref=${ref}`] : [];
}

function ghTextMatchAcceptArgs(): string[] {
  return ['-H', 'Accept: application/vnd.github.text-match+json'];
}

function ghError(error: unknown, fallback: string): ProviderFailure {
  const err = error as { code?: unknown; message?: unknown; stderr?: unknown };
  const stderr = typeof err?.stderr === 'string' ? err.stderr : '';
  const message = redactText(stderr || (typeof err?.message === 'string' ? err.message : fallback));
  const missing = err?.code === 'ENOENT' || /no such file/i.test(message);
  const notFound = /\b404\b|not found/i.test(message) && !missing;
  const auth = /auth|login|not logged|authentication/i.test(message);
  return new ProviderFailure({
    code: missing ? 'missing_configuration' : notFound ? 'not_found' : 'provider_error',
    category: missing ? 'provider_unavailable' : notFound ? 'not_found' : auth ? 'auth' : 'unexpected',
    message: missing
      ? 'GitHub CLI (`gh`) is required because websearch github provider is set to `gh`, but it was not found in PATH.'
      : auth
        ? 'GitHub CLI is installed but not authenticated. Run `gh auth login` and retry.'
        : notFound
          ? 'GitHub resource was not found.'
          : `GitHub CLI request failed: ${message}`,
    recoverable: true,
    provider: 'github',
  });
}

const GITHUB_COMMENTS_PAGE_SIZE = 100;
const GITHUB_TIMELINE_PAGE_SIZE = 100;
const GITHUB_TIMELINE_MAX_PAGES = 3;

function commentsPageForOffset(offset: number): { page: number; index: number } {
  return {
    page: Math.floor(offset / GITHUB_COMMENTS_PAGE_SIZE) + 1,
    index: offset % GITHUB_COMMENTS_PAGE_SIZE,
  };
}

async function ghJson<T>(runtime: WebsearchRuntime, args: string[], signal?: AbortSignal): Promise<T> {
  if (!runtime.commandRunner) {
    throw new ProviderFailure({
      code: 'missing_configuration',
      category: 'provider_unavailable',
      message: 'A command runner is required for GitHub CLI websearch tools.',
      recoverable: true,
      provider: 'github',
    });
  }
  try {
    const { stdout } = await runtime.commandRunner('gh', args, { signal });
    return JSON.parse(stdout) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ProviderFailure({
        code: 'provider_error',
        category: 'provider_payload',
        message: 'GitHub CLI returned invalid JSON.',
        recoverable: true,
        provider: 'github',
      });
    }
    throw ghError(error, 'GitHub CLI request failed.');
  }
}

function ghGraphqlArgs(query: string, variables: Record<string, string | number | boolean | undefined>): string[] {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined) continue;
    args.push('-F', `${key}=${value}`);
  }
  return args;
}

class OctokitGitHubClient implements GitHubClient {
  private readonly octokit: Octokit;

  constructor(private readonly runtime: WebsearchRuntime) {
    this.octokit = new Octokit(runtime.env.GITHUB_TOKEN ? { auth: runtime.env.GITHUB_TOKEN } : {});
  }

  private requireGraphQLAuth(): void {
    if (!this.runtime.env.GITHUB_TOKEN) {
      throw new ProviderFailure({
        code: 'missing_configuration',
        category: 'provider_unavailable',
        message: 'GitHub Discussions use the GitHub GraphQL API, which requires GITHUB_TOKEN for the api provider. Set GITHUB_TOKEN or use the gh provider with an authenticated GitHub CLI.',
        recoverable: true,
        provider: 'github',
      });
    }
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    this.requireGraphQLAuth();
    try {
      return await this.octokit.graphql<T>(query, {
        ...variables,
        request: signal ? { signal } : undefined,
      });
    } catch (error) {
      throw new ProviderFailure(githubProviderErrorFromError(error));
    }
  }

  async getRepository(input: GitHubRepoRef, signal?: AbortSignal): Promise<GitHubRawRepository | null> {
    try {
      const response = await this.octokit.rest.repos.get({
        owner: input.owner,
        repo: input.repo,
        request: signal ? { signal } : undefined,
      });
      return response.data as unknown as GitHubRawRepository;
    } catch (error) {
      const mapped = githubProviderErrorFromError(error);
      if (mapped.code === 'not_found') return null;
      throw new ProviderFailure(mapped);
    }
  }

  async getRepositoryReadme(input: GitHubRepoRef & { ref?: string }, signal?: AbortSignal): Promise<GitHubRawContentFile | null> {
    try {
      const response = await this.octokit.rest.repos.getReadme({
        owner: input.owner,
        repo: input.repo,
        ref: input.ref,
        request: signal ? { signal } : undefined,
      });
      return response.data as unknown as GitHubRawContentFile;
    } catch (error) {
      const mapped = githubProviderErrorFromError(error);
      if (mapped.code === 'not_found') return null;
      throw new ProviderFailure(mapped);
    }
  }

  async getFile(input: GitHubFileGetRequest, signal?: AbortSignal): Promise<GitHubRawContentFile | null> {
    try {
      const response = await this.octokit.rest.repos.getContent({
        owner: input.owner,
        repo: input.repo,
        path: input.path,
        ref: input.ref,
        request: signal ? { signal } : undefined,
      });
      if (Array.isArray(response.data)) {
        throw new ProviderFailure({
          code: 'validation_error',
          category: 'validation',
          message: 'GitHub path resolved to a directory; use github_code_search or request a file path.',
          recoverable: true,
          provider: 'github',
        });
      }
      return response.data as unknown as GitHubRawContentFile;
    } catch (error) {
      if (error instanceof ProviderFailure) throw error;
      const mapped = githubProviderErrorFromError(error);
      if (mapped.code === 'not_found') return null;
      throw new ProviderFailure(mapped);
    }
  }

  async searchCode(input: GitHubCodeSearchRequest, signal?: AbortSignal): Promise<GitHubRawCodeSearchItem[]> {
    try {
      const response = await this.octokit.request('GET /search/code', {
        q: codeSearchQuery(input),
        per_page: input.limit,
        page: 1,
        headers: {
          accept: 'application/vnd.github.text-match+json',
        },
        request: signal ? { signal } : undefined,
      });
      const data = response.data as { items?: unknown[] };
      return Array.isArray(data.items) ? data.items as GitHubRawCodeSearchItem[] : [];
    } catch (error) {
      throw new ProviderFailure(githubProviderErrorFromError(error));
    }
  }

  async searchDiscussions(input: GitHubDiscussionSearchRequest, signal?: AbortSignal): Promise<GitHubRawDiscussion[]> {
    const response = await this.graphql<{ search?: { edges?: Array<{ node?: unknown; textMatches?: unknown[] }> } }>(GITHUB_DISCUSSION_SEARCH_QUERY, {
      searchQuery: discussionSearchQuery(input),
      first: input.limit,
    }, signal);
    const edges = response.search?.edges ?? [];
    return edges
      .map((edge): Record<string, unknown> | undefined => edge.node && typeof edge.node === 'object' ? { ...(edge.node as Record<string, unknown>), text_matches: edge.textMatches } : undefined)
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  async getDiscussion(input: GitHubDiscussionGetRequest, signal?: AbortSignal): Promise<GitHubRawDiscussion | null> {
    let cursor: string | undefined;
    let remainingOffset = input.commentsOffset;
    const collected: unknown[] = [];
    let discussion: Record<string, unknown> | undefined;
    let totalCount: unknown;
    let pageInfo: Record<string, unknown> | undefined;

    while (collected.length < input.commentsLimit) {
      const first = Math.min(GITHUB_COMMENTS_PAGE_SIZE, remainingOffset + input.commentsLimit - collected.length);
      const response = await this.graphql<{ repository?: { discussion?: Record<string, unknown> | null } }>(GITHUB_DISCUSSION_GET_QUERY, {
        owner: input.owner,
        name: input.repo,
        number: input.discussionNumber,
        commentsFirst: first,
        commentsAfter: cursor,
      }, signal);
      const current = response.repository?.discussion;
      if (!current) return null;
      discussion ??= current;
      const comments = current.comments as { nodes?: unknown[]; totalCount?: unknown; pageInfo?: Record<string, unknown> } | undefined;
      const nodes = Array.isArray(comments?.nodes) ? comments.nodes : [];
      totalCount = comments?.totalCount;
      pageInfo = comments?.pageInfo;
      const visible = remainingOffset > 0 ? nodes.slice(remainingOffset) : nodes;
      collected.push(...visible);
      remainingOffset = Math.max(0, remainingOffset - nodes.length);
      cursor = typeof pageInfo?.endCursor === 'string' ? pageInfo.endCursor : undefined;
      if (!pageInfo?.hasNextPage || !cursor) break;
    }

    return {
      ...discussion,
      comments: {
        totalCount,
        nodes: collected.slice(0, input.commentsLimit),
        pageInfo,
      },
    };
  }

  async searchIssues(input: GitHubIssueSearchRequest, signal?: AbortSignal): Promise<GitHubRawIssueSearchItem[]> {
    try {
      const response = await this.octokit.rest.search.issuesAndPullRequests({
        q: issueSearchQuery(input),
        per_page: input.limit,
        page: 1,
        request: signal ? { signal } : undefined,
      });
      return response.data.items as GitHubRawIssueSearchItem[];
    } catch (error) {
      throw new ProviderFailure(githubProviderErrorFromError(error));
    }
  }

  async getIssue(input: GitHubIssueRef, signal?: AbortSignal): Promise<GitHubRawIssue | null> {
    try {
      const response = await this.octokit.rest.issues.get({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issueNumber,
        request: signal ? { signal } : undefined,
      });
      return response.data as unknown as GitHubRawIssue;
    } catch (error) {
      const mapped = githubProviderErrorFromError(error);
      if (mapped.code === 'not_found') {
        return null;
      }
      throw new ProviderFailure(mapped);
    }
  }

  async listIssueComments(input: GitHubIssueCommentsRequest, signal?: AbortSignal): Promise<GitHubRawIssueComment[]> {
    const { page, index } = commentsPageForOffset(input.offset);
    try {
      const firstPage = await this.listIssueCommentsPage(input, page, signal);
      const needsNextPage = index + input.limit > GITHUB_COMMENTS_PAGE_SIZE && firstPage.length === GITHUB_COMMENTS_PAGE_SIZE;
      const combined = needsNextPage
        ? firstPage.concat(await this.listIssueCommentsPage(input, page + 1, signal))
        : firstPage;
      return combined.slice(index, index + input.limit);
    } catch (error) {
      throw new ProviderFailure(githubProviderErrorFromError(error));
    }
  }

  private async listIssueCommentsPage(input: GitHubIssueCommentsRequest, page: number, signal?: AbortSignal): Promise<GitHubRawIssueComment[]> {
    const response = await this.octokit.rest.issues.listComments({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.issueNumber,
      per_page: GITHUB_COMMENTS_PAGE_SIZE,
      page,
      request: signal ? { signal } : undefined,
    });
    return response.data as unknown as GitHubRawIssueComment[];
  }

  async listIssueTimelineEvents(input: GitHubIssueRef, signal?: AbortSignal): Promise<GitHubRawIssueTimelineEvent[]> {
    try {
      return this.listTimelineEvents(input.owner, input.repo, input.issueNumber, signal);
    } catch (error) {
      throw new ProviderFailure(githubProviderErrorFromError(error));
    }
  }

  async searchPullRequests(input: GitHubPullRequestSearchRequest, signal?: AbortSignal): Promise<GitHubRawIssueSearchItem[]> {
    try {
      const response = await this.octokit.rest.search.issuesAndPullRequests({
        q: pullRequestSearchQuery(input),
        per_page: input.limit,
        page: 1,
        request: signal ? { signal } : undefined,
      });
      return response.data.items as GitHubRawIssueSearchItem[];
    } catch (error) {
      throw new ProviderFailure(githubProviderErrorFromError(error));
    }
  }

  async getPullRequest(input: GitHubPullRequestRef, signal?: AbortSignal): Promise<GitHubRawPullRequest | null> {
    try {
      const response = await this.octokit.rest.pulls.get({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullNumber,
        request: signal ? { signal } : undefined,
      });
      return response.data as unknown as GitHubRawPullRequest;
    } catch (error) {
      const mapped = githubProviderErrorFromError(error);
      if (mapped.code === 'not_found') {
        return null;
      }
      throw new ProviderFailure(mapped);
    }
  }

  async listPullRequestReviewComments(input: GitHubPullRequestRef & { limit: number; offset: number }, signal?: AbortSignal): Promise<GitHubRawPullRequestComment[]> {
    const { page, index } = commentsPageForOffset(input.offset);
    try {
      const firstPage = await this.listPullRequestReviewCommentsPage(input, page, signal);
      const needsNextPage = index + input.limit > GITHUB_COMMENTS_PAGE_SIZE && firstPage.length === GITHUB_COMMENTS_PAGE_SIZE;
      const combined = needsNextPage ? firstPage.concat(await this.listPullRequestReviewCommentsPage(input, page + 1, signal)) : firstPage;
      return combined.slice(index, index + input.limit);
    } catch (error) {
      throw new ProviderFailure(githubProviderErrorFromError(error));
    }
  }

  private async listPullRequestReviewCommentsPage(input: GitHubPullRequestRef, page: number, signal?: AbortSignal): Promise<GitHubRawPullRequestComment[]> {
    const response = await this.octokit.rest.pulls.listReviewComments({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullNumber,
      per_page: GITHUB_COMMENTS_PAGE_SIZE,
      page,
      request: signal ? { signal } : undefined,
    });
    return response.data as unknown as GitHubRawPullRequestComment[];
  }

  async listPullRequestReviews(input: GitHubPullRequestRef, signal?: AbortSignal): Promise<GitHubRawPullRequestReview[]> {
    try {
      const response = await this.octokit.rest.pulls.listReviews({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullNumber,
        per_page: 10,
        page: 1,
        request: signal ? { signal } : undefined,
      });
      return response.data as unknown as GitHubRawPullRequestReview[];
    } catch (error) {
      throw new ProviderFailure(githubProviderErrorFromError(error));
    }
  }

  async listReleases(input: GitHubReleasesGetRequest, signal?: AbortSignal): Promise<GitHubRawRelease[]> {
    try {
      const response = await this.octokit.rest.repos.listReleases({
        owner: input.owner,
        repo: input.repo,
        per_page: input.limit,
        page: 1,
        request: signal ? { signal } : undefined,
      });
      return response.data as unknown as GitHubRawRelease[];
    } catch (error) {
      throw new ProviderFailure(githubProviderErrorFromError(error));
    }
  }

  async getReleaseByTag(input: GitHubReleaseGetRequest, signal?: AbortSignal): Promise<GitHubRawRelease | null> {
    try {
      const response = await this.octokit.rest.repos.getReleaseByTag({
        owner: input.owner,
        repo: input.repo,
        tag: input.tag,
        request: signal ? { signal } : undefined,
      });
      return response.data as unknown as GitHubRawRelease;
    } catch (error) {
      const mapped = githubProviderErrorFromError(error);
      if (mapped.code === 'not_found') {
        return null;
      }
      throw new ProviderFailure(mapped);
    }
  }

  private async listTimelineEvents(owner: string, repo: string, issueNumber: number, signal?: AbortSignal): Promise<GitHubRawIssueTimelineEvent[]> {
    const events: GitHubRawIssueTimelineEvent[] = [];
    for (let page = 1; page <= GITHUB_TIMELINE_MAX_PAGES; page += 1) {
      const response = await this.octokit.rest.issues.listEventsForTimeline({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: GITHUB_TIMELINE_PAGE_SIZE,
        page,
        request: signal ? { signal } : undefined,
      });
      const pageEvents = response.data as unknown as GitHubRawIssueTimelineEvent[];
      events.push(...pageEvents);
      if (pageEvents.length < GITHUB_TIMELINE_PAGE_SIZE) {
        break;
      }
    }
    return events;
  }
}

class GhGitHubClient implements GitHubClient {
  constructor(private readonly runtime: WebsearchRuntime) {}

  async getRepository(input: GitHubRepoRef, signal?: AbortSignal): Promise<GitHubRawRepository | null> {
    try {
      return await ghJson<GitHubRawRepository>(this.runtime, [
        'api',
        `repos/${input.owner}/${input.repo}`,
      ], signal);
    } catch (error) {
      if (error instanceof ProviderFailure && error.toolError.category === 'not_found') {
        return null;
      }
      throw error;
    }
  }

  async getRepositoryReadme(input: GitHubRepoRef & { ref?: string }, signal?: AbortSignal): Promise<GitHubRawContentFile | null> {
    try {
      return await ghJson<GitHubRawContentFile>(this.runtime, [
        'api',
        '-X', 'GET',
        `repos/${input.owner}/${input.repo}/readme`,
        ...ghRefArgs(input.ref),
      ], signal);
    } catch (error) {
      if (error instanceof ProviderFailure && error.toolError.category === 'not_found') {
        return null;
      }
      throw error;
    }
  }

  async getFile(input: GitHubFileGetRequest, signal?: AbortSignal): Promise<GitHubRawContentFile | null> {
    try {
      const data = await ghJson<GitHubRawContentFile | GitHubRawContentFile[]>(this.runtime, [
        'api',
        '-X', 'GET',
        githubContentEndpoint(input.owner, input.repo, input.path),
        ...ghRefArgs(input.ref),
      ], signal);
      if (Array.isArray(data)) {
        throw new ProviderFailure({
          code: 'validation_error',
          category: 'validation',
          message: 'GitHub path resolved to a directory; use github_code_search or request a file path.',
          recoverable: true,
          provider: 'github',
        });
      }
      return data;
    } catch (error) {
      if (error instanceof ProviderFailure && error.toolError.category === 'not_found') {
        return null;
      }
      throw error;
    }
  }

  async searchCode(input: GitHubCodeSearchRequest, signal?: AbortSignal): Promise<GitHubRawCodeSearchItem[]> {
    const payload = await ghJson<{ items?: unknown[] }>(this.runtime, [
      'api',
      '-X', 'GET',
      'search/code',
      ...ghTextMatchAcceptArgs(),
      '-f', `q=${codeSearchQuery(input)}`,
      '-f', `per_page=${input.limit}`,
      '-f', 'page=1',
    ], signal);
    return (payload.items ?? []) as GitHubRawCodeSearchItem[];
  }

  async searchDiscussions(input: GitHubDiscussionSearchRequest, signal?: AbortSignal): Promise<GitHubRawDiscussion[]> {
    const payload = await ghJson<{ data?: { search?: { edges?: Array<{ node?: unknown; textMatches?: unknown[] }> } } }>(this.runtime, ghGraphqlArgs(GITHUB_DISCUSSION_SEARCH_QUERY, {
      searchQuery: discussionSearchQuery(input),
      first: input.limit,
    }), signal);
    const edges = payload.data?.search?.edges ?? [];
    return edges
      .map((edge): Record<string, unknown> | undefined => edge.node && typeof edge.node === 'object' ? { ...(edge.node as Record<string, unknown>), text_matches: edge.textMatches } : undefined)
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  async getDiscussion(input: GitHubDiscussionGetRequest, signal?: AbortSignal): Promise<GitHubRawDiscussion | null> {
    let cursor: string | undefined;
    let remainingOffset = input.commentsOffset;
    const collected: unknown[] = [];
    let discussion: Record<string, unknown> | undefined;
    let totalCount: unknown;
    let pageInfo: Record<string, unknown> | undefined;

    while (collected.length < input.commentsLimit) {
      const first = Math.min(GITHUB_COMMENTS_PAGE_SIZE, remainingOffset + input.commentsLimit - collected.length);
      const payload = await ghJson<{ data?: { repository?: { discussion?: Record<string, unknown> | null } } }>(this.runtime, ghGraphqlArgs(GITHUB_DISCUSSION_GET_QUERY, {
        owner: input.owner,
        name: input.repo,
        number: input.discussionNumber,
        commentsFirst: first,
        commentsAfter: cursor,
      }), signal);
      const current = payload.data?.repository?.discussion;
      if (!current) return null;
      discussion ??= current;
      const comments = current.comments as { nodes?: unknown[]; totalCount?: unknown; pageInfo?: Record<string, unknown> } | undefined;
      const nodes = Array.isArray(comments?.nodes) ? comments.nodes : [];
      totalCount = comments?.totalCount;
      pageInfo = comments?.pageInfo;
      const visible = remainingOffset > 0 ? nodes.slice(remainingOffset) : nodes;
      collected.push(...visible);
      remainingOffset = Math.max(0, remainingOffset - nodes.length);
      cursor = typeof pageInfo?.endCursor === 'string' ? pageInfo.endCursor : undefined;
      if (!pageInfo?.hasNextPage || !cursor) break;
    }

    return {
      ...discussion,
      comments: {
        totalCount,
        nodes: collected.slice(0, input.commentsLimit),
        pageInfo,
      },
    };
  }

  async searchIssues(input: GitHubIssueSearchRequest, signal?: AbortSignal): Promise<GitHubRawIssueSearchItem[]> {
    const payload = await ghJson<{ items?: unknown[] }>(this.runtime, [
      'api',
      '-X', 'GET',
      'search/issues',
      '-f', `q=${issueSearchQuery(input)}`,
      '-f', `per_page=${input.limit}`,
    ], signal);
    return (payload.items ?? []) as GitHubRawIssueSearchItem[];
  }

  async getIssue(input: GitHubIssueRef, signal?: AbortSignal): Promise<GitHubRawIssue | null> {
    try {
      return await ghJson<GitHubRawIssue>(this.runtime, [
        'api',
        `repos/${input.owner}/${input.repo}/issues/${input.issueNumber}`,
      ], signal);
    } catch (error) {
      if (error instanceof ProviderFailure && error.toolError.category === 'not_found') {
        return null;
      }
      throw error;
    }
  }

  async listIssueComments(input: GitHubIssueCommentsRequest, signal?: AbortSignal): Promise<GitHubRawIssueComment[]> {
    const { page, index } = commentsPageForOffset(input.offset);
    const firstPage = await this.listIssueCommentsPage(input, page, signal);
    const needsNextPage = index + input.limit > GITHUB_COMMENTS_PAGE_SIZE && firstPage.length === GITHUB_COMMENTS_PAGE_SIZE;
    const combined = needsNextPage
      ? firstPage.concat(await this.listIssueCommentsPage(input, page + 1, signal))
      : firstPage;
    return combined.slice(index, index + input.limit);
  }

  private listIssueCommentsPage(input: GitHubIssueCommentsRequest, page: number, signal?: AbortSignal): Promise<GitHubRawIssueComment[]> {
    return ghJson<GitHubRawIssueComment[]>(this.runtime, [
      'api',
      '-X', 'GET',
      `repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`,
      '-f', `per_page=${GITHUB_COMMENTS_PAGE_SIZE}`,
      '-f', `page=${page}`,
    ], signal);
  }

  async listIssueTimelineEvents(input: GitHubIssueRef, signal?: AbortSignal): Promise<GitHubRawIssueTimelineEvent[]> {
    return this.listTimelineEvents(input.owner, input.repo, input.issueNumber, signal);
  }

  async searchPullRequests(input: GitHubPullRequestSearchRequest, signal?: AbortSignal): Promise<GitHubRawIssueSearchItem[]> {
    const payload = await ghJson<{ items?: unknown[] }>(this.runtime, [
      'api',
      '-X', 'GET',
      'search/issues',
      '-f', `q=${pullRequestSearchQuery(input)}`,
      '-f', `per_page=${input.limit}`,
    ], signal);
    return (payload.items ?? []) as GitHubRawIssueSearchItem[];
  }

  async getPullRequest(input: GitHubPullRequestRef, signal?: AbortSignal): Promise<GitHubRawPullRequest | null> {
    try {
      return await ghJson<GitHubRawPullRequest>(this.runtime, [
        'api',
        `repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}`,
      ], signal);
    } catch (error) {
      if (error instanceof ProviderFailure && error.toolError.category === 'not_found') {
        return null;
      }
      throw error;
    }
  }

  async listPullRequestReviewComments(input: GitHubPullRequestRef & { limit: number; offset: number }, signal?: AbortSignal): Promise<GitHubRawPullRequestComment[]> {
    const { page, index } = commentsPageForOffset(input.offset);
    const firstPage = await this.listPullRequestReviewCommentsPage(input, page, signal);
    const needsNextPage = index + input.limit > GITHUB_COMMENTS_PAGE_SIZE && firstPage.length === GITHUB_COMMENTS_PAGE_SIZE;
    const combined = needsNextPage ? firstPage.concat(await this.listPullRequestReviewCommentsPage(input, page + 1, signal)) : firstPage;
    return combined.slice(index, index + input.limit);
  }

  private listPullRequestReviewCommentsPage(input: GitHubPullRequestRef, page: number, signal?: AbortSignal): Promise<GitHubRawPullRequestComment[]> {
    return ghJson<GitHubRawPullRequestComment[]>(this.runtime, [
      'api',
      '-X', 'GET',
      `repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/comments`,
      '-f', `per_page=${GITHUB_COMMENTS_PAGE_SIZE}`,
      '-f', `page=${page}`,
    ], signal);
  }

  async listPullRequestReviews(input: GitHubPullRequestRef, signal?: AbortSignal): Promise<GitHubRawPullRequestReview[]> {
    return ghJson<GitHubRawPullRequestReview[]>(this.runtime, [
      'api',
      '-X', 'GET',
      `repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/reviews`,
      '-f', 'per_page=10',
      '-f', 'page=1',
    ], signal);
  }

  async listReleases(input: GitHubReleasesGetRequest, signal?: AbortSignal): Promise<GitHubRawRelease[]> {
    return ghJson<GitHubRawRelease[]>(this.runtime, [
      'api',
      '-X', 'GET',
      `repos/${input.owner}/${input.repo}/releases`,
      '-f', `per_page=${input.limit}`,
      '-f', 'page=1',
    ], signal);
  }

  async getReleaseByTag(input: GitHubReleaseGetRequest, signal?: AbortSignal): Promise<GitHubRawRelease | null> {
    try {
      return await ghJson<GitHubRawRelease>(this.runtime, [
        'api',
        '-X', 'GET',
        `repos/${input.owner}/${input.repo}/releases/tags/${input.tag}`,
      ], signal);
    } catch (error) {
      if (error instanceof ProviderFailure && error.toolError.category === 'not_found') {
        return null;
      }
      throw error;
    }
  }

  private async listTimelineEvents(owner: string, repo: string, issueNumber: number, signal?: AbortSignal): Promise<GitHubRawIssueTimelineEvent[]> {
    const events: GitHubRawIssueTimelineEvent[] = [];
    for (let page = 1; page <= GITHUB_TIMELINE_MAX_PAGES; page += 1) {
      const pageEvents = await ghJson<GitHubRawIssueTimelineEvent[]>(this.runtime, [
        'api',
        '-X', 'GET',
        `repos/${owner}/${repo}/issues/${issueNumber}/timeline`,
        '-f', `per_page=${GITHUB_TIMELINE_PAGE_SIZE}`,
        '-f', `page=${page}`,
      ], signal);
      events.push(...pageEvents);
      if (pageEvents.length < GITHUB_TIMELINE_PAGE_SIZE) {
        break;
      }
    }
    return events;
  }
}

export function createGitHubClient(runtime: WebsearchRuntime): GitHubClient {
  return runtime.config.github.provider === 'gh'
    ? new GhGitHubClient(runtime)
    : new OctokitGitHubClient(runtime);
}
