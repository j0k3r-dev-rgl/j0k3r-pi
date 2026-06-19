import { execFile } from 'node:child_process';
import { Type } from 'typebox';
import { createWebsearchClients } from './client.js';
import { loadWebsearchConfig, WebsearchConfigError } from './config.js';
import {
  normalizeDevtoArticle,
  normalizeDevtoComments,
  normalizeGitHubIssue,
  normalizeGitHubIssueComment,
  normalizeGitHubIssueRelations,
  normalizeGitHubPullRequest,
  normalizeGitHubPullRequestReview,
  normalizeGitHubPullRequestReviewComment,
  normalizeGitHubRelease,
  normalizeHackerNewsStory,
  normalizeHackerNewsStoryDetail,
  normalizeStackOverflowAnswer,
  normalizeStackOverflowComment,
  normalizeStackOverflowQuestion,
} from './normalize.js';
import { ProviderFailure, isAbortLike, redactSecretsDeep, truncateText } from './security.js';
import type {
  DevtoArticleSearchResult,
  DevtoCommentsResult,
  GitHubIssueDetailResult,
  GitHubIssueSearchResult,
  GitHubPullRequestDetailResult,
  GitHubPullRequestSearchResult,
  GitHubReleaseResult,
  GitHubReleasesResult,
  HackerNewsSearchResult,
  HackerNewsStoryDetailResult,
  NormalizedStackOverflowQuestion,
  PiToolResult,
  RegisterWebsearchToolsDeps,
  StackOverflowAnswersResult,
  StackOverflowCommentsResult,
  StackOverflowSearchResult,
  ToolError,
  WebsearchRuntime,
} from './types.js';
import {
  GITHUB_COMMENTS_DEFAULT_LIMIT,
  GITHUB_COMMENTS_MAX_LIMIT,
  validateDevtoArticleSearch,
  validateDevtoCommentsGet,
  validateGitHubIssueGet,
  validateGitHubIssueSearch,
  validateGitHubPullRequestGet,
  validateGitHubPullRequestSearch,
  validateGitHubReleaseGet,
  validateGitHubReleasesGet,
  validateHackerNewsSearch,
  validateHackerNewsStoryGet,
  validateStackOverflowAnswers,
  validateStackOverflowComments,
  validateStackOverflowQuestionRef,
  validateStackOverflowSearch,
  ValidationError,
} from './validation.js';

export const WEBSEARCH_TOOL_NAMES = [
  'search_stack_overflow',
  'stack_overflow_question_get',
  'stack_overflow_answers_get',
  'stack_overflow_comments_get',
  'search_github_issues',
  'github_issue_get',
  'search_github_pull_requests',
  'github_pull_request_get',
  'github_releases_get',
  'github_release_get',
  'search_devto_articles',
  'devto_comments_get',
  'search_hackernews',
  'hackernews_story_get',
] as const;

type ToolName = (typeof WEBSEARCH_TOOL_NAMES)[number];
type ExecuteContext = { signal?: AbortSignal } | undefined;

const stackSearchParameters = Type.Object({
  query: Type.String(),
  limit: Type.Optional(Type.Number()),
});

const stackQuestionParameters = Type.Object({
  question: Type.String(),
});

const stackAnswersParameters = Type.Object({
  question: Type.String(),
  limit: Type.Optional(Type.Number()),
});

const stackCommentsParameters = Type.Object({
  question: Type.String(),
  commentsLimit: Type.Optional(Type.Number()),
  commentsOffset: Type.Optional(Type.Number()),
});

const githubSearchParameters = Type.Object({
  query: Type.String(),
  repo: Type.Optional(Type.String()),
  state: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('closed'), Type.Literal('all')])),
  limit: Type.Optional(Type.Number()),
});

const githubIssueParameters = Type.Object({
  issue: Type.String(),
  commentsLimit: Type.Optional(Type.Number()),
  commentsOffset: Type.Optional(Type.Number()),
});

const githubPullRequestSearchParameters = Type.Object({
  query: Type.String(),
  repo: Type.Optional(Type.String()),
  state: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('closed'), Type.Literal('merged'), Type.Literal('all')])),
  limit: Type.Optional(Type.Number()),
});

const githubPullRequestParameters = Type.Object({
  pull_request: Type.String(),
  commentsLimit: Type.Optional(Type.Number()),
  commentsOffset: Type.Optional(Type.Number()),
  reviewCommentsLimit: Type.Optional(Type.Number()),
  reviewCommentsOffset: Type.Optional(Type.Number()),
});

