import type { ApiAuthConfig, ApiToolResult, ApiTruncationMetadata, ApiWarning } from './types.js';

export const REDACTION_MARKER = '[REDACTED]';
export const DEFAULT_MAX_RESPONSE_BYTES = 50000;
export const DEFAULT_MAX_RESPONSE_LINES = 2000;

const SECRET_KEY_PATTERN = /(?:authorization|api[_-]?key|token|secret|password|cookie|set-cookie)/i;

export interface AuthMetadataStatus {
  status: 'valid' | 'expired' | 'unknown';
  warning?: ApiWarning;
  expiresAt?: string;
  secondsRemaining?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSecretLikeHeader(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

export function collectConfiguredSecrets(input: {
  headers?: Record<string, string>;
  auth: ApiAuthConfig;
}): string[] {
  const secrets: string[] = [];

  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (isSecretLikeHeader(key)) secrets.push(value);
  }

  switch (input.auth.type) {
    case 'bearer':
      secrets.push(input.auth.token);
      break;
    case 'basic':
      secrets.push(input.auth.password);
      break;
    case 'api_key':
      secrets.push(input.auth.value);
      break;
    case 'headers':
      secrets.push(...Object.values(input.auth.headers));
      break;
    case 'login':
      secrets.push(input.auth.password);
      if (input.auth.access_token) secrets.push(input.auth.access_token);
      break;
    case 'none':
      break;
  }

  return uniqueNonEmpty(secrets);
}

export function redactText(text: string, exactSecrets: string[] = []): string {
  let redacted = text;
  for (const secret of uniqueNonEmpty(exactSecrets)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTION_MARKER);
  }

  return redacted
    .replace(/\b(authorization)(\s*:\s*)(bearer\s+[^\s,;]+)/gi, `$1$2${REDACTION_MARKER}`)
    .replace(/\b(api[_-]?key|token|secret|password)(\s*[:=]\s*)([^\s,;]+)/gi, `$1$2${REDACTION_MARKER}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTION_MARKER)
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, REDACTION_MARKER);
}

export function redactDeep<T>(value: T, exactSecrets: string[] = []): T {
  if (typeof value === 'string') return redactText(value, exactSecrets) as T;
  if (Array.isArray(value)) return value.map((entry) => redactDeep(entry, exactSecrets)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactDeep(entry, exactSecrets)]),
    ) as T;
  }
  return value;
}

export function redactToolResult(result: ApiToolResult, exactSecrets: string[] = []): ApiToolResult {
  return {
    ...result,
    content: result.content.map((entry) => ({ ...entry, text: redactText(entry.text, exactSecrets) })),
    details: result.details ? redactDeep(result.details, exactSecrets) : result.details,
  };
}

function base64UrlDecode(value: string): string | undefined {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
}

export function getAuthMetadataStatus(
  auth: ApiAuthConfig,
  options: { now?: () => Date } = {},
): AuthMetadataStatus {
  const now = options.now ?? (() => new Date());

  const token = auth.type === 'bearer' ? auth.token : auth.type === 'login' ? auth.access_token : undefined;

  if (!token) {
    return { status: 'unknown', warning: { code: 'unsupported_auth_metadata', message: 'Auth metadata is not locally inspectable.' } };
  }

  const parts = token.split('.');
  if (parts.length !== 3) return { status: 'unknown' };
  const payloadText = base64UrlDecode(parts[1]);
  if (!payloadText) return { status: 'unknown' };

  try {
    const payload = JSON.parse(payloadText) as { exp?: unknown };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return { status: 'unknown' };
    const nowSeconds = Math.floor(now().getTime() / 1000);
    const secondsRemaining = Math.max(0, Math.floor(payload.exp - nowSeconds));
    const expiresAt = new Date(payload.exp * 1000).toISOString();
    return payload.exp > nowSeconds
      ? { status: 'valid', expiresAt, secondsRemaining }
      : { status: 'expired', expiresAt, secondsRemaining };
  } catch {
    return { status: 'unknown' };
  }
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function countLines(value: string): number {
  return value.length === 0 ? 0 : value.split('\n').length;
}

function trimToBytes(value: string, maxBytes: number): string {
  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes) {
    end -= 1;
  }
  return value.slice(0, end);
}

export function applyOutputTruncation(
  text: string,
  limits?: { maxResponseBytes?: unknown; maxResponseLines?: unknown },
): { text: string; metadata: ApiTruncationMetadata } {
  const limitBytes = normalizePositiveInteger(limits?.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
  const limitLines = normalizePositiveInteger(limits?.maxResponseLines, DEFAULT_MAX_RESPONSE_LINES);
  const originalLines = countLines(text);
  const originalBytes = Buffer.byteLength(text, 'utf8');

  const lineLimitedText = text.split('\n').slice(0, limitLines).join('\n');
  const lineTruncated = originalLines > limitLines;
  const byteLimitedText = trimToBytes(lineLimitedText, limitBytes);
  const byteTruncated = Buffer.byteLength(lineLimitedText, 'utf8') > limitBytes;
  const truncated = lineTruncated || byteTruncated;

  const metadata: ApiTruncationMetadata = {
    truncated,
    limit_bytes: limitBytes,
    limit_lines: limitLines,
    original_bytes_known: true,
    original_lines_known: true,
    returned_bytes: Buffer.byteLength(byteLimitedText, 'utf8'),
    returned_lines: countLines(byteLimitedText),
  };

  if (truncated) {
    metadata.reason = lineTruncated && byteTruncated ? 'byte_and_line_limit' : lineTruncated ? 'line_limit' : 'byte_limit';
  }

  return { text: byteLimitedText, metadata };
}
