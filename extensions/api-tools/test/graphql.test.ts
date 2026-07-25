import { describe, expect, it, vi } from 'vitest';
import { executeGraphqlAction } from '../src/graphql.js';
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

function createClient(): ApiClient {
  return {
    login: vi.fn(),
    rest: vi.fn(),
    fetchSwaggerDocument: vi.fn(),
    resolveGraphqlUrl: vi.fn(() => 'https://api.example.test/base/graphql'),
    graphql: vi.fn(async ({ query }) => {
      if (String(query).includes('ApiToolsGraphqlDiscover')) {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({
            data: {
              __schema: {
                queryType: { fields: [{ name: 'user', type: { kind: 'OBJECT', name: 'User' } }, { name: 'viewer', type: { kind: 'OBJECT', name: 'Viewer' } }] },
                mutationType: { fields: [{ name: 'updateUser', type: { kind: 'OBJECT', name: 'User' } }] },
              },
            },
          }),
        };
      }

      if (String(query).includes('ApiToolsGraphqlTypes')) {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({
            data: {
              __schema: {
                types: [
                  {
                    name: 'User',
                    kind: 'OBJECT',
                    fields: [
                      { name: 'id', description: 'identifier', type: { kind: 'SCALAR', name: 'ID' } },
                      { name: 'profile', description: 'profile', type: { kind: 'OBJECT', name: 'Profile' } },
                    ],
                  },
                  {
                    name: 'Profile',
                    kind: 'OBJECT',
                    fields: [
                      { name: 'displayName', description: 'name', type: { kind: 'SCALAR', name: 'String' } },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }

      return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        bodyText: JSON.stringify({ data: { viewer: { id: '123', token: 'top-secret' } } }),
      };
    }),
  };
}

describe('executeGraphqlAction', () => {
  it('discovers query and mutation operations with optional filters', async () => {
    const client = createClient();
    const result = await executeGraphqlAction({ action: 'discover', filter: 'user' }, undefined, client, createConfig());
    expect(result.details?.status).toBe('success');
    expect(result.details?.data.operations).toEqual([
      { name: 'user', type: 'query', return_type: 'User' },
      { name: 'updateUser', type: 'mutation', return_type: 'User' },
    ]);
  });

  it('returns nested schema fields bounded by max_depth', async () => {
    const client = createClient();
    const result = await executeGraphqlAction({ action: 'schema', name: 'User', max_depth: 2 }, undefined, client, createConfig());
    expect(result.details?.status).toBe('success');
    expect(result.details?.data.fields).toEqual([
      { name: 'id', description: 'identifier', type: 'ID', type_name: 'ID' },
      {
        name: 'profile',
        description: 'profile',
        type: 'Profile',
        type_name: 'Profile',
        fields: [
          { name: 'displayName', description: 'name', type: 'String', type_name: 'String' },
        ],
      },
    ]);
  });

  it('executes queries with variables and redacts response secrets', async () => {
    const client = createClient();
    const result = await executeGraphqlAction({ action: 'execute', query: 'query GetViewer { viewer { id } }', variables: { id: '1' }, operationName: 'GetViewer' }, undefined, client, createConfig());
    expect(client.graphql).toHaveBeenCalledWith(expect.objectContaining({ operationName: 'GetViewer', variables: { id: '1' } }), undefined);
    expect(JSON.stringify(result)).not.toContain('top-secret');
  });
});
