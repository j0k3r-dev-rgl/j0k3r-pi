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
  const handlers: Record<string, Function[]> = {};
  return {
    tools,
    handlers,
    registerTool(tool: any) { tools.push(tool); },
    on(event: string, handler: Function) { handlers[event] ??= []; handlers[event].push(handler); },
  };
}

function createConfig(overrides: Partial<ApiToolsConfig> = {}): ApiToolsConfig {
  return {
    configPath: '/tmp/project/.pi/api.json',
    exists: true,
    enabled: true,
    url: 'https://api.example.test/base/',
    graphqlUrl: 'https://api.example.test/base/legacy-graphql',
    swagger: { configured: true, enabled: true, framework: 'spring', valid: true },
    graphql: { configured: true, enabled: true, framework: 'spring', valid: true },
    headers: { 'x-project-client': 'pi', authorization: 'Bearer top-secret' },
    auth: { type: 'bearer', token: 'top-secret' },
    timeoutMs: 30000,
    limits: { maxResponseBytes: 50000, maxResponseLines: 2000, cursorTtlSeconds: 3600 },
    warnings: [{ code: 'limit_default_applied', message: 'Default response limits were applied.' }],
    secretValues: ['top-secret', 'Bearer top-secret'],
    git: { state: 'tracked' },
    ...overrides,
  };
}

function createMockClient(): ApiClient {
  return {
    login: vi.fn(async () => ({ status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: JSON.stringify({ access_token: 'fresh-token' }) })),
    rest: vi.fn(async () => ({ status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: JSON.stringify({ ok: true, token: 'top-secret', items: ['one', 'two'] }) })),
    graphql: vi.fn(async ({ query, variables }) => {
      if (String(query).includes('ApiToolsGraphqlDiscoverRoot')) {
        const root = variables && typeof variables === 'object' ? (variables as Record<string, unknown>).root : undefined;
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({ data: { __type: { fields: root === 'Mutation' ? [] : [{ name: 'viewer', type: { kind: 'OBJECT', name: 'Viewer' } }] } } }),
        };
      }
      return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: JSON.stringify({ data: { viewer: { id: '123', token: 'top-secret' } } }) };
    }),
    fetchSwaggerDocument: vi.fn(async () => ({ url: 'https://api.example.test/base/v3/api-docs', document: { openapi: '3.0.0', info: { title: 'Demo', version: '1.0.0' }, paths: { '/users': { get: { operationId: 'listUsers', tags: ['users'], responses: { 200: { description: 'ok' } } } } } } })),
    resolveGraphqlUrl: vi.fn(() => 'https://api.example.test/base/graphql'),
  };
}

function optionsFor(config: ApiToolsConfig, client: ApiClient, extra: Partial<RegisterApiToolsOptions> = {}): RegisterApiToolsOptions {
  return { loadConfig: vi.fn(async () => config), client, now: () => new Date('2026-06-22T00:00:00.000Z'), ...extra };
}

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

async function execute(tool: any, params: Record<string, unknown>) {
  return await tool.execute('id', params, undefined);
}

