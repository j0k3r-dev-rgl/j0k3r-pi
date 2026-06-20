import {
  normalizeGitHubIssue,
  normalizeGitHubIssueComment,
  normalizeGitHubIssueRelations,
  normalizeGitHubPullRequest,
  normalizeGitHubPullRequestReview,
  normalizeGitHubPullRequestReviewComment,
  normalizeGitHubRelease,
} from '../../normalize.js';
import {
  githubIssueParameters,
  githubPullRequestParameters,
  githubPullRequestSearchParameters,
  githubReleaseParameters,
  githubReleasesParameters,
  githubSearchParameters,
} from '../../schemas/discussions/github.js';
import {
  githubIssueSummary,
  githubPullRequestSearchSummary,
  githubPullRequestSummary,
  githubReleaseSummary,
  githubReleasesSummary,
  githubSearchSummary,
} from '../../summaries/discussions/github.js';
import type {
  GitHubIssueDetailResult,
  GitHubIssueSearchResult,
  GitHubPullRequestDetailResult,
  GitHubPullRequestSearchResult,
  GitHubReleaseResult,
  GitHubReleasesResult,
  PiToolResult,
  RegisterWebsearchToolsDeps,
} from '../../types.js';
import {
  GITHUB_COMMENTS_DEFAULT_LIMIT,
  GITHUB_COMMENTS_MAX_LIMIT,
  validateGitHubIssueGet,
  validateGitHubIssueSearch,
  validateGitHubPullRequestGet,
  validateGitHubPullRequestSearch,
  validateGitHubReleaseGet,
  validateGitHubReleasesGet,
} from '../../validation.js';
import { buildFailure, buildSuccess, toToolError } from '../result.js';
import { clientsFromDeps, signalFromContext, type ExecuteContext } from '../runtime.js';
import { registerTool, type WebsearchToolModule } from '../registry.js';

export const githubToolNames = [
  'search_github_issues',
  'github_issue_get',
  'search_github_pull_requests',
  'github_pull_request_get',
  'github_releases_get',
  'github_release_get',
] as const;

