import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import apiToolsExtension from '../index.js';
import { API_TOOL_NAMES, registerApiTools, type RegisterApiToolsOptions } from '../src/tools.js';
import type { ApiClient, ApiToolsConfig } from '../src/types.js';

function createMockPi() {
  const tools: any[] = [];
  return {
    tools,
    registerTool(tool: any) {
      tools.push(tool);
    },
  };
}

function createConfig(overrides: Partial<ApiToolsConfig> = {}): ApiToolsConfig {
  return {
    configPath: '/tmp/project/.pi/api.json',
    exists: true,
    enabled: true,
    url: 'https://api.example.test/base/',
    graphqlUrl: 'https://api.example.test/graphql',
    headers: { 'x-project-client': 'pi', authorization: 'Bearer top-secret' },
    auth: { type: 'bearer', token: 'top-secret' },
    timeoutMs: 30000,
    limits: { maxResponseBytes: 80, maxResponseLines: 3 },
    warnings: [{ code: 'limit_default_applied', message: 'Default response limits were applied.' }],
    secretValues: ['top-secret', 'Bearer top-secret'],
    git: { state: 'tracked' },
    ...overrides,
  };
}

function createMockClient(): ApiClient {
  return {
    login: vi.fn(async () => ({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ access_token: 'fresh-token' }),
    })),
    rest: vi.fn(async () => ({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ ok: true, token: 'top-secret', items: ['one', 'two', 'three', 'four'] }),
    })),
    graphql: vi.fn(async () => ({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ data: { viewer: { id: '123', token: 'top-secret' } } }),
    })),
  };
}

function optionsFor(config: ApiToolsConfig, client: ApiClient, extra: Partial<RegisterApiToolsOptions> = {}): RegisterApiToolsOptions {
  return {
    loadConfig: vi.fn(async () => config),
    client,
    now: () => new Date('2026-06-22T00:00:00.000Z'),
    ...extra,
  };
}

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

async function execute(tool: any, params: Record<string, unknown>, ctx: { cwd?: string } = { cwd: '/tmp/project' }) {
  return await tool.execute('id', params, undefined, undefined, ctx);
}

