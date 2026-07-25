import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApiJsonGitInspector } from './git.js';
import {
  clampCursorTtlSeconds,
  clampPositiveInteger,
  collectConfiguredSecrets,
  DEFAULT_CURSOR_TTL_SECONDS,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_RESPONSE_LINES,
} from './security.js';
import type { ApiAuthConfig, ApiFramework, ApiIntegrationState, ApiJsonGitInspector, ApiToolsConfig, ApiWarning } from './types.js';

const DEFAULT_TIMEOUT_MS = 30000;

export interface LoadApiConfigOptions {
  cwd?: string;
  gitInspector?: ApiJsonGitInspector;
}

function createIntegrationState(): ApiIntegrationState {
  return { configured: false, enabled: false, valid: true };
}

function createBaseConfig(configPath: string): ApiToolsConfig {
  return {
    configPath,
    exists: false,
    enabled: false,
    headers: {},
    auth: { type: 'none' },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    limits: {
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
      maxResponseLines: DEFAULT_MAX_RESPONSE_LINES,
      cursorTtlSeconds: DEFAULT_CURSOR_TTL_SECONDS,
    },
    swagger: createIntegrationState(),
    graphql: createIntegrationState(),
    warnings: [],
    secretValues: [],
    git: { state: 'unknown' },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function pushWarning(warnings: ApiWarning[], warning: ApiWarning): void {
  if (!warnings.some((entry) => entry.code === warning.code && entry.message === warning.message)) warnings.push(warning);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function parseHeaders(value: unknown, warnings: ApiWarning[]): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') headers[key] = entry;
    else pushWarning(warnings, { code: 'invalid_config', message: 'Header values must be strings.' });
  }
  return headers;
}

function parseAuth(value: unknown, warnings: ApiWarning[]): ApiAuthConfig {
  const record = asRecord(value);
  if (!record) return { type: 'none' };

  switch (record.type) {
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return typeof record.token === 'string' ? { type: 'bearer', token: record.token } : { type: 'none' };
    case 'basic':
      return typeof record.username === 'string' && typeof record.password === 'string'
        ? { type: 'basic', username: record.username, password: record.password }
        : { type: 'none' };
    case 'api_key':
      return typeof record.header === 'string' && typeof record.value === 'string'
        ? { type: 'api_key', header: record.header, value: record.value }
        : { type: 'none' };
    case 'headers':
      return { type: 'headers', headers: parseHeaders(record.headers, warnings) };
    case 'login':
      return typeof record.login_path === 'string' && typeof record.username === 'string' && typeof record.password === 'string'
        ? {
          type: 'login',
          login_path: record.login_path,
          username: record.username,
          password: record.password,
          ...(typeof record.access_token === 'string' ? { access_token: record.access_token } : {}),
        }
        : { type: 'none' };
    case undefined:
      return { type: 'none' };
    default:
      pushWarning(warnings, { code: 'unsupported_auth_metadata', message: 'Unsupported auth metadata was ignored.' });
      return { type: 'none' };
  }
}

function parseFramework(value: unknown): ApiFramework | undefined {
  return value === 'spring' || value === 'node' ? value : undefined;
}

function parseIntegrationBlock(
  kind: 'swagger' | 'graphql',
  value: unknown,
  warnings: ApiWarning[],
): ApiIntegrationState {
  const record = asRecord(value);
  if (!record) return createIntegrationState();

  const enabled = record.enabled === true;
  const framework = parseFramework(record.framework);
  const state: ApiIntegrationState = {
    configured: true,
    enabled,
    framework,
    url: typeof record.url === 'string' ? record.url : undefined,
    valid: true,
  };

  if (typeof record.enabled !== 'boolean') {
    pushWarning(warnings, { code: `invalid_${kind}_config` as const, message: `${kind}.enabled must be a boolean.` });
    state.valid = false;
  }

  if (enabled && !framework) {
    pushWarning(warnings, { code: `invalid_${kind}_config` as const, message: `${kind}.framework must be spring or node when enabled.` });
    state.valid = false;
  }

  return state;
}

function parseLimits(value: unknown, warnings: ApiWarning[]): ApiToolsConfig['limits'] {
  const limits = asRecord(value);
  if (!limits) {
    pushWarning(warnings, { code: 'limit_default_applied', message: 'Default response limits were applied.' });
    return {
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
      maxResponseLines: DEFAULT_MAX_RESPONSE_LINES,
      cursorTtlSeconds: DEFAULT_CURSOR_TTL_SECONDS,
    };
  }

  const bytes = limits.max_response_bytes;
  const lines = limits.max_response_lines;
  const ttl = limits.cursor_ttl_seconds;
  const bytesValid = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0;
  const linesValid = typeof lines === 'number' && Number.isFinite(lines) && lines > 0;
  const ttlValid = typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0;

  if (typeof bytes === 'undefined' || typeof lines === 'undefined') {
    pushWarning(warnings, { code: 'limit_default_applied', message: 'Default response limits were applied.' });
  }
  if ((typeof bytes !== 'undefined' && !bytesValid) || (typeof lines !== 'undefined' && !linesValid) || (typeof ttl !== 'undefined' && !ttlValid)) {
    pushWarning(warnings, { code: 'limit_fallback_applied', message: 'Invalid response limits were replaced safely.' });
  }

  return {
    maxResponseBytes: bytesValid ? clampPositiveInteger(bytes, DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_MAX_RESPONSE_BYTES) : DEFAULT_MAX_RESPONSE_BYTES,
    maxResponseLines: linesValid ? clampPositiveInteger(lines, DEFAULT_MAX_RESPONSE_LINES, DEFAULT_MAX_RESPONSE_LINES) : DEFAULT_MAX_RESPONSE_LINES,
    cursorTtlSeconds: clampCursorTtlSeconds(ttlValid ? ttl : DEFAULT_CURSOR_TTL_SECONDS),
  };
}

export async function loadApiConfig(options: LoadApiConfigOptions = {}): Promise<ApiToolsConfig> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configPath = join(cwd, '.pi', 'api.json');
  const gitInspector = options.gitInspector ?? createApiJsonGitInspector();
  const config = createBaseConfig(configPath);

  if (!(await fileExists(configPath))) return config;

  config.exists = true;
  config.git = await gitInspector.inspectApiJson({ cwd });

  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    pushWarning(config.warnings, { code: 'invalid_config', message: 'Could not parse .pi/api.json.' });
    return config;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    pushWarning(config.warnings, { code: 'invalid_config', message: '.pi/api.json must contain an object.' });
    return config;
  }

  config.enabled = parsed.enabled === true;
  config.url = typeof parsed.url === 'string' ? parsed.url : undefined;
  config.graphqlUrl = typeof parsed.graphql_url === 'string' ? parsed.graphql_url : undefined;
  config.port = typeof parsed.port === 'number' && Number.isFinite(parsed.port) ? Math.floor(parsed.port) : undefined;
  config.timeoutMs = typeof parsed.timeout_ms === 'number' && Number.isFinite(parsed.timeout_ms) && parsed.timeout_ms > 0
    ? Math.floor(parsed.timeout_ms)
    : DEFAULT_TIMEOUT_MS;
  config.headers = parseHeaders(parsed.headers, config.warnings);
  config.auth = parseAuth(parsed.auth, config.warnings);
  config.swagger = parseIntegrationBlock('swagger', parsed.swagger, config.warnings);
  config.graphql = parseIntegrationBlock('graphql', parsed.graphql, config.warnings);
  config.limits = parseLimits(parsed.limits, config.warnings);
  config.secretValues = collectConfiguredSecrets({ headers: config.headers, auth: config.auth });

  if (typeof parsed.enabled !== 'boolean') {
    pushWarning(config.warnings, { code: 'invalid_config', message: 'enabled must be a boolean.' });
  }

  return config;
}