const githubReleasesParameters = Type.Object({
  repo: Type.String(),
  limit: Type.Optional(Type.Number()),
  includePrereleases: Type.Optional(Type.Boolean()),
});

const githubReleaseParameters = Type.Object({
  repo: Type.String(),
  tag: Type.String(),
});

const devtoSearchParameters = Type.Object({
  tag: Type.String(),
  limit: Type.Optional(Type.Number()),
});

const devtoCommentsParameters = Type.Object({
  article_id: Type.Number(),
  topLevelLimit: Type.Optional(Type.Number()),
  topLevelOffset: Type.Optional(Type.Number()),
});

const hackerNewsSearchParameters = Type.Object({
  query: Type.String(),
  limit: Type.Optional(Type.Number()),
});

const hackerNewsStoryParameters = Type.Object({
  story_id: Type.Number(),
  commentsLimit: Type.Optional(Type.Number()),
  commentsOffset: Type.Optional(Type.Number()),
});

function buildSuccess<T>(text: string, data: T, maxContentChars = 450): PiToolResult<T> {
  return {
    content: [{ type: 'text', text: truncateText(text, maxContentChars) ?? '' }],
    details: {
      status: 'success',
      data: redactSecretsDeep(data),
    },
  };
}

function buildFailure<T>(errorOrCode: ToolError | ToolError['code'], message?: string, recoverable = true): PiToolResult<T> {
  const error: ToolError = typeof errorOrCode === 'string'
    ? { code: errorOrCode, message: message ?? errorOrCode, recoverable }
    : errorOrCode;
  const safeError = redactSecretsDeep(error);
  return {
    content: [{ type: 'text', text: safeError.message }],
    details: {
      status: 'failure',
      error: safeError,
    },
    isError: true,
  };
}

function toToolError(error: unknown): ToolError {
  if (error instanceof ProviderFailure) {
    return error.toolError;
  }
  if (error instanceof ValidationError || error instanceof WebsearchConfigError) {
    return {
      code: 'validation_error',
      category: 'validation',
      message: error.message,
      recoverable: true,
    };
  }
  if (isAbortLike(error)) {
    return {
      code: 'cancelled',
      category: 'cancelled',
      message: 'Request was cancelled.',
      recoverable: true,
    };
  }
  const message = truncateText(error instanceof Error ? error.message : 'Unexpected provider error.', 500) ?? 'Unexpected provider error.';
  return {
    code: message.toLowerCase().includes('timeout') ? 'timeout' : 'provider_error',
    category: message.toLowerCase().includes('timeout') ? 'timeout' : 'unexpected',
    message,
    recoverable: true,
  };
}

