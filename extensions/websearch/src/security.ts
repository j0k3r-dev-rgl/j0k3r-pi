import type { ErrorCategory, Provider, ToolError } from './types.js';

export class ProviderFailure extends Error {
  readonly toolError: ToolError;

  constructor(toolError: ToolError) {
    super(toolError.message);
    this.toolError = toolError;
  }
}

export class MissingConfigurationError extends ProviderFailure {
  constructor(message: string, provider: Provider) {
    super({ code: 'missing_configuration', message, recoverable: true, provider, category: 'provider_unavailable' });
  }
}

export function redactText(value: string): string {
  return value
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_SECRET]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{10,}\b/g, '[REDACTED_SECRET]')
    .replace(/\b[A-Z0-9]{20}\b/g, '[REDACTED_SECRET]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_SECRET]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED_SECRET]');
}

export function isAbortLike(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  const name = typeof error === 'object' && error ? (error as { name?: unknown }).name : undefined;
  const code = typeof error === 'object' && error ? (error as { code?: unknown }).code : undefined;
  return name === 'AbortError' || code === 'ABORT_ERR';
}

export function sanitizeErrorMessage(error: unknown, fallbackMessage: string, maxChars = 500): string {
  const message = error instanceof Error ? error.message : fallbackMessage;
  return truncateText(message, maxChars) ?? fallbackMessage;
}

export function redactSecretsDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return redactText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecretsDeep(entry)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactSecretsDeep(entry)]),
    ) as T;
  }
  return value;
}

export function truncateText(value: string | undefined, maxChars: number): string | undefined {
  if (!value) {
    return undefined;
  }
  const redacted = redactText(value);
  return redacted.length > maxChars ? `${redacted.slice(0, maxChars - 1)}…` : redacted;
}

function responseCategory(response: Response): ErrorCategory {
  if (response.status === 401) {
    return 'auth';
  }
  if (response.status === 403 || response.status === 429) {
    return 'rate_limit';
  }
  if (response.status === 404) {
    return 'not_found';
  }
  if (response.status >= 500) {
    return 'provider_unavailable';
  }
  return 'unexpected';
}

export function providerErrorFromResponse(provider: Provider, response: Response): ToolError {
  const retryAfter = numberHeader(response.headers, 'retry-after');
  const requestId = stringHeader(response.headers, 'x-request-id') ?? stringHeader(response.headers, 'x-github-request-id');
  const rateLimitRemaining = numberHeader(response.headers, 'x-ratelimit-remaining');
  const hasAuthChallenge = Boolean(response.headers.get('www-authenticate'));
  if (response.status === 401 || (response.status === 403 && hasAuthChallenge && rateLimitRemaining !== 0 && retryAfter === undefined)) {
    return {
      code: 'provider_error',
      category: 'auth',
      message: `${provider} authentication failed; credential [REDACTED_SECRET] was not accepted or access is unavailable.`,
      recoverable: true,
      provider,
      status: response.status,
      request_id: requestId,
    };
  }
  if (response.status === 403 || response.status === 429) {
    return {
      code: rateLimitRemaining === 0 ? 'quota_exhausted' : 'rate_limited',
      category: rateLimitRemaining === 0 ? 'quota_exhausted' : 'rate_limit',
      message: `${provider} rate limit reached.`,
      recoverable: true,
      provider,
      status: response.status,
      retry_after_seconds: retryAfter,
      request_id: requestId,
    };
  }
  if (response.status === 404) {
    return {
      code: 'not_found',
      category: 'not_found',
      message: `${provider} resource was not found.`,
      recoverable: true,
      provider,
      status: response.status,
      request_id: requestId,
    };
  }
  return {
    code: 'provider_error',
    category: responseCategory(response),
    message: `${provider} request failed with HTTP ${response.status}.`,
    recoverable: response.status >= 500,
    provider,
    status: response.status,
    retry_after_seconds: retryAfter,
    request_id: requestId,
  };
}

