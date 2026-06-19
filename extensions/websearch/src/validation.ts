import type {
  DevtoArticleSearchRequest,
  DevtoCommentsRequest,
  GitHubIssueGetRequest,
  GitHubIssueRef,
  GitHubIssueSearchRequest,
  GitHubReleaseGetRequest,
  GitHubPullRequestGetRequest,
  GitHubPullRequestRef,
  GitHubPullRequestSearchRequest,
  GitHubReleasesGetRequest,
  HackerNewsSearchRequest,
  HackerNewsStoryRequest,
  StackOverflowAnswersRequest,
  StackOverflowCommentsRequest,
  StackOverflowQuestionRef,
  StackOverflowSearchRequest,
} from './types.js';

export const SEARCH_DEFAULT_LIMIT = 5;
export const SEARCH_MAX_LIMIT = 10;
const STACK_OVERFLOW_ANSWERS_DEFAULT_LIMIT = 10;
const STACK_OVERFLOW_ANSWERS_MAX_LIMIT = 30;
const STACK_OVERFLOW_COMMENTS_DEFAULT_LIMIT = 10;
const STACK_OVERFLOW_COMMENTS_MAX_LIMIT = 30;
export const GITHUB_COMMENTS_DEFAULT_LIMIT = 5;
export const GITHUB_COMMENTS_MAX_LIMIT = 20;
export const DEVTO_TOP_LEVEL_COMMENTS_DEFAULT_LIMIT = 10;
export const DEVTO_TOTAL_COMMENTS_MAX = 25;
export const DEVTO_MAX_DEPTH = 2;
export const HN_COMMENTS_DEFAULT_LIMIT = 10;
export const HN_COMMENTS_MAX_LIMIT = 25;
export const HN_MAX_DEPTH = 3;

export class ValidationError extends Error {
  readonly code = 'validation_error' as const;
}

type Input = Record<string, unknown>;

function asInput(value: unknown): Input {
  return value && typeof value === 'object' ? (value as Input) : {};
}

function requiredString(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${key} is required.`);
  }
  return value.trim();
}

function requiredInteger(input: Input, key: string): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${key} must be an integer.`);
  }
  if (value < 1) {
    throw new ValidationError(`${key} must be at least 1.`);
  }
  return value;
}

function optionalString(input: Input, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${key} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function boundedInteger(input: Input, key: string, defaultValue: number, max: number): number {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${key} must be an integer.`);
  }
  if (value < 1) {
    throw new ValidationError(`${key} must be at least 1.`);
  }
  if (value > max) {
    throw new ValidationError(`${key} must be at most ${max}.`);
  }
  return value;
}

function optionalBoolean(input: Input, key: string, defaultValue: boolean): boolean {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${key} must be a boolean.`);
  }
  return value;
}

function boundedOffset(input: Input, key: string, defaultValue: number): number {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${key} must be an integer.`);
  }
  if (value < 0) {
    throw new ValidationError(`${key} must be at least 0.`);
  }
  return value;
}

function parseStackOverflowQuestion(raw: string): StackOverflowQuestionRef {
  const value = raw.trim();
  if (/^\d+$/.test(value)) {
    return { questionId: value, url: `https://stackoverflow.com/questions/${value}` };
  }
  try {
    const url = new URL(value);
    if (!/(^|\.)stackoverflow\.com$/i.test(url.hostname)) {
      throw new ValidationError('question must be a Stack Overflow question id or url.');
    }
    const match = /\/questions\/(\d+)/.exec(url.pathname);
    if (!match) {
      throw new ValidationError('Stack Overflow url must include a question id.');
    }
    return { questionId: match[1]!, url: url.toString() };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('question must be a Stack Overflow question id or url.');
  }
}

function parseGitHubRepoScope(value: string): { owner: string; repo: string } {
  const match = /^(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)$/.exec(value.trim());
  if (!match?.groups?.owner || !match.groups.repo) {
    throw new ValidationError('repo must be an owner/repo reference.');
  }
  return { owner: match.groups.owner, repo: match.groups.repo };
}

