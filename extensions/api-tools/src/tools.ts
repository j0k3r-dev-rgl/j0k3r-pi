import { readFile, writeFile } from 'node:fs/promises';
import { ContinuationManager } from './continuation.js';
import { createApiClient, ApiClientError, type FetchLike } from './client.js';
import { loadApiConfig } from './config.js';
import { classifyError, httpFailure } from './error-classify.js';
import { executeGraphqlAction } from './graphql.js';
import { GRAPHQL_FIELD_PAGE_SIZE } from './graphql/detail.js';
import { DISCOVERY_PAGE_SIZE as GRAPHQL_DISCOVERY_PAGE_SIZE } from './graphql/discovery.js';
import { failureDocument, frameText, record, successDocument } from './result-format.js';
import { getAuthMetadataStatus, redactDeep } from './security.js';
import { executeSwaggerAction } from './swagger.js';
import { DISCOVERY_PAGE_SIZE as SWAGGER_DISCOVERY_PAGE_SIZE } from './swagger/discovery.js';
import { renderApiToolResult } from './render.js';
import type { ApiActionDocument, ApiClient, ApiToolResult, ApiToolsConfig, ApiWarning } from './types.js';

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
      properties: { action: { type: 'string', enum: ['detail'] }, operation: { type: 'string' }, max_depth: { type: 'number', minimum: 0, maximum: 5 } },
      required: ['action', 'operation'],
    },
    {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['schema'] }, operation: { type: 'string' }, max_depth: { type: 'number', minimum: 0, maximum: 5 } },
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
      properties: { action: { type: 'string', enum: ['discover', 'detail', 'schema', 'request'] }, cursor: { type: 'string' } },
      required: ['action', 'cursor'],
    },
  ],
} as const;

const GRAPHQL_PARAMETERS = {
  type: 'object',
  oneOf: [
    {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['discover'] }, filter: { type: 'string' }, use_token: { type: 'boolean' } },
      required: ['action'],
    },
    {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['detail'] }, operation: { type: 'string' }, max_depth: { type: 'number', minimum: 0, maximum: 5 }, use_token: { type: 'boolean' } },
      required: ['action', 'operation'],
    },
    {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['schema'] }, name: { type: 'string' }, max_depth: { type: 'number', minimum: 0, maximum: 5 }, use_token: { type: 'boolean' } },
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
      properties: { action: { type: 'string', enum: ['discover', 'detail', 'schema', 'execute'] }, cursor: { type: 'string' } },
      required: ['action', 'cursor'],
    },
  ],
} as const;

