import { Type } from 'typebox';
import { createStackExchangeClient } from './client.js';
import { normalizeStackOverflowAnswer, normalizeStackOverflowQuestion } from './normalize.js';
import { ProviderFailure, redactSecretsDeep, redactText } from './security.js';
import type {
  NormalizedStackOverflowQuestion,
  PiToolResult,
  RegisterWebsearchToolsDeps,
  StackOverflowAnswersResult,
  StackOverflowSearchResult,
  ToolError,
  WebsearchRuntime,
} from './types.js';
import {
  validateStackOverflowAnswers,
  validateStackOverflowQuestionRef,
  validateStackOverflowSearch,
  ValidationError,
} from './validation.js';

export const WEBSEARCH_TOOL_NAMES = [
  'search_stack_overflow',
  'stack_overflow_question_get',
  'stack_overflow_answers_get',
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

function buildSuccess<T>(text: string, data: T): PiToolResult<T> {
  return {
    content: [{ type: 'text', text: redactText(text) }],
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
      message: error.message,
      recoverable: true,
    };
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      code: 'cancelled',
      message: 'Request was cancelled.',
      recoverable: true,
    };
  }
  return {
    code: 'provider_error',
    message: error instanceof Error ? error.message : 'Unexpected provider error.',
    recoverable: true,
  };
}

function runtimeFromDeps(deps: RegisterWebsearchToolsDeps): WebsearchRuntime {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new ProviderFailure({
      code: 'missing_configuration',
      message: 'A fetch implementation is required for websearch tools.',
      recoverable: true,
    });
  }
  return {
    env: deps.env ?? process.env,
    fetch: fetchImpl,
  };
}

function stackExchangeClientFromDeps(deps: RegisterWebsearchToolsDeps) {
  if (deps.clients?.stackExchange) {
    return deps.clients.stackExchange;
  }
  const runtime = runtimeFromDeps(deps);
  return deps.createClients ? deps.createClients(runtime).stackExchange : createStackExchangeClient(runtime);
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
  return data.items.map((item, index) => `${index + 1}. ${item.title ?? item.id} — ${item.url}`).join('\n');
}

function stackAnswersSummary(data: StackOverflowAnswersResult): string {
  if (data.answers.length === 0) {
    return `No Stack Overflow answers found for ${data.questionId}.`;
  }
  return data.answers.map((answer, index) => `${index + 1}. ${answer.accepted ? '[accepted] ' : ''}${answer.author ?? 'unknown'}: ${answer.body ?? ''}`).join('\n');
}

export function registerWebsearchTools(pi: any, deps: RegisterWebsearchToolsDeps = {}): void {
  registerTool(pi, {
    name: 'search_stack_overflow',
    description: 'Search public Stack Overflow questions with bounded read-only results.',
    parameters: stackSearchParameters,
    async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<StackOverflowSearchResult>> {
      try {
        const input = validateStackOverflowSearch(params);
        const items = (await stackExchangeClientFromDeps(deps).searchQuestions(input, signalFromContext(context))).map(normalizeStackOverflowQuestion);
        const data = { ...input, items };
        return buildSuccess(stackSearchSummary(data), data);
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
        const raw = await stackExchangeClientFromDeps(deps).getQuestion(input, signalFromContext(context));
        if (!raw) {
          return buildFailure({ code: 'not_found', message: 'Stack Overflow question was not found.', recoverable: true, provider: 'stack_overflow' });
        }
        const data = normalizeStackOverflowQuestion(raw);
        return buildSuccess(`${data.title ?? data.id}\n${data.url}`, data);
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
        const answers = (await stackExchangeClientFromDeps(deps).getAnswers(input, signalFromContext(context))).map(normalizeStackOverflowAnswer);
        const data = { questionId: input.questionId, limit: input.limit, answers };
        return buildSuccess(stackAnswersSummary(data), data);
      } catch (error) {
        return buildFailure(toToolError(error));
      }
    },
  });
}
