import { Buffer } from 'node:buffer';
import type {
  ApiAuthConfig,
  ApiAuthorizationMetadata,
  ApiAuthorizationScheme,
  ApiToolResult,
  ApiTruncationMetadata,
  ApiWarning,
} from './types.js';

export const REDACTION_MARKER = '[REDACTED]';
export const DEFAULT_MAX_RESPONSE_BYTES = 50000;
export const DEFAULT_MAX_RESPONSE_LINES = 2000;
export const DEFAULT_CURSOR_TTL_SECONDS = 3600;
export const MAX_CURSOR_TTL_SECONDS = 86400;
export const DESCRIPTION_LIMIT = 500;
export const AUTH_VALUE_LIMIT = 128;
export const AUTH_VALUE_COUNT_LIMIT = 32;

const SECRET_KEY_PATTERN = /(?:authorization|api[_-]?key|token|secret|password|cookie|set-cookie)/i;
const PATH_PATTERN = /(?:[A-Za-z]:\\|\/(?:home|Users|tmp|var|private|etc)\/)[^\s"']+/g;

const OPENAPI_ROLE_KEYS = new Set(['x-role', 'x-roles', 'x-required-role', 'x-required-roles']);
const OPENAPI_PERMISSION_KEYS = new Set(['x-permission', 'x-permissions', 'x-required-permission', 'x-required-permissions']);
const OPENAPI_AUTHORITY_KEYS = new Set(['x-authority', 'x-authorities', 'x-required-authority', 'x-required-authorities']);
const OPENAPI_SCOPE_KEYS = new Set(['x-scope', 'x-scopes', 'x-required-scope', 'x-required-scopes']);
const GRAPHQL_DIRECTIVE_NAMES = new Set(['role', 'roles', 'permission', 'permissions', 'authority', 'authorities', 'scope', 'scopes', 'auth', 'authz']);

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

export function clampPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.floor(value));
}

export function clampCursorTtlSeconds(value: unknown): number {
  return clampPositiveInteger(value, DEFAULT_CURSOR_TTL_SECONDS, MAX_CURSOR_TTL_SECONDS);
}