function defaultCommandRunner(file: string, args: string[], options?: { signal?: AbortSignal }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, signal: options?.signal }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function timeoutSignal(timeoutMs: number, parent?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    abort();
    return { signal: controller.signal, cleanup: () => undefined };
  }
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`)), timeoutMs);
  parent?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
  };
}

async function retrying<T>(maxRetries: number, run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (isAbortLike(error) || attempt >= maxRetries) {
        throw error;
      }
    }
  }
  throw lastError;
}

function withRequestConfig(runtime: WebsearchRuntime, fetchImpl: typeof fetch, commandRunner: NonNullable<WebsearchRuntime['commandRunner']>): Pick<WebsearchRuntime, 'fetch' | 'commandRunner'> {
  const { timeoutMs, maxRetries } = runtime.config.request;
  return {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => retrying(maxRetries, async () => {
      const { signal, cleanup } = timeoutSignal(timeoutMs, init?.signal ?? undefined);
      try {
        return await fetchImpl(input, { ...init, signal });
      } finally {
        cleanup();
      }
    })) as typeof fetch,
    commandRunner: (file, args, options) => retrying(maxRetries, async () => {
      const { signal, cleanup } = timeoutSignal(timeoutMs, options?.signal);
      try {
        return await commandRunner(file, args, { ...options, signal });
      } finally {
        cleanup();
      }
    }),
  };
}

function runtimeFromDeps(deps: RegisterWebsearchToolsDeps): WebsearchRuntime {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new ProviderFailure({
      code: 'missing_configuration',
      category: 'provider_unavailable',
      message: 'A fetch implementation is required for websearch tools.',
      recoverable: true,
    });
  }
  const config = deps.config ?? loadWebsearchConfig();
  const baseRuntime: WebsearchRuntime = {
    env: deps.env ?? process.env,
    fetch: fetchImpl,
    config,
    commandRunner: deps.commandRunner ?? defaultCommandRunner,
  };
  return {
    ...baseRuntime,
    ...withRequestConfig(baseRuntime, fetchImpl, baseRuntime.commandRunner ?? defaultCommandRunner),
  };
}

function clientsFromDeps(deps: RegisterWebsearchToolsDeps) {
  if (deps.clients) {
    const runtime = runtimeFromDeps(deps);
    const fallback = deps.createClients ? deps.createClients(runtime) : createWebsearchClients(runtime);
    return {
      stackExchange: deps.clients.stackExchange ?? fallback.stackExchange,
      github: deps.clients.github ?? fallback.github,
      devto: deps.clients.devto ?? fallback.devto,
      hackerNews: deps.clients.hackerNews ?? fallback.hackerNews,
    };
  }
  const runtime = runtimeFromDeps(deps);
  return deps.createClients ? deps.createClients(runtime) : createWebsearchClients(runtime);
}

function signalFromContext(context: ExecuteContext): AbortSignal | undefined {
  return context?.signal;
}

function registerTool(pi: any, tool: { name: ToolName; description: string; parameters: unknown; execute: (...args: any[]) => Promise<unknown> }): void {
  pi.registerTool(tool);
}

function stackSearchSummary(data: StackOverflowSearchResult): string {
  if (data.items.length === 0) {
    return `No Stack Overflow results found for "${data.query}".`;
  }
  return data.items.map((item, index) => {
    const metadata = [
      `question_id: ${item.question_id}`,
      item.score === undefined ? undefined : `score: ${item.score}`,
      item.answer_count === undefined ? undefined : `answers: ${item.answer_count}`,
      item.is_answered === undefined ? undefined : `answered: ${item.is_answered ? 'yes' : 'no'}`,
      item.tags && item.tags.length > 0 ? `tags: ${item.tags.join(', ')}` : undefined,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    return `${index + 1}. ${item.title ?? item.id} — ${item.url}${metadata ? ` (${metadata})` : ''}${snippet}`;
  }).join('\n');
}

function stackQuestionSummary(data: NormalizedStackOverflowQuestion): string {
  const metadata = [
    `question_id: ${data.question_id}`,
    data.score === undefined ? undefined : `score: ${data.score}`,
    data.answer_count === undefined ? undefined : `answers: ${data.answer_count}`,
    data.is_answered === undefined ? undefined : `answered: ${data.is_answered ? 'yes' : 'no'}`,
    data.accepted_answer_id === undefined ? undefined : `accepted_answer_id: ${data.accepted_answer_id}`,
    data.tags && data.tags.length > 0 ? `tags: ${data.tags.join(', ')}` : undefined,
  ].filter(Boolean).join('; ');
  return [
    data.title ?? data.id,
    data.url,
    metadata,
    `use stack_overflow_answers_get with question: ${data.question_id}`,
    `use stack_overflow_comments_get with question: ${data.question_id}`,
    data.body,
  ].filter(Boolean).join('\n');
}

function stackAnswersSummary(data: StackOverflowAnswersResult): string {
  if (data.answers.length === 0) {
    return `No Stack Overflow answers found for ${data.questionId}.`;
  }
  return data.answers.map((answer, index) => `${index + 1}. ${answer.accepted ? '[accepted] ' : ''}${answer.author ?? 'unknown'}: ${answer.body ?? ''}`).join('\n');
}

function stackCommentsSummary(data: StackOverflowCommentsResult): string {
  if (data.comments.length === 0) {
    return `No Stack Overflow comments found for question ${data.question_id}.`;
  }
  const comments = data.comments.map((comment, index) => `${data.comments_offset + index + 1}. ${comment.author ?? 'unknown'}: ${comment.body ?? ''}`);
  const continuation = data.has_more_comments && data.next_comments_offset !== undefined ? `next_comments_offset: ${data.next_comments_offset}` : undefined;
  return [`Stack Overflow comments for question ${data.question_id}`, ...comments, continuation].filter(Boolean).join('\n');
}

function githubRelationsSummary(item: { related_pull_requests?: GitHubIssueSearchResult['items'][number]['related_pull_requests']; related_issues?: GitHubIssueSearchResult['items'][number]['related_issues'] }, indent = ''): string | undefined {
  const lines: string[] = [];
  if (item.related_pull_requests && item.related_pull_requests.length > 0) {
    lines.push(`${indent}related PRs: ${item.related_pull_requests.map((relation) => `${relation.ref}${relation.state ? ` (${relation.state})` : ''}`).join(', ')}`);
  }
  if (item.related_issues && item.related_issues.length > 0) {
    lines.push(`${indent}related issues: ${item.related_issues.map((relation) => `${relation.ref}${relation.state ? ` (${relation.state})` : ''}`).join(', ')}`);
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function githubSearchSummary(data: GitHubIssueSearchResult): string {
  if (data.items.length === 0) {
    return `No GitHub issues found for "${data.query}".`;
  }
  return data.items.map((item, index) => {
    const metadata = [
      item.state ? `state: ${item.state}` : undefined,
      item.comments_count === undefined ? undefined : `comments: ${item.comments_count}`,
      item.labels && item.labels.length > 0 ? `labels: ${item.labels.join(', ')}` : undefined,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    const relations = githubRelationsSummary(item, '   ');
    return `${index + 1}. ${item.title ?? item.follow_up_ref} — ${item.follow_up_ref} — ${item.url}${metadata ? ` (${metadata})` : ''}${snippet}${relations ? `\n${relations}` : ''}`;
  }).join('\n');
}

function githubIssueSummary(data: GitHubIssueDetailResult): string {
  const metadata = [
    data.follow_up_ref,
    data.state ? `state: ${data.state}` : undefined,
    data.comments_count === undefined ? undefined : `comments: ${data.comments_count}`,
    data.labels && data.labels.length > 0 ? `labels: ${data.labels.join(', ')}` : undefined,
  ].filter(Boolean).join('; ');
  const comments = data.comments.length > 0
    ? [
        `Comments offset ${data.comments_offset} limit ${data.comments_limit}`,
        ...data.comments.map((comment, index) => `${data.comments_offset + index + 1}. ${comment.author ?? 'unknown'}: ${comment.body ?? ''}`),
      ].join('\n')
    : undefined;
  const relatedPullRequests = data.related_pull_requests && data.related_pull_requests.length > 0
    ? ['Related pull requests', ...data.related_pull_requests.map((relation) => `- ${relation.ref}${relation.title ? ` — ${relation.title}` : ''}${relation.state ? ` (${relation.state})` : ''}${relation.url ? ` — ${relation.url}` : ''}`)].join('\n')
    : undefined;
  const relatedIssues = data.related_issues && data.related_issues.length > 0
    ? ['Related issues', ...data.related_issues.map((relation) => `- ${relation.ref}${relation.title ? ` — ${relation.title}` : ''}${relation.state ? ` (${relation.state})` : ''}${relation.url ? ` — ${relation.url}` : ''}`)].join('\n')
    : undefined;
  return [
    data.title ?? data.follow_up_ref,
    data.url,
    metadata,
    data.body ?? '',
    relatedPullRequests,
    relatedIssues,
    comments,
  ].filter(Boolean).join('\n');
}

function githubPullRequestSearchSummary(data: GitHubPullRequestSearchResult): string {
  if (data.items.length === 0) {
    return `No GitHub pull requests found for "${data.query}".`;
  }
  return data.items.map((item, index) => {
    const metadata = [
      item.state ? `state: ${item.state}` : undefined,
      item.merged === undefined ? undefined : `merged: ${item.merged}`,
      item.merged_at ? `merged_at: ${item.merged_at}` : undefined,
      item.comments_count === undefined ? undefined : `comments: ${item.comments_count}`,
      item.labels && item.labels.length > 0 ? `labels: ${item.labels.join(', ')}` : undefined,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    const relations = githubRelationsSummary(item, '   ');
    return `${index + 1}. ${item.title ?? item.follow_up_ref} — ${item.follow_up_ref} — ${item.url}${metadata ? ` (${metadata})` : ''}${snippet}${relations ? `\n${relations}` : ''}`;
  }).join('\n');
}

function githubPullRequestSummary(data: GitHubPullRequestDetailResult): string {
  const metadata = [
    data.follow_up_ref,
    data.state ? `state: ${data.state}` : undefined,
    data.merged === undefined ? undefined : `merged: ${data.merged}`,
    data.merged_at ? `merged_at: ${data.merged_at}` : undefined,
    data.comments_count === undefined ? undefined : `comments: ${data.comments_count}`,
    data.review_comments_count === undefined ? undefined : `review_comments: ${data.review_comments_count}`,
    data.commits_count === undefined ? undefined : `commits: ${data.commits_count}`,
    data.changed_files_count === undefined ? undefined : `changed_files: ${data.changed_files_count}`,
    data.additions === undefined ? undefined : `additions: ${data.additions}`,
    data.deletions === undefined ? undefined : `deletions: ${data.deletions}`,
  ].filter(Boolean).join('; ');
  const refs = [
    data.base_ref ? `base: ${data.base_repo ?? data.repository}:${data.base_ref}` : undefined,
    data.head_ref ? `head: ${data.head_repo ?? data.repository}:${data.head_ref}` : undefined,
  ].filter(Boolean).join('\n');
  const relatedPullRequests = data.related_pull_requests && data.related_pull_requests.length > 0
    ? ['Related pull requests', ...data.related_pull_requests.map((relation) => `- ${relation.ref}${relation.title ? ` — ${relation.title}` : ''}${relation.state ? ` (${relation.state})` : ''}${relation.url ? ` — ${relation.url}` : ''}`)].join('\n')
    : undefined;
  const relatedIssues = data.related_issues && data.related_issues.length > 0
    ? ['Related issues', ...data.related_issues.map((relation) => `- ${relation.ref}${relation.title ? ` — ${relation.title}` : ''}${relation.state ? ` (${relation.state})` : ''}${relation.url ? ` — ${relation.url}` : ''}`)].join('\n')
    : undefined;
  const comments = data.comments.length > 0
    ? [`Comments offset ${data.comments_offset} limit ${data.comments_limit}`, ...data.comments.map((comment, index) => `${data.comments_offset + index + 1}. ${comment.author ?? 'unknown'}: ${comment.body ?? ''}`)].join('\n')
    : undefined;
  const reviewComments = data.review_comments.length > 0
    ? [`Review comments offset ${data.review_comments_offset} limit ${data.review_comments_limit}`, ...data.review_comments.map((comment, index) => `${data.review_comments_offset + index + 1}. ${comment.author ?? 'unknown'}${comment.path ? ` on ${comment.path}` : ''}: ${comment.body ?? ''}`)].join('\n')
    : undefined;
  const reviews = data.reviews.length > 0
    ? ['Reviews', ...data.reviews.map((review) => `- ${review.author ?? 'unknown'}${review.state ? ` ${review.state}` : ''}${review.body ? `: ${review.body}` : ''}`)].join('\n')
    : undefined;
  return [
    data.title ?? data.follow_up_ref,
    data.url,
    metadata,
    refs,
    data.body ?? '',
    relatedPullRequests,
    relatedIssues,
    reviews,
    comments,
    reviewComments,
  ].filter(Boolean).join('\n');
}

function githubReleasesSummary(data: GitHubReleasesResult): string {
  if (data.items.length === 0) {
    return `No GitHub releases found for ${data.repository}.`;
  }
  return data.items.map((item, index) => {
    const metadata = [
      item.published_at ? `published: ${item.published_at}` : undefined,
      item.prerelease === undefined ? undefined : `prerelease: ${item.prerelease}`,
      item.draft === undefined ? undefined : `draft: ${item.draft}`,
      item.assets_count === undefined ? undefined : `assets: ${item.assets_count}`,
      item.author ? `author: ${item.author}` : undefined,
    ].filter(Boolean).join('; ');
    const body = item.body ? `\n   notes: ${item.body}` : '';
    return `${index + 1}. ${item.name ?? item.tag} — ${item.tag} — ${item.url ?? `${data.repository}/releases/tag/${item.tag}`}${metadata ? ` (${metadata})` : ''}${body}`;
  }).join('\n');
}

function githubReleaseSummary(data: GitHubReleaseResult): string {
  const metadata = [
    data.published_at ? `published: ${data.published_at}` : undefined,
    data.target_commitish ? `target: ${data.target_commitish}` : undefined,
    data.prerelease === undefined ? undefined : `prerelease: ${data.prerelease}`,
    data.draft === undefined ? undefined : `draft: ${data.draft}`,
    data.assets_count === undefined ? undefined : `assets: ${data.assets_count}`,
    data.author ? `author: ${data.author}` : undefined,
  ].filter(Boolean).join('; ');
  const body = data.body ? `\nnotes: ${data.body}` : '';
  return `${data.name ?? data.tag} — ${data.tag} — ${data.url ?? `${data.repository}/releases/tag/${data.tag}`}${metadata ? ` (${metadata})` : ''}${body}`;
}

function devtoSearchSummary(data: DevtoArticleSearchResult): string {
  if (data.items.length === 0) {
    return `No Dev.to articles found for tag "${data.tag}".`;
  }
  return data.items.map((item, index) => {
    const metadata = [
      item.author ? `author: ${item.author}` : undefined,
      item.reactions_count === undefined ? undefined : `reactions: ${item.reactions_count}`,
      item.comments_count === undefined ? undefined : `comments: ${item.comments_count}`,
      item.reading_time_minutes === undefined ? undefined : `reading: ${item.reading_time_minutes} min`,
      item.tags && item.tags.length > 0 ? `tags: ${item.tags.join(', ')}` : undefined,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    return `${index + 1}. ${item.title ?? item.id} — article_id: ${item.follow_up_article_id} — ${item.url ?? `article ${item.follow_up_article_id}`}${metadata ? ` (${metadata})` : ''}${snippet}`;
  }).join('\n');
}

function flattenDevtoCommentSummary(comments: DevtoCommentsResult['comments'], startIndex: number): string[] {
  const lines: string[] = [];
  comments.forEach((comment, index) => {
    lines.push(`${startIndex + index}. ${comment.author ?? 'unknown'}: ${comment.body ?? ''}`);
    for (const child of comment.children ?? []) {
      lines.push(`   ↳ ${child.author ?? 'unknown'}: ${child.body ?? ''}`);
    }
  });
  return lines;
}

function devtoCommentsSummary(data: DevtoCommentsResult): string {
  if (data.comments.length === 0) {
    return `No Dev.to comments found for article ${data.article_id}.`;
  }
  const continuation = data.next_top_level_offset === undefined ? undefined : `next_top_level_offset: ${data.next_top_level_offset}`;
  return [
    `Dev.to comments for article ${data.article_id}`,
    `top_level_offset: ${data.top_level_offset}; top_level_limit: ${data.top_level_limit}; returned_nodes: ${data.bounds.returned_total_nodes}`,
    ...flattenDevtoCommentSummary(data.comments, data.top_level_offset + 1),
    continuation,
  ].filter(Boolean).join('\n');
}

function hackerNewsSearchSummary(data: HackerNewsSearchResult): string {
  if (data.items.length === 0) {
    return `No Hacker News stories found for "${data.query}".`;
  }
  return data.items.map((item, index) => {
    const metadata = [
      item.author ? `author: ${item.author}` : undefined,
      item.points === undefined ? undefined : `points: ${item.points}`,
      item.comments_count === undefined ? undefined : `comments: ${item.comments_count}`,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    return `${index + 1}. ${item.title ?? item.id} — story_id: ${item.follow_up_story_id} — ${item.url ?? `story ${item.follow_up_story_id}`}${metadata ? ` (${metadata})` : ''}${snippet}`;
  }).join('\n');
}

function flattenHackerNewsCommentSummary(comments: HackerNewsStoryDetailResult['comments'], startIndex: number): string[] {
  const lines: string[] = [];
  comments.forEach((comment, index) => {
    lines.push(`${startIndex + index}. ${comment.author ?? 'unknown'}: ${comment.body ?? ''}`);
    for (const child of comment.children ?? []) {
      lines.push(`   ↳ ${child.author ?? 'unknown'}: ${child.body ?? ''}`);
    }
  });
  return lines;
}

function hackerNewsStorySummary(data: HackerNewsStoryDetailResult): string {
  const metadata = [
    `story_id: ${data.follow_up_story_id}`,
    data.author ? `author: ${data.author}` : undefined,
    data.points === undefined ? undefined : `points: ${data.points}`,
    data.comments_count === undefined ? undefined : `comments: ${data.comments_count}`,
  ].filter(Boolean).join('; ');
  const continuation = data.next_comments_offset === undefined ? undefined : `next_comments_offset: ${data.next_comments_offset}`;
  return [
    data.title ?? `Hacker News story ${data.follow_up_story_id}`,
    data.url,
    metadata,
    data.body ?? '',
    data.comments.length > 0 ? `Comments offset ${data.comments_offset} limit ${data.comments_limit}` : undefined,
    ...flattenHackerNewsCommentSummary(data.comments, data.comments_offset + 1),
    continuation,
  ].filter(Boolean).join('\n');
}

export function registerWebsearchTools(pi: any, deps: RegisterWebsearchToolsDeps = {}): void {
  registerTool(pi, {
    name: 'search_stack_overflow',
    description: 'Search public Stack Overflow questions with bounded read-only results.',
    parameters: stackSearchParameters,
    async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<StackOverflowSearchResult>> {
      try {
        const input = validateStackOverflowSearch(params);
        const items = (await clientsFromDeps(deps).stackExchange.searchQuestions(input, signalFromContext(context))).map(normalizeStackOverflowQuestion);
        const data = { ...input, items };
        return buildSuccess(stackSearchSummary(data), data, 5000);
      } catch (error) {
        return buildFailure(toToolError(error));
      }
    },
  });

  registerTool(pi, {
    name: 'stack_overflow_question_get',
    description: 'Fetch a selected Stack Overflow question by id or URL.',
    parameters: stackQuestionParameters,
    async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<NormalizedStackOverflowQuestion>> {
      try {
        const input = validateStackOverflowQuestionRef(params);
        const raw = await clientsFromDeps(deps).stackExchange.getQuestion(input, signalFromContext(context));
        if (!raw) {
          return buildFailure({ code: 'not_found', category: 'not_found', message: 'Stack Overflow question was not found.', recoverable: true, provider: 'stack_overflow' });
        }
        const data = normalizeStackOverflowQuestion(raw);
        return buildSuccess(stackQuestionSummary(data), data, 4500);
      } catch (error) {
        return buildFailure(toToolError(error));
      }
    },
  });

  registerTool(pi, {
    name: 'stack_overflow_answers_get',
    description: 'Fetch bounded Stack Overflow answers for a selected question.',
    parameters: stackAnswersParameters,
    async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<StackOverflowAnswersResult>> {
      try {
        const input = validateStackOverflowAnswers(params);
        const answers = (await clientsFromDeps(deps).stackExchange.getAnswers(input, signalFromContext(context))).map(normalizeStackOverflowAnswer);
        const data = { questionId: input.questionId, limit: input.limit, answers };
        return buildSuccess(stackAnswersSummary(data), data, 12000);
      } catch (error) {
        return buildFailure(toToolError(error));
      }
    },
  });

  registerTool(pi, {
    name: 'stack_overflow_comments_get',
    description: 'Fetch bounded Stack Overflow question comments with offset pagination.',
    parameters: stackCommentsParameters,
    async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<StackOverflowCommentsResult>> {
      try {
        const input = validateStackOverflowComments(params);
        const raw = await clientsFromDeps(deps).stackExchange.getQuestionComments(input, signalFromContext(context));
        const comments = raw.items.map(normalizeStackOverflowComment);
        const data: StackOverflowCommentsResult = {
          platform: 'stack_overflow',
          question_id: input.questionId,
          comments_limit: input.commentsLimit,
          comments_offset: input.commentsOffset,
          comments_returned: comments.length,
          has_more_comments: raw.hasMore,
          next_comments_offset: raw.hasMore ? input.commentsOffset + comments.length : undefined,
          comments,
        };
        return buildSuccess(stackCommentsSummary(data), data, 12000);
      } catch (error) {
        return buildFailure(toToolError(error));
      }
    },
  });

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
          if (!owner || !repo || !normalized.number) {
            return normalized;
          }
          const relations = normalizeGitHubIssueRelations(await github.listIssueTimelineEvents({ owner, repo, issueNumber: normalized.number, url: normalized.url }, signal));
          return {
            ...normalized,
            related_pull_requests: relations.pull_requests,
            related_issues: relations.issues,
          };
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
        if (!rawIssue) {
          return buildFailure({ code: 'not_found', category: 'not_found', message: 'GitHub issue was not found.', recoverable: true, provider: 'github' });
        }
        const comments = (await github.listIssueComments({ ...input, limit: input.commentsLimit, offset: input.commentsOffset }, signal)).map(normalizeGitHubIssueComment);
        const relations = normalizeGitHubIssueRelations(await github.listIssueTimelineEvents(input, signal));
        const data: GitHubIssueDetailResult = {
          ...normalizeGitHubIssue(rawIssue),
          related_pull_requests: relations.pull_requests,
          related_issues: relations.issues,
          comments,
          comments_limit: input.commentsLimit,
          comments_offset: input.commentsOffset,
          next_comments_offset: comments.length === input.commentsLimit ? input.commentsOffset + comments.length : undefined,
          bounds: {
            comments_default: GITHUB_COMMENTS_DEFAULT_LIMIT,
            comments_max: GITHUB_COMMENTS_MAX_LIMIT,
          },
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
          if (!owner || !repo || !normalized.number) {
            return normalized;
          }
          const relations = normalizeGitHubIssueRelations(await github.listIssueTimelineEvents({ owner, repo, issueNumber: normalized.number, url: normalized.url }, signal));
          return {
            ...normalized,
            related_pull_requests: relations.pull_requests,
            related_issues: relations.issues,
          };
        }));
        const data: GitHubPullRequestSearchResult = { ...input, items };
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
        if (!rawPullRequest) {
          return buildFailure({ code: 'not_found', category: 'not_found', message: 'GitHub pull request was not found.', recoverable: true, provider: 'github' });
        }
        const comments = (await github.listIssueComments({ owner: input.owner, repo: input.repo, issueNumber: input.pullNumber, url: input.url, limit: input.commentsLimit, offset: input.commentsOffset }, signal)).map(normalizeGitHubIssueComment);
        const reviewComments = (await github.listPullRequestReviewComments({ ...input, limit: input.reviewCommentsLimit, offset: input.reviewCommentsOffset }, signal)).map(normalizeGitHubPullRequestReviewComment);
        const reviews = (await github.listPullRequestReviews(input, signal)).map(normalizeGitHubPullRequestReview);
        const relations = normalizeGitHubIssueRelations(await github.listIssueTimelineEvents({ owner: input.owner, repo: input.repo, issueNumber: input.pullNumber, url: input.url }, signal));
        const data: GitHubPullRequestDetailResult = {
          ...normalizeGitHubPullRequest(rawPullRequest),
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
          bounds: {
            comments_default: GITHUB_COMMENTS_DEFAULT_LIMIT,
            comments_max: GITHUB_COMMENTS_MAX_LIMIT,
          },
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
        const repository = `${input.owner}/${input.repo}`;
        const items = rawReleases
          .map((raw) => normalizeGitHubRelease(raw, repository))
          .filter((release) => input.includePrereleases || !release.prerelease)
          .slice(0, input.limit);
        const data: GitHubReleasesResult = {
          repository,
          limit: input.limit,
          include_prereleases: input.includePrereleases,
          items,
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
        if (!rawRelease) {
          return buildFailure({ code: 'not_found', category: 'not_found', message: 'GitHub release was not found for the requested tag.', recoverable: true, provider: 'github' });
        }
        const data = normalizeGitHubRelease(rawRelease, `${input.owner}/${input.repo}`);
        return buildSuccess(githubReleaseSummary(data), data, 8000);
      } catch (error) {
        return buildFailure(toToolError(error));
      }
    },
  });

  registerTool(pi, {
    name: 'search_devto_articles',
    description: 'Search public Dev.to articles by tag with bounded read-only results.',
    parameters: devtoSearchParameters,
    async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<DevtoArticleSearchResult>> {
      try {
        const input = validateDevtoArticleSearch(params);
        const items = (await clientsFromDeps(deps).devto.searchArticles(input, signalFromContext(context))).map(normalizeDevtoArticle);
        const data = { ...input, items };
        return buildSuccess(devtoSearchSummary(data), data, 5000);
      } catch (error) {
        return buildFailure(toToolError(error));
      }
    },
  });

  registerTool(pi, {
    name: 'devto_comments_get',
    description: 'Fetch bounded Dev.to comments for a selected article id.',
    parameters: devtoCommentsParameters,
    async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<DevtoCommentsResult>> {
      try {
        const input = validateDevtoCommentsGet(params);
        const rawComments = await clientsFromDeps(deps).devto.getComments(input, signalFromContext(context));
        const data = normalizeDevtoComments(rawComments, input.articleId, input.topLevelLimit, input.topLevelOffset, input.totalLimit, input.maxDepth);
        return buildSuccess(devtoCommentsSummary(data), data, 12000);
      } catch (error) {
        return buildFailure(toToolError(error));
      }
    },
  });

  registerTool(pi, {
    name: 'search_hackernews',
    description: 'Search public Hacker News stories with bounded read-only results.',
    parameters: hackerNewsSearchParameters,
    async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<HackerNewsSearchResult>> {
      try {
        const input = validateHackerNewsSearch(params);
        const items = (await clientsFromDeps(deps).hackerNews.searchStories(input, signalFromContext(context))).map(normalizeHackerNewsStory);
        const data = { ...input, items };
        return buildSuccess(hackerNewsSearchSummary(data), data, 5000);
      } catch (error) {
        return buildFailure(toToolError(error));
      }
    },
  });

  registerTool(pi, {
    name: 'hackernews_story_get',
    description: 'Fetch a Hacker News story with bounded nested comments.',
    parameters: hackerNewsStoryParameters,
    async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<HackerNewsStoryDetailResult>> {
      try {
        const input = validateHackerNewsStoryGet(params);
        const rawStory = await clientsFromDeps(deps).hackerNews.getStory(input, signalFromContext(context));
        if (!rawStory) {
          return buildFailure({ code: 'not_found', category: 'not_found', message: 'Hacker News story was not found.', recoverable: true, provider: 'hacker_news' });
        }
        const data = normalizeHackerNewsStoryDetail(rawStory, input.commentsLimit, input.commentsOffset, input.maxDepth);
        return buildSuccess(hackerNewsStorySummary(data), data, 12000);
      } catch (error) {
        return buildFailure(toToolError(error));
      }
    },
  });
}
