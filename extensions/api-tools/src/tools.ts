import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { ContinuationManager } from './continuation.js';
import { createApiClient, ApiClientError, type FetchLike } from './client.js';
import { loadApiConfig } from './config.js';
import { executeGraphqlAction } from './graphql.js';
import { getAuthMetadataStatus, redactDeep, redactToolResult } from './security.js';
import { executeSwaggerAction } from './swagger.js';
import { renderApiToolResult } from './render.js';
import type { ApiClient, ApiToolResult, ApiToolsConfig, ApiWarning } from './types.js';

export const API_TOOL_NAMES = [
  'api_status',
  'api_auth_status',
  'api_login',
  'api_rest_request',
  'api_swagger',
  'api_graphql',
] as const;

export interface RegisterApiToolsOptions {
  cwd?: string;
  loadConfig?: typeof loadApiConfig;
  client?: ApiClient;
  createClient?: (options: { config: ApiToolsConfig; fetch?: FetchLike }) => ApiClient;
  fetch?: FetchLike;
  now?: () => Date;
}

const EMPTY_PARAMETERS = { type: 'object', additionalProperties: false, properties: {} } as const;

const SWAGGER_PARAMETERS = {
  type: 'object',
  oneOf: [
    {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['discover'] }, tag: { type: 'string' }, operation: { type: 'string' } },
      required: ['action'],
    },
    {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['schema'] }, operation: { type: 'string' }, max_depth: { type: 'number', minimum: 0, maximum: 6 } },
      required: ['action', 'operation'],
    },
    {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['request'] },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] },
        path: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: { type: 'string' },
        use_token: { type: 'boolean' },
      },
      required: ['action', 'method', 'path'],
    },
    {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['discover', 'schema', 'request'] }, cursor: { type: 'string' } },
      required: ['action', 'cursor'],
    },
  ],
} as const;

const GRAPHQL_PARAMETERS = {
  type: 'object',
  oneOf: [
    {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['discover'] }, filter: { type: 'string' } },
      required: ['action'],
    },
    {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['schema'] }, name: { type: 'string' }, max_depth: { type: 'number', minimum: 0, maximum: 6 } },
      required: ['action', 'name'],
    },
    {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['execute'] },
        query: { type: 'string' },
        variables: { type: 'object', additionalProperties: true },
        operationName: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        use_token: { type: 'boolean' },
      },
      required: ['action', 'query'],
    },
    {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['discover', 'schema', 'execute'] }, cursor: { type: 'string' } },
      required: ['action', 'cursor'],
    },
  ],
} as const;