export function validateGitHubIssueRef(value: unknown): GitHubIssueRef {
  const raw = requiredString(asInput(value), 'issue');
  const refMatch = /^(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)#(?<issueNumber>\d+)$/.exec(raw);
  if (refMatch?.groups?.owner && refMatch.groups.repo && refMatch.groups.issueNumber) {
    return {
      owner: refMatch.groups.owner,
      repo: refMatch.groups.repo,
      issueNumber: Number(refMatch.groups.issueNumber),
      url: `https://github.com/${refMatch.groups.owner}/${refMatch.groups.repo}/issues/${refMatch.groups.issueNumber}`,
    };
  }

  try {
    const url = new URL(raw);
    if (!/(^|\.)github\.com$/i.test(url.hostname)) {
      throw new ValidationError('issue must be a GitHub issue url or owner/repo#number reference.');
    }
    const match = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)$/.exec(url.pathname);
    if (!match) {
      throw new ValidationError('GitHub issue url must include /owner/repo/issues/number.');
    }
    return {
      owner: match[1]!,
      repo: match[2]!,
      issueNumber: Number(match[3]!),
      url: `https://github.com/${match[1]!}/${match[2]!}/issues/${match[3]!}`,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('issue must be a GitHub issue url or owner/repo#number reference.');
  }
}

function optionalGitHubState(input: Input, key: string): 'open' | 'closed' | 'all' | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value !== 'open' && value !== 'closed' && value !== 'all') {
    throw new ValidationError(`${key} must be "open", "closed", or "all".`);
  }
  return value;
}

function optionalGitHubPullRequestState(input: Input, key: string): 'open' | 'closed' | 'merged' | 'all' | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value !== 'open' && value !== 'closed' && value !== 'merged' && value !== 'all') {
    throw new ValidationError(`${key} must be "open", "closed", "merged", or "all".`);
  }
  return value;
}