export const githubTools: WebsearchToolModule<typeof githubToolNames[number]> = {
  names: githubToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'search_github_issues',
      description: 'Search public GitHub issues with bounded read-only results.',
      parameters: githubSearchParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<GitHubIssueSearchResult>> {
        try {
          const input = validateGitHubIssueSearch(params);
          const signal = signalFromContext(context);
          const github = clientsFromDeps(deps).github;
          const rawItems = await github.searchIssues(input, signal);
          const items = await Promise.all(rawItems.map(async (raw) => {
            const normalized = normalizeGitHubIssue(raw);
            const [owner, repo] = normalized.repository.split('/');
            if (!owner || !repo || !normalized.number) return normalized;
            const relations = normalizeGitHubIssueRelations(await github.listIssueTimelineEvents({ owner, repo, issueNumber: normalized.number, url: normalized.url }, signal));
            return { ...normalized, related_pull_requests: relations.pull_requests, related_issues: relations.issues };
          }));
          const data = { ...input, items };
          return buildSuccess(githubSearchSummary(data), data, 5000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'github_issue_get',
      description: 'Fetch a GitHub issue by URL or owner/repo#number with bounded comments.',
      parameters: githubIssueParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<GitHubIssueDetailResult>> {
        try {
          const input = validateGitHubIssueGet(params);
          const signal = signalFromContext(context);
          const github = clientsFromDeps(deps).github;
          const rawIssue = await github.getIssue(input, signal);
          if (!rawIssue) return buildFailure({ code: 'not_found', category: 'not_found', message: 'GitHub issue was not found.', recoverable: true, provider: 'github' });
          const comments = (await github.listIssueComments({ ...input, limit: input.commentsLimit, offset: input.commentsOffset }, signal)).map(normalizeGitHubIssueComment);
          const relations = normalizeGitHubIssueRelations(await github.listIssueTimelineEvents(input, signal));
          const normalized = normalizeGitHubIssue(rawIssue);
          const data: GitHubIssueDetailResult = {
            ...normalized,
            related_pull_requests: relations.pull_requests,
            related_issues: relations.issues,
            comments,
            comments_limit: input.commentsLimit,
            comments_offset: input.commentsOffset,
            next_comments_offset: comments.length === input.commentsLimit ? input.commentsOffset + comments.length : undefined,
            bounds: { comments_default: GITHUB_COMMENTS_DEFAULT_LIMIT, comments_max: GITHUB_COMMENTS_MAX_LIMIT },
          };
          return buildSuccess(githubIssueSummary(data), data, 12000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'search_github_pull_requests',
      description: 'Search public GitHub pull requests with bounded read-only results.',
      parameters: githubPullRequestSearchParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<GitHubPullRequestSearchResult>> {
        try {
          const input = validateGitHubPullRequestSearch(params);
          const signal = signalFromContext(context);
          const github = clientsFromDeps(deps).github;
          const rawItems = await github.searchPullRequests(input, signal);
          const items = await Promise.all(rawItems.map(async (raw) => {
            const normalized = normalizeGitHubPullRequest(raw);
            const [owner, repo] = normalized.repository.split('/');
            if (!owner || !repo || !normalized.number) return normalized;
            const relations = normalizeGitHubIssueRelations(await github.listIssueTimelineEvents({ owner, repo, issueNumber: normalized.number, url: normalized.url }, signal));
            return { ...normalized, related_pull_requests: relations.pull_requests, related_issues: relations.issues };
          }));
          const data = { ...input, items };
          return buildSuccess(githubPullRequestSearchSummary(data), data, 5000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'github_pull_request_get',
      description: 'Fetch a GitHub pull request by URL or owner/repo#number with bounded comments and review comments.',
      parameters: githubPullRequestParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<GitHubPullRequestDetailResult>> {
        try {
          const input = validateGitHubPullRequestGet(params);
          const signal = signalFromContext(context);
          const github = clientsFromDeps(deps).github;
          const rawPullRequest = await github.getPullRequest(input, signal);
          if (!rawPullRequest) return buildFailure({ code: 'not_found', category: 'not_found', message: 'GitHub pull request was not found.', recoverable: true, provider: 'github' });
          const comments = (await github.listIssueComments({ owner: input.owner, repo: input.repo, issueNumber: input.pullNumber, url: input.url, limit: input.commentsLimit, offset: input.commentsOffset }, signal)).map(normalizeGitHubIssueComment);
          const reviewComments = (await github.listPullRequestReviewComments({ ...input, limit: input.reviewCommentsLimit, offset: input.reviewCommentsOffset }, signal)).map(normalizeGitHubPullRequestReviewComment);
          const reviews = (await github.listPullRequestReviews(input, signal)).map(normalizeGitHubPullRequestReview);
          const relations = normalizeGitHubIssueRelations(await github.listIssueTimelineEvents({ owner: input.owner, repo: input.repo, issueNumber: input.pullNumber, url: input.url }, signal));
          const normalized = normalizeGitHubPullRequest(rawPullRequest);
          const data: GitHubPullRequestDetailResult = {
            ...normalized,
            related_pull_requests: relations.pull_requests,
            related_issues: relations.issues,
            comments,
            review_comments: reviewComments,
            reviews,
            comments_limit: input.commentsLimit,
            comments_offset: input.commentsOffset,
            next_comments_offset: comments.length === input.commentsLimit ? input.commentsOffset + comments.length : undefined,
            review_comments_limit: input.reviewCommentsLimit,
            review_comments_offset: input.reviewCommentsOffset,
            next_review_comments_offset: reviewComments.length === input.reviewCommentsLimit ? input.reviewCommentsOffset + reviewComments.length : undefined,
            bounds: { comments_default: GITHUB_COMMENTS_DEFAULT_LIMIT, comments_max: GITHUB_COMMENTS_MAX_LIMIT },
          };
          return buildSuccess(githubPullRequestSummary(data), data, 14000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'github_releases_get',
      description: 'Fetch recent GitHub releases for a repository with bounded read-only results.',
      parameters: githubReleasesParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<GitHubReleasesResult>> {
        try {
          const input = validateGitHubReleasesGet(params);
          const rawReleases = await clientsFromDeps(deps).github.listReleases(input, signalFromContext(context));
          const allItems = rawReleases.map((release) => normalizeGitHubRelease(release, `${input.owner}/${input.repo}`));
          const filtered = input.includePrereleases ? allItems : allItems.filter((release) => release.prerelease !== true);
          const data: GitHubReleasesResult = {
            repository: `${input.owner}/${input.repo}`,
            limit: input.limit,
            include_prereleases: input.includePrereleases,
            items: filtered.slice(0, input.limit),
          };
          return buildSuccess(githubReleasesSummary(data), data, 8000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'github_release_get',
      description: 'Fetch one GitHub release by repository and tag with bounded read-only output.',
      parameters: githubReleaseParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<GitHubReleaseResult>> {
        try {
          const input = validateGitHubReleaseGet(params);
          const rawRelease = await clientsFromDeps(deps).github.getReleaseByTag(input, signalFromContext(context));
          if (!rawRelease) return buildFailure({ code: 'not_found', category: 'not_found', message: 'GitHub release was not found for the requested tag.', recoverable: true, provider: 'github' });
          const data = normalizeGitHubRelease(rawRelease, `${input.owner}/${input.repo}`);
          return buildSuccess(githubReleaseSummary(data), data, 8000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
