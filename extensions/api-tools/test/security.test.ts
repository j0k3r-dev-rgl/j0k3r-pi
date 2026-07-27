import { describe, expect, it } from 'vitest';
import { applyOutputTruncation, clampCursorTtlSeconds, collectConfiguredSecrets, extractGraphqlAuthorizationMetadata, extractOpenApiAuthorizationMetadata, getAuthMetadataStatus, redactToolResult } from '../src/security.js';
import type { ApiToolResult } from '../src/types.js';

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('api-tools security helpers', () => {
  it('collects configured secrets and redacts content, details, and paths', () => {
    const secrets = collectConfiguredSecrets({ headers: { authorization: 'Bearer top-secret', 'x-project-client': 'pi' }, auth: { type: 'basic', username: 'demo', password: 'top-secret-password' } });
    const result: ApiToolResult = { content: [{ type: 'text', text: 'token: top-secret-password\nAuthorization: Bearer top-secret\n/home/demo/project' }], details: { nested: { api_key: 'top-secret-password' }, error: 'password=top-secret-password' } as any };
    const redacted = redactToolResult(result, secrets);
    expect(redacted.content[0]?.text).toContain('[REDACTED]');
    expect(JSON.stringify(redacted.details)).toContain('[REDACTED]');
    expect(redacted.content[0]?.text).not.toContain('/home/demo/project');
  });

  it('reports valid and expired jwt exp locally without exposing token content', () => {
    const validToken = createJwt({ exp: Math.floor(new Date('2026-06-23T00:00:00.000Z').getTime() / 1000), sub: 'user-1' });
    const expiredToken = createJwt({ exp: Math.floor(new Date('2026-06-21T00:00:00.000Z').getTime() / 1000), sub: 'user-2' });
    const now = () => new Date('2026-06-22T00:00:00.000Z');
    expect(getAuthMetadataStatus({ type: 'bearer', token: validToken }, { now }).status).toBe('valid');
    expect(getAuthMetadataStatus({ type: 'bearer', token: expiredToken }, { now }).status).toBe('expired');
  });

  it('extracts bounded allowlisted OpenAPI and GraphQL auth metadata', () => {
    const openapi = extractOpenApiAuthorizationMetadata({
      document: { components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } } },
      effectiveSecurity: [{ bearerAuth: ['items:read'] }],
      sources: [{ 'x-roles': ['admin', 'owner'], 'x-permissions': Array.from({ length: 40 }, (_, index) => `perm-${index}`), 'x-authorities': { admin: true } }],
    });
    expect(openapi.state).toBe('declared');
    expect(openapi.roles).toEqual(['admin', 'owner']);
    expect(openapi.permissions).toHaveLength(32);
    expect(openapi.unsupported_metadata).toBe(true);

    const unavailable = extractGraphqlAuthorizationMetadata(undefined);
    expect(unavailable.state).toBe('unavailable');

    const declared = extractGraphqlAuthorizationMetadata([{ name: 'roles', arguments: { allowed: ['admin', 'owner'] } }]);
    expect(declared.state).toBe('declared');
    expect(declared.roles).toEqual(['admin', 'owner']);
  });

  it('preserves schema-like field names and clamps budgets safely', () => {
    const result: ApiToolResult = { content: [{ type: 'text', text: '{"apiKey":null}' }] };
    const redacted = redactToolResult(result, ['different-secret']);
    expect(redacted.content[0].text).toContain('apiKey');
    const truncated = applyOutputTruncation(['alpha', 'beta', 'gamma', 'delta'].join('\n'), { maxResponseBytes: 0, maxResponseLines: 999999 });
    expect(truncated.metadata.limit_bytes).toBe(50000);
    expect(truncated.metadata.limit_lines).toBe(2000);
    expect(clampCursorTtlSeconds(999999)).toBe(86400);
  });
});