export function validateGitHubPullRequestRef(value: unknown): GitHubPullRequestRef {
  const raw = requiredString(asInput(value), 'pull_request');
  const refMatch = /^(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)#(?<pullNumber>\d+)$/.exec(raw);
  if (refMatch?.groups?.owner && refMatch.groups.repo && refMatch.groups.pullNumber) {
    return {
      owner: refMatch.groups.owner,
      repo: refMatch.groups.repo,
      pullNumber: Number(refMatch.groups.pullNumber),
      url: `https://github.com/${refMatch.groups.owner}/${refMatch.groups.repo}/pull/${refMatch.groups.pullNumber}`,
    };
  }

  try {
    const url = new URL(raw);
    if (!/(^|\.)github\.com$/i.test(url.hostname)) {
      throw new ValidationError('pull_request must be a GitHub pull request url or owner/repo#number reference.');
    }
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(url.pathname);
    if (!match) {
      throw new ValidationError('GitHub pull request url must include /owner/repo/pull/number.');
    }
    return {
      owner: match[1]!,
      repo: match[2]!,
      pullNumber: Number(match[3]!),
      url: `https://github.com/${match[1]!}/${match[2]!}/pull/${match[3]!}`,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('pull_request must be a GitHub pull request url or owner/repo#number reference.');
  }
}

export function validateStackOverflowSearch(value: unknown): StackOverflowSearchRequest {
  const input = asInput(value);
  return {
    query: requiredString(input, 'query'),
    limit: boundedInteger(input, 'limit', SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT),
  };
}

export function validateStackOverflowQuestionRef(value: unknown): StackOverflowQuestionRef {
  return parseStackOverflowQuestion(requiredString(asInput(value), 'question'));
}

export function validateStackOverflowAnswers(value: unknown): StackOverflowAnswersRequest {
  const input = asInput(value);
  return {
    ...parseStackOverflowQuestion(requiredString(input, 'question')),
    limit: boundedInteger(input, 'limit', STACK_OVERFLOW_ANSWERS_DEFAULT_LIMIT, STACK_OVERFLOW_ANSWERS_MAX_LIMIT),
  };
}

export function validateStackOverflowComments(value: unknown): StackOverflowCommentsRequest {
  const input = asInput(value);
  return {
    ...parseStackOverflowQuestion(requiredString(input, 'question')),
    commentsLimit: boundedInteger(input, 'commentsLimit', STACK_OVERFLOW_COMMENTS_DEFAULT_LIMIT, STACK_OVERFLOW_COMMENTS_MAX_LIMIT),
    commentsOffset: boundedOffset(input, 'commentsOffset', 0),
  };
}

export function validateGitHubIssueSearch(value: unknown): GitHubIssueSearchRequest {
  const input = asInput(value);
  const repoInput = optionalString(input, 'repo');
  if (repoInput) {
    parseGitHubRepoScope(repoInput);
  }
  return {
    query: requiredString(input, 'query'),
    limit: boundedInteger(input, 'limit', SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT),
    repo: repoInput,
    state: optionalGitHubState(input, 'state'),
  };
}

export function validateGitHubIssueGet(value: unknown): GitHubIssueGetRequest {
  const input = asInput(value);
  return {
    ...validateGitHubIssueRef(input),
    commentsLimit: boundedInteger(input, 'commentsLimit', GITHUB_COMMENTS_DEFAULT_LIMIT, GITHUB_COMMENTS_MAX_LIMIT),
    commentsOffset: boundedOffset(input, 'commentsOffset', 0),
  };
}

export function validateGitHubPullRequestSearch(value: unknown): GitHubPullRequestSearchRequest {
  const input = asInput(value);
  const repoInput = optionalString(input, 'repo');
  if (repoInput) {
    parseGitHubRepoScope(repoInput);
  }
  return {
    query: requiredString(input, 'query'),
    limit: boundedInteger(input, 'limit', SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT),
    repo: repoInput,
    state: optionalGitHubPullRequestState(input, 'state'),
  };
}

export function validateGitHubPullRequestGet(value: unknown): GitHubPullRequestGetRequest {
  const input = asInput(value);
  return {
    ...validateGitHubPullRequestRef(input),
    commentsLimit: boundedInteger(input, 'commentsLimit', GITHUB_COMMENTS_DEFAULT_LIMIT, GITHUB_COMMENTS_MAX_LIMIT),
    commentsOffset: boundedOffset(input, 'commentsOffset', 0),
    reviewCommentsLimit: boundedInteger(input, 'reviewCommentsLimit', GITHUB_COMMENTS_DEFAULT_LIMIT, GITHUB_COMMENTS_MAX_LIMIT),
    reviewCommentsOffset: boundedOffset(input, 'reviewCommentsOffset', 0),
  };
}

export function validateGitHubReleasesGet(value: unknown): GitHubReleasesGetRequest {
  const input = asInput(value);
  const repo = parseGitHubRepoScope(requiredString(input, 'repo'));
  return {
    owner: repo.owner,
    repo: repo.repo,
    limit: boundedInteger(input, 'limit', SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT),
    includePrereleases: optionalBoolean(input, 'includePrereleases', false),
  };
}

export function validateGitHubReleaseGet(value: unknown): GitHubReleaseGetRequest {
  const input = asInput(value);
  const repo = parseGitHubRepoScope(requiredString(input, 'repo'));
  return {
    owner: repo.owner,
    repo: repo.repo,
    tag: requiredString(input, 'tag'),
  };
}

export function validateDevtoArticleSearch(value: unknown): DevtoArticleSearchRequest {
  const input = asInput(value);
  return {
    tag: requiredString(input, 'tag'),
    limit: boundedInteger(input, 'limit', SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT),
  };
}

export function validateDevtoCommentsGet(value: unknown): DevtoCommentsRequest {
  const input = asInput(value);
  return {
    articleId: requiredInteger(input, 'article_id'),
    topLevelLimit: boundedInteger(input, 'topLevelLimit', DEVTO_TOP_LEVEL_COMMENTS_DEFAULT_LIMIT, DEVTO_TOTAL_COMMENTS_MAX),
    topLevelOffset: boundedOffset(input, 'topLevelOffset', 0),
    totalLimit: DEVTO_TOTAL_COMMENTS_MAX,
    maxDepth: DEVTO_MAX_DEPTH,
  };
}

export function validateHackerNewsSearch(value: unknown): HackerNewsSearchRequest {
  const input = asInput(value);
  return {
    query: requiredString(input, 'query'),
    limit: boundedInteger(input, 'limit', SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT),
  };
}

export function validateHackerNewsStoryGet(value: unknown): HackerNewsStoryRequest {
  const input = asInput(value);
  return {
    storyId: requiredInteger(input, 'story_id'),
    commentsLimit: boundedInteger(input, 'commentsLimit', HN_COMMENTS_DEFAULT_LIMIT, HN_COMMENTS_MAX_LIMIT),
    commentsOffset: boundedOffset(input, 'commentsOffset', 0),
    maxDepth: HN_MAX_DEPTH,
  };
}
