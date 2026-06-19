import type {
  StackOverflowAnswersRequest,
  StackOverflowQuestionRef,
  StackOverflowSearchRequest,
} from './types.js';

const SEARCH_DEFAULT_LIMIT = 5;
const SEARCH_MAX_LIMIT = 10;
const STACK_OVERFLOW_ANSWERS_DEFAULT_LIMIT = 10;
const STACK_OVERFLOW_ANSWERS_MAX_LIMIT = 30;

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
