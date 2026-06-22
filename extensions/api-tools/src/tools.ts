import { readFile, writeFile } from 'node:fs/promises';
import { createApiClient, ApiClientError, type FetchLike } from './client.js';
import { loadApiConfig } from './config.js';
import {
  applyOutputTruncation,
  getAuthMetadataStatus,
  redactDeep,
  redactText,
  redactToolResult,
} from './security.js';
import type { ApiClient, ApiToolResult, ApiToolsConfig, ApiWarning } from './types.js';

export const API_TOOL_NAMES = [
  'api_status',
  'api_auth_status',
  'api_login',
  'api_rest_request',
  'api_graphql_query',
  'api_graphql_schema_queries',
  'api_graphql_schema_query',
] as const;

export interface RegisterApiToolsOptions {
  cwd?: string;
  loadConfig?: typeof loadApiConfig;
  client?: ApiClient;
  createClient?: (options: { config: ApiToolsConfig; fetch?: FetchLike }) => ApiClient;
  fetch?: FetchLike;
  now?: () => Date;
}

const EMPTY_PARAMETERS = {
  type: 'object',
  properties: {},
} as const;

const REST_PARAMETERS = {
  type: 'object',
  properties: {
    method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] },
    path: { type: 'string' },
    headers: { type: 'object', additionalProperties: { type: 'string' } },
    body: { type: 'string' },
    use_token: { type: 'boolean' },
  },
  required: ['method', 'path'],
} as const;

const GRAPHQL_PARAMETERS = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    variables: { type: 'object', additionalProperties: true },
    operationName: { type: 'string' },
    headers: { type: 'object', additionalProperties: { type: 'string' } },
    use_token: { type: 'boolean' },
  },
  required: ['query'],
} as const;

const GRAPHQL_SCHEMA_QUERIES_PARAMETERS = {
  type: 'object',
  properties: {
    use_token: { type: 'boolean' },
  },
} as const;

const GRAPHQL_SCHEMA_QUERY_PARAMETERS = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    max_depth: { type: 'number' },
    use_token: { type: 'boolean' },
  },
  required: ['name'],
} as const;

