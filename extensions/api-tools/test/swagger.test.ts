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

function createClient(document?: Record<string, any>, restStatus = 200): ApiClient {
  return {
    login: vi.fn(),
    graphql: vi.fn(),
    resolveGraphqlUrl: vi.fn(() => 'https://api.example.test/base/graphql'),
    fetchSwaggerDocument: vi.fn(async () => ({
      url: 'https://api.example.test/base/v3/api-docs',
      document: document ?? {
        openapi: '3.0.0',
        info: { title: 'Demo API', version: '1.0.0' },
        security: [{ bearerAuth: ['items:read'] }],
        components: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
          parameters: {
            ItemId: { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          },
        },
        paths: {
          '/users/{id}': {
            parameters: [{ $ref: '#/components/parameters/ItemId' }],
            get: {
              operationId: 'getUser',
              tags: ['users'],
              'x-roles': ['admin', 'owner'],
              parameters: [{ name: 'verbose', in: 'query', schema: { type: 'boolean' } }],
              requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } },
              responses: {
                200: { description: 'ok', headers: { 'x-trace': { schema: { type: 'string' } } }, content: { 'application/json': { schema: { type: 'object' } } } },
                404: { description: 'missing', content: { 'application/json': { schema: { $ref: 'https://evil.example/schema.json#/Item' } } } },
              },
            },
          },
        },
      },
    })),
    rest: vi.fn(async () => ({
      status: restStatus,
      statusText: restStatus === 200 ? 'OK' : 'Forbidden',
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ ok: restStatus === 200, token: 'top-secret' }),
    })),
  };
}

describe('executeSwaggerAction', () => {
  it('discovers compact operation rows with authorization summary', async () => {
    const client = createClient();
    const result = await executeSwaggerAction({ action: 'discover', tag: 'users' }, undefined, client, createConfig());
    expect(result.status).toBe('success');
    expect(result.records[0].text).toContain('GET /users/{id} · getUser');
    expect(result.records[0].text).toContain('auth: declared');
  });

  it('returns detail for one selector with inherited params, auth metadata, local refs, and unsupported external refs', async () => {
    const client = createClient();
    const result = await executeSwaggerAction({ action: 'detail', operation: 'getUser' }, undefined, client, createConfig());
    const text = result.records.map((entry) => entry.text).join('\n');
    expect(text).toContain('GET /users/{id} · getUser');
    expect(text).toContain('parameter path.id required');
    expect(text).toContain('parameter query.verbose optional');
    expect(text).toContain('authorization: declared');
    expect(text).toContain('roles=admin,owner');
    expect(text).toContain('response 404');
    expect(text).toContain('unsupported_reference');
  });

  it('requires a selector for schema and reports HTTP failures for request', async () => {
    const client = createClient(undefined, 403);
    const missing = await executeSwaggerAction({ action: 'schema' }, undefined, client, createConfig());
    expect(missing.status).toBe('failure');

    const request = await executeSwaggerAction({ action: 'request', method: 'GET', path: '/users' }, undefined, client, createConfig());
    expect(request.status).toBe('failure');
    expect(request.failure?.category).toBe('http_error');
  });
});
