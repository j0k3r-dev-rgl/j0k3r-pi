import { describe, expect, it } from 'vitest';
import {
  applyOutputTruncation,
  collectConfiguredSecrets,
  getAuthMetadataStatus,
  redactToolResult,
} from '../src/security.js';
import type { ApiToolResult } from '../src/types.js';

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('api-tools security helpers', () => {
  it('collects configured secrets and redacts content, details, and errors', () => {
    const secrets = collectConfiguredSecrets({
      headers: { authorization: 'Bearer top-secret', 'x-project-client': 'pi' },
      auth: { type: 'basic', username: 'demo', password: 'top-secret-password' },
    });
    const result: ApiToolResult = {
      content: [{ type: 'text', text: 'token: top-secret-password\nAuthorization: Bearer top-secret' }],
      details: {
        nested: { api_key: 'top-secret-password' },
        error: 'password=top-secret-password',
      },
    };

    const redacted = redactToolResult(result, secrets);

    expect(secrets).toContain('Bearer top-secret');
    expect(secrets).toContain('top-secret-password');
    expect(redacted.content[0]?.text).not.toContain('top-secret');
    expect(JSON.stringify(redacted.details)).not.toContain('top-secret');
    expect(redacted.content[0]?.text).toContain('[REDACTED]');
    expect(JSON.stringify(redacted.details)).toContain('[REDACTED]');
  });

  it('reports valid and expired jwt exp locally without exposing token content', () => {
    const validToken = createJwt({ exp: Math.floor(new Date('2026-06-23T00:00:00.000Z').getTime() / 1000), sub: 'user-1' });
    const expiredToken = createJwt({ exp: Math.floor(new Date('2026-06-21T00:00:00.000Z').getTime() / 1000), sub: 'user-2' });
    const now = () => new Date('2026-06-22T00:00:00.000Z');

    const valid = getAuthMetadataStatus({ type: 'bearer', token: validToken }, { now });
    const expired = getAuthMetadataStatus({ type: 'bearer', token: expiredToken }, { now });
    const loginValid = getAuthMetadataStatus({ type: 'login', login_path: '/auth/login', username: 'test', password: 'test', access_token: validToken }, { now });

    expect(valid.status).toBe('valid');
    expect(valid.expiresAt).toBe('2026-06-23T00:00:00.000Z');
    expect(valid.secondsRemaining).toBe(86400);
    expect(expired.status).toBe('expired');
    expect(expired.expiresAt).toBe('2026-06-21T00:00:00.000Z');
    expect(expired.secondsRemaining).toBe(0);
    expect(loginValid.status).toBe('valid');
    expect(JSON.stringify(valid)).not.toContain(validToken);
    expect(JSON.stringify(expired)).not.toContain(expiredToken);
    expect(JSON.stringify(loginValid)).not.toContain(validToken);
  });

  it('reports unknown for malformed jwt and unsupported auth metadata', () => {
    const malformed = getAuthMetadataStatus({ type: 'bearer', token: 'not-a-jwt' }, { now: () => new Date('2026-06-22T00:00:00.000Z') });
    const unsupported = getAuthMetadataStatus({ type: 'headers', headers: { authorization: 'Bearer anything' } }, { now: () => new Date('2026-06-22T00:00:00.000Z') });

    expect(malformed.status).toBe('unknown');
    expect(unsupported.status).toBe('unknown');
    expect(unsupported.warning?.code).toBe('unsupported_auth_metadata');
  });

  it('applies truncation metadata for default, configured, and fallback limits', () => {
    const text = ['alpha', 'beta', 'gamma', 'delta'].join('\n');

    const defaults = applyOutputTruncation(text);
    const configured = applyOutputTruncation(text, { maxResponseBytes: 8, maxResponseLines: 2 });
    const fallback = applyOutputTruncation(text, { maxResponseBytes: 0, maxResponseLines: -1 });

    expect(defaults.metadata).toMatchObject({
      truncated: false,
      limit_bytes: 50000,
      limit_lines: 2000,
      original_bytes_known: true,
      original_lines_known: true,
    });
    expect(configured.metadata.truncated).toBe(true);
    expect(configured.metadata.limit_bytes).toBe(8);
    expect(configured.metadata.limit_lines).toBe(2);
    expect(configured.metadata.reason).toBe('byte_and_line_limit');
    expect(configured.text).toBe('alpha\nbe');
    expect(fallback.metadata.limit_bytes).toBe(50000);
    expect(fallback.metadata.limit_lines).toBe(2000);
  });
});