const REST_PARAMETERS = {
  type: 'object',
  oneOf: [
    {
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
    {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['request'] }, cursor: { type: 'string' } },
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

function formatSecondsRemaining(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function buildStatusDocument(config: ApiToolsConfig): ApiActionDocument {
  const warnings = mergeWarnings(config);
  const lines = [
    'api_status',
    `enabled: ${config.enabled}`,
    `auth_type: ${config.auth.type}`,
    `timeout_ms: ${config.timeoutMs}`,
    `swagger: ${config.swagger.enabled ? `enabled${config.swagger.framework ? ` (${config.swagger.framework})` : ''}` : 'disabled'}`,
    `graphql: ${config.graphql.enabled ? `enabled${config.graphql.framework ? ` (${config.graphql.framework})` : ''}` : 'disabled'}`,
    `git: ${config.git.state}`,
    ...warnings.map((warning) => `warning ${warning.code}: ${warning.message ?? ''}`),
  ];
  return successDocument({ tool: 'api_rest_request', action: 'status', identity: 'api_status', records: lines.map((line, index) => record(`status-${index + 1}`, 'status', line)), total: lines.length });
}

function buildAuthStatusDocument(config: ApiToolsConfig, now?: () => Date): ApiActionDocument {
  const authStatus = getAuthMetadataStatus(config.auth, { now });
  const suffix = typeof authStatus.secondsRemaining === 'number'
    ? authStatus.status === 'valid'
      ? `expires in ${formatSecondsRemaining(authStatus.secondsRemaining)}`
      : `expired at ${authStatus.expiresAt}`
    : undefined;
  const lines = [
    `auth_type: ${config.auth.type}`,
    `auth_status: ${authStatus.status}`,
    suffix,
  ].filter(Boolean) as string[];
  return successDocument({ tool: 'api_rest_request', action: 'auth_status', identity: 'api_auth_status', records: lines.map((line, index) => record(`auth-${index + 1}`, 'auth_status', line)), total: lines.length });
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
  if (!config.configPath) throw new ApiClientError('configuration', 'Config path is not available for token persistence.');
  const parsed = JSON.parse(await readFile(config.configPath, 'utf8')) as Record<string, unknown>;
  const auth = parsed.auth && typeof parsed.auth === 'object' && !Array.isArray(parsed.auth) ? { ...(parsed.auth as Record<string, unknown>) } : {};
  auth.access_token = accessToken;
  parsed.auth = auth;
  await writeFile(config.configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  if (config.auth.type === 'login') config.auth.access_token = accessToken;
  if (!config.secretValues.includes(accessToken)) config.secretValues.push(accessToken);
}

async function executeLoginTool(signal: AbortSignal | undefined, config: ApiToolsConfig, client: ApiClient): Promise<ApiActionDocument> {
  if (config.auth.type !== 'login') return failureDocument({ tool: 'api_rest_request', action: 'login', failure: classifyError('api_rest_request', 'login', new ApiClientError('configuration', 'Login auth is not configured.')) });
  try {
    const response = await client.login(signal);
    const accessToken = extractAccessToken(response.bodyText);
    if (!accessToken) return failureDocument({ tool: 'api_rest_request', action: 'login', failure: classifyError('api_rest_request', 'login', new ApiClientError('provider', 'Login response did not include access_token.')) });
    await persistAccessToken(config, accessToken);
    return successDocument({
      tool: 'api_rest_request',
      action: 'login',
      identity: 'api_login',
      records: [
        record('login-1', 'login', 'api_login: access_token persisted.'),
        record('login-2', 'response', `status: ${response.status} ${response.statusText}`),
      ],
      total: 2,
    });
  } catch (error) {
    return failureDocument({ tool: 'api_rest_request', action: 'login', failure: classifyError('api_rest_request', 'login', error) });
  }
}

async function executeRestTool(
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  config: ApiToolsConfig,
  client: ApiClient,
): Promise<ApiActionDocument> {
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

    const payload = redactDeep({ body: response.bodyText }, config.secretValues);
    const records = [
      record('request-1', 'request', `${method} ${path}`),
      record('response-1', 'response', `status: ${response.status} ${response.statusText}`),
      ...frameText('response-body', 'text_frame', typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body, null, 2)),
    ];

    if (response.status >= 400) {
      return failureDocument({
        tool: 'api_rest_request',
        action: 'request',
        identity: `${method} ${path}`,
        failure: httpFailure('api_rest_request', 'request', response.status, response.statusText, `REST request failed with ${response.status} ${response.statusText}.`),
        records,
      });
    }
    return successDocument({ tool: 'api_rest_request', action: 'request', identity: `${method} ${path}`, records, total: records.length });
  } catch (error) {
    return failureDocument({ tool: 'api_rest_request', action: 'request', identity: `${method} ${path}`, failure: classifyError('api_rest_request', 'request', error) });
  }
}

function continuationPageLimit(tool: 'api_rest_request' | 'api_swagger' | 'api_graphql', action: string): number | undefined {
  if (tool === 'api_swagger' && action === 'discover') return SWAGGER_DISCOVERY_PAGE_SIZE;
  if (tool === 'api_graphql' && action === 'discover') return GRAPHQL_DISCOVERY_PAGE_SIZE;
  if (tool === 'api_graphql' && (action === 'detail' || action === 'schema')) return GRAPHQL_FIELD_PAGE_SIZE;
  return undefined;
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
  return {
    content: [{ type: 'text', text: 'Cursor continuation does not accept execution-specific inputs.' }],
    details: {
      contract_version: 2,
      status: 'failure',
      action: 'continue',
      failure: {
        category: 'continuation_error',
        code: 'continuation.cursor_execution_inputs_rejected',
        message: 'Cursor continuation does not accept execution-specific inputs.',
        retryable: false,
        next_step: 'Repeat the original action without extra execution inputs.',
      },
      continuation: { returned_count: 1, has_more: false, follow_up: { tool: 'unknown', action: 'unknown', cursor_parameter: 'cursor' }, returned_bytes: 58, returned_lines: 1 },
    },
    isError: true,
  };
}

export async function registerApiTools(pi: any, options: RegisterApiToolsOptions = {}): Promise<void> {
  if (!pi || typeof pi.registerTool !== 'function') return;

  const config = await (options.loadConfig ?? loadApiConfig)({ cwd: options.cwd ?? process.cwd() });
  if (!config.exists || !config.enabled) return;

  const client = options.client ?? options.createClient?.({ config, fetch: options.fetch }) ?? createApiClient({ config, fetch: options.fetch });
  const continuation = new ContinuationManager({ ttlSeconds: config.limits.cursorTtlSeconds });

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
    execute: async () => continuation.finalize({ tool: 'api_rest_request', action: 'status', document: buildStatusDocument(config), secretValues: config.secretValues, limits: { ...config.limits, maxRecordsPerPage: continuationPageLimit('api_rest_request', 'status') } }),
    ...buildRenderers('api_status'),
  });

  pi.registerTool({
    name: 'api_auth_status',
    description: 'Inspect local API auth metadata without contacting the backend.',
    parameters: EMPTY_PARAMETERS,
    execute: async () => continuation.finalize({ tool: 'api_rest_request', action: 'auth_status', document: buildAuthStatusDocument(config, options.now), secretValues: config.secretValues, limits: { ...config.limits, maxRecordsPerPage: continuationPageLimit('api_rest_request', 'auth_status') } }),
    ...buildRenderers('api_auth_status'),
  });

  pi.registerTool({
    name: 'api_login',
    description: 'Login with configured project credentials and persist access_token into .pi/api.json.',
    parameters: EMPTY_PARAMETERS,
    execute: async (_id: string, _params: Record<string, unknown>, signal?: AbortSignal) => continuation.finalize({ tool: 'api_rest_request', action: 'login', document: await executeLoginTool(signal, config, client), secretValues: config.secretValues, limits: { ...config.limits, maxRecordsPerPage: continuationPageLimit('api_rest_request', 'login') } }),
    ...buildRenderers('api_login'),
  });

  pi.registerTool({
    name: 'api_rest_request',
    description: 'Execute a REST request against the configured project API with safe bounded outputs.',
    parameters: REST_PARAMETERS,
    execute: async (_id: string, params: Record<string, unknown>, signal?: AbortSignal) => {
      const cursorConflict = rejectCursorExecutionInputs(params);
      if (cursorConflict) return cursorConflict;
      if (typeof params.cursor === 'string') return continuation.continue({ tool: 'api_rest_request', action: String(params.action ?? 'request'), cursor: params.cursor });
      const document = await executeRestTool(params, signal, config, client);
      return continuation.finalize({ tool: 'api_rest_request', action: 'request', document, secretValues: config.secretValues, limits: { ...config.limits, maxRecordsPerPage: continuationPageLimit('api_rest_request', 'request') } });
    },
    ...buildRenderers('api_rest_request'),
  });

  if (config.swagger.enabled && config.swagger.valid) {
    pi.registerTool({
      name: 'api_swagger',
      description: 'Inspect Swagger/OpenAPI contracts with discover, detail, schema, request, and same-tool cursor continuation.',
      parameters: SWAGGER_PARAMETERS,
      execute: async (_id: string, params: Record<string, unknown>, signal?: AbortSignal) => {
        const cursorConflict = rejectCursorExecutionInputs(params);
        if (cursorConflict) return cursorConflict;
        if (typeof params.cursor === 'string') return continuation.continue({ tool: 'api_swagger', action: String(params.action ?? ''), cursor: params.cursor });
        const action = String(params.action ?? '');
        const document = await executeSwaggerAction(params, signal, client, config);
        return continuation.finalize({ tool: 'api_swagger', action, document, secretValues: config.secretValues, limits: { ...config.limits, maxRecordsPerPage: continuationPageLimit('api_swagger', action) } });
      },
      ...buildRenderers('api_swagger'),
    });
  }

  if (config.graphql.enabled && config.graphql.valid) {
    pi.registerTool({
      name: 'api_graphql',
      description: 'Inspect GraphQL contracts with discover, detail, schema, execute, and same-tool cursor continuation.',
      parameters: GRAPHQL_PARAMETERS,
      execute: async (_id: string, params: Record<string, unknown>, signal?: AbortSignal) => {
        const cursorConflict = rejectCursorExecutionInputs(params);
        if (cursorConflict) return cursorConflict;
        if (typeof params.cursor === 'string') return continuation.continue({ tool: 'api_graphql', action: String(params.action ?? ''), cursor: params.cursor });
        const action = String(params.action ?? '');
        const document = await executeGraphqlAction(params, signal, client, config);
        return continuation.finalize({ tool: 'api_graphql', action, document, secretValues: config.secretValues, limits: { ...config.limits, maxRecordsPerPage: continuationPageLimit('api_graphql', action) } });
      },
      ...buildRenderers('api_graphql'),
    });
  }
}
