import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadApiConfig } from '../src/config.js';
import type { ApiJsonGitInspector } from '../src/types.js';

function gitInspector(state: 'ignored' | 'unignored_untracked' | 'tracked' | 'unknown'): ApiJsonGitInspector {
  return {
    inspectApiJson: async () => ({ state }),
  };
}

async function writeApiJson(root: string, content: string): Promise<void> {
  await mkdir(join(root, '.pi'), { recursive: true });
  await writeFile(join(root, '.pi', 'api.json'), content, 'utf8');
}

describe('loadApiConfig', () => {
  it('returns disabled config when api.json is missing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-'));

    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('unknown') });

    expect(config.configPath).toBe(join(cwd, '.pi', 'api.json'));
    expect(config.exists).toBe(false);
    expect(config.enabled).toBe(false);
    expect(config.warnings).toEqual([]);
  });

  it('does not read parent directories or global locations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'api-tools-config-parent-'));
    const child = join(root, 'packages', 'child');
    await mkdir(child, { recursive: true });
    await writeApiJson(root, JSON.stringify({ enabled: true, url: 'https://parent.example.test' }));

    const config = await loadApiConfig({ cwd: child, gitInspector: gitInspector('unknown') });

    expect(config.exists).toBe(false);
    expect(config.enabled).toBe(false);
  });

  it('requires enabled to be exactly true', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-disabled-'));
    await writeApiJson(cwd, JSON.stringify({ enabled: false, url: 'https://api.example.test' }));

    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('ignored') });

    expect(config.exists).toBe(true);
    expect(config.enabled).toBe(false);
    expect(config.git.state).toBe('ignored');
  });

  it('loads enabled config with safe defaults and collected secrets', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-enabled-'));
    await writeApiJson(
      cwd,
      JSON.stringify({
        enabled: true,
        url: 'https://api.example.test',
        graphql_url: 'https://api.example.test/graphql',
        headers: { 'x-project-client': 'pi', authorization: 'Bearer top-secret' },
        auth: { type: 'bearer', token: 'top-secret' },
      }),
    );

    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('tracked') });

    expect(config.enabled).toBe(true);
    expect(config.url).toBe('https://api.example.test');
    expect(config.graphqlUrl).toBe('https://api.example.test/graphql');
    expect(config.timeoutMs).toBe(30000);
    expect(config.limits).toEqual({ maxResponseBytes: 50000, maxResponseLines: 2000 });
    expect(config.secretValues).toContain('top-secret');
    expect(config.secretValues).toContain('Bearer top-secret');
    expect(config.warnings.map((warning) => warning.code)).toContain('limit_default_applied');
    expect(JSON.stringify(config.warnings)).not.toContain('top-secret');
    expect(config.git.state).toBe('tracked');
  });

  it('emits invalid_config for invalid json without exposing raw content', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-invalid-json-'));
    await writeApiJson(cwd, '{"enabled": true, "auth": {"type": "bearer", "token": "top-secret" }');

    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('unknown') });

    expect(config.exists).toBe(true);
    expect(config.enabled).toBe(false);
    expect(config.warnings.map((warning) => warning.code)).toContain('invalid_config');
    expect(JSON.stringify(config.warnings)).not.toContain('top-secret');
  });

  it('falls back on invalid limits and warns safely', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-limits-'));
    await writeApiJson(
      cwd,
      JSON.stringify({
        enabled: true,
        url: 'https://api.example.test',
        limits: { max_response_bytes: -10, max_response_lines: 'many' },
      }),
    );

    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('ignored') });

    expect(config.enabled).toBe(true);
    expect(config.limits).toEqual({ maxResponseBytes: 50000, maxResponseLines: 2000 });
    expect(config.warnings.map((warning) => warning.code)).toContain('limit_fallback_applied');
  });

  it('loads login auth config with access_token persistence fields and collected secrets', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-login-'));
    await writeApiJson(
      cwd,
      JSON.stringify({
        enabled: true,
        url: 'https://api.example.test',
        auth: { type: 'login', login_path: '/auth/login', username: 'test-user', password: 'test-password', access_token: 'persisted-token' },
      }),
    );

    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('ignored') });

    expect(config.auth).toEqual({ type: 'login', login_path: '/auth/login', username: 'test-user', password: 'test-password', access_token: 'persisted-token' });
    expect(config.secretValues).toContain('test-password');
    expect(config.secretValues).toContain('persisted-token');
  });

  it('warns for unsupported auth metadata without leaking values', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-auth-'));
    await writeApiJson(
      cwd,
      JSON.stringify({
        enabled: true,
        url: 'https://api.example.test',
        auth: { type: 'oauth2', token: 'top-secret' },
      }),
    );

    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('unknown') });

    expect(config.auth).toEqual({ type: 'none' });
    expect(config.warnings.map((warning) => warning.code)).toContain('unsupported_auth_metadata');
    expect(JSON.stringify(config.warnings)).not.toContain('top-secret');
  });
});