describe('api-tools registration and result shaping', () => {
  it('stays inert when config is missing or not exactly enabled, and registers enabled tools only', async () => {
    const missingPi = createMockPi();
    await registerApiTools(missingPi, {
      loadConfig: vi.fn(async () => createConfig({ exists: false, enabled: false })),
    });
    expect(missingPi.tools).toEqual([]);

    const disabledPi = createMockPi();
    await apiToolsExtension(disabledPi, {
      loadConfig: vi.fn(async () => createConfig({ enabled: false })),
    });
    expect(disabledPi.tools).toEqual([]);

    const enabledPi = createMockPi();
    await registerApiTools(enabledPi, optionsFor(createConfig(), createMockClient()));

    expect(enabledPi.tools.map((tool) => tool.name)).toEqual(API_TOOL_NAMES);
    for (const tool of enabledPi.tools) {
      expect(tool.parameters?.type).toBe('object');
      expect(typeof tool.execute).toBe('function');
      expect(tool).not.toHaveProperty('needsConfirmation');
    }
  });

  it('returns api_status safe config summary without exposing secrets', async () => {
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig(), createMockClient()));

    const result = await execute(pi.tools.find((tool) => tool.name === 'api_status'), {});
    const serialized = JSON.stringify(result);

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      config_exists: true,
      enabled: true,
      auth_type: 'bearer',
      timeout_ms: 30000,
      limits: { max_response_bytes: 80, max_response_lines: 3 },
      git: { state: 'tracked' },
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: 'limit_default_applied' }),
        expect.objectContaining({ code: 'api_json_tracked' }),
      ]),
    });
    expect(result.details.data.endpoints).toMatchObject({
      rest_configured: true,
      graphql_configured: true,
    });
    expect(result.details.data.endpoints.rest_url).toBe('https://api.example.test/base/');
    expect(result.details.data.endpoints.graphql_url).toBe('https://api.example.test/graphql');
    expect(serialized).not.toContain('top-secret');
    expect(serialized).not.toContain('Bearer top-secret');
  });

  it('returns api_auth_status valid, expired, and unknown states without backend calls or token leaks', async () => {
    const validJwt = createJwt({ exp: Math.floor(new Date('2026-06-23T00:00:00.000Z').getTime() / 1000), sub: 'user-1' });
    const expiredJwt = createJwt({ exp: Math.floor(new Date('2026-06-21T00:00:00.000Z').getTime() / 1000), sub: 'user-2' });

    const validPi = createMockPi();
    const validClient = createMockClient();
    await registerApiTools(validPi, optionsFor(createConfig({ auth: { type: 'bearer', token: validJwt }, secretValues: [validJwt] }), validClient));
    const validResult = await execute(validPi.tools.find((tool) => tool.name === 'api_auth_status'), {});
    expect(validResult.content[0].text).toContain('expires in');
    expect(validResult.details.data.auth_status).toBe('valid');
    expect(validResult.details.data.expires_at).toBe('2026-06-23T00:00:00.000Z');
    expect(validResult.details.data.seconds_remaining).toBe(86400);
    expect(validClient.rest).not.toHaveBeenCalled();
    expect(validClient.graphql).not.toHaveBeenCalled();
    expect(JSON.stringify(validResult)).not.toContain(validJwt);

    const expiredPi = createMockPi();
    await registerApiTools(expiredPi, optionsFor(createConfig({ auth: { type: 'bearer', token: expiredJwt }, secretValues: [expiredJwt] }), createMockClient()));
    const expiredResult = await execute(expiredPi.tools.find((tool) => tool.name === 'api_auth_status'), {});
    expect(expiredResult.details.data.auth_status).toBe('expired');

    const unknownPi = createMockPi();
    await registerApiTools(unknownPi, optionsFor(createConfig({ auth: { type: 'headers', headers: { authorization: 'Bearer top-secret' } } }), createMockClient()));
    const unknownResult = await execute(unknownPi.tools.find((tool) => tool.name === 'api_auth_status'), {});
    expect(unknownResult.details.data.auth_status).toBe('unknown');
    expect(unknownResult.details.data.reason_code).toBe('unsupported_auth_metadata');
    expect(JSON.stringify(unknownResult)).not.toContain('top-secret');
  });

  it('lists GraphQL query methods with arguments and return type summaries', async () => {
    const client = createMockClient();
    vi.mocked(client.graphql).mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ data: { __schema: { queryType: { name: 'Query', fields: [
        { name: 'getMyProfile', description: null, args: [], type: { kind: 'OBJECT', name: 'SingleUserRootResponse', ofType: null } },
        { name: 'getUsersByDependency', description: null, args: [{ name: 'page', description: null, type: { kind: 'SCALAR', name: 'Int', ofType: null } }], type: { kind: 'OBJECT', name: 'PageUserItemResponse', ofType: null } },
      ] } } } }),
    });
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig(), client));

    const result = await execute(pi.tools.find((tool) => tool.name === 'api_graphql_schema_queries'), { use_token: true });

    expect(client.graphql).toHaveBeenCalledWith(expect.objectContaining({ useToken: true }), undefined);
    expect(result.details.status).toBe('success');
    expect(result.details.data.queries).toHaveLength(2);
    expect(result.details.data.queries[0]).toMatchObject({ name: 'getMyProfile', return_type: 'SingleUserRootResponse' });
    expect(result.content[0].text).toContain('getUsersByDependency(page: Int): PageUserItemResponse');
  });

  it('inspects one GraphQL query schema with arguments and nested return fields', async () => {
    const client = createMockClient();
    vi.mocked(client.graphql)
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        bodyText: JSON.stringify({ data: { __type: { fields: [
          { name: 'getMyProfile', description: null, args: [], type: { kind: 'OBJECT', name: 'SingleUserRootResponse', ofType: null } },
        ] } } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        bodyText: JSON.stringify({ data: { __type: { name: 'SingleUserRootResponse', description: null, fields: [
          { name: 'data', description: null, type: { kind: 'OBJECT', name: 'UserRootResponse', ofType: null } },
          { name: 'responseStatus', description: null, type: { kind: 'OBJECT', name: 'ResponseStatus', ofType: null } },
        ] } } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        bodyText: JSON.stringify({ data: { __type: { name: 'UserRootResponse', description: null, fields: [
          { name: 'id', description: null, type: { kind: 'SCALAR', name: 'ID', ofType: null } },
          { name: 'names', description: null, type: { kind: 'SCALAR', name: 'String', ofType: null } },
        ] } } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        bodyText: JSON.stringify({ data: { __type: { name: 'ResponseStatus', description: null, fields: [
          { name: 'code', description: null, type: { kind: 'SCALAR', name: 'Int', ofType: null } },
          { name: 'message', description: null, type: { kind: 'SCALAR', name: 'String', ofType: null } },
        ] } } }),
      });
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig(), client));

    const result = await execute(pi.tools.find((tool) => tool.name === 'api_graphql_schema_query'), { name: 'getMyProfile', max_depth: 2, use_token: true });

    expect(result.details.status).toBe('success');
    expect(result.details.data.query.name).toBe('getMyProfile');
    expect(result.details.data.query.return_type).toBe('SingleUserRootResponse');
    expect(result.details.data.types.SingleUserRootResponse.fields.data.type).toBe('UserRootResponse');
    expect(result.details.data.types.UserRootResponse.fields.names.type).toBe('String');
    expect(result.content[0].text).toContain('getMyProfile(): SingleUserRootResponse');
    expect(result.content[0].text).toContain('type SingleUserRootResponse');
    expect(result.content[0].text).toContain('data: UserRootResponse');
    expect(result.content[0].text).toContain('type UserRootResponse');
    expect(result.content[0].text).toContain('names: String');
    expect(result.content[0].text).toContain('responseStatus: ResponseStatus');
  });

  it('does not redact GraphQL schema metadata names such as token arguments', async () => {
    const client = createMockClient();
    vi.mocked(client.graphql).mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ data: { __schema: { queryType: { name: 'Query', fields: [
        { name: 'getReviewById', description: null, args: [
          { name: 'id', description: null, type: { kind: 'SCALAR', name: 'String', ofType: null } },
          { name: 'token', description: null, type: { kind: 'SCALAR', name: 'String', ofType: null } },
        ], type: { kind: 'OBJECT', name: 'SingleReviewDetailResponse', ofType: null } },
      ] } } } }),
    });
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig({ secretValues: ['top-secret'] }), client));

    const result = await execute(pi.tools.find((tool) => tool.name === 'api_graphql_schema_queries'), { use_token: true });

    expect(result.content[0].text).toContain('getReviewById(id: String, token: String): SingleReviewDetailResponse');
    expect(result.content[0].text).not.toContain('[REDACTED]');
  });

  it('returns redacted bounded success envelopes for rest and graphql, including mutations without extension-specific prompts', async () => {
    const client = createMockClient();
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig(), client));

    const restTool = pi.tools.find((tool) => tool.name === 'api_rest_request');
    const graphqlTool = pi.tools.find((tool) => tool.name === 'api_graphql_query');

    const restResult = await execute(restTool, { method: 'POST', path: 'users', body: '{"token":"top-secret"}', use_token: true });
    expect(client.rest).toHaveBeenCalledWith({ method: 'POST', path: 'users', body: '{"token":"top-secret"}', useToken: true }, undefined);
    expect(restResult.details.status).toBe('success');
    expect(restResult.details.data.request).toMatchObject({ method: 'POST', path: 'users', mutation: true });
    expect(restResult.details.data.response.truncation.limit_bytes).toBe(80);
    expect(restResult.details.data.response.body).toContain('[REDACTED]');
    expect(JSON.stringify(restResult)).not.toContain('top-secret');
    expect(restTool).not.toHaveProperty('needsConfirmation');

    const graphqlResult = await execute(graphqlTool, {
      query: 'mutation UpdateName { updateName(id: "123") { id token } }',
      variables: { id: '123' },
      operationName: 'UpdateName',
      use_token: false,
    });
    expect(client.graphql).toHaveBeenCalledWith(
      {
        query: 'mutation UpdateName { updateName(id: "123") { id token } }',
        variables: { id: '123' },
        operationName: 'UpdateName',
        useToken: false,
      },
      undefined,
    );
    expect(graphqlResult.details.status).toBe('success');
    expect(graphqlResult.details.data.request.mutation).toBe(true);
    expect(graphqlResult.details.data.response.body).toContain('[REDACTED]');
    expect(JSON.stringify(graphqlResult)).not.toContain('top-secret');
    expect(graphqlTool).not.toHaveProperty('needsConfirmation');
  });

  it('logs in, persists access_token to api.json, and redacts token from output', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-login-tool-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'api.json'), JSON.stringify({
      enabled: true,
      url: 'https://api.example.test/base/',
      auth: { type: 'login', login_path: '/login', username: 'test', password: 'test' },
    }, null, 2));
    const client = createMockClient();
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig({
      configPath: join(cwd, '.pi', 'api.json'),
      auth: { type: 'login', login_path: '/login', username: 'test', password: 'test' },
      secretValues: ['test'],
    }), client));

    const result = await execute(pi.tools.find((tool) => tool.name === 'api_login'), {}, { cwd });
    const persisted = JSON.parse(await readFile(join(cwd, '.pi', 'api.json'), 'utf8'));

    expect(client.login).toHaveBeenCalledOnce();
    expect(result.details.status).toBe('success');
    expect(result.details.data.auth_type).toBe('login');
    expect(result.details.data.access_token_persisted).toBe(true);
    expect(persisted.auth.access_token).toBe('fresh-token');
    expect(JSON.stringify(result)).not.toContain('fresh-token');
  });

  it('accepts token as login response alias and persists it as access_token', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-login-token-alias-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'api.json'), JSON.stringify({
      enabled: true,
      url: 'https://api.example.test/base/',
      auth: { type: 'login', login_path: '/auth/login', username: 'test', password: 'test' },
    }, null, 2));
    const client = createMockClient();
    vi.mocked(client.login).mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ token: 'alias-token' }),
    });
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig({
      configPath: join(cwd, '.pi', 'api.json'),
      auth: { type: 'login', login_path: '/auth/login', username: 'test', password: 'test' },
      secretValues: ['test'],
    }), client));

    const result = await execute(pi.tools.find((tool) => tool.name === 'api_login'), {}, { cwd });
    const persisted = JSON.parse(await readFile(join(cwd, '.pi', 'api.json'), 'utf8'));

    expect(result.details.status).toBe('success');
    expect(persisted.auth.access_token).toBe('alias-token');
    expect(JSON.stringify(result)).not.toContain('alias-token');
  });

  it('returns redacted failure envelopes for rest and graphql tool execution errors', async () => {
    const client: ApiClient = {
      login: vi.fn(async () => ({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        bodyText: '{"access_token":"unused"}',
      })),
      rest: vi.fn(async () => ({
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'application/json' },
        bodyText: '{"error":"token top-secret failed"}',
      })),
      graphql: vi.fn(async () => {
        throw new Error('provider saw Authorization: Bearer top-secret');
      }),
    };

    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig(), client));

    const restFailure = await execute(pi.tools.find((tool) => tool.name === 'api_rest_request'), { method: 'GET', path: 'broken' });
    expect(restFailure.isError).toBe(true);
    expect(restFailure.details.status).toBe('failure');
    expect(restFailure.details.error.code).toBe('http_error');
    expect(JSON.stringify(restFailure)).not.toContain('top-secret');
    expect(JSON.stringify(restFailure)).toContain('[REDACTED]');

    const graphqlFailure = await execute(pi.tools.find((tool) => tool.name === 'api_graphql_query'), { query: '{ viewer { id } }' });
    expect(graphqlFailure.isError).toBe(true);
    expect(graphqlFailure.details.status).toBe('failure');
    expect(graphqlFailure.details.error.code).toBe('provider_error');
    expect(JSON.stringify(graphqlFailure)).not.toContain('top-secret');
    expect(JSON.stringify(graphqlFailure)).toContain('[REDACTED]');
  });
});
