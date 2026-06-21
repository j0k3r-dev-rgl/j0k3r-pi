import { Type } from 'typebox';
import type { PiToolResult, RegisterWebsearchToolsDeps } from '../../types.js';
import { ValidationError } from '../../validation.js';
import { FULL_TOOL_CONTENT, buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { executeInternalTool, internalToolsFromDeps } from '../common/internal.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { devtoTools } from './devto.js';
import { githubTools } from './github.js';
import { hackerNewsTools } from './hackernews.js';
import { stackOverflowTools } from './stack-overflow.js';

export const discussionGroupedToolNames = [
  'discussion_get',
  'discussion_answers_get',
  'discussion_comments_get',
] as const;

const stackSources = ['stack_overflow', 'server_fault', 'unix_linux', 'super_user', 'dba'] as const;
const discussionGetSources = [
  ...stackSources,
  'github_issue',
  'github_issues',
  'github_pull_request',
  'github_pull_requests',
  'github_discussion',
  'github_discussions',
  'hacker_news',
] as const;
const discussionCommentSources = [...discussionGetSources, 'devto'] as const;

const sourceSchema = (sources: readonly string[]) => Type.Union(
  sources.map((source) => Type.Literal(source)) as [ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]],
);

const sharedDiscussionRefProperties = {
  source: sourceSchema(discussionGetSources),
  ref: Type.Optional(Type.Union([Type.String(), Type.Number()], { description: 'Generic selected entity reference from discussion_search followup_ref.' })),
  question: Type.Optional(Type.Union([Type.String(), Type.Number()], { description: 'Stack Exchange question id, URL, or source:id reference.' })),
  issue: Type.Optional(Type.String({ description: 'GitHub issue URL or owner/repo#number reference.' })),
  pull_request: Type.Optional(Type.String({ description: 'GitHub pull request URL or owner/repo#number reference.' })),
  discussion: Type.Optional(Type.String({ description: 'GitHub discussion URL or owner/repo#number reference.' })),
  story_id: Type.Optional(Type.Number({ description: 'Hacker News story id.' })),
  commentsLimit: Type.Optional(Type.Number({ description: 'Maximum comments to return where supported.' })),
  commentsOffset: Type.Optional(Type.Number({ description: 'Comment pagination offset where supported.' })),
  reviewCommentsLimit: Type.Optional(Type.Number({ description: 'Maximum pull request review comments to return where supported.' })),
  reviewCommentsOffset: Type.Optional(Type.Number({ description: 'Pull request review comment pagination offset where supported.' })),
};

const stackGetBranches = stackSources.map((source) => Type.Object({
  source: Type.Literal(source),
  ref: sharedDiscussionRefProperties.ref,
  question: sharedDiscussionRefProperties.question,
}));

const githubIssueBranches = ['github_issue', 'github_issues'] as const;
const githubPullRequestBranches = ['github_pull_request', 'github_pull_requests'] as const;
const githubDiscussionBranches = ['github_discussion', 'github_discussions'] as const;

const discussionGetParameters = {
  ...Type.Object(sharedDiscussionRefProperties),
  oneOf: [
    ...stackGetBranches,
    ...githubIssueBranches.map((source) => Type.Object({
      source: Type.Literal(source),
      ref: sharedDiscussionRefProperties.ref,
      issue: sharedDiscussionRefProperties.issue,
      commentsLimit: sharedDiscussionRefProperties.commentsLimit,
      commentsOffset: sharedDiscussionRefProperties.commentsOffset,
    })),
    ...githubPullRequestBranches.map((source) => Type.Object({
      source: Type.Literal(source),
      ref: sharedDiscussionRefProperties.ref,
      pull_request: sharedDiscussionRefProperties.pull_request,
      commentsLimit: sharedDiscussionRefProperties.commentsLimit,
      commentsOffset: sharedDiscussionRefProperties.commentsOffset,
      reviewCommentsLimit: sharedDiscussionRefProperties.reviewCommentsLimit,
      reviewCommentsOffset: sharedDiscussionRefProperties.reviewCommentsOffset,
    })),
    ...githubDiscussionBranches.map((source) => Type.Object({
      source: Type.Literal(source),
      ref: sharedDiscussionRefProperties.ref,
      discussion: sharedDiscussionRefProperties.discussion,
      commentsLimit: sharedDiscussionRefProperties.commentsLimit,
      commentsOffset: sharedDiscussionRefProperties.commentsOffset,
    })),
    Type.Object({
      source: Type.Literal('hacker_news'),
      ref: sharedDiscussionRefProperties.ref,
      story_id: sharedDiscussionRefProperties.story_id,
      commentsLimit: sharedDiscussionRefProperties.commentsLimit,
      commentsOffset: sharedDiscussionRefProperties.commentsOffset,
    }),
  ],
};

