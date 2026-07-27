import { Buffer } from 'node:buffer';
import type {
  ApiAuthConfig,
  ApiClient,
  ApiGraphqlRequest,
  ApiHttpResponse,
  ApiRestRequest,
  ApiToolsConfig,
  SwaggerDocumentResponse,
} from './types.js';

const ALLOWED_REST_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const ENCODED_TRAVERSAL_PATTERN = /%2e/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export interface FetchResponseLike {
  status: number;
  statusText: string;
  headers?: Headers | Record<string, string>;
  text(): Promise<string>;
}

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<FetchResponseLike>;

export interface CreateApiClientOptions {
  config: ApiToolsConfig;
  fetch?: FetchLike;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export class ApiClientError extends Error {
  constructor(
    public readonly kind: 'validation' | 'configuration' | 'timeout' | 'cancellation' | 'provider' | 'reference' = 'provider',
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function err(kind: ApiClientError['kind'], message: string): ApiClientError {
  return new ApiClientError(kind, message);
}

function applyConfiguredPort(url: URL, port?: number): URL {
  const next = new URL(url.toString());
  if (typeof port === 'number' && Number.isFinite(port)) next.port = String(Math.floor(port));
  return next;
}

function headersToRecord(headers?: Headers | Record<string, string>): Record<string, string> {
  if (!headers) return {};
  if (typeof (headers as Headers).entries === 'function') return Object.fromEntries((headers as Headers).entries());
  return { ...(headers as Record<string, string>) };
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|abort|cancelled|canceled/i.test(error.message));
}

function makeBaseUrl(config: ApiToolsConfig): URL {
  if (!config.url) throw err('configuration', 'REST base URL is not configured.');
  const url = applyConfiguredPort(new URL(config.url), config.port);
  if (!/^https?:$/i.test(url.protocol)) throw err('configuration', 'Only HTTP(S) API base URLs are allowed.');
  if (url.username || url.password) throw err('configuration', 'API base URL may not include URL credentials.');
  return url;
}

function buildAuthHeaders(auth: ApiAuthConfig, useToken = true): Record<string, string> {
  if (!useToken) return {};
  switch (auth.type) {
    case 'none':
      return {};
    case 'bearer':
      return { authorization: `Bearer ${auth.token}` };
    case 'basic':
      return { authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}` };
    case 'api_key':
      return { [auth.header]: auth.value };
    case 'headers':
      return { ...auth.headers };
    case 'login':
      return auth.access_token ? { authorization: `Bearer ${auth.access_token}` } : {};
  }
}

function normalizeRequestHeaders(
  config: ApiToolsConfig,
  requestHeaders?: Record<string, string>,
  defaults?: Record<string, string>,
  useToken = true,
): Record<string, string> {
  return {
    ...(defaults ?? {}),
    ...config.headers,
    ...(requestHeaders ?? {}),
    ...buildAuthHeaders(config.auth, useToken),
  };
}

function hasTraversalSegment(path: string): boolean {
  return path.split(/[/?#]/).some((segment) => segment === '.' || segment === '..');
}

function validateUnsafeText(value: string, label: string): void {
  if (CONTROL_CHARACTER_PATTERN.test(value)) throw err('validation', `Control characters are not allowed in ${label}.`);
  if (value.includes('\\')) throw err('validation', `Backslashes are not allowed in ${label}.`);
  if (ENCODED_TRAVERSAL_PATTERN.test(value) || hasTraversalSegment(value)) throw err('validation', 'Path traversal is not allowed.');
}

function ensureWithinBasePath(baseUrl: URL, resolvedUrl: URL): void {
  if (resolvedUrl.origin !== baseUrl.origin) throw err('validation', 'Request escaped the configured origin.');
  const basePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`;
  const resolvedPath = resolvedUrl.pathname.endsWith('/') ? resolvedUrl.pathname : `${resolvedUrl.pathname}/`;
  if (!resolvedPath.startsWith(basePath)) throw err('validation', 'Request escaped the configured base path.');
}

function resolveConfiguredUrl(config: ApiToolsConfig, input: string, label: string): string {
  validateUnsafeText(input, label);
  const baseUrl = makeBaseUrl(config);
  let resolved: URL;
  if (ABSOLUTE_URL_PATTERN.test(input)) {
    resolved = new URL(input);
  } else if (input.startsWith('/')) {
    const trimmedBasePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname.slice(0, -1) : baseUrl.pathname;
    resolved = new URL(`${trimmedBasePath}${input}`, baseUrl.origin);
  } else {
    resolved = new URL(input, baseUrl);
  }
  if (!/^https?:$/i.test(resolved.protocol)) throw err('validation', 'Only HTTP(S) URLs are allowed.');
  if (resolved.username || resolved.password) throw err('validation', 'URL credentials are not allowed.');
  ensureWithinBasePath(baseUrl, resolved);
  return resolved.toString();
}

function buildRestUrl(config: ApiToolsConfig, path: string): string {
  if (!path || typeof path !== 'string') throw err('validation', 'A request path is required.');
  if (ABSOLUTE_URL_PATTERN.test(path)) throw err('validation', 'Absolute URLs are not allowed for REST requests.');
  return resolveConfiguredUrl(config, path, 'request paths');
}

function buildLoginUrl(config: ApiToolsConfig): string {
  if (config.auth.type !== 'login') throw err('configuration', 'Login auth is not configured.');
  if (ABSOLUTE_URL_PATTERN.test(config.auth.login_path)) throw err('validation', 'Absolute URLs are not allowed for login requests.');
  return resolveConfiguredUrl(config, config.auth.login_path, 'login paths');
}

function resolveGraphqlUrl(config: ApiToolsConfig): string {
  if (!config.graphql.enabled) throw err('configuration', 'GraphQL is not enabled.');
  if (!config.graphql.valid) throw err('configuration', 'GraphQL configuration is invalid.');
  if (config.graphql.url) return resolveConfiguredUrl(config, config.graphql.url, 'GraphQL URLs');
  if (config.graphqlUrl) return resolveConfiguredUrl(config, config.graphqlUrl, 'GraphQL URLs');
  return resolveConfiguredUrl(config, '/graphql', 'GraphQL URLs');
}

function swaggerCandidateUrls(config: ApiToolsConfig): string[] {
  if (!config.swagger.enabled) throw err('configuration', 'Swagger is not enabled.');
  if (!config.swagger.valid) throw err('configuration', 'Swagger configuration is invalid.');
  if (config.swagger.url) return [resolveConfiguredUrl(config, config.swagger.url, 'Swagger URLs')];
  if (config.swagger.framework === 'node') throw err('configuration', 'swagger.url is required when swagger.framework is node.');
  return [
    resolveConfiguredUrl(config, '/v3/api-docs', 'Swagger URLs'),
    resolveConfiguredUrl(config, '/v2/api-docs', 'Swagger URLs'),
  ];
}

function createRequestSignal(
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  setTimeoutFn: typeof setTimeout,
  clearTimeoutFn: typeof clearTimeout,
): { signal: AbortSignal; cleanup: () => void; getTimedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;

  const onAbort = () => {
    if (!controller.signal.aborted) controller.abort(externalSignal?.reason ?? new Error('request cancelled'));
  };

  if (externalSignal) {
    if (externalSignal.aborted) onAbort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }

  const timer = setTimeoutFn(() => {
    timedOut = true;
    if (!controller.signal.aborted) controller.abort(new Error('request timed out'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeoutFn(timer);
      if (externalSignal && !externalSignal.aborted) externalSignal.removeEventListener('abort', onAbort);
    },
    getTimedOut: () => timedOut,
  };
}

async function executeRequest(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  runtime: { timeoutMs: number; externalSignal?: AbortSignal; setTimeoutFn: typeof setTimeout; clearTimeoutFn: typeof clearTimeout },
  config: ApiToolsConfig,
): Promise<ApiHttpResponse> {
  const requestSignal = createRequestSignal(runtime.timeoutMs, runtime.externalSignal, runtime.setTimeoutFn, runtime.clearTimeoutFn);
  let currentUrl = url;
  let currentInit: RequestInit = { ...init, signal: requestSignal.signal, redirect: 'manual' };

  try {
    for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
      const response = await fetchImpl(currentUrl, currentInit);
      const headers = headersToRecord(response.headers);
      if (REDIRECT_STATUS.has(response.status)) {
        const location = headers.location;
        if (!location) throw err('provider', 'Redirect response did not include a location.');
        currentUrl = resolveConfiguredUrl(config, location, 'redirect URLs');
        if (response.status === 303) {
          currentInit = { ...currentInit, method: 'GET', body: undefined, signal: requestSignal.signal, redirect: 'manual' };
        }
        continue;
      }
      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        bodyText: await response.text(),
        url: currentUrl,
      };
    }
    throw err('provider', 'Too many redirects.');
  } catch (error) {
    if (requestSignal.getTimedOut()) throw err('timeout', 'Request timed out.');
    if (requestSignal.signal.aborted || isAbortLike(error)) throw err('cancellation', 'Request cancelled.');
    if (error instanceof ApiClientError) throw error;
    throw err('provider', error instanceof Error ? error.message : 'Unexpected request failure.');
  } finally {
    requestSignal.cleanup();
  }
}

function isSwaggerDocument(document: unknown): document is Record<string, any> {
  return !!document && typeof document === 'object' && !Array.isArray(document)
    && (typeof (document as any).openapi === 'string' || typeof (document as any).swagger === 'string');
}

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

  if (!fetchImpl) throw err('configuration', 'API client requires an injected fetch implementation.');

  return {
    async login(signal?: AbortSignal): Promise<ApiHttpResponse> {
      if (options.config.auth.type !== 'login') throw err('configuration', 'Login auth is not configured.');
      const url = buildLoginUrl(options.config);
      return executeRequest(fetchImpl, url, {
        method: 'POST',
        headers: normalizeRequestHeaders(options.config, undefined, {
          accept: 'application/json',
          'content-type': 'application/json',
        }, false),
        body: JSON.stringify({ username: options.config.auth.username, password: options.config.auth.password }),
      }, {
        timeoutMs: options.config.timeoutMs,
        externalSignal: signal,
        setTimeoutFn,
        clearTimeoutFn,
      }, options.config);
    },

    async rest(request: ApiRestRequest, signal?: AbortSignal): Promise<ApiHttpResponse> {
      if (!ALLOWED_REST_METHODS.has(request.method)) throw err('validation', `Unsupported REST method: ${request.method}`);
      const url = buildRestUrl(options.config, request.path);
      return executeRequest(fetchImpl, url, {
        method: request.method,
        headers: normalizeRequestHeaders(options.config, request.headers, undefined, request.useToken ?? true),
        body: request.body,
      }, {
        timeoutMs: options.config.timeoutMs,
        externalSignal: signal,
        setTimeoutFn,
        clearTimeoutFn,
      }, options.config);
    },

    resolveGraphqlUrl(): string {
      return resolveGraphqlUrl(options.config);
    },

    async graphql(request: ApiGraphqlRequest, signal?: AbortSignal): Promise<ApiHttpResponse> {
      if (!request.query || typeof request.query !== 'string') throw err('validation', 'A GraphQL query is required.');
      const url = resolveGraphqlUrl(options.config);
      return executeRequest(fetchImpl, url, {
        method: 'POST',
        headers: normalizeRequestHeaders(options.config, request.headers, {
          accept: 'application/json',
          'content-type': 'application/json',
        }, request.useToken ?? true),
        body: JSON.stringify({ query: request.query, variables: request.variables, operationName: request.operationName }),
      }, {
        timeoutMs: options.config.timeoutMs,
        externalSignal: signal,
        setTimeoutFn,
        clearTimeoutFn,
      }, options.config);
    },

    async fetchSwaggerDocument(signal?: AbortSignal): Promise<SwaggerDocumentResponse> {
      const candidates = swaggerCandidateUrls(options.config);
      let lastError: Error | undefined;
      for (const candidate of candidates) {
        try {
          const response = await executeRequest(fetchImpl, candidate, {
            method: 'GET',
            headers: normalizeRequestHeaders(options.config, undefined, { accept: 'application/json' }, true),
          }, {
            timeoutMs: options.config.timeoutMs,
            externalSignal: signal,
            setTimeoutFn,
            clearTimeoutFn,
          }, options.config);
          if (response.status < 200 || response.status >= 300) throw err('provider', `Swagger document request failed with ${response.status}.`);
          const document = JSON.parse(response.bodyText);
          if (!isSwaggerDocument(document)) throw err('provider', 'Swagger document was not a valid OpenAPI/Swagger JSON document.');
          return { url: candidate, document };
        } catch (error) {
          lastError = error as Error;
        }
      }
      throw lastError ?? err('provider', 'Swagger document is unavailable.');
    },
  };
}

export { buildRestUrl, resolveConfiguredUrl, resolveGraphqlUrl };
