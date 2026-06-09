import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadContext7Config } from '../src/config.js';

describe('loadContext7Config', () => {
  it('uses safe defaults when .pi/context7.json is missing and no API key is present', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'context7-config-missing-'));

    const config = await loadContext7Config({ cwd, env: {}, homeDir: join(cwd, 'home') });

    expect(config.configPath).toBeUndefined();
    expect(config.apiKeyPresent).toBe(false);
    expect(config.defaults).toEqual({ maxChars: 12000, resultLimit: 5 });
    expect(config.cache.enabled).toBe(false);
    expect(config.cache.location).toBe('disabled');
    expect(config.warnings).toEqual([]);
  });

  it('reports CONTEXT7_API_KEY presence without exposing its value', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'context7-config-key-'));

    const config = await loadContext7Config({
      cwd,
      env: { CONTEXT7_API_KEY: 'redaction-sentinel' },
      homeDir: join(cwd, 'home'),
    });

    expect(config.apiKeyPresent).toBe(true);
    expect(JSON.stringify(config)).not.toContain('redaction-sentinel');
  });

  it('falls back for invalid defaults and records warnings', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'context7-config-invalid-'));
    await writeFile(join(cwd, '.pi-context7-placeholder'), '');
    await writeFile(join(cwd, 'context7.json'), '{}');
    await writeFile(join(cwd, 'not-used.json'), '{}');
    await writeFile(join(cwd, '.pi-context7'), '{}');
    await writeFile(join(cwd, 'config.json'), '{}');
    await writeFile(join(cwd, '.context7.json'), '{}');
    await writeFile(join(cwd, '.pi-context7.json'), '{}');
    await writeFile(join(cwd, 'pi-context7.json'), '{}');
    await writeFile(join(cwd, 'context7-config.json'), '{}');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(join(cwd, '.pi'), { recursive: true }));
    await writeFile(join(cwd, '.pi', 'context7.json'), JSON.stringify({
      defaults: { max_chars: 99, result_limit: 99 },
      cache: { ttl_seconds: -1 },
    }));

    const config = await loadContext7Config({ cwd, env: {}, homeDir: join(cwd, 'home') });

    expect(config.defaults).toEqual({ maxChars: 12000, resultLimit: 5 });
    expect(config.cache.ttlSeconds).toBe(86400);
    expect(config.warnings.join('\n')).toContain('defaults.max_chars');
    expect(config.warnings.join('\n')).toContain('defaults.result_limit');
    expect(config.warnings.join('\n')).toContain('cache.ttl_seconds');
  });

  it('ignores suspicious secret-like config keys', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'context7-config-secret-'));
    await import('node:fs/promises').then(({ mkdir }) => mkdir(join(cwd, '.pi'), { recursive: true }));
    await writeFile(join(cwd, '.pi', 'context7.json'), JSON.stringify({
      apiKey: 'redaction-sentinel',
      token: 'redaction-sentinel',
      defaults: { max_chars: 8000, result_limit: 3 },
    }));

    const config = await loadContext7Config({ cwd, env: {}, homeDir: join(cwd, 'home') });

    expect(config.defaults).toEqual({ maxChars: 8000, resultLimit: 3 });
    expect(JSON.stringify(config)).not.toContain('redaction-sentinel');
    expect(config.warnings.join('\n')).toContain('CONTEXT7_API_KEY');
  });

  it('keeps cache disabled by default and resolves enabled cache to a user-local category', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'context7-config-cache-'));
    const xdg = await mkdtemp(join(tmpdir(), 'context7-xdg-'));
    await import('node:fs/promises').then(({ mkdir }) => mkdir(join(cwd, '.pi'), { recursive: true }));
    await writeFile(join(cwd, '.pi', 'context7.json'), JSON.stringify({
      cache: { enabled: true, ttl_seconds: 60 },
    }));

    const config = await loadContext7Config({ cwd, env: { XDG_CACHE_HOME: xdg }, homeDir: join(cwd, 'home') });

    expect(config.cache.enabled).toBe(true);
    expect(config.cache.ttlSeconds).toBe(60);
    expect(config.cache.location).toBe('xdg');
    expect(config.cache.directory).toBe(join(xdg, 'pi', 'context7'));
    expect(config.cache.directory).not.toContain(join(cwd, '.pi'));
  });
});
