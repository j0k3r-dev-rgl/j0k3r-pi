import { Buffer } from 'node:buffer';
import type { ApiAuthConfig, ApiClient, ApiGraphqlRequest, ApiHttpResponse, ApiRestRequest, ApiToolsConfig } from './types.js';

const ALLOWED_REST_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const ENCODED_TRAVERSAL_PATTERN = /%2e/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

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

class ApiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function applyConfiguredPort(url: URL, port?: number): URL {
  const next = new URL(url.toString());
  if (typeof port === 'number' && Number.isFinite(port)) next.port = String(Math.floor(port));
  return next;
}

function headersToRecord(headers?: Headers | Record<string, string>): Record<string, string> {
  if (!headers) return {};
  if (typeof (headers as Headers).entries === 'function') {
    return Object.fromEntries((headers as Headers).entries());
  }
  return { ...(headers as Record<string, string>) };
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|abort|cancelled|canceled/i.test(error.message));
}

function makeBaseUrl(config: ApiToolsConfig): URL {
  if (!config.url) throw new ApiClientError('REST base URL is not configured.');
  return applyConfiguredPort(new URL(config.url), config.port);
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
  return path
    .split(/[/?#]/)
    .some((segment) => segment === '.' || segment === '..');
}

function validateRelativePath(path: string): void {
  if (!path || typeof path !== 'string') throw new ApiClientError('A request path is required.');
  if (CONTROL_CHARACTER_PATTERN.test(path)) throw new ApiClientError('Control characters are not allowed in request paths.');
  if (ABSOLUTE_URL_PATTERN.test(path)) throw new ApiClientError('Absolute URLs are not allowed for REST requests.');
  if (path.includes('\\')) throw new ApiClientError('Backslashes are not allowed in request paths.');
  if (hasTraversalSegment(path) || ENCODED_TRAVERSAL_PATTERN.test(path)) {
    throw new ApiClientError('Path traversal is not allowed.');
  }
}

function ensureWithinBasePath(baseUrl: URL, resolvedUrl: URL): void {
  if (resolvedUrl.origin !== baseUrl.origin) throw new ApiClientError('REST request escaped the configured origin.');

  const normalizedBasePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`;
  const normalizedResolvedPath = resolvedUrl.pathname.endsWith('/') ? resolvedUrl.pathname : `${resolvedUrl.pathname}/`;

  if (!normalizedResolvedPath.startsWith(normalizedBasePath)) {
    throw new ApiClientError('REST request escaped the configured base path.');
  }
}

function buildRestUrl(config: ApiToolsConfig, path: string): string {
  validateRelativePath(path);
  const baseUrl = makeBaseUrl(config);
  const resolvedUrl = new URL(path, baseUrl);
  ensureWithinBasePath(baseUrl, resolvedUrl);
  if (resolvedUrl.username || resolvedUrl.password) throw new ApiClientError('REST requests may not include URL credentials.');
  return resolvedUrl.toString();
}

function buildLoginUrl(config: ApiToolsConfig): string {
  if (config.auth.type !== 'login') throw new ApiClientError('Login auth is not configured.');
  validateRelativePath(config.auth.login_path);
  const baseUrl = makeBaseUrl(config);
  const originBase = new URL('/', baseUrl.origin);
  const resolvedUrl = new URL(config.auth.login_path, originBase);
  if (resolvedUrl.origin !== baseUrl.origin) throw new ApiClientError('Login request escaped the configured origin.');
  if (resolvedUrl.username || resolvedUrl.password) throw new ApiClientError('Login requests may not include URL credentials.');
  return resolvedUrl.toString();
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
    if (!controller.signal.aborted) {
      controller.abort(externalSignal?.reason ?? new Error('request cancelled'));
    }
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
): Promise<ApiHttpResponse> {
  const requestSignal = createRequestSignal(runtime.timeoutMs, runtime.externalSignal, runtime.setTimeoutFn, runtime.clearTimeoutFn);

  try {
    const response = await fetchImpl(url, { ...init, signal: requestSignal.signal });
    return {
      status: response.status,
      statusText: response.statusText,
      headers: headersToRecord(response.headers),
      bodyText: await response.text(),
    };
  } catch (error) {
    if (requestSignal.getTimedOut()) throw new ApiClientError('Request timed out.');
    if (requestSignal.signal.aborted || isAbortLike(error)) throw new ApiClientError('Request cancelled.');
    throw error;
  } finally {
    requestSignal.cleanup();
  }
}

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

  if (!fetchImpl) throw new ApiClientError('API client requires an injected fetch implementation.');

  return {
    async login(signal?: AbortSignal): Promise<ApiHttpResponse> {
      if (options.config.auth.type !== 'login') throw new ApiClientError('Login auth is not configured.');
      const url = buildLoginUrl(options.config);
      const headers = normalizeRequestHeaders(options.config, undefined, {
        accept: 'application/json',
        'content-type': 'application/json',
      }, false);

      return executeRequest(
        fetchImpl,
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ username: options.config.auth.username, password: options.config.auth.password }),
        },
        {
          timeoutMs: options.config.timeoutMs,
          externalSignal: signal,
          setTimeoutFn,
          clearTimeoutFn,
        },
      );
    },

    async rest(request: ApiRestRequest, signal?: AbortSignal): Promise<ApiHttpResponse> {
      if (!ALLOWED_REST_METHODS.has(request.method)) throw new ApiClientError(`Unsupported REST method: ${request.method}`);

      const url = buildRestUrl(options.config, request.path);
      const headers = normalizeRequestHeaders(options.config, request.headers, undefined, request.useToken ?? true);

      return executeRequest(
        fetchImpl,
        url,
        {
          method: request.method,
          headers,
          body: request.body,
        },
        {
          timeoutMs: options.config.timeoutMs,
          externalSignal: signal,
          setTimeoutFn,
          clearTimeoutFn,
        },
      );
    },

    async graphql(request: ApiGraphqlRequest, signal?: AbortSignal): Promise<ApiHttpResponse> {
      if (!options.config.graphqlUrl) throw new ApiClientError('GraphQL URL is not configured.');
      if (!request.query || typeof request.query !== 'string') throw new ApiClientError('A GraphQL query is required.');

      const headers = normalizeRequestHeaders(options.config, request.headers, {
        accept: 'application/json',
        'content-type': 'application/json',
      }, request.useToken ?? true);

      return executeRequest(
        fetchImpl,
        options.config.graphqlUrl,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: request.query,
            variables: request.variables,
            operationName: request.operationName,
          }),
        },
        {
          timeoutMs: options.config.timeoutMs,
          externalSignal: signal,
          setTimeoutFn,
          clearTimeoutFn,
        },
      );
    },
  };
}

export { ApiClientError };
