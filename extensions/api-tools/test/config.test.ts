import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadApiConfig } from '../src/config.js';
import type { ApiJsonGitInspector } from '../src/types.js';

function gitInspector(state: 'ignored' | 'unignored_untracked' | 'tracked' | 'unknown'): ApiJsonGitInspector {
  return { inspectApiJson: async () => ({ state }) };
}

async function writeApiJson(root: string, content: string): Promise<void> {
  await mkdir(join(root, '.pi'), { recursive: true });
  await writeFile(join(root, '.pi', 'api.json'), content, 'utf8');
}

describe('loadApiConfig', () => {
  it('returns disabled config when api.json is missing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-'));
    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('unknown') });
    expect(config.exists).toBe(false);
    expect(config.enabled).toBe(false);
    expect(config.swagger.enabled).toBe(false);
    expect(config.graphql.enabled).toBe(false);
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

  it('loads independent swagger and graphql blocks with defaults and collected secrets', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-enabled-'));
    await writeApiJson(cwd, JSON.stringify({
      enabled: true,
      url: 'https://api.example.test/base/',
      graphql_url: 'https://api.example.test/base/graphql',
      swagger: { enabled: true, framework: 'spring' },
      graphql: { enabled: true, framework: 'node' },
      headers: { authorization: 'Bearer top-secret' },
      auth: { type: 'bearer', token: 'top-secret' },
    }));

    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('tracked') });

    expect(config.enabled).toBe(true);
    expect(config.swagger).toMatchObject({ configured: true, enabled: true, framework: 'spring', valid: true });
    expect(config.graphql).toMatchObject({ configured: true, enabled: true, framework: 'node', valid: true });
    expect(config.secretValues).toContain('top-secret');
    expect(config.warnings.map((warning) => warning.code)).toContain('limit_default_applied');
  });

  it('keeps graphql_url as a fallback source without enabling graphql by itself', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-graphql-fallback-'));
    await writeApiJson(cwd, JSON.stringify({ enabled: true, url: 'https://api.example.test', graphql_url: 'https://api.example.test/graphql' }));
    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('ignored') });
    expect(config.graphqlUrl).toBe('https://api.example.test/graphql');
    expect(config.graphql.enabled).toBe(false);
    expect(config.graphql.configured).toBe(false);
  });

  it('marks enabled blocks without framework as invalid and warns safely', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-invalid-blocks-'));
    await writeApiJson(cwd, JSON.stringify({
      enabled: true,
      url: 'https://api.example.test',
      swagger: { enabled: true },
      graphql: { enabled: true, framework: 'dotnet' },
    }));
    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('ignored') });
    expect(config.swagger.valid).toBe(false);
    expect(config.graphql.valid).toBe(false);
    expect(config.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['invalid_swagger_config', 'invalid_graphql_config', 'limit_default_applied']));
  });

  it('falls back on invalid limits and clamps cursor ttl safely', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'api-tools-config-limits-'));
    await writeApiJson(cwd, JSON.stringify({
      enabled: true,
      url: 'https://api.example.test',
      limits: { max_response_bytes: -10, max_response_lines: 999999, cursor_ttl_seconds: 999999 },
    }));
    const config = await loadApiConfig({ cwd, gitInspector: gitInspector('ignored') });
    expect(config.limits.maxResponseBytes).toBe(50000);
    expect(config.limits.maxResponseLines).toBe(2000);
    expect(config.limits.cursorTtlSeconds).toBe(86400);
    expect(config.warnings.map((warning) => warning.code)).toContain('limit_fallback_applied');
  });
});
