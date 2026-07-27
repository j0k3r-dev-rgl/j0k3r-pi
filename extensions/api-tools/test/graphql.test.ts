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

function createClient(errorMode: 'none' | 'discover-error' | 'execute-error' = 'none'): ApiClient {
  return {
    login: vi.fn(),
    rest: vi.fn(),
    fetchSwaggerDocument: vi.fn(),
    resolveGraphqlUrl: vi.fn(() => 'https://api.example.test/base/graphql'),
    graphql: vi.fn(async ({ query, variables }) => {
      if (String(query).includes('ApiToolsGraphqlDiscoverRoot')) {
        if (errorMode === 'discover-error') {
          return {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            bodyText: JSON.stringify({ errors: [{ message: 'introspection exploded', extensions: { code: 'INTROSPECTION_FAILED' } }] }),
          };
        }
        const root = variables && typeof variables === 'object' ? (variables as Record<string, unknown>).root : undefined;
        const fields = root === 'Mutation'
          ? [{ name: 'updateUser', type: { kind: 'OBJECT', name: 'User' } }]
          : [{ name: 'user', type: { kind: 'OBJECT', name: 'User' } }, { name: 'viewer', type: { kind: 'OBJECT', name: 'Viewer' } }];
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({ data: { __type: { fields } } }),
        };
      }

      if (String(query).includes('ApiToolsGraphqlRootField')) {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({
            data: {
              __type: {
                fields: [
                  { name: 'getUser', description: 'get one user', args: [{ name: 'id', description: 'identifier', defaultValue: null, type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'ID' } } }], type: { kind: 'OBJECT', name: 'User' } },
                ],
              },
            },
          }),
        };
      }

      if (String(query).includes('ApiToolsGraphqlTypeByName')) {
        const name = variables && typeof variables === 'object' ? (variables as Record<string, unknown>).name : undefined;
        const types: Record<string, any> = {
          User: { name: 'User', kind: 'OBJECT', fields: [{ name: 'id', description: 'identifier', type: { kind: 'SCALAR', name: 'ID' } }, { name: 'profile', description: 'profile', type: { kind: 'OBJECT', name: 'Profile' } }] },
          Profile: { name: 'Profile', kind: 'OBJECT', fields: [{ name: 'displayName', description: 'name', type: { kind: 'SCALAR', name: 'String' } }, { name: 'owner', description: 'cycle', type: { kind: 'OBJECT', name: 'User' } }] },
        };
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({ data: { __type: typeof name === 'string' ? (types[name] ?? null) : null } }),
        };
      }

      if (errorMode === 'execute-error') {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({ errors: [{ message: 'field denied', extensions: { code: 'FORBIDDEN' } }] }),
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
  it('discovers compact query and mutation selectors with standard introspection fields only', async () => {
    const client = createClient();
    const result = await executeGraphqlAction({ action: 'discover', filter: 'user' }, undefined, client, createConfig());
    expect(result.status).toBe('success');
    expect(result.records.map((entry) => entry.text)).toEqual([
      'Mutation.updateUser · mutation · auth: unavailable',
      'Query.user · query · auth: unavailable',
    ]);
    for (const [request] of vi.mocked(client.graphql).mock.calls) {
      const query = String(request?.query ?? '');
      expect(query).not.toContain('appliedDirectives');
      expect(query.match(/fields\s*\{/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it('returns visible failure envelopes for introspection and execute errors', async () => {
    const discoverFailure = await executeGraphqlAction({ action: 'discover' }, undefined, createClient('discover-error'), createConfig());
    expect(discoverFailure.status).toBe('failure');
    expect(discoverFailure.failure?.category).toBe('graphql_error');

    const malformedDiscover = await executeGraphqlAction({ action: 'discover' }, undefined, {
      ...createClient(),
      graphql: vi.fn(async ({ query }) => {
        if (String(query).includes('ApiToolsGraphqlDiscoverRoot')) {
          return {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            bodyText: JSON.stringify({ data: {} }),
          };
        }
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({ data: { viewer: { id: '123' } } }),
        };
      }),
    }, createConfig());
    expect(malformedDiscover.status).toBe('failure');
    expect(malformedDiscover.failure?.category).toBe('validation_error');

    const executeFailure = await executeGraphqlAction({ action: 'execute', query: 'query Viewer { viewer { id } }' }, undefined, createClient('execute-error'), createConfig());
    expect(executeFailure.status).toBe('failure');
    expect(executeFailure.failure?.category).toBe('graphql_error');
  });

  it('returns detail and schema with bounded nested fields and unavailable auth metadata', async () => {
    const client = createClient();
    const detail = await executeGraphqlAction({ action: 'detail', operation: 'Query.getUser', max_depth: 2 }, undefined, client, createConfig());
    for (const [request] of vi.mocked(client.graphql).mock.calls) {
      const query = String(request?.query ?? '');
      expect(query).not.toContain('appliedDirectives');
      expect(query.match(/fields\s*\{/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
    const detailText = detail.records.map((entry) => entry.text).join('\n');
    expect(detailText).toContain('query Query.getUser');
    expect(detailText).toContain('argument id: ID!');
    expect(detailText).toContain('field profile: Profile');
    expect(detailText).toContain('cycle_reference');
    expect(detailText).toContain('authorization: unavailable');

    const schema = await executeGraphqlAction({ action: 'schema', name: 'User', max_depth: 2 }, undefined, client, createConfig());
    expect(schema.records[0].text).toContain('type User: OBJECT');
  });
});
