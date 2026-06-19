import { describe, expect, it, vi } from 'vitest';
import { loadWebsearchConfig, WEBSEARCH_CONFIG_PATH } from '../src/config.js';

describe('websearch global config', () => {
  it('defaults github provider to api when the global config file is missing', () => {
    const config = loadWebsearchConfig({
      homedir: () => '/home/tester',
      existsSync: () => false,
      readFileSync: vi.fn(),
    });

    expect(config).toEqual({
      github: { provider: 'api' },
      request: { timeoutMs: 120_000, maxRetries: 1 },
    });
  });

  it('loads github provider api or gh from ~/.pi/agent/websearch.json', () => {
    const apiConfig = loadWebsearchConfig({
      homedir: () => '/home/tester',
      existsSync: (path) => path === '/home/tester/.pi/agent/websearch.json',
      readFileSync: () => JSON.stringify({ github: { provider: 'api' } }),
    });
    const ghConfig = loadWebsearchConfig({
      homedir: () => '/home/tester',
      existsSync: (path) => path === '/home/tester/.pi/agent/websearch.json',
      readFileSync: () => JSON.stringify({ github: { provider: 'gh' } }),
    });

    expect(apiConfig.github.provider).toBe('api');
    expect(ghConfig.github.provider).toBe('gh');
    expect(apiConfig.request).toEqual({ timeoutMs: 120_000, maxRetries: 1 });
  });

  it('loads request timeout and max retries from ~/.pi/agent/websearch.json', () => {
    const config = loadWebsearchConfig({
      homedir: () => '/home/tester',
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ request: { timeoutMs: 30_000, maxRetries: 3 } }),
    });

    expect(config.request).toEqual({ timeoutMs: 30_000, maxRetries: 3 });
  });

  it('rejects invalid json and invalid github provider values', () => {
    expect(() => loadWebsearchConfig({
      homedir: () => '/home/tester',
      existsSync: () => true,
      readFileSync: () => '{ nope',
    })).toThrow(/invalid websearch config json/i);

    expect(() => loadWebsearchConfig({
      homedir: () => '/home/tester',
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ github: { provider: 'github-cli' } }),
    })).toThrow(/github\.provider must be "api" or "gh"/i);
  });

  it('rejects invalid request timeout and max retries values', () => {
    expect(() => loadWebsearchConfig({
      homedir: () => '/home/tester',
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ request: { timeoutMs: 999 } }),
    })).toThrow(/request\.timeoutMs must be an integer between 1000 and 300000/i);

    expect(() => loadWebsearchConfig({
      homedir: () => '/home/tester',
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ request: { maxRetries: -1 } }),
    })).toThrow(/request\.maxRetries must be an integer between 0 and 5/i);
  });

  it('uses only the global config path and ignores project config paths', () => {
    const existsSync = vi.fn((path: string) => path === '/workspace/.pi/websearch.json');
    const readFileSync = vi.fn();

    const config = loadWebsearchConfig({
      homedir: () => '/home/tester',
      existsSync,
      readFileSync,
    });

    expect(WEBSEARCH_CONFIG_PATH('/home/tester')).toBe('/home/tester/.pi/agent/websearch.json');
    expect(existsSync).toHaveBeenCalledWith('/home/tester/.pi/agent/websearch.json');
    expect(readFileSync).not.toHaveBeenCalled();
    expect(config.github.provider).toBe('api');
    expect(config.request).toEqual({ timeoutMs: 120_000, maxRetries: 1 });
  });
});