function mergeWarnings(config: ApiToolsConfig): ApiWarning[] {
  const warnings = [...config.warnings];
  const seen = new Set(warnings.map((warning) => `${warning.code}:${warning.message ?? ''}`));
  const push = (warning: ApiWarning) => {
    const key = `${warning.code}:${warning.message ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      warnings.push(warning);
    }
  };

  switch (config.git.state) {
    case 'tracked':
      push({ code: 'api_json_tracked', message: '.pi/api.json appears tracked by git.' });
      break;
    case 'unignored_untracked':
      push({ code: 'api_json_unignored', message: '.pi/api.json does not appear ignored by git.' });
      break;
    case 'unknown':
      push({ code: 'git_status_unknown', message: 'Git exposure status could not be determined safely.' });
      break;
    case 'ignored':
      break;
  }

  return warnings;
}

function buildSuccess(text: string, data: Record<string, unknown>): ApiToolResult {
  return { content: [{ type: 'text', text }], details: { status: 'success', data } };
}

function buildFailure(code: string, message: string, details: Record<string, unknown> = {}): ApiToolResult {
  return {
    content: [{ type: 'text', text: message }],
    details: { status: 'failure', error: { code, message, recoverable: true }, ...details },
    isError: true,
  };
}

function classifyError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : 'Unexpected API tool failure.';
  if (/timed out/i.test(message)) return { code: 'timeout', message };
  if (/cancelled|canceled|aborted/i.test(message)) return { code: 'cancelled', message };
  if (error instanceof ApiClientError) return { code: 'validation_error', message };
  return { code: 'provider_error', message };
}

function formatSecondsRemaining(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function buildStatusResult(config: ApiToolsConfig): ApiToolResult {
  const warnings = mergeWarnings(config);
  const data: Record<string, unknown> = {
    config_exists: config.exists,
    enabled: config.enabled,
    auth_type: config.auth.type,
    timeout_ms: config.timeoutMs,
    limits: {
      max_response_bytes: config.limits.maxResponseBytes,
      max_response_lines: config.limits.maxResponseLines,
      cursor_ttl_seconds: config.limits.cursorTtlSeconds,
    },
    git: { state: config.git.state },
    warnings,
  };

  if (config.swagger.configured) {
    data.swagger = config.swagger.enabled && config.swagger.framework
      ? { enabled: true, framework: config.swagger.framework }
      : { enabled: config.swagger.enabled };
  }
  if (config.graphql.configured) {
    data.graphql = config.graphql.enabled && config.graphql.framework
      ? { enabled: true, framework: config.graphql.framework }
      : { enabled: config.graphql.enabled };
  }

  return buildSuccess('api_status: enabled project-local API tools configuration is active.', data);
}

function buildAuthStatusResult(config: ApiToolsConfig, now?: () => Date): ApiToolResult {
  const authStatus = getAuthMetadataStatus(config.auth, { now });
  const warnings = authStatus.warning ? [authStatus.warning] : [];
  const reasonCode = authStatus.warning?.code ?? (authStatus.status === 'unknown' ? 'unknown_auth_metadata' : undefined);
  const suffix = typeof authStatus.secondsRemaining === 'number'
    ? authStatus.status === 'valid'
      ? ` · expires in ${formatSecondsRemaining(authStatus.secondsRemaining)}`
      : ` · expired at ${authStatus.expiresAt}`
    : '';

  return buildSuccess(`api_auth_status: ${authStatus.status}${suffix}`, {
    auth_type: config.auth.type,
    auth_status: authStatus.status,
    reason_code: reasonCode,
    expires_at: authStatus.expiresAt,
    seconds_remaining: authStatus.secondsRemaining,
    warnings,
  });
}

function extractAccessToken(bodyText: string): string | undefined {
  try {
    const parsed = JSON.parse(bodyText) as { access_token?: unknown; token?: unknown };
    if (typeof parsed.access_token === 'string' && parsed.access_token.length > 0) return parsed.access_token;
    if (typeof parsed.token === 'string' && parsed.token.length > 0) return parsed.token;
    return undefined;
  } catch {
    return undefined;
  }
}

async function persistAccessToken(config: ApiToolsConfig, accessToken: string): Promise<void> {
  if (!config.configPath) throw new ApiClientError('Config path is not available for token persistence.');
  const parsed = JSON.parse(await readFile(config.configPath, 'utf8')) as Record<string, unknown>;
  const auth = parsed.auth && typeof parsed.auth === 'object' && !Array.isArray(parsed.auth) ? { ...(parsed.auth as Record<string, unknown>) } : {};
  auth.access_token = accessToken;
  parsed.auth = auth;
  await writeFile(config.configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  if (config.auth.type === 'login') config.auth.access_token = accessToken;
  if (!config.secretValues.includes(accessToken)) config.secretValues.push(accessToken);
}

async function executeLoginTool(signal: AbortSignal | undefined, config: ApiToolsConfig, client: ApiClient): Promise<ApiToolResult> {
  if (config.auth.type !== 'login') return buildFailure('validation_error', 'Login auth is not configured.');
  try {
    const response = await client.login(signal);
    const accessToken = extractAccessToken(response.bodyText);
    if (!accessToken) return buildFailure('provider_error', 'Login response did not include access_token.');
    await persistAccessToken(config, accessToken);
    return redactToolResult(buildSuccess('api_login: access_token persisted.', {
      auth_type: 'login',
      access_token_persisted: true,
      status: response.status,
      status_text: response.statusText,
    }), [...config.secretValues, accessToken]);
  } catch (error) {
    const safe = classifyError(error);
    return buildFailure(safe.code, safe.message);
  }
}

function isRestMutation(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

function buildRenderers(toolName: string) {
  return {
    renderResult(result: ApiToolResult, options: any, theme: any, context: any) {
      return renderApiToolResult(toolName, result, options, theme, context);
    },
  };
}

function rejectCursorExecutionInputs(params: Record<string, unknown>): ApiToolResult | undefined {
  if (typeof params.cursor !== 'string') return undefined;
  const forbidden = Object.keys(params).filter((key) => !['action', 'cursor'].includes(key));
  if (forbidden.length === 0) return undefined;
  return buildFailure('cursor_execution_inputs_rejected', 'Cursor continuation does not accept execution-specific inputs.');
}

async function executeRestTool(
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  config: ApiToolsConfig,
  client: ApiClient,
): Promise<ApiToolResult> {
  const method = typeof params.method === 'string' ? params.method.toUpperCase() : '';
  const path = typeof params.path === 'string' ? params.path : '';
  try {
    const response = await client.rest({
      method: method as any,
      path,
      headers: params.headers as Record<string, string> | undefined,
      body: typeof params.body === 'string' ? params.body : undefined,
      useToken: params.use_token === false ? false : true,
    }, signal);

    const payload = redactDeep({
      request: { method, path, mutation: isRestMutation(method), use_token: params.use_token === false ? false : true },
      response: { status: response.status, status_text: response.statusText, headers: response.headers, body: response.bodyText },
    }, config.secretValues);

    if (response.status >= 400) return buildFailure('http_error', `REST request failed with ${response.status} ${response.statusText}.`, payload);
    return buildSuccess(`api_rest_request ${method} ${path}`, payload);
  } catch (error) {
    const safe = classifyError(error);
    return buildFailure(safe.code, safe.message, { request: { method, path } });
  }
}

export async function registerApiTools(pi: any, options: RegisterApiToolsOptions = {}): Promise<void> {
  if (!pi || typeof pi.registerTool !== 'function') return;

  const config = await (options.loadConfig ?? loadApiConfig)({ cwd: options.cwd ?? process.cwd() });
  if (!config.exists || !config.enabled) return;

  const client = options.client ?? options.createClient?.({ config, fetch: options.fetch }) ?? createApiClient({ config, fetch: options.fetch });
  const continuation = new ContinuationManager({ ttlSeconds: config.limits.cursorTtlSeconds });
  const sessionOwner = randomBytes(8).toString('hex');
  void sessionOwner;

  pi.on?.('session_start', async () => {
    await continuation.rotateSession();
  });
  pi.on?.('session_shutdown', async () => {
    await continuation.cleanup();
  });

  pi.registerTool({
    name: 'api_status',
    description: 'Show safe project-local API tools configuration status without exposing secrets.',
    parameters: EMPTY_PARAMETERS,
    execute: async () => redactToolResult(buildStatusResult(config), config.secretValues),
    ...buildRenderers('api_status'),
  });

  pi.registerTool({
    name: 'api_auth_status',
    description: 'Inspect local API auth metadata without contacting the backend.',
    parameters: EMPTY_PARAMETERS,
    execute: async () => redactToolResult(buildAuthStatusResult(config, options.now), config.secretValues),
    ...buildRenderers('api_auth_status'),
  });

  pi.registerTool({
    name: 'api_login',
    description: 'Login with configured project credentials and persist access_token into .pi/api.json.',
    parameters: EMPTY_PARAMETERS,
    execute: async (_id: string, _params: Record<string, unknown>, signal?: AbortSignal) => redactToolResult(await executeLoginTool(signal, config, client), config.secretValues),
    ...buildRenderers('api_login'),
  });

  pi.registerTool({
    name: 'api_rest_request',
    description: 'Execute a REST request against the configured project API with safe bounded outputs.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] },
        path: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: { type: 'string' },
        use_token: { type: 'boolean' },
      },
      required: ['method', 'path'],
    },
    execute: async (_id: string, params: Record<string, unknown>, signal?: AbortSignal) => redactToolResult(await executeRestTool(params, signal, config, client), config.secretValues),
    ...buildRenderers('api_rest_request'),
  });

  if (config.swagger.enabled && config.swagger.valid) {
    pi.registerTool({
      name: 'api_swagger',
      description: 'Inspect Swagger/OpenAPI contracts with discover, schema, request, and same-tool cursor continuation.',
      parameters: SWAGGER_PARAMETERS,
      execute: async (_id: string, params: Record<string, unknown>, signal?: AbortSignal) => {
        const cursorConflict = rejectCursorExecutionInputs(params);
        if (cursorConflict) return cursorConflict;
        if (typeof params.cursor === 'string') return continuation.continue({ tool: 'api_swagger', action: String(params.action ?? ''), cursor: params.cursor });
        const result = await executeSwaggerAction(params, signal, client, config);
        return continuation.finalize({ tool: 'api_swagger', action: String(params.action ?? ''), result, secretValues: config.secretValues, limits: config.limits });
      },
      ...buildRenderers('api_swagger'),
    });
  }

  if (config.graphql.enabled && config.graphql.valid) {
    pi.registerTool({
      name: 'api_graphql',
      description: 'Inspect GraphQL contracts with discover, schema, execute, and same-tool cursor continuation.',
      parameters: GRAPHQL_PARAMETERS,
      execute: async (_id: string, params: Record<string, unknown>, signal?: AbortSignal) => {
        const cursorConflict = rejectCursorExecutionInputs(params);
        if (cursorConflict) return cursorConflict;
        if (typeof params.cursor === 'string') return continuation.continue({ tool: 'api_graphql', action: String(params.action ?? ''), cursor: params.cursor });
        const result = await executeGraphqlAction(params, signal, client, config);
        return continuation.finalize({ tool: 'api_graphql', action: String(params.action ?? ''), result, secretValues: config.secretValues, limits: config.limits });
      },
      ...buildRenderers('api_graphql'),
    });
  }
}
