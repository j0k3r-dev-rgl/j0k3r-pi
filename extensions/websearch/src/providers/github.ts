import { Octokit } from 'octokit';
import { ProviderFailure, githubProviderErrorFromError } from '../security.js';
import type {
  GitHubClient,
  GitHubIssueCommentsRequest,
  GitHubIssueRef,
  GitHubIssueSearchRequest,
  GitHubRawIssue,
  GitHubRawIssueComment,
  GitHubRawIssueSearchItem,
  WebsearchRuntime,
} from '../types.js';

function issueSearchQuery(input: GitHubIssueSearchRequest): string {
  const parts = [input.query.trim(), 'is:issue'];
  if (input.repo) {
    parts.push(`repo:${input.repo}`);
  }
  if (input.state) {
    parts.push(`is:${input.state}`);
  }
  return parts.filter(Boolean).join(' ');
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
    try {
      const response = await this.octokit.rest.issues.listComments({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issueNumber,
        per_page: input.limit,
        page: 1,
        request: signal ? { signal } : undefined,
      });
      return response.data as unknown as GitHubRawIssueComment[];
    } catch (error) {
      throw new ProviderFailure(githubProviderErrorFromError(error));
    }
  }
}

export function createGitHubClient(runtime: WebsearchRuntime): GitHubClient {
  return new OctokitGitHubClient(runtime);
}