describe('api-tools registration and v2 contracts', () => {
  it('stays inert when config is missing or not exactly enabled, and registers enabled tools only', async () => {
    const missingPi = createMockPi();
    await registerApiTools(missingPi, { loadConfig: vi.fn(async () => createConfig({ exists: false, enabled: false })) });
    expect(missingPi.tools).toEqual([]);

    const disabledPi = createMockPi();
    await apiToolsExtension(disabledPi, { loadConfig: vi.fn(async () => createConfig({ enabled: false })) });
    expect(disabledPi.tools).toEqual([]);

    const enabledPi = createMockPi();
    await registerApiTools(enabledPi, optionsFor(createConfig(), createMockClient()));
    expect(enabledPi.tools.map((tool) => tool.name)).toEqual(API_TOOL_NAMES);
  });

  it('keeps exactly six tools and exposes detail only on swagger/graphql schemas', async () => {
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig(), createMockClient()));
    const swagger = pi.tools.find((tool) => tool.name === 'api_swagger');
    const graphql = pi.tools.find((tool) => tool.name === 'api_graphql');
    expect(JSON.stringify(swagger.parameters)).toContain('detail');
    expect(JSON.stringify(graphql.parameters)).toContain('detail');
    expect(pi.tools.find((tool) => tool.name === 'api_rest_request').parameters).not.toEqual(swagger.parameters);
  });

  it('reports safe api_status and v2 details without endpoint URL disclosure', async () => {
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig(), createMockClient()));
    const result = await execute(pi.tools.find((tool) => tool.name === 'api_status'), {});
    const serialized = JSON.stringify(result);
    expect(result.details.contract_version).toBe(2);
    expect(result.details.action).toBe('status');
    expect(serialized).not.toContain('https://api.example.test');
  });

  it('returns api_auth_status valid and unknown states without backend calls or token leaks', async () => {
    const validJwt = createJwt({ exp: Math.floor(new Date('2026-06-23T00:00:00.000Z').getTime() / 1000) });
    const validPi = createMockPi();
    const validClient = createMockClient();
    await registerApiTools(validPi, optionsFor(createConfig({ auth: { type: 'bearer', token: validJwt }, secretValues: [validJwt] }), validClient));
    const validResult = await execute(validPi.tools.find((tool) => tool.name === 'api_auth_status'), {});
    expect(validResult.content[0].text).toContain('auth_status: valid');
    expect(validClient.rest).not.toHaveBeenCalled();
    expect(validClient.graphql).not.toHaveBeenCalled();

    const unknownPi = createMockPi();
    await registerApiTools(unknownPi, optionsFor(createConfig({ auth: { type: 'headers', headers: { authorization: 'Bearer top-secret' } } }), createMockClient()));
    const unknownResult = await execute(unknownPi.tools.find((tool) => tool.name === 'api_auth_status'), {});
    expect(unknownResult.content[0].text).toContain('auth_status: unknown');
  });

  it('supports swagger discover and graphql execute through v2 results', async () => {
    const client = createMockClient();
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig(), client));

    const swagger = await execute(pi.tools.find((tool) => tool.name === 'api_swagger'), { action: 'discover' });
    expect(swagger.details.contract_version).toBe(2);
    expect(swagger.content[0].text).toContain('GET /users · listUsers');
    expect(swagger.details.continuation.has_more).toBe(false);

    const graphql = await execute(pi.tools.find((tool) => tool.name === 'api_graphql'), { action: 'execute', query: '{ viewer { id } }' });
    expect(graphql.details.status).toBe('success');
    expect(JSON.stringify(graphql)).not.toContain('top-secret');
  });

  it('enforces the default 50-operation discovery page size for swagger and graphql', async () => {
    const client = createMockClient();
    vi.mocked(client.fetchSwaggerDocument).mockResolvedValueOnce({
      url: 'https://api.example.test/base/v3/api-docs',
      document: {
        openapi: '3.0.0',
        info: { title: 'Demo', version: '1.0.0' },
        paths: Object.fromEntries(Array.from({ length: 75 }, (_, index) => [`/users/${index}`, { get: { operationId: `getUser${index}`, tags: ['users'], responses: { 200: { description: 'ok' } } } }])),
      },
    });
    vi.mocked(client.graphql).mockImplementation(async ({ query, variables }) => {
      if (String(query).includes('ApiToolsGraphqlDiscoverRoot')) {
        const root = variables && typeof variables === 'object' ? (variables as Record<string, unknown>).root : undefined;
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({
            data: {
              __type: {
                fields: root === 'Mutation' ? [] : Array.from({ length: 75 }, (_, index) => ({ name: `viewer${index}`, type: { kind: 'OBJECT', name: 'Viewer' } })),
              },
            },
          }),
        };
      }
      return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: JSON.stringify({ data: { viewer: { id: '123', token: 'top-secret' } } }) };
    });

    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig({ limits: { maxResponseBytes: 500000, maxResponseLines: 5000, cursorTtlSeconds: 3600 } }), client));

    const swagger = await execute(pi.tools.find((tool) => tool.name === 'api_swagger'), { action: 'discover' });
    expect(swagger.details.continuation.returned_count).toBe(50);
    expect(swagger.details.continuation.total).toBe(75);
    expect(swagger.details.continuation.has_more).toBe(true);
    expect(swagger.content[0].text).toContain('next_cursor:');
    expect(swagger.content[0].text).toContain('api_swagger');
    expect(swagger.content[0].text).toContain('action=discover');

    const graphql = await execute(pi.tools.find((tool) => tool.name === 'api_graphql'), { action: 'discover' });
    expect(graphql.details.continuation.returned_count).toBe(50);
    expect(graphql.details.continuation.total).toBe(75);
    expect(graphql.details.continuation.has_more).toBe(true);
  });

  it('rejects execution-specific inputs when continuing with a cursor', async () => {
    const client = createMockClient();
    vi.mocked(client.fetchSwaggerDocument).mockResolvedValueOnce({
      url: 'https://api.example.test/base/v3/api-docs',
      document: { openapi: '3.0.0', info: { title: 'Demo', version: '1.0.0' }, paths: Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`/users/${index}`, { get: { operationId: `getUser${index}`, tags: ['users'], responses: { 200: { description: 'ok' } } } }])) },
    });
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig({ limits: { maxResponseBytes: 120, maxResponseLines: 3, cursorTtlSeconds: 3600 } }), client));
    const first = await execute(pi.tools.find((tool) => tool.name === 'api_swagger'), { action: 'discover' });
    expect(first.details.continuation.has_more).toBe(true);
    const conflict = await execute(pi.tools.find((tool) => tool.name === 'api_swagger'), { action: 'discover', cursor: first.details.continuation.next_cursor, tag: 'users' });
    expect(conflict.details.failure.code).toBe('continuation.cursor_execution_inputs_rejected');
  });

  it('continues graphql detail when nested field output exceeds the 200-field budget', async () => {
    const client = createMockClient();
    vi.mocked(client.graphql).mockImplementation(async ({ query, variables }) => {
      if (String(query).includes('ApiToolsGraphqlDiscoverRoot')) {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({ data: { __type: { fields: [{ name: 'bigViewer', type: { kind: 'OBJECT', name: 'HugeType' } }] } } }),
        };
      }
      if (String(query).includes('ApiToolsGraphqlRootField')) {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({ data: { __type: { fields: [{ name: 'bigViewer', description: 'large field set', args: [], type: { kind: 'OBJECT', name: 'HugeType' } }] } } }),
        };
      }
      if (String(query).includes('ApiToolsGraphqlTypeByName')) {
        const name = variables && typeof variables === 'object' ? (variables as Record<string, unknown>).name : undefined;
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({
            data: {
              __type: name === 'HugeType' ? {
                name: 'HugeType',
                kind: 'OBJECT',
                fields: Array.from({ length: 250 }, (_, index) => ({ name: `field${index}`, description: `field ${index}`, type: { kind: 'SCALAR', name: 'String' } })),
              } : null,
            },
          }),
        };
      }
      return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: JSON.stringify({ data: { viewer: { id: '123' } } }) };
    });

    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig({ limits: { maxResponseBytes: 500000, maxResponseLines: 5000, cursorTtlSeconds: 3600 } }), client));
    const detail = await execute(pi.tools.find((tool) => tool.name === 'api_graphql'), { action: 'detail', operation: 'Query.bigViewer', max_depth: 3 });
    expect(detail.details.continuation.has_more).toBe(true);
    expect(detail.details.continuation.returned_count).toBeGreaterThanOrEqual(200);
    expect(detail.details.continuation.total).toBeGreaterThan(detail.details.continuation.returned_count);
  });

  it('logs in, persists access_token to api.json, and redacts token from output', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-login-tool-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'api.json'), JSON.stringify({ enabled: true, url: 'https://api.example.test/base/', auth: { type: 'login', login_path: '/login', username: 'test', password: 'test' } }, null, 2));
    const client = createMockClient();
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig({ configPath: join(cwd, '.pi', 'api.json'), auth: { type: 'login', login_path: '/login', username: 'test', password: 'test' }, secretValues: ['test'] }), client));
    const result = await execute(pi.tools.find((tool) => tool.name === 'api_login'), {});
    const persisted = JSON.parse(await readFile(join(cwd, '.pi', 'api.json'), 'utf8'));
    expect(result.details.status).toBe('success');
    expect(persisted.auth.access_token).toBe('fresh-token');
    expect(JSON.stringify(result)).not.toContain('fresh-token');
  });

  it('exposes alias parameter on api_login and rejects direct password or unknown parameters', async () => {
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig({
      auth: { type: 'login', login_path: '/login', username: 'test', password: 'test' },
    }), createMockClient()));
    const loginTool = pi.tools.find((tool) => tool.name === 'api_login');
    expect(loginTool.parameters).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        alias: {
          type: 'string',
          description: expect.any(String),
        },
      },
    });

    const result = await execute(loginTool, { password: 'secret-password' } as any);
    expect(result.details.status).toBe('failure');
    expect(result.details.failure.category).toBe('validation_error');
    expect(JSON.stringify(result)).not.toContain('secret-password');
  });

  it('executes alias-based login from accounts_file, persists token, and redacts resolved secrets', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-alias-login-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await mkdir(join(cwd, 'dev'), { recursive: true });

    const accounts = [
      { role: 'PLATFORM_ADMIN', username: 'admin_user', email: 'admin@test.local', password: 'secret-admin-pass-xyz' },
    ];
    await writeFile(join(cwd, 'dev', '.accounts.json'), JSON.stringify(accounts), 'utf8');

    const apiJson = {
      enabled: true,
      url: 'https://api.example.test/base/',
      auth: {
        type: 'login',
        login_path: '/auth/login',
        identifier_field: 'identifier',
        accounts_file: 'dev/.accounts.json',
      },
    };
    await writeFile(join(cwd, '.pi', 'api.json'), JSON.stringify(apiJson, null, 2), 'utf8');

    const client = createMockClient();
    const pi = createMockPi();
    const config = createConfig({
      configPath: join(cwd, '.pi', 'api.json'),
      auth: {
        type: 'login',
        login_path: '/auth/login',
        identifier_field: 'identifier',
        password_field: 'password',
        accounts_file: 'dev/.accounts.json',
      },
      secretValues: [],
    });

    // Provide gitInspector that marks accounts file as ignored
    const gitInspector = {
      inspectFile: vi.fn(async () => 'ignored' as const),
    };

    await registerApiTools(pi, optionsFor(config, client, {
      cwd,
      gitFileInspector: gitInspector as any,
    }));

    const loginTool = pi.tools.find((tool) => tool.name === 'api_login');
    const result = await execute(loginTool, { alias: 'PLATFORM_ADMIN' });

    expect(result.details.status).toBe('success');
    expect(result.details.identity).toBe('api_login [PLATFORM_ADMIN]');
    expect(client.login).toHaveBeenCalledWith(
      { identifier: 'admin_user', password: 'secret-admin-pass-xyz' },
      undefined,
    );

    const persisted = JSON.parse(await readFile(join(cwd, '.pi', 'api.json'), 'utf8'));
    expect(persisted.auth.access_token).toBe('fresh-token');

    // Password must be redacted and never leaked
    expect(JSON.stringify(result)).not.toContain('secret-admin-pass-xyz');
  });

  it('falls back to config.auth.account_alias when alias is omitted from api_login params', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-alias-fallback-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await mkdir(join(cwd, 'dev'), { recursive: true });

    const accounts = [
      { role: 'DEFAULT_ROLE', username: 'default_user', email: 'default@test.local', password: 'secret-default-pass' },
    ];
    await writeFile(join(cwd, 'dev', '.accounts.json'), JSON.stringify(accounts), 'utf8');

    const apiJson = {
      enabled: true,
      url: 'https://api.example.test/base/',
      auth: {
        type: 'login',
        login_path: '/auth/login',
        accounts_file: 'dev/.accounts.json',
        account_alias: 'DEFAULT_ROLE',
      },
    };
    await writeFile(join(cwd, '.pi', 'api.json'), JSON.stringify(apiJson, null, 2), 'utf8');

    const client = createMockClient();
    const pi = createMockPi();
    const config = createConfig({
      configPath: join(cwd, '.pi', 'api.json'),
      auth: {
        type: 'login',
        login_path: '/auth/login',
        identifier_field: 'username',
        password_field: 'password',
        accounts_file: 'dev/.accounts.json',
        account_alias: 'DEFAULT_ROLE',
      },
      secretValues: [],
    });

    const gitInspector = {
      inspectFile: vi.fn(async () => 'ignored' as const),
    };

    await registerApiTools(pi, optionsFor(config, client, {
      cwd,
      gitFileInspector: gitInspector as any,
    }));

    const loginTool = pi.tools.find((tool) => tool.name === 'api_login');
    const result = await execute(loginTool, {});

    expect(result.details.status).toBe('success');
    expect(result.details.identity).toBe('api_login [DEFAULT_ROLE]');
    expect(client.login).toHaveBeenCalledWith(
      { identifier: 'default_user', password: 'secret-default-pass' },
      undefined,
    );
  });
});
