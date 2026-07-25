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
    limits: { maxResponseBytes: 80, maxResponseLines: 3, cursorTtlSeconds: 3600 },
    warnings: [{ code: 'limit_default_applied', message: 'Default response limits were applied.' }],
    secretValues: ['top-secret', 'Bearer top-secret'],
    git: { state: 'tracked' },
    ...overrides,
  };
}

function createMockClient(): ApiClient {
  return {
    login: vi.fn(async () => ({ status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: JSON.stringify({ access_token: 'fresh-token' }) })),
    rest: vi.fn(async () => ({ status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: JSON.stringify({ ok: true, token: 'top-secret', items: ['one', 'two', 'three', 'four'] }) })),
    graphql: vi.fn(async () => ({ status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: JSON.stringify({ data: { viewer: { id: '123', token: 'top-secret' } } }) })),
    fetchSwaggerDocument: vi.fn(async () => ({ url: 'https://api.example.test/base/v3/api-docs', document: { openapi: '3.0.0', info: { title: 'Demo', version: '1.0.0' }, paths: { '/users': { get: { summary: 'List users', operationId: 'listUsers', tags: ['users'], responses: { 200: { description: 'ok' } } } } } } })),
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

describe('api-tools registration and result shaping', () => {
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

  it('reports safe api_status without endpoint URL disclosure', async () => {
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig(), createMockClient()));
    const result = await execute(pi.tools.find((tool) => tool.name === 'api_status'), {});
    const serialized = JSON.stringify(result);
    expect(result.details.data.swagger).toEqual({ enabled: true, framework: 'spring' });
    expect(result.details.data.graphql).toEqual({ enabled: true, framework: 'spring' });
    expect(serialized).not.toContain('rest_url');
    expect(serialized).not.toContain('graphql_url');
    expect(serialized).not.toContain('https://api.example.test');
  });

  it('returns api_auth_status valid and unknown states without backend calls or token leaks', async () => {
    const validJwt = createJwt({ exp: Math.floor(new Date('2026-06-23T00:00:00.000Z').getTime() / 1000) });
    const validPi = createMockPi();
    const validClient = createMockClient();
    await registerApiTools(validPi, optionsFor(createConfig({ auth: { type: 'bearer', token: validJwt }, secretValues: [validJwt] }), validClient));
    const validResult = await execute(validPi.tools.find((tool) => tool.name === 'api_auth_status'), {});
    expect(validResult.details.data.auth_status).toBe('valid');
    expect(validClient.rest).not.toHaveBeenCalled();
    expect(validClient.graphql).not.toHaveBeenCalled();

    const unknownPi = createMockPi();
    await registerApiTools(unknownPi, optionsFor(createConfig({ auth: { type: 'headers', headers: { authorization: 'Bearer top-secret' } } }), createMockClient()));
    const unknownResult = await execute(unknownPi.tools.find((tool) => tool.name === 'api_auth_status'), {});
    expect(unknownResult.details.data.auth_status).toBe('unknown');
  });

  it('conditionally registers api_swagger and api_graphql only when their blocks are enabled', async () => {
    const swaggerOnly = createMockPi();
    await registerApiTools(swaggerOnly, optionsFor(createConfig({ graphql: { configured: true, enabled: false, valid: true } as any }), createMockClient()));
    expect(swaggerOnly.tools.map((tool) => tool.name)).toContain('api_swagger');
    expect(swaggerOnly.tools.map((tool) => tool.name)).not.toContain('api_graphql');

    const graphqlOnly = createMockPi();
    await registerApiTools(graphqlOnly, optionsFor(createConfig({ swagger: { configured: true, enabled: false, valid: true } as any }), createMockClient()));
    expect(graphqlOnly.tools.map((tool) => tool.name)).toContain('api_graphql');
    expect(graphqlOnly.tools.map((tool) => tool.name)).not.toContain('api_swagger');
  });

  it('supports swagger discover and graphql execute through the new tools', async () => {
    const client = createMockClient();
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig({ limits: { maxResponseBytes: 50000, maxResponseLines: 2000, cursorTtlSeconds: 3600 } }), client));

    const swagger = await execute(pi.tools.find((tool) => tool.name === 'api_swagger'), { action: 'discover' });
    expect(swagger.details.data.title).toBe('Demo');
    expect(swagger.details.continuation.has_more).toBe(false);

    const graphql = await execute(pi.tools.find((tool) => tool.name === 'api_graphql'), { action: 'execute', query: '{ viewer { id } }' });
    expect(graphql.details.status).toBe('success');
    expect(JSON.stringify(graphql)).not.toContain('top-secret');
  });

  it('rejects execution-specific inputs when continuing with a cursor', async () => {
    const client = createMockClient();
    vi.mocked(client.fetchSwaggerDocument).mockResolvedValueOnce({
      url: 'https://api.example.test/base/v3/api-docs',
      document: { openapi: '3.0.0', info: { title: 'Demo', version: '1.0.0' }, paths: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`/users/${index}`, { get: { operationId: `getUser${index}`, tags: ['users'], responses: { 200: { description: 'ok' } } } }])) },
    });
    const pi = createMockPi();
    await registerApiTools(pi, optionsFor(createConfig({ limits: { maxResponseBytes: 60, maxResponseLines: 2, cursorTtlSeconds: 3600 } }), client));
    const first = await execute(pi.tools.find((tool) => tool.name === 'api_swagger'), { action: 'discover' });
    expect(first.details.continuation.has_more).toBe(true);
    const conflict = await execute(pi.tools.find((tool) => tool.name === 'api_swagger'), { action: 'discover', cursor: first.details.continuation.next_cursor, tag: 'users' });
    expect(conflict.details.error.code).toBe('cursor_execution_inputs_rejected');
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
});