const discussionAnswersParameters = Type.Object({
  source: sourceSchema(stackSources),
  ref: Type.Optional(Type.Union([Type.String(), Type.Number()], { description: 'Stack Exchange question id, URL, or source:id reference.' })),
  question: Type.Optional(Type.Union([Type.String(), Type.Number()], { description: 'Stack Exchange question id, URL, or source:id reference.' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum answers to return.' })),
});

const discussionCommentsParameters = {
  ...Type.Object({
    ...sharedDiscussionRefProperties,
    source: sourceSchema(discussionCommentSources),
    article_id: Type.Optional(Type.Number({ description: 'Dev.to article id when source is devto.' })),
    topLevelLimit: Type.Optional(Type.Number({ description: 'Maximum top-level Dev.to comments to return.' })),
    topLevelOffset: Type.Optional(Type.Number({ description: 'Dev.to top-level comment pagination offset.' })),
  }),
  oneOf: [
    ...stackSources.map((source) => Type.Object({
      source: Type.Literal(source),
      ref: sharedDiscussionRefProperties.ref,
      question: sharedDiscussionRefProperties.question,
      commentsLimit: sharedDiscussionRefProperties.commentsLimit,
      commentsOffset: sharedDiscussionRefProperties.commentsOffset,
    })),
    ...githubIssueBranches.map((source) => Type.Object({
      source: Type.Literal(source),
      ref: sharedDiscussionRefProperties.ref,
      issue: sharedDiscussionRefProperties.issue,
      commentsLimit: sharedDiscussionRefProperties.commentsLimit,
      commentsOffset: sharedDiscussionRefProperties.commentsOffset,
    })),
    ...githubPullRequestBranches.map((source) => Type.Object({
      source: Type.Literal(source),
      ref: sharedDiscussionRefProperties.ref,
      pull_request: sharedDiscussionRefProperties.pull_request,
      commentsLimit: sharedDiscussionRefProperties.commentsLimit,
      commentsOffset: sharedDiscussionRefProperties.commentsOffset,
      reviewCommentsLimit: sharedDiscussionRefProperties.reviewCommentsLimit,
      reviewCommentsOffset: sharedDiscussionRefProperties.reviewCommentsOffset,
    })),
    ...githubDiscussionBranches.map((source) => Type.Object({
      source: Type.Literal(source),
      ref: sharedDiscussionRefProperties.ref,
      discussion: sharedDiscussionRefProperties.discussion,
      commentsLimit: sharedDiscussionRefProperties.commentsLimit,
      commentsOffset: sharedDiscussionRefProperties.commentsOffset,
    })),
    Type.Object({
      source: Type.Literal('devto'),
      ref: sharedDiscussionRefProperties.ref,
      article_id: Type.Optional(Type.Number({ description: 'Dev.to article id when source is devto.' })),
      topLevelLimit: Type.Optional(Type.Number({ description: 'Maximum top-level Dev.to comments to return.' })),
      topLevelOffset: Type.Optional(Type.Number({ description: 'Dev.to top-level comment pagination offset.' })),
    }),
    Type.Object({
      source: Type.Literal('hacker_news'),
      ref: sharedDiscussionRefProperties.ref,
      story_id: sharedDiscussionRefProperties.story_id,
      commentsLimit: sharedDiscussionRefProperties.commentsLimit,
      commentsOffset: sharedDiscussionRefProperties.commentsOffset,
    }),
  ],
};

type StackSource = typeof stackSources[number];
type DiscussionGetSource = typeof discussionGetSources[number];
type DiscussionCommentSource = typeof discussionCommentSources[number];

type Input = Record<string, unknown>;

const legacyDiscussionModules = [stackOverflowTools, githubTools, devtoTools, hackerNewsTools] as const;

function asInput(value: unknown): Input {
  return value && typeof value === 'object' ? value as Input : {};
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function optionalNumber(input: Input, key: string): number | undefined {
  return numberValue(input[key]);
}

function requiredString(value: unknown, field: string): string {
  const result = stringValue(value);
  if (!result) throw new ValidationError(`${field} is required.`);
  return result;
}

function requiredSource<T extends readonly string[]>(input: Input, sources: T): T[number] {
  const source = stringValue(input.source);
  if (!source || !(sources as readonly string[]).includes(source)) {
    throw new ValidationError(`source must be one of: ${sources.join(', ')}.`);
  }
  return source as T[number];
}

function isStackSource(source: string): source is StackSource {
  return (stackSources as readonly string[]).includes(source);
}

function stackSite(source: StackSource): 'stackoverflow' | 'serverfault' | 'unix' | 'superuser' | 'dba' {
  if (source === 'server_fault') return 'serverfault';
  if (source === 'unix_linux') return 'unix';
  if (source === 'super_user') return 'superuser';
  if (source === 'dba') return 'dba';
  return 'stackoverflow';
}

function refValue(input: Input, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(input[key]);
    if (value) return value;
  }
  return undefined;
}

function stackQuestionParams(input: Input, source: StackSource): Input {
  return {
    question: requiredString(input.question ?? input.ref, 'question'),
    source,
    site: stackSite(source),
  };
}

function githubIssueParams(input: Input): Input {
  return {
    issue: requiredString(refValue(input, 'issue', 'ref'), 'issue'),
    commentsLimit: optionalNumber(input, 'commentsLimit'),
    commentsOffset: optionalNumber(input, 'commentsOffset'),
  };
}

function githubPullRequestParams(input: Input): Input {
  return {
    pull_request: requiredString(refValue(input, 'pull_request', 'ref'), 'pull_request'),
    commentsLimit: optionalNumber(input, 'commentsLimit'),
    commentsOffset: optionalNumber(input, 'commentsOffset'),
    reviewCommentsLimit: optionalNumber(input, 'reviewCommentsLimit'),
    reviewCommentsOffset: optionalNumber(input, 'reviewCommentsOffset'),
  };
}

function githubDiscussionParams(input: Input): Input {
  return {
    discussion: requiredString(refValue(input, 'discussion', 'ref'), 'discussion'),
    commentsLimit: optionalNumber(input, 'commentsLimit'),
    commentsOffset: optionalNumber(input, 'commentsOffset'),
  };
}

function hackerNewsStoryParams(input: Input): Input {
  return {
    story_id: numberValue(input.story_id ?? input.ref),
    commentsLimit: optionalNumber(input, 'commentsLimit'),
    commentsOffset: optionalNumber(input, 'commentsOffset'),
  };
}

function devtoCommentsParams(input: Input): Input {
  return {
    article_id: numberValue(input.article_id ?? input.ref),
    topLevelLimit: optionalNumber(input, 'topLevelLimit'),
    topLevelOffset: optionalNumber(input, 'topLevelOffset'),
  };
}

function discussionGetTarget(source: DiscussionGetSource, input: Input): { tool: string; params: Input } {
  if (isStackSource(source)) {
    return {
      tool: source === 'stack_overflow' ? 'stack_overflow_question_get' : 'stack_exchange_question_get',
      params: stackQuestionParams(input, source),
    };
  }
  if (source === 'github_issue' || source === 'github_issues') return { tool: 'github_issue_get', params: githubIssueParams(input) };
  if (source === 'github_pull_request' || source === 'github_pull_requests') return { tool: 'github_pull_request_get', params: githubPullRequestParams(input) };
  if (source === 'github_discussion' || source === 'github_discussions') return { tool: 'github_discussion_get', params: githubDiscussionParams(input) };
  return { tool: 'hackernews_story_get', params: hackerNewsStoryParams(input) };
}

function discussionAnswersTarget(source: StackSource, input: Input): { tool: string; params: Input } {
  return {
    tool: source === 'stack_overflow' ? 'stack_overflow_answers_get' : 'stack_exchange_answers_get',
    params: {
      ...stackQuestionParams(input, source),
      limit: optionalNumber(input, 'limit'),
    },
  };
}

function discussionCommentsTarget(source: DiscussionCommentSource, input: Input): { tool: string; params: Input } {
  if (isStackSource(source)) {
    return {
      tool: source === 'stack_overflow' ? 'stack_overflow_comments_get' : 'stack_exchange_comments_get',
      params: {
        ...stackQuestionParams(input, source),
        commentsLimit: optionalNumber(input, 'commentsLimit'),
        commentsOffset: optionalNumber(input, 'commentsOffset'),
      },
    };
  }
  if (source === 'github_issue' || source === 'github_issues') return { tool: 'github_issue_get', params: githubIssueParams(input) };
  if (source === 'github_pull_request' || source === 'github_pull_requests') return { tool: 'github_pull_request_get', params: githubPullRequestParams(input) };
  if (source === 'github_discussion' || source === 'github_discussions') return { tool: 'github_discussion_get', params: githubDiscussionParams(input) };
  if (source === 'devto') return { tool: 'devto_comments_get', params: devtoCommentsParams(input) };
  return { tool: 'hackernews_story_get', params: hackerNewsStoryParams(input) };
}

function commentBody(comment: unknown): string | undefined {
  if (!comment || typeof comment !== 'object') return undefined;
  const body = (comment as Record<string, unknown>).body;
  return typeof body === 'string' && body.trim() ? body.trim() : undefined;
}

function commentsSummary(source: DiscussionCommentSource, data: Record<string, unknown>): string {
  const comments = Array.isArray(data.comments) ? data.comments : [];
  const reviewComments = Array.isArray(data.review_comments) ? data.review_comments : [];
  const subject = [data.repository, data.number ?? data.story_id ?? data.article_id ?? data.question_id].filter(Boolean).join('#') || source;
  const lines = [`discussion_comments_get returned ${comments.length} comment(s)${reviewComments.length ? ` and ${reviewComments.length} review comment(s)` : ''} for ${source} ${subject}.`];
  for (const [index, comment] of comments.slice(0, 5).entries()) {
    const body = commentBody(comment);
    if (body) lines.push(`${index + 1}. ${body}`);
  }
  for (const [index, comment] of reviewComments.slice(0, 5).entries()) {
    const body = commentBody(comment);
    if (body) lines.push(`review ${index + 1}. ${body}`);
  }
  return lines.join('\n');
}

function projectDiscussionComments(source: DiscussionCommentSource, result: PiToolResult<unknown>): PiToolResult<unknown> {
  if (result.details.status !== 'success' || isStackSource(source) || source === 'devto') return result;
  const value = result.details.data && typeof result.details.data === 'object' ? result.details.data as Record<string, unknown> : {};
  const comments = Array.isArray(value.comments) ? value.comments : [];
  const data: Record<string, unknown> = {
    platform: value.platform,
    source,
    repository: value.repository,
    number: value.number,
    id: value.id,
    url: value.url,
    comments_limit: value.comments_limit,
    comments_offset: value.comments_offset,
    comments_returned: comments.length,
    next_comments_offset: value.next_comments_offset,
    comments,
    bounds: value.bounds,
  };

  if (source === 'github_pull_request' || source === 'github_pull_requests') {
    const reviewComments = Array.isArray(value.review_comments) ? value.review_comments : [];
    data.review_comments_limit = value.review_comments_limit;
    data.review_comments_offset = value.review_comments_offset;
    data.review_comments_returned = reviewComments.length;
    data.next_review_comments_offset = value.next_review_comments_offset;
    data.review_comments = reviewComments;
  }

  if (source === 'hacker_news') {
    data.platform = 'hacker_news';
    data.story_id = value.follow_up_story_id ?? numberValue(value.id);
    data.max_depth = value.max_depth;
  }

  return buildSuccess(commentsSummary(source, data), data, FULL_TOOL_CONTENT);
}

export const discussionGroupedTools: WebsearchToolModule<typeof discussionGroupedToolNames[number]> = {
  names: discussionGroupedToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    const internalTools = internalToolsFromDeps(deps, legacyDiscussionModules);

    registerTool(pi, {
      name: 'discussion_get',
      description: 'Open one selected discussion/community entity from Stack Exchange, GitHub discussions/issues/pull requests, or Hacker News.',
      parameters: discussionGetParameters,
      async execute(id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: unknown): Promise<PiToolResult<unknown>> {
        try {
          const input = asInput(params);
          const source = requiredSource(input, discussionGetSources);
          const target = discussionGetTarget(source, input);
          return await executeInternalTool(internalTools, target.tool, id, target.params, context) as PiToolResult<unknown>;
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'discussion_answers_get',
      description: 'Fetch bounded Stack Exchange answers for a selected Stack Overflow or Stack Exchange network question.',
      parameters: discussionAnswersParameters,
      async execute(id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: unknown): Promise<PiToolResult<unknown>> {
        try {
          const input = asInput(params);
          const source = requiredSource(input, stackSources);
          const target = discussionAnswersTarget(source, input);
          return await executeInternalTool(internalTools, target.tool, id, target.params, context) as PiToolResult<unknown>;
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'discussion_comments_get',
      description: 'Fetch bounded comments or replies for Stack Exchange questions, GitHub issues/pull requests/discussions, Dev.to articles, or Hacker News stories where supported.',
      parameters: discussionCommentsParameters,
      async execute(id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: unknown): Promise<PiToolResult<unknown>> {
        try {
          const input = asInput(params);
          const source = requiredSource(input, discussionCommentSources);
          const target = discussionCommentsTarget(source, input);
          const result = await executeInternalTool(internalTools, target.tool, id, target.params, context) as PiToolResult<unknown>;
          return projectDiscussionComments(source, result);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
