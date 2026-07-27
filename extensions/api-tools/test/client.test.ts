import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient, type FetchLike, type FetchResponseLike } from '../src/client.js';
import type { ApiAuthConfig, ApiToolsConfig } from '../src/types.js';

function createConfig(overrides: Partial<ApiToolsConfig> = {}): ApiToolsConfig {
  return {
    configPath: '/tmp/project/.pi/api.json',
    exists: true,
    enabled: true,
    url: 'https://api.example.test/base/',
    graphqlUrl: 'https://api.example.test/base/legacy-graphql',
    swagger: { configured: true, enabled: true, framework: 'spring', valid: true },
    graphql: { configured: true, enabled: true, framework: 'spring', valid: true },
    headers: { 'x-project-client': 'pi' },
    auth: { type: 'none' },
    timeoutMs: 100,
    limits: { maxResponseBytes: 50000, maxResponseLines: 2000, cursorTtlSeconds: 3600 },
    warnings: [],
    secretValues: [],
    git: { state: 'ignored' },
    ...overrides,
  };
}

function createResponse(bodyText: string, init: Partial<FetchResponseLike> = {}): FetchResponseLike {
  return {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: init.headers ?? { 'content-type': 'application/json' },
    text: init.text ?? (async () => bodyText),
  };
}

function createFetchMock(handler?: (input: { url: string; init: RequestInit | undefined }) => Promise<FetchResponseLike>): FetchLike {
  return vi.fn(async (url: string | URL, init?: RequestInit) => handler ? handler({ url: String(url), init }) : createResponse('{"ok":true}'));
}

describe('api-tools client runtime', () => {
  it('executes supported REST methods against safe same-origin relative paths', async () => {
    const fetch = createFetchMock();
    const client = createApiClient({ config: createConfig(), fetch });
    await client.rest({ method: 'GET', path: 'users?id=1' });
    await client.rest({ method: 'POST', path: 'users', body: '{"name":"Ada"}' });
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://api.example.test/base/users?id=1', expect.objectContaining({ method: 'GET' }));
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://api.example.test/base/users', expect.objectContaining({ method: 'POST', body: '{"name":"Ada"}' }));
  });

  it('resolves GraphQL URL precedence from explicit block url to legacy fallback to default path', async () => {
    const fetch = createFetchMock();
    const explicit = createApiClient({ config: createConfig({ graphql: { configured: true, enabled: true, framework: 'node', url: 'https://api.example.test/base/gql', valid: true } as any }), fetch });
    await explicit.graphql({ query: '{ viewer { id } }' });
    expect(fetch).toHaveBeenLastCalledWith('https://api.example.test/base/gql', expect.any(Object));

    const legacy = createApiClient({ config: createConfig({ graphql: { configured: true, enabled: true, framework: 'spring', valid: true }, graphqlUrl: 'https://api.example.test/base/from-legacy' }), fetch });
    await legacy.graphql({ query: '{ viewer { id } }' });
    expect(fetch).toHaveBeenLastCalledWith('https://api.example.test/base/from-legacy', expect.any(Object));

    const derived = createApiClient({ config: createConfig({ graphql: { configured: true, enabled: true, framework: 'spring', valid: true }, graphqlUrl: undefined }), fetch });
    await derived.graphql({ query: '{ viewer { id } }' });
    expect(fetch).toHaveBeenLastCalledWith('https://api.example.test/base/graphql', expect.any(Object));
  });

  it('fetches swagger documents with spring fallback and no node scan without explicit url', async () => {
    const fetch = createFetchMock(async ({ url }) => {
      if (url.endsWith('/v3/api-docs')) return createResponse('{"foo":"bar"}');
      if (url.endsWith('/v2/api-docs')) return createResponse('{"swagger":"2.0","paths":{}}');
      return createResponse('{"ok":true}');
    });
    const springClient = createApiClient({ config: createConfig(), fetch });
    const doc = await springClient.fetchSwaggerDocument();
    expect(doc.document.swagger).toBe('2.0');

    const nodeClient = createApiClient({ config: createConfig({ swagger: { configured: true, enabled: true, framework: 'node', valid: true } as any }), fetch });
    await expect(nodeClient.fetchSwaggerDocument()).rejects.toThrow(/swagger.url is required/i);
  });

  it('applies configured headers and typed auth to outgoing requests', async () => {
    const authCases: Array<{ auth: ApiAuthConfig; expected: Record<string, string> }> = [
      { auth: { type: 'none' }, expected: { 'x-project-client': 'pi' } },
      { auth: { type: 'bearer', token: 'secret-token' }, expected: { authorization: 'Bearer secret-token' } },
      { auth: { type: 'basic', username: 'demo', password: 'p@ss' }, expected: { authorization: `Basic ${Buffer.from('demo:p@ss').toString('base64')}` } },
    ];
    for (const { auth, expected } of authCases) {
      const fetch = createFetchMock();
      const client = createApiClient({ config: createConfig({ auth }), fetch });
      await client.rest({ method: 'GET', path: 'auth-check', headers: { 'x-request-id': '123' } });
      const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
      expect(init.headers).toMatchObject({ 'x-project-client': 'pi', 'x-request-id': '123', ...expected });
    }
  });

  it('rejects invalid methods, cross-origin urls, traversal, userinfo, control characters, and unsafe redirects with typed client errors', async () => {
    const fetch = createFetchMock(async ({ url }) => {
      if (url.endsWith('/redirect-me')) return createResponse('', { status: 302, statusText: 'Found', headers: { location: 'https://evil.example.test/x' } });
      return createResponse('{"ok":true}');
    });
    const client = createApiClient({ config: createConfig(), fetch });
    await expect(client.rest({ method: 'TRACE' as never, path: '/users' })).rejects.toMatchObject({ kind: 'validation' satisfies ApiClientError['kind'] });
    await expect(client.rest({ method: 'GET', path: '../escape' })).rejects.toMatchObject({ kind: 'validation' satisfies ApiClientError['kind'] });
    await expect(client.rest({ method: 'GET', path: '/users\nsecret' })).rejects.toMatchObject({ kind: 'validation' satisfies ApiClientError['kind'] });
    await expect(createApiClient({ config: createConfig({ graphql: { configured: true, enabled: true, framework: 'spring', url: 'https://user:pass@api.example.test/base/gql', valid: true } as any }), fetch }).graphql({ query: '{ viewer }' })).rejects.toMatchObject({ kind: 'validation' satisfies ApiClientError['kind'] });
    await expect(client.rest({ method: 'GET', path: 'redirect-me' })).rejects.toMatchObject({ kind: 'validation' satisfies ApiClientError['kind'] });
  });

  it('propagates AbortSignal cancellation and timeout through injected fetch behavior', async () => {
    const abortingFetch = createFetchMock(async ({ init }) => new Promise<FetchResponseLike>((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
      signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
      setTimeout(() => resolve(createResponse('{"late":true}')), 50);
    }));
    const client = createApiClient({ config: createConfig({ timeoutMs: 10 }), fetch: abortingFetch });
    const externalController = new AbortController();
    externalController.abort(new Error('manual abort'));
    await expect(client.graphql({ query: '{ viewer { id } }' }, externalController.signal)).rejects.toMatchObject({ kind: 'cancellation' satisfies ApiClientError['kind'] });
    await expect(client.rest({ method: 'GET', path: 'slow' })).rejects.toMatchObject({ kind: 'timeout' satisfies ApiClientError['kind'] });
  });
});
