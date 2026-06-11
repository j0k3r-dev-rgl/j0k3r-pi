import type { DocumentationSnippet } from './types.js';
import { toErrorMessage } from './utils.js';

export const REDACTION_MARKER = '[REDACTED]';
export const DEFAULT_MAX_CHARS = 12000;
export const MIN_MAX_CHARS = 1000;
export const HARD_MAX_CHARS = 50000;

export interface TruncatedText {
  text: string;
  truncated: boolean;
  originalChars: number;
}

export interface TruncatedSnippets {
  snippets: DocumentationSnippet[];
  truncated: boolean;
}

export interface SafeErrorLike {
  code?: string;
  status?: number;
  message?: string;
  retryAfter?: string | number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactSecrets(text: string, exactSecrets: Array<string | undefined> = []): string {
  let redacted = text;
  for (const secret of exactSecrets) {
    if (!secret) continue;
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTION_MARKER);
  }

  redacted = redacted
    .replace(/\b(api[_-]?key)(\s*[:=]\s*)([^\s,;]+)/gi, `$1$2${REDACTION_MARKER}`)
    .replace(/\b(token|secret|password)(\s*[:=]\s*)([^\s,;]+)/gi, `$1$2${REDACTION_MARKER}`)
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, REDACTION_MARKER);

  return redacted;
}

export function clampMaxChars(value: unknown, fallback = DEFAULT_MAX_CHARS): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < MIN_MAX_CHARS) return MIN_MAX_CHARS;
  if (value > HARD_MAX_CHARS) return HARD_MAX_CHARS;
  return Math.floor(value);
}

function truncateWithNotice(text: string, maxChars: number): TruncatedText {
  const originalChars = text.length;
  if (originalChars <= maxChars) return { text, truncated: false, originalChars };
  const notice = `\n[truncated: showing ${maxChars} of ${originalChars} chars]`;
  const bodyBudget = Math.max(0, maxChars - notice.length);
  return {
    text: `${text.slice(0, bodyBudget)}${notice}`,
    truncated: true,
    originalChars,
  };
}

export function truncateText(text: string, maxChars: number): TruncatedText {
  return truncateWithNotice(text, clampMaxChars(maxChars));
}

export function truncateSnippets(snippets: DocumentationSnippet[], maxChars: number): TruncatedSnippets {
  const effectiveMax = clampMaxChars(maxChars);
  const perSnippet = Math.max(MIN_MAX_CHARS, Math.floor(effectiveMax / Math.max(1, snippets.length)));
  let anyTruncated = false;
  const bounded = snippets.map((snippet) => {
    const truncated = truncateWithNotice(snippet.content, perSnippet);
    anyTruncated ||= truncated.truncated;
    return {
      ...snippet,
      content: truncated.text,
      truncated: truncated.truncated || snippet.truncated,
      originalChars: truncated.truncated ? truncated.originalChars : snippet.originalChars,
    };
  });
  return { snippets: bounded, truncated: anyTruncated };
}

function normalizeSafeError(error: unknown): SafeErrorLike {
  if (error && typeof error === 'object') return error as SafeErrorLike;
  return { message: toErrorMessage(error) };
}

export function formatSafeContext7Error(error: unknown, options: { apiKey?: string } = {}): string {
  const normalized = normalizeSafeError(error);
  const status = normalized.status;
  const code = normalized.code;
  const rawMessage = normalized.message ?? toErrorMessage(error);

  let message: string;
  if (code === 'missing_api_key') {
    message = 'Context7 API key is missing. Set CONTEXT7_API_KEY in the Pi process environment and retry.';
  } else if (status === 401 || status === 403) {
    message = `Context7 access was denied. Check CONTEXT7_API_KEY and account access. ${rawMessage}`;
  } else if (status === 429) {
    const retryAfter = normalized.retryAfter ? ` Retry-After: ${normalized.retryAfter}.` : '';
    message = `Context7 rate limit occurred.${retryAfter} Retry later or use a narrower query. ${rawMessage}`;
  } else if (typeof status === 'number' && status >= 500) {
    message = `Context7 transient upstream failure. Retry later or use a narrower query. ${rawMessage}`;
  } else if (status === 404) {
    message = `Context7 library or documentation was not found. Run context7_search_library to resolve the correct library ID. ${rawMessage}`;
  } else {
    message = `Context7 request failed. ${rawMessage}`;
  }

  return redactSecrets(message, [options.apiKey]);
}
