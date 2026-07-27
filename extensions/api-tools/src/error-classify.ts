import { ApiClientError } from './client.js';
import type { ApiFailureEnvelope, ApiToolName } from './types.js';
import { sanitizeErrorText } from './security.js';

function buildCode(tool: string, action: string, condition: string): string {
  return `${tool}.${action}.${condition}`;
}

export function classifyError(tool: ApiToolName, action: string, error: unknown, extras: Partial<ApiFailureEnvelope> = {}): ApiFailureEnvelope {
  if (error instanceof ApiClientError) {
    const message = sanitizeErrorText(error.message);
    switch (error.kind) {
      case 'configuration':
        return { category: 'configuration_error', code: buildCode(tool, action, 'configuration'), message, retryable: false, next_step: 'Fix the API Tools configuration.', ...extras };
      case 'timeout':
        return { category: 'timeout_error', code: buildCode(tool, action, 'timeout'), message, retryable: true, next_step: 'Retry the request or reduce the requested scope.', ...extras };
      case 'cancellation':
        return { category: 'cancellation_error', code: buildCode(tool, action, 'cancelled'), message, retryable: true, next_step: 'Retry the request when ready.', ...extras };
      case 'validation':
        return { category: 'validation_error', code: buildCode(tool, action, 'validation'), message, retryable: false, next_step: 'Correct the tool inputs and try again.', ...extras };
      case 'reference':
        return { category: 'reference_error', code: buildCode(tool, action, 'reference'), message, retryable: false, next_step: 'Use a supported local reference or inspect the schema directly.', ...extras };
      default:
        return { category: 'provider_error', code: buildCode(tool, action, 'provider'), message, retryable: true, next_step: 'Check the upstream API and retry if appropriate.', ...extras };
    }
  }

  const message = sanitizeErrorText(error instanceof Error ? error.message : 'Unexpected API tool failure.');
  if (/cancelled|canceled|aborted/i.test(message)) {
    return { category: 'cancellation_error', code: buildCode(tool, action, 'cancelled'), message, retryable: true, next_step: 'Retry the request when ready.', ...extras };
  }
  if (/timed out/i.test(message)) {
    return { category: 'timeout_error', code: buildCode(tool, action, 'timeout'), message, retryable: true, next_step: 'Retry the request or reduce the requested scope.', ...extras };
  }
  return { category: 'unknown_error', code: buildCode(tool, action, 'unknown'), message, retryable: false, next_step: 'Inspect the failing request and configuration.', ...extras };
}

export function httpFailure(tool: ApiToolName, action: string, status: number, statusText: string, message?: string): ApiFailureEnvelope {
  return {
    category: 'http_error',
    code: `${tool}.${action}.http_error`,
    message: sanitizeErrorText(message ?? `${status} ${statusText}`),
    http_status: status,
    retryable: status >= 500,
    next_step: status >= 500 ? 'Check the provider status and retry.' : 'Inspect the request inputs or credentials.',
  };
}

export function graphqlFailure(tool: ApiToolName, action: string, classification: string | undefined, message: string): ApiFailureEnvelope {
  return {
    category: 'graphql_error',
    code: `${tool}.${action}.graphql_error`,
    message: sanitizeErrorText(message),
    graphql_classification: classification,
    retryable: false,
    next_step: 'Inspect the GraphQL query, selector, or server logs.',
  };
}

export function continuationFailure(code: string, message: string): ApiFailureEnvelope {
  return {
    category: 'continuation_error',
    code: `continuation.${code}`,
    message,
    retryable: false,
    next_step: 'Repeat the original action to obtain a fresh cursor.',
  };
}
