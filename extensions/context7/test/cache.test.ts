import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  createCacheKey,
  createContext7Cache,
  createDisabledContext7Cache,
  resolveUserCacheDirectory,
} from '../src/cache.js';

describe('context7 cache internals', () => {
  it('keeps the disabled cache inert', async () => {
    const cache = createDisabledContext7Cache();
    const key = createCacheKey('search', { libraryName: 'react', query: 'hooks', limit: 5 });

    await expect(cache.get(key)).resolves.toEqual({ hit: false });
    await expect(cache.set(key, { value: 'ignored' }, 60)).resolves.toBeUndefined();
    await expect(cache.get(key)).resolves.toEqual({ hit: false });
  });

  it('selects the XDG user-local cache directory when XDG_CACHE_HOME is set', () => {
    const resolved = resolveUserCacheDirectory({
      cwd: '/repo/project',
      env: { XDG_CACHE_HOME: '/tmp/xdg-cache' },
      homeDir: '/home/user',
    });

    expect(resolved).toEqual({ directory: '/tmp/xdg-cache/pi/context7', location: 'xdg' });
  });

  it('falls back to ~/.cache/pi/context7 when XDG_CACHE_HOME is absent', () => {
    const resolved = resolveUserCacheDirectory({ cwd: '/repo/project', env: {}, homeDir: '/home/user' });

    expect(resolved).toEqual({ directory: '/home/user/.cache/pi/context7', location: 'home' });
  });

  it('disables file cache when the directory would be inside the repository', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'context7-cache-repo-'));
    const cache = createContext7Cache({
      enabled: true,
      directory: join(cwd, '.cache', 'pi', 'context7'),
      repositoryRoot: cwd,
    });

    expect(cache.enabled).toBe(false);
    expect(cache.warnings.join('\n')).toContain('inside the repository');
    await expect(cache.cache.get(createCacheKey('search', { query: 'x' }))).resolves.toEqual({ hit: false });
  });

  it('builds non-secret stable cache keys', () => {
    const key = createCacheKey('search', {
      libraryName: 'react',
      query: 'hooks',
      limit: 5,
      CONTEXT7_API_KEY: 'redaction-sentinel',
      apiKey: 'redaction-sentinel',
    });

    expect(key.raw).toContain('react');
    expect(key.raw).toContain('hooks');
    expect(key.raw).not.toContain('CONTEXT7_API_KEY');
    expect(key.raw).not.toContain('redaction-sentinel');
    expect(key.filename).toMatch(/^[a-f0-9]{64}\.json$/);
  });

  it('returns fresh hits, expires old entries, and writes the expected JSON entry format', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'context7-cache-files-'));
    const { cache } = createContext7Cache({ enabled: true, directory, repositoryRoot: await mkdtemp(join(tmpdir(), 'context7-cache-repo-root-')) });
    const key = createCacheKey('get-context', { libraryId: '/facebook/react', query: 'hooks', type: 'json' });
    const now = Date.parse('2026-06-09T00:00:00.000Z');

    await cache.set(key, { docs: ['ok'] }, 60, now);

    await expect(cache.get(key, now + 30_000)).resolves.toEqual({ hit: true, value: { docs: ['ok'] } });
    await expect(cache.get(key, now + 61_000)).resolves.toEqual({ hit: false });

    const rawEntry = JSON.parse(await readFile(join(directory, key.filename), 'utf8'));
    expect(rawEntry).toMatchObject({
      version: 1,
      key: key.raw,
      value: { docs: ['ok'] },
    });
    expect(rawEntry.createdAt).toBe('2026-06-09T00:00:00.000Z');
    expect(rawEntry.expiresAt).toBe('2026-06-09T00:01:00.000Z');
  });
});
