import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike, type FetchResponseLike } from '../src/client.js';
import type { ApiAuthConfig, ApiToolsConfig } from '../src/types.js';

function createConfig(overrides: Partial<ApiToolsConfig> = {}): ApiToolsConfig {
  return {
    configPath: '/tmp/project/.pi/api.json',
    exists: true,
    enabled: true,
    url: 'https://api.example.test/base/',
    graphqlUrl: 'https://api.example.test/graphql',
    headers: { 'x-project-client': 'pi' },
    auth: { type: 'none' },
    timeoutMs: 100,
    limits: { maxResponseBytes: 50000, maxResponseLines: 2000 },
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
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (handler) return handler({ url: String(url), init });
    return createResponse('{"ok":true}');
  });
}

describe('api-tools client runtime', () => {
  it('executes supported REST methods against safe same-origin relative paths', async () => {
    const fetch = createFetchMock();
    const client = createApiClient({ config: createConfig(), fetch });

    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const) {
      await expect(
        client.rest({ method, path: method === 'GET' ? 'users?id=1' : 'users', body: method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : '{"name":"Ada"}' }),
      ).resolves.toMatchObject({ status: 200 });
    }

    expect(fetch).toHaveBeenCalledTimes(7);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/base/users?id=1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/base/users',
      expect.objectContaining({ method: 'POST', body: '{"name":"Ada"}' }),
    );
  });

  it('executes GraphQL queries and mutations with variables and operationName', async () => {
    const fetch = createFetchMock();
    const client = createApiClient({ config: createConfig(), fetch });

    await client.graphql({
      query: 'query Viewer($id: ID!) { viewer(id: $id) { id } }',
      variables: { id: '123' },
      operationName: 'Viewer',
    });
    await client.graphql({
      query: 'mutation UpdateName($id: ID!) { updateName(id: $id) { id } }',
      variables: { id: '123' },
      operationName: 'UpdateName',
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/graphql',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: 'query Viewer($id: ID!) { viewer(id: $id) { id } }',
          variables: { id: '123' },
          operationName: 'Viewer',
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/graphql',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: 'mutation UpdateName($id: ID!) { updateName(id: $id) { id } }',
          variables: { id: '123' },
          operationName: 'UpdateName',
        }),
      }),
    );
  });

  it('applies configured headers and typed auth to outgoing requests', async () => {
    const authCases: Array<{ auth: ApiAuthConfig; expected: Record<string, string> }> = [
      { auth: { type: 'none' }, expected: { 'x-project-client': 'pi' } },
      { auth: { type: 'bearer', token: 'secret-token' }, expected: { authorization: 'Bearer secret-token' } },
      {
        auth: { type: 'basic', username: 'demo', password: 'p@ss' },
        expected: { authorization: `Basic ${Buffer.from('demo:p@ss').toString('base64')}` },
      },
      { auth: { type: 'api_key', header: 'x-api-key', value: 'secret-key' }, expected: { 'x-api-key': 'secret-key' } },
      { auth: { type: 'headers', headers: { authorization: 'Bearer from-headers', 'x-extra-auth': 'present' } }, expected: { authorization: 'Bearer from-headers', 'x-extra-auth': 'present' } },
    ];

    for (const { auth, expected } of authCases) {
      const fetch = createFetchMock();
      const client = createApiClient({ config: createConfig({ auth }), fetch });

      await client.rest({ method: 'GET', path: 'auth-check', headers: { 'x-request-id': '123' } });

      const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
      expect(init.headers).toMatchObject({ 'x-project-client': 'pi', 'x-request-id': '123', ...expected });
    }
  });

  it('uses login access_token only when use_token is true and posts login credentials', async () => {
    const fetch = createFetchMock(async ({ url }) => url.endsWith('/login') ? createResponse('{"access_token":"fresh-token"}') : createResponse('{"ok":true}'));
    const client = createApiClient({
      config: createConfig({ auth: { type: 'login', login_path: '/login', username: 'test', password: 'test', access_token: 'persisted-token' } }),
      fetch,
    });

    await client.rest({ method: 'GET', path: 'public', useToken: false });
    await client.rest({ method: 'GET', path: 'private', useToken: true });
    await client.graphql({ query: '{ public }', useToken: false });
    await client.graphql({ query: '{ me { id } }', useToken: true });
    const login = await client.login();

    expect(login.bodyText).toBe('{"access_token":"fresh-token"}');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: 'Bearer persisted-token' });
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[2]?.[1]?.headers).not.toHaveProperty('authorization');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[3]?.[1]?.headers).toMatchObject({ authorization: 'Bearer persisted-token' });
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[4]?.[0]).toBe('https://api.example.test/login');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[4]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ username: 'test', password: 'test' }) });
  });

  it('rejects invalid methods, absolute URLs, traversal, encoded traversal, and control characters before network execution', async () => {
    const fetch = createFetchMock();
    const client = createApiClient({ config: createConfig(), fetch });

    await expect(client.rest({ method: 'TRACE' as never, path: '/users' })).rejects.toThrow(/unsupported rest method/i);
    await expect(client.rest({ method: 'GET', path: 'https://evil.example.test/pwn' })).rejects.toThrow(/absolute urls are not allowed/i);
    await expect(client.rest({ method: 'GET', path: '../escape' })).rejects.toThrow(/path traversal/i);
    await expect(client.rest({ method: 'GET', path: '/base/%2e%2e/escape' })).rejects.toThrow(/path traversal/i);
    await expect(client.rest({ method: 'GET', path: '/users\nsecret' })).rejects.toThrow(/control characters/i);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates AbortSignal cancellation and timeout through injected fetch behavior', async () => {
    const abortingFetch = createFetchMock(async ({ init }) => {
      const signal = init?.signal;
      return await new Promise<FetchResponseLike>((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason ?? new Error('aborted'));
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
        setTimeout(() => resolve(createResponse('{"late":true}')), 50);
      });
    });

    const client = createApiClient({
      config: createConfig({ timeoutMs: 10 }),
      fetch: abortingFetch,
    });

    const externalController = new AbortController();
    externalController.abort(new Error('manual abort'));

    await expect(client.graphql({ query: '{ viewer { id } }' }, externalController.signal)).rejects.toThrow(/request cancelled/i);
    await expect(client.rest({ method: 'GET', path: 'slow' })).rejects.toThrow(/request timed out/i);
    expect(abortingFetch).toHaveBeenCalledTimes(2);
  });
});
