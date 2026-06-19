import { Octokit } from 'octokit';
import { ProviderFailure, githubProviderErrorFromError, redactText } from '../security.js';
import type {
  GitHubClient,
  GitHubIssueCommentsRequest,
  GitHubIssueRef,
  GitHubIssueSearchRequest,
  GitHubPullRequestRef,
  GitHubPullRequestSearchRequest,
  GitHubRawIssue,
  GitHubRawIssueComment,
  GitHubRawIssueSearchItem,
  GitHubRawIssueTimelineEvent,
  GitHubRawPullRequest,
  GitHubRawPullRequestComment,
  GitHubRawPullRequestReview,
  WebsearchRuntime,
} from '../types.js';

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

class OctokitGitHubClient implements GitHubClient {
  private readonly octokit: Octokit;

  constructor(runtime: WebsearchRuntime) {
    this.octokit = new Octokit(runtime.env.GITHUB_TOKEN ? { auth: runtime.env.GITHUB_TOKEN } : {});
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