function mergeWarnings(config: ApiToolsConfig): ApiWarning[] {
  const warnings = [...config.warnings];
  const seen = new Set(warnings.map((warning) => warning.code));
  const push = (warning: ApiWarning) => {
    if (!seen.has(warning.code)) {
      seen.add(warning.code);
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

function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function buildSuccess(text: string, data: Record<string, unknown>): ApiToolResult {
  return {
    content: [{ type: 'text', text }],
    details: {
      status: 'success',
      data,
    },
  };
}

function buildFailure(code: string, message: string, details: Record<string, unknown> = {}): ApiToolResult {
  return {
    content: [{ type: 'text', text: message }],
    details: {
      status: 'failure',
      error: {
        code,
        message,
        recoverable: true,
      },
      ...details,
    },
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

function isRestMutation(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

function isGraphqlMutation(query: string): boolean {
  return /^\s*mutation\b/i.test(query);
}

function buildResponseData(response: {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
}, config: ApiToolsConfig) {
  const redactedBody = redactText(response.bodyText, config.secretValues);
  const truncated = applyOutputTruncation(redactedBody, config.limits);
  return {
    status: response.status,
    status_text: response.statusText,
    headers: redactDeep(response.headers, config.secretValues),
    body: truncated.text,
    truncation: truncated.metadata,
  };
}

function buildRequestSuccessText(prefix: string, responseData: ReturnType<typeof buildResponseData>): string {
  const header = `${prefix}: ${responseData.status} ${responseData.status_text}`;
  return responseData.body ? `${header}\n${responseData.body}` : header;
}

function buildStatusResult(config: ApiToolsConfig): ApiToolResult {
  const restUrl = sanitizeUrl(config.url);
  const graphqlUrl = sanitizeUrl(config.graphqlUrl);
  const warnings = mergeWarnings(config);

  return buildSuccess('api_status: enabled project-local API tools configuration is active.', {
    config_exists: config.exists,
    enabled: config.enabled,
    auth_type: config.auth.type,
    timeout_ms: config.timeoutMs,
    limits: {
      max_response_bytes: config.limits.maxResponseBytes,
      max_response_lines: config.limits.maxResponseLines,
    },
    endpoints: {
      rest_configured: Boolean(config.url),
      rest_url: restUrl,
      graphql_configured: Boolean(config.graphqlUrl),
      graphql_url: graphqlUrl,
    },
    warnings,
    git: { state: config.git.state },
  });
}

function formatSecondsRemaining(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
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

async function executeLoginTool(
  signal: AbortSignal | undefined,
  config: ApiToolsConfig,
  client: ApiClient,
): Promise<ApiToolResult> {
  if (config.auth.type !== 'login') {
    return buildFailure('validation_error', 'Login auth is not configured.');
  }

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

type GraphqlTypeRef = { kind?: string; name?: string | null; ofType?: GraphqlTypeRef | null };

type GraphqlField = {
  name?: string;
  description?: string | null;
  args?: Array<{ name?: string; description?: string | null; type?: GraphqlTypeRef | null }>;
  type?: GraphqlTypeRef | null;
};

function unwrapTypeName(type: GraphqlTypeRef | null | undefined): string | undefined {
  if (!type) return undefined;
  if (type.name) return type.name;
  return unwrapTypeName(type.ofType);
}

function formatGraphqlType(type: GraphqlTypeRef | null | undefined): string {
  if (!type) return 'Unknown';
  if (type.kind === 'NON_NULL') return `${formatGraphqlType(type.ofType)}!`;
  if (type.kind === 'LIST') return `[${formatGraphqlType(type.ofType)}]`;
  return type.name ?? 'Unknown';
}

function fieldSummary(field: GraphqlField): Record<string, unknown> {
  return {
    name: field.name,
    description: field.description ?? undefined,
    args: (field.args ?? []).map((arg) => ({ name: arg.name, description: arg.description ?? undefined, type: formatGraphqlType(arg.type) })),
    return_type: formatGraphqlType(field.type),
    return_type_name: unwrapTypeName(field.type),
  };
}

async function graphqlJson(client: ApiClient, query: string, useToken: boolean, signal?: AbortSignal): Promise<any> {
  const response = await client.graphql({ query, useToken }, signal);
  try {
    return JSON.parse(response.bodyText);
  } catch {
    throw new ApiClientError('GraphQL introspection response was not valid JSON.');
  }
}

const QUERY_FIELDS_INTROSPECTION = `query ApiToolsQueryFields {
  __schema {
    queryType {
      name
      fields {
        name
        description
        args { name description type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
      }
    }
  }
}`;

const QUERY_TYPE_INTROSPECTION = `query ApiToolsQueryType {
  __type(name: "Query") {
    fields {
      name
      description
      args { name description type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
      type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
    }
  }
}`;

function typeIntrospectionQuery(typeName: string): string {
  return `query ApiToolsTypeShape {
    __type(name: ${JSON.stringify(typeName)}) {
      name
      description
      fields { name description type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
      inputFields { name description type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
    }
  }`;
}

async function executeGraphqlSchemaQueriesTool(
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  client: ApiClient,
): Promise<ApiToolResult> {
  const useToken = params.use_token === false ? false : true;
  try {
    const json = await graphqlJson(client, QUERY_FIELDS_INTROSPECTION, useToken, signal);
    const fields = (json?.data?.__schema?.queryType?.fields ?? []) as GraphqlField[];
    const queries = fields.filter((field) => field.name).map(fieldSummary);
    const lines = queries.map((query: any) => `${query.name}(${query.args.map((arg: any) => `${arg.name}: ${arg.type}`).join(', ')}): ${query.return_type}`);
    return buildSuccess(`api_graphql_schema_queries: ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}\n${lines.join('\n')}`, { queries, use_token: useToken });
  } catch (error) {
    const safe = classifyError(error);
    return buildFailure(safe.code, safe.message);
  }
}

function renderSchemaTypes(types: Record<string, unknown>): string {
  const blocks: string[] = [];
  for (const [typeName, raw] of Object.entries(types)) {
    const type = raw as { fields?: Record<string, { type?: string; description?: string }> };
    const fields = Object.entries(type.fields ?? {});
    blocks.push([
      `type ${typeName} {`,
      ...fields.map(([fieldName, field]) => `  ${fieldName}: ${field.type ?? 'Unknown'}${field.description ? ` # ${field.description}` : ''}`),
      `}`,
    ].join('\n'));
  }
  return blocks.join('\n\n');
}

async function fetchTypeShape(
  client: ApiClient,
  typeName: string,
  useToken: boolean,
  maxDepth: number,
  signal: AbortSignal | undefined,
  out: Record<string, unknown>,
  seen = new Set<string>(),
  depth = 0,
): Promise<void> {
  if (seen.has(typeName) || depth > maxDepth) return;
  seen.add(typeName);
  const json = await graphqlJson(client, typeIntrospectionQuery(typeName), useToken, signal);
  const type = json?.data?.__type;
  if (!type) return;
  const entries = [...(type.fields ?? []), ...(type.inputFields ?? [])] as GraphqlField[];
  const fields: Record<string, unknown> = {};
  out[typeName] = { description: type.description ?? undefined, fields };
  for (const field of entries) {
    if (!field.name) continue;
    const typeText = formatGraphqlType(field.type);
    const nestedName = unwrapTypeName(field.type);
    fields[field.name] = { description: field.description ?? undefined, type: typeText, type_name: nestedName };
    if (nestedName && !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(nestedName)) {
      await fetchTypeShape(client, nestedName, useToken, maxDepth, signal, out, seen, depth + 1);
    }
  }
}

async function executeGraphqlSchemaQueryTool(
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  client: ApiClient,
): Promise<ApiToolResult> {
  const name = typeof params.name === 'string' ? params.name : '';
  const useToken = params.use_token === false ? false : true;
  const maxDepth = Math.max(0, Math.min(6, Math.floor(typeof params.max_depth === 'number' ? params.max_depth : 3)));
  if (!name) return buildFailure('validation_error', 'A GraphQL query name is required.');

  try {
    const json = await graphqlJson(client, QUERY_TYPE_INTROSPECTION, useToken, signal);
    const fields = (json?.data?.__type?.fields ?? []) as GraphqlField[];
    const field = fields.find((entry) => entry.name === name);
    if (!field) return buildFailure('not_found', `GraphQL query not found: ${name}.`);
    const query = fieldSummary(field);
    const types: Record<string, unknown> = {};
    const returnTypeName = unwrapTypeName(field.type);
    if (returnTypeName && !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(returnTypeName)) {
      await fetchTypeShape(client, returnTypeName, useToken, maxDepth, signal, types);
    }
    const argsText = (query.args as any[]).map((arg) => `${arg.name}: ${arg.type}`).join(', ');
    const schemaText = renderSchemaTypes(types);
    return buildSuccess(`api_graphql_schema_query: ${name}(${argsText}): ${query.return_type}${schemaText ? `\n\n${schemaText}` : ''}`, { query, types, max_depth: maxDepth, use_token: useToken });
  } catch (error) {
    const safe = classifyError(error);
    return buildFailure(safe.code, safe.message);
  }
}

async function executeRestTool(
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  config: ApiToolsConfig,
  client: ApiClient,
): Promise<ApiToolResult> {
  const method = typeof params.method === 'string' ? params.method.toUpperCase() : '';
  const path = typeof params.path === 'string' ? params.path : '';
  const headers = params.headers && typeof params.headers === 'object' ? (params.headers as Record<string, string>) : undefined;
  const body = typeof params.body === 'string' ? params.body : undefined;
  const useToken = params.use_token === false ? false : true;

  try {
    const response = await client.rest({ method: method as never, path, headers, body, useToken }, signal);
    const responseData = buildResponseData(response, config);
    const requestData = {
      method,
      path,
      mutation: isRestMutation(method),
      use_token: useToken,
    };

    if (response.status >= 400) {
      return buildFailure(`http_error`, `REST request failed with ${response.status} ${response.statusText}.`, {
        request: redactDeep(requestData, config.secretValues),
        response: responseData,
      });
    }

    return buildSuccess(buildRequestSuccessText(`api_rest_request ${method} ${path}`, responseData), {
      request: redactDeep(requestData, config.secretValues),
      response: responseData,
    });
  } catch (error) {
    const safe = classifyError(error);
    return buildFailure(safe.code, safe.message, {
      request: redactDeep({ method, path, mutation: isRestMutation(method), use_token: useToken }, config.secretValues),
    });
  }
}

async function executeGraphqlTool(
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  config: ApiToolsConfig,
  client: ApiClient,
): Promise<ApiToolResult> {
  const query = typeof params.query === 'string' ? params.query : '';
  const operationName = typeof params.operationName === 'string' ? params.operationName : undefined;
  const variables = typeof params.variables === 'undefined' ? undefined : params.variables;
  const headers = params.headers && typeof params.headers === 'object' ? (params.headers as Record<string, string>) : undefined;
  const useToken = params.use_token === false ? false : true;

  try {
    const response = await client.graphql({ query, variables, operationName, headers, useToken }, signal);
    const responseData = buildResponseData(response, config);
    const requestData = {
      operation_name: operationName,
      mutation: isGraphqlMutation(query),
      query,
      variables,
      use_token: useToken,
    };

    if (response.status >= 400) {
      return buildFailure('http_error', `GraphQL request failed with ${response.status} ${response.statusText}.`, {
        request: redactDeep(requestData, config.secretValues),
        response: responseData,
      });
    }

    return buildSuccess(buildRequestSuccessText(`api_graphql_query${operationName ? ` ${operationName}` : ''}`, responseData), {
      request: redactDeep(requestData, config.secretValues),
      response: responseData,
    });
  } catch (error) {
    const safe = classifyError(error);
    return buildFailure(safe.code, safe.message, {
      request: redactDeep({ operation_name: operationName, mutation: isGraphqlMutation(query), query, variables, use_token: useToken }, config.secretValues),
    });
  }
}

export async function registerApiTools(pi: any, options: RegisterApiToolsOptions = {}): Promise<void> {
  if (!pi || typeof pi.registerTool !== 'function') return;

  const config = await (options.loadConfig ?? loadApiConfig)({ cwd: options.cwd ?? process.cwd() });
  if (!config.exists || !config.enabled) return;

  const client = options.client ?? options.createClient?.({ config, fetch: options.fetch }) ?? createApiClient({ config, fetch: options.fetch });

  pi.registerTool({
    name: 'api_status',
    description: 'Show safe project-local API tools configuration status without exposing secrets.',
    parameters: EMPTY_PARAMETERS,
    execute: async () => redactToolResult(buildStatusResult(config), config.secretValues),
  });

  pi.registerTool({
    name: 'api_auth_status',
    description: 'Inspect local API auth metadata without contacting the backend.',
    parameters: EMPTY_PARAMETERS,
    execute: async () => redactToolResult(buildAuthStatusResult(config, options.now), config.secretValues),
  });

  pi.registerTool({
    name: 'api_login',
    description: 'Login with configured project credentials and persist access_token into .pi/api.json.',
    parameters: EMPTY_PARAMETERS,
    execute: async (_id: string, _params: Record<string, unknown>, signal?: AbortSignal) => redactToolResult(await executeLoginTool(signal, config, client), config.secretValues),
  });

  pi.registerTool({
    name: 'api_rest_request',
    description: 'Execute a REST request against the configured project API with safe bounded outputs.',
    parameters: REST_PARAMETERS,
    execute: async (_id: string, params: Record<string, unknown>, signal?: AbortSignal) => redactToolResult(await executeRestTool(params, signal, config, client), config.secretValues),
  });

  pi.registerTool({
    name: 'api_graphql_query',
    description: 'Execute a GraphQL query or mutation against the configured project API with safe bounded outputs.',
    parameters: GRAPHQL_PARAMETERS,
    execute: async (_id: string, params: Record<string, unknown>, signal?: AbortSignal) => redactToolResult(await executeGraphqlTool(params, signal, config, client), config.secretValues),
  });

  pi.registerTool({
    name: 'api_graphql_schema_queries',
    description: 'List GraphQL Query methods with argument and return type summaries using bounded introspection.',
    parameters: GRAPHQL_SCHEMA_QUERIES_PARAMETERS,
    execute: async (_id: string, params: Record<string, unknown>, signal?: AbortSignal) => executeGraphqlSchemaQueriesTool(params, signal, client),
  });

  pi.registerTool({
    name: 'api_graphql_schema_query',
    description: 'Inspect one GraphQL Query method with arguments and nested return schema using bounded introspection.',
    parameters: GRAPHQL_SCHEMA_QUERY_PARAMETERS,
    execute: async (_id: string, params: Record<string, unknown>, signal?: AbortSignal) => executeGraphqlSchemaQueryTool(params, signal, client),
  });
}