export function truncateString(value: string, max = DESCRIPTION_LIMIT): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated]`;
}

export function sanitizeErrorText(value: string): string {
  return truncateString(value.replace(PATH_PATTERN, REDACTION_MARKER), DESCRIPTION_LIMIT);
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
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, REDACTION_MARKER)
    .replace(PATH_PATTERN, REDACTION_MARKER);
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

function countLines(value: string): number {
  return value.length === 0 ? 0 : value.split('\n').length;
}

function trimToBytes(value: string, maxBytes: number): string {
  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes) end -= 1;
  return value.slice(0, end);
}

export function applyOutputTruncation(
  text: string,
  limits?: { maxResponseBytes?: unknown; maxResponseLines?: unknown },
): { text: string; metadata: ApiTruncationMetadata } {
  const limitBytes = clampPositiveInteger(limits?.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_MAX_RESPONSE_BYTES);
  const limitLines = clampPositiveInteger(limits?.maxResponseLines, DEFAULT_MAX_RESPONSE_LINES, DEFAULT_MAX_RESPONSE_LINES);
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

function pushAuthValues(target: string[] | undefined, values: string[]): string[] {
  const next = target ? [...target] : [];
  for (const value of values) {
    if (!next.includes(value)) next.push(value);
  }
  return next;
}

function normalizeAuthValue(raw: unknown): { values: string[]; unsupported: boolean; truncated: boolean } {
  if (typeof raw === 'string') {
    return { values: [truncateString(raw, AUTH_VALUE_LIMIT)], unsupported: false, truncated: raw.length > AUTH_VALUE_LIMIT };
  }
  if (Array.isArray(raw) && raw.every((value) => typeof value === 'string')) {
    const sliced = raw.slice(0, AUTH_VALUE_COUNT_LIMIT).map((value) => truncateString(value, AUTH_VALUE_LIMIT));
    return { values: sliced, unsupported: false, truncated: raw.length > AUTH_VALUE_COUNT_LIMIT || raw.some((value) => value.length > AUTH_VALUE_LIMIT) };
  }
  return { values: [], unsupported: true, truncated: false };
}

export function compactAuthorizationSummary(metadata: ApiAuthorizationMetadata): string {
  switch (metadata.state) {
    case 'declared':
      return 'declared';
    case 'not_declared':
      return 'not_declared';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'unknown';
  }
}

export function extractOpenApiAuthorizationMetadata(input: {
  document: Record<string, any>;
  effectiveSecurity?: any[];
  sources?: Array<Record<string, any> | undefined>;
}): ApiAuthorizationMetadata {
  const metadata: ApiAuthorizationMetadata = { state: 'not_declared', sources: [] };
  const schemes: ApiAuthorizationScheme[] = [];
  const securitySchemes = input.document.components?.securitySchemes ?? {};
  let hasDeclared = false;

  for (const requirement of input.effectiveSecurity ?? []) {
    if (!requirement || typeof requirement !== 'object') continue;
    for (const [name, scopes] of Object.entries(requirement)) {
      const scheme = securitySchemes[name] ?? {};
      const record: ApiAuthorizationScheme = {
        name,
        type: typeof scheme.type === 'string' ? scheme.type : 'unknown',
      };
      if (typeof scheme.scheme === 'string') record.scheme = scheme.scheme;
      if (Array.isArray(scopes) && scopes.every((value) => typeof value === 'string')) {
        record.scopes = scopes.slice(0, AUTH_VALUE_COUNT_LIMIT).map((value) => truncateString(value, AUTH_VALUE_LIMIT));
        metadata.scopes = pushAuthValues(metadata.scopes, record.scopes);
      }
      schemes.push(record);
      hasDeclared = true;
    }
  }

  if (schemes.length > 0) {
    metadata.schemes = schemes;
    metadata.sources!.push('openapi_security');
  }

  for (const source of input.sources ?? []) {
    if (!source || typeof source !== 'object') continue;
    for (const [rawKey, rawValue] of Object.entries(source)) {
      const key = rawKey.toLowerCase();
      const normalized = normalizeAuthValue(rawValue);
      if (normalized.unsupported) {
        if (OPENAPI_ROLE_KEYS.has(key) || OPENAPI_PERMISSION_KEYS.has(key) || OPENAPI_AUTHORITY_KEYS.has(key) || OPENAPI_SCOPE_KEYS.has(key)) {
          metadata.unsupported_metadata = true;
        }
        continue;
      }
      if (normalized.truncated) metadata.truncated = true;
      if (OPENAPI_ROLE_KEYS.has(key)) metadata.roles = pushAuthValues(metadata.roles, normalized.values);
      if (OPENAPI_PERMISSION_KEYS.has(key)) metadata.permissions = pushAuthValues(metadata.permissions, normalized.values);
      if (OPENAPI_AUTHORITY_KEYS.has(key)) metadata.authorities = pushAuthValues(metadata.authorities, normalized.values);
      if (OPENAPI_SCOPE_KEYS.has(key)) metadata.scopes = pushAuthValues(metadata.scopes, normalized.values);
      if (OPENAPI_ROLE_KEYS.has(key) || OPENAPI_PERMISSION_KEYS.has(key) || OPENAPI_AUTHORITY_KEYS.has(key) || OPENAPI_SCOPE_KEYS.has(key)) {
        hasDeclared = true;
      }
    }
  }

  if (hasDeclared) {
    metadata.state = 'declared';
    if ((metadata.roles?.length || metadata.permissions?.length || metadata.authorities?.length || metadata.scopes?.length) && !metadata.sources!.includes('openapi_vendor')) {
      metadata.sources!.push('openapi_vendor');
    }
  }

  if (!metadata.sources?.length) delete metadata.sources;
  return metadata;
}

function readDirectiveArgs(raw: any): Array<[string, unknown]> {
  if (Array.isArray(raw?.arguments)) return raw.arguments.map((entry: any) => [String(entry.name ?? ''), entry.value]);
  if (Array.isArray(raw?.args)) return raw.args.map((entry: any) => [String(entry.name ?? ''), entry.value]);
  if (raw?.arguments && typeof raw.arguments === 'object') return Object.entries(raw.arguments);
  if (raw?.args && typeof raw.args === 'object') return Object.entries(raw.args);
  return [];
}

export function extractGraphqlAuthorizationMetadata(appliedDirectives: any[] | undefined): ApiAuthorizationMetadata {
  if (!Array.isArray(appliedDirectives) || appliedDirectives.length === 0) {
    return {
      state: 'unavailable',
      reason: 'Standard introspection does not expose applied directives.',
    };
  }

  const metadata: ApiAuthorizationMetadata = {
    state: 'not_declared',
    sources: [],
  };
  let hasDeclared = false;

  for (const directive of appliedDirectives) {
    const name = String(directive?.name ?? '').toLowerCase();
    if (!GRAPHQL_DIRECTIVE_NAMES.has(name)) continue;
    for (const [, value] of readDirectiveArgs(directive)) {
      const normalized = normalizeAuthValue(value);
      if (normalized.unsupported) {
        metadata.unsupported_metadata = true;
        continue;
      }
      if (normalized.truncated) metadata.truncated = true;
      if (name.includes('role')) metadata.roles = pushAuthValues(metadata.roles, normalized.values);
      else if (name.includes('permission') || name === 'auth' || name === 'authz') metadata.permissions = pushAuthValues(metadata.permissions, normalized.values);
      else if (name.includes('authority')) metadata.authorities = pushAuthValues(metadata.authorities, normalized.values);
      else if (name.includes('scope')) metadata.scopes = pushAuthValues(metadata.scopes, normalized.values);
      hasDeclared = true;
    }
  }

  if (hasDeclared) {
    metadata.state = 'declared';
    metadata.sources = ['graphql_applied_directive'];
    return metadata;
  }

  return { state: 'not_declared', sources: ['graphql_applied_directive'] };
}
