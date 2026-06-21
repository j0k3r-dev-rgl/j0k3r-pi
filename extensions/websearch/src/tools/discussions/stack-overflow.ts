import {
  normalizeStackOverflowAnswer,
  normalizeStackOverflowComment,
  normalizeStackOverflowQuestion,
} from '../../normalize.js';
import {
  stackAnswersParameters,
  stackCommentsParameters,
  stackExchangeAnswersParameters,
  stackExchangeCommentsParameters,
  stackExchangeQuestionParameters,
  stackQuestionParameters,
  stackSearchParameters,
} from '../../schemas/discussions/stack-overflow.js';
import { stackAnswersSummary, stackCommentsSummary, stackQuestionSummary, stackSearchSummary } from '../../summaries/discussions/stack-overflow.js';
import type {
  NormalizedStackOverflowQuestion,
  PiToolResult,
  RegisterWebsearchToolsDeps,
  StackExchangePlatform,
  StackExchangeSite,
  StackOverflowAnswersResult,
  StackOverflowCommentsResult,
  StackOverflowSearchResult,
} from '../../types.js';
import {
  validateStackExchangeAnswers,
  validateStackExchangeComments,
  validateStackExchangeQuestionRef,
  validateStackOverflowAnswers,
  validateStackOverflowComments,
  validateStackOverflowQuestionRef,
  validateStackOverflowSearch,
} from '../../validation.js';
import { FULL_TOOL_CONTENT, buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { clientsFromDeps, signalFromContext, type ExecuteContext } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';

export const stackOverflowToolNames = [
  'search_stack_overflow',
  'stack_overflow_question_get',
  'stack_exchange_question_get',
  'stack_overflow_answers_get',
  'stack_exchange_answers_get',
  'stack_overflow_comments_get',
  'stack_exchange_comments_get',
] as const;

function stackExchangePlatform(site: StackExchangeSite | undefined): StackExchangePlatform {
  if (site === 'serverfault') return 'server_fault';
  if (site === 'unix') return 'unix_linux';
  if (site === 'superuser') return 'super_user';
  if (site === 'dba') return 'dba';
  return 'stack_overflow';
}

export const stackOverflowTools: WebsearchToolModule<typeof stackOverflowToolNames[number]> = {
  names: stackOverflowToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
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
          return buildSuccess(stackQuestionSummary(data), data, FULL_TOOL_CONTENT);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'stack_exchange_question_get',
      description: 'Fetch a selected Stack Exchange question by id, URL, or source-prefixed id.',
      parameters: stackExchangeQuestionParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<NormalizedStackOverflowQuestion>> {
        try {
          const input = validateStackExchangeQuestionRef(params);
          const raw = await clientsFromDeps(deps).stackExchange.getQuestion(input, signalFromContext(context));
          if (!raw) {
            return buildFailure({ code: 'not_found', category: 'not_found', message: 'Stack Exchange question was not found.', recoverable: true, provider: 'stack_overflow' });
          }
          const data = normalizeStackOverflowQuestion(raw);
          return buildSuccess(stackQuestionSummary(data), data, FULL_TOOL_CONTENT);
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
          const data = { platform: stackExchangePlatform(input.site), site: input.site, questionId: input.questionId, limit: input.limit, answers };
          return buildSuccess(stackAnswersSummary(data), data, FULL_TOOL_CONTENT);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'stack_exchange_answers_get',
      description: 'Fetch bounded Stack Exchange answers for a selected network question.',
      parameters: stackExchangeAnswersParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<StackOverflowAnswersResult>> {
        try {
          const input = validateStackExchangeAnswers(params);
          const answers = (await clientsFromDeps(deps).stackExchange.getAnswers(input, signalFromContext(context))).map(normalizeStackOverflowAnswer);
          const data = { platform: stackExchangePlatform(input.site), site: input.site, questionId: input.questionId, limit: input.limit, answers };
          return buildSuccess(stackAnswersSummary(data), data, FULL_TOOL_CONTENT);
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
            platform: stackExchangePlatform(input.site),
            site: input.site,
            question_id: input.questionId,
            comments_limit: input.commentsLimit,
            comments_offset: input.commentsOffset,
            comments_returned: comments.length,
            has_more_comments: raw.hasMore,
            next_comments_offset: raw.hasMore ? input.commentsOffset + comments.length : undefined,
            comments,
          };
          return buildSuccess(stackCommentsSummary(data), data, FULL_TOOL_CONTENT);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'stack_exchange_comments_get',
      description: 'Fetch bounded Stack Exchange question comments with offset pagination.',
      parameters: stackExchangeCommentsParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<StackOverflowCommentsResult>> {
        try {
          const input = validateStackExchangeComments(params);
          const raw = await clientsFromDeps(deps).stackExchange.getQuestionComments(input, signalFromContext(context));
          const comments = raw.items.map(normalizeStackOverflowComment);
          const data: StackOverflowCommentsResult = {
            platform: stackExchangePlatform(input.site),
            site: input.site,
            question_id: input.questionId,
            comments_limit: input.commentsLimit,
            comments_offset: input.commentsOffset,
            comments_returned: comments.length,
            has_more_comments: raw.hasMore,
            next_comments_offset: raw.hasMore ? input.commentsOffset + comments.length : undefined,
            comments,
          };
          return buildSuccess(stackCommentsSummary(data), data, FULL_TOOL_CONTENT);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