export function stackExchangePayloadError(payload: unknown): ToolError | undefined {
  const body = payload as { backoff?: unknown; error_id?: unknown; error_name?: unknown; error_message?: unknown; quota_remaining?: unknown };
  if (typeof body.backoff === 'number') {
    return {
      code: 'rate_limited',
      category: 'rate_limit',
      message: typeof body.error_message === 'string' ? redactText(body.error_message) : 'Stack Exchange requested client backoff.',
      recoverable: true,
      provider: 'stack_overflow',
      backoff_seconds: body.backoff,
    };
  }
  if (body.quota_remaining === 0) {
    return {
      code: 'quota_exhausted',
      category: 'quota_exhausted',
      message: 'Stack Exchange quota is exhausted.',
      recoverable: true,
      provider: 'stack_overflow',
    };
  }
  if (body.error_id || body.error_name) {
    return {
      code: body.error_name === 'throttle_violation' ? 'rate_limited' : 'provider_error',
      category: body.error_name === 'throttle_violation' ? 'rate_limit' : 'unexpected',
      message: typeof body.error_message === 'string' ? redactText(body.error_message) : 'Stack Exchange provider error.',
      recoverable: true,
      provider: 'stack_overflow',
    };
  }
  return undefined;
}

export function githubProviderErrorFromError(error: unknown): ToolError {
  if (error instanceof ProviderFailure) {
    return error.toolError;
  }
  if (isAbortLike(error)) {
    return {
      code: 'cancelled',
      category: 'cancelled',
      message: 'GitHub request was cancelled.',
      recoverable: true,
      provider: 'github',
    };
  }

  const status = numberValue((error as { status?: unknown })?.status);
  const message = sanitizeErrorMessage(error, 'Unexpected GitHub provider error.');
  const headers = headersLike((error as { response?: { headers?: unknown } })?.response?.headers);
  const retryAfter = numberHeader(headers, 'retry-after');
  const requestId = stringHeader(headers, 'x-github-request-id') ?? stringHeader(headers, 'x-request-id');
  const remaining = numberHeader(headers, 'x-ratelimit-remaining');

  if (status === 401) {
    return {
      code: 'provider_error',
      category: 'auth',
      message: 'GitHub authentication failed; credential [REDACTED_SECRET] was not accepted or access is unavailable.',
      recoverable: true,
      provider: 'github',
      status,
      request_id: requestId,
    };
  }
  if (status === 404) {
    return {
      code: 'not_found',
      category: 'not_found',
      message: 'GitHub issue was not found.',
      recoverable: true,
      provider: 'github',
      status,
      request_id: requestId,
    };
  }
  if (status === 403 || status === 429) {
    return {
      code: remaining === 0 ? 'quota_exhausted' : 'rate_limited',
      category: remaining === 0 ? 'quota_exhausted' : 'rate_limit',
      message,
      recoverable: true,
      provider: 'github',
      status,
      retry_after_seconds: retryAfter,
      request_id: requestId,
    };
  }
  return {
    code: 'provider_error',
    category: status ? (status >= 500 ? 'provider_unavailable' : 'unexpected') : 'network',
    message,
    recoverable: true,
    provider: 'github',
    status,
    request_id: requestId,
  };
}

export function fetchProviderErrorFromError(provider: Provider, error: unknown, fallbackMessage: string): ToolError {
  if (error instanceof ProviderFailure) {
    return error.toolError;
  }
  if (isAbortLike(error)) {
    return {
      code: 'cancelled',
      category: 'cancelled',
      message: `${provider} request was cancelled.`,
      recoverable: true,
      provider,
    };
  }
  const message = sanitizeErrorMessage(error, fallbackMessage);
  const lower = message.toLowerCase();
  return {
    code: lower.includes('timeout') ? 'timeout' : 'provider_error',
    category: lower.includes('timeout') ? 'timeout' : 'network',
    message,
    recoverable: true,
    provider,
  };
}

function headersLike(value: unknown): Headers {
  if (value instanceof Headers) {
    return value;
  }
  const headers = new Headers();
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'string') {
        headers.set(key, entry);
      }
    }
  }
  return headers;
}

function numberHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringHeader(headers: Headers, name: string): string | undefined {
  const raw = headers.get(name);
  return raw ? redactText(raw) : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
