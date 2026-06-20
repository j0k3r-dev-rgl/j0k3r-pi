import { WebsearchConfigError } from '../config.js';
import { ProviderFailure, isAbortLike, redactSecretsDeep, truncateText } from '../security.js';
import type { PiToolResult, ToolError } from '../types.js';
import { ValidationError } from '../validation.js';

export function buildSuccess<T>(text: string, data: T, maxContentChars = 450): PiToolResult<T> {
  return {
    content: [{ type: 'text', text: truncateText(text, maxContentChars) ?? '' }],
    details: {
      status: 'success',
      data: redactSecretsDeep(data),
    },
  };
}

export function buildFailure<T>(errorOrCode: ToolError | ToolError['code'], message?: string, recoverable = true): PiToolResult<T> {
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

export function toToolError(error: unknown): ToolError {
  if (error instanceof ProviderFailure) return error.toolError;
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
