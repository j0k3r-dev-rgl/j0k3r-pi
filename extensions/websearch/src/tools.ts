import { Type } from 'typebox';
import { createWebsearchClients } from './client.js';
import {
  normalizeDevtoArticle,
  normalizeDevtoComments,
  normalizeGitHubIssue,
  normalizeGitHubIssueComment,
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
  state: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('closed')])),
  limit: Type.Optional(Type.Number()),
});

const githubIssueParameters = Type.Object({
  issue: Type.String(),
  commentsLimit: Type.Optional(Type.Number()),
});

const devtoSearchParameters = Type.Object({
  tag: Type.String(),
  limit: Type.Optional(Type.Number()),
});

const devtoCommentsParameters = Type.Object({
  article_id: Type.Number(),
  topLevelLimit: Type.Optional(Type.Number()),
});

const hackerNewsSearchParameters = Type.Object({
  query: Type.String(),
  limit: Type.Optional(Type.Number()),
});

const hackerNewsStoryParameters = Type.Object({
  story_id: Type.Number(),
  commentsLimit: Type.Optional(Type.Number()),
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
  if (error instanceof ValidationError) {
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
  return {
    env: deps.env ?? process.env,
    fetch: fetchImpl,
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

function githubSearchSummary(data: GitHubIssueSearchResult): string {
  if (data.items.length === 0) {
    return `No GitHub issues found for "${data.query}".`;
  }
  return data.items.map((item, index) => `${index + 1}. ${item.title ?? item.follow_up_ref} — ${item.url}`).join('\n');
}

function githubIssueSummary(data: GitHubIssueDetailResult): string {
  return [
    `${data.title ?? data.follow_up_ref}`,
    data.url,
    data.body ?? '',
  ].filter(Boolean).join('\n').slice(0, 450);
}

function devtoSearchSummary(data: DevtoArticleSearchResult): string {
  if (data.items.length === 0) {
    return `No Dev.to articles found for tag "${data.tag}".`;
  }
  return data.items.map((item, index) => `${index + 1}. ${item.title ?? item.id} — ${item.url ?? `article ${item.follow_up_article_id}`}`).join('\n');
}

function devtoCommentsSummary(data: DevtoCommentsResult): string {
  if (data.comments.length === 0) {
    return `No Dev.to comments found for article ${data.article_id}.`;
  }
  return `Dev.to article ${data.article_id} comments: ${data.bounds.returned_total_nodes} node(s) across ${data.bounds.returned_top_level_comments} top-level comment(s).`;
}

function hackerNewsSearchSummary(data: HackerNewsSearchResult): string {
  if (data.items.length === 0) {
    return `No Hacker News stories found for "${data.query}".`;
  }
  return data.items.map((item, index) => `${index + 1}. ${item.title ?? item.id} — ${item.url ?? `story ${item.follow_up_story_id}`}`).join('\n');
}

function hackerNewsStorySummary(data: HackerNewsStoryDetailResult): string {
  return [
    data.title ?? `Hacker News story ${data.follow_up_story_id}`,
    data.url,
    data.body ?? '',
  ].filter(Boolean).join('\n').slice(0, 450);
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
        const items = (await clientsFromDeps(deps).github.searchIssues(input, signalFromContext(context))).map(normalizeGitHubIssue);
        const data = { ...input, items };
        return buildSuccess(githubSearchSummary(data), data);
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
        const comments = (await github.listIssueComments({ ...input, limit: input.commentsLimit }, signal)).map(normalizeGitHubIssueComment);
        const data: GitHubIssueDetailResult = {
          ...normalizeGitHubIssue(rawIssue),
          comments,
          comments_limit: input.commentsLimit,
          bounds: {
            comments_default: GITHUB_COMMENTS_DEFAULT_LIMIT,
            comments_max: GITHUB_COMMENTS_MAX_LIMIT,
          },
        };
        return buildSuccess(githubIssueSummary(data), data);
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
        return buildSuccess(devtoSearchSummary(data), data);
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
        const data = normalizeDevtoComments(rawComments, input.articleId, input.topLevelLimit, input.totalLimit, input.maxDepth);
        return buildSuccess(devtoCommentsSummary(data), data);
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
        return buildSuccess(hackerNewsSearchSummary(data), data);
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
        const data = normalizeHackerNewsStoryDetail(rawStory, input.commentsLimit, input.maxDepth);
        return buildSuccess(hackerNewsStorySummary(data), data);
      } catch (error) {
        return buildFailure(toToolError(error));
      }
    },
  });
}
