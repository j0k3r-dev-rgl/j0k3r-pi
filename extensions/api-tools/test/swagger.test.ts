import { describe, expect, it, vi } from 'vitest';
import { executeSwaggerAction } from '../src/swagger.js';
import type { ApiClient, ApiToolsConfig } from '../src/types.js';

function createConfig(overrides: Partial<ApiToolsConfig> = {}): ApiToolsConfig {
  return {
    configPath: '/tmp/project/.pi/api.json',
    exists: true,
    enabled: true,
    url: 'https://api.example.test/base/',
    graphqlUrl: 'https://api.example.test/base/graphql',
    swagger: { configured: true, enabled: true, framework: 'spring', valid: true },
    graphql: { configured: true, enabled: true, framework: 'spring', valid: true },
    headers: {},
    auth: { type: 'none' },
    timeoutMs: 100,
    limits: { maxResponseBytes: 50000, maxResponseLines: 2000, cursorTtlSeconds: 3600 },
    warnings: [],
    secretValues: ['top-secret'],
    git: { state: 'ignored' },
    ...overrides,
  };
}

function createClient(document?: Record<string, any>): ApiClient {
  return {
    login: vi.fn(),
    graphql: vi.fn(),
    resolveGraphqlUrl: vi.fn(() => 'https://api.example.test/base/graphql'),
    fetchSwaggerDocument: vi.fn(async () => ({
      url: 'https://api.example.test/base/v3/api-docs',
      document: document ?? {
        openapi: '3.0.0',
        info: { title: 'Demo API', version: '1.0.0' },
        paths: {
          '/users': {
            get: { operationId: 'listUsers', summary: 'List users', tags: ['users'], responses: { 200: { description: 'ok' } } },
          },
          '/orders': {
            post: { operationId: 'createOrder', summary: 'Create order', tags: ['orders'], responses: { 201: { description: 'created' } } },
          },
        },
      },
    })),
    rest: vi.fn(async () => ({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ ok: true, token: 'top-secret' }),
    })),
  };
}

describe('executeSwaggerAction', () => {
  it('discovers operations with optional tag filters', async () => {
    const client = createClient();
    const result = await executeSwaggerAction({ action: 'discover', tag: 'users' }, undefined, client, createConfig());
    expect(result.details?.status).toBe('success');
    expect(result.details?.data.tags).toEqual(['users']);
    expect(result.details?.data.operations).toHaveLength(1);
    expect(result.details?.data.operations[0]).toMatchObject({ id: 'listUsers', method: 'GET', path: '/users' });
  });

  it('returns bounded schema data for a selected operation', async () => {
    const client = createClient({
      openapi: '3.0.0',
      info: { title: 'Demo API', version: '1.0.0' },
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            summary: 'Get user',
            parameters: [{ name: 'id', in: 'path', schema: { type: 'string', nested: { extra: true } } }],
            responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { user: { type: 'string' } } } } } } },
          },
        },
      },
    });

    const result = await executeSwaggerAction({ action: 'schema', operation: 'getUser', max_depth: 1 }, undefined, client, createConfig());
    expect(result.details?.status).toBe('success');
    expect(result.details?.data.id).toBe('getUser');
    expect(result.details?.data.responses).toBe('[Truncated]');
  });

  it('executes configured-origin requests and redacts response secrets', async () => {
    const client = createClient();
    const result = await executeSwaggerAction({ action: 'request', method: 'GET', path: '/users' }, undefined, client, createConfig());
    expect(client.rest).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/users' }), undefined);
    expect(JSON.stringify(result)).not.toContain('top-secret');
  });
});
