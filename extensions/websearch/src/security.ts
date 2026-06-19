import type { Provider, ToolError } from './types.js';

export class ProviderFailure extends Error {
  readonly toolError: ToolError;

  constructor(toolError: ToolError) {
    super(toolError.message);
    this.toolError = toolError;
  }
}

export class MissingConfigurationError extends ProviderFailure {
  constructor(message: string, provider: Provider) {
    super({ code: 'missing_configuration', message, recoverable: true, provider });
  }
}

export function redactText(value: string): string {
  return value
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_SECRET]')
    .replace(/\b[A-Z0-9]{20}\b/g, '[REDACTED_SECRET]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_SECRET]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED_SECRET]');
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

export function providerErrorFromResponse(provider: Provider, response: Response): ToolError {
  const retryAfter = numberHeader(response.headers, 'retry-after');
  if (response.status === 429) {
    return {
      code: 'rate_limited',
      message: `${provider} rate limit reached.`,
      recoverable: true,
      provider,
      retry_after_seconds: retryAfter,
    };
  }
  if (response.status === 404) {
    return {
      code: 'not_found',
      message: `${provider} resource was not found.`,
      recoverable: true,
      provider,
    };
  }
  return {
    code: 'provider_error',
    message: `${provider} request failed with HTTP ${response.status}.`,
    recoverable: response.status >= 500,
    provider,
    retry_after_seconds: retryAfter,
  };
}

export function stackExchangePayloadError(payload: unknown): ToolError | undefined {
  const body = payload as { backoff?: unknown; error_id?: unknown; error_name?: unknown; error_message?: unknown; quota_remaining?: unknown };
  if (typeof body.backoff === 'number') {
    return {
      code: 'rate_limited',
      message: typeof body.error_message === 'string' ? redactText(body.error_message) : 'Stack Exchange requested client backoff.',
      recoverable: true,
      provider: 'stack_overflow',
      backoff_seconds: body.backoff,
    };
  }
  if (body.quota_remaining === 0) {
    return {
      code: 'quota_exhausted',
      message: 'Stack Exchange quota is exhausted.',
      recoverable: true,
      provider: 'stack_overflow',
    };
  }
  if (body.error_id || body.error_name) {
    return {
      code: body.error_name === 'throttle_violation' ? 'rate_limited' : 'provider_error',
      message: typeof body.error_message === 'string' ? redactText(body.error_message) : 'Stack Exchange provider error.',
      recoverable: true,
      provider: 'stack_overflow',
    };
  }
  return undefined;
}

function numberHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
