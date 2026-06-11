import { describe, expect, it, vi } from 'vitest';
import { Context7ClientError, createContext7Client } from '../src/client.js';

const AUTH_SENTINEL = 'redaction-sentinel';
const TEST_ENV = { CONTEXT7_API_KEY: AUTH_SENTINEL };

describe('context7 sdk wrapper', () => {
  it('constructs the SDK lazily only when a live method is called', async () => {
    const searchLibrary = vi.fn().mockResolvedValue([]);
    const sdkFactory = vi.fn(() => ({ searchLibrary }));
    const client = createContext7Client({ env: TEST_ENV, sdkFactory });

    expect(sdkFactory).not.toHaveBeenCalled();

    await client.searchLibrary({ libraryName: 'react', query: 'hooks', limit: 5 });

    expect(sdkFactory).toHaveBeenCalledOnce();
    expect(sdkFactory).toHaveBeenCalledWith({ apiKey: AUTH_SENTINEL });
  });

  it('throws an actionable missing-key error before constructing the SDK', async () => {
    const sdkFactory = vi.fn();
    const client = createContext7Client({ env: {}, sdkFactory });

    await expect(client.searchLibrary({ libraryName: 'react', query: 'hooks', limit: 5 })).rejects.toMatchObject({
      code: 'missing_api_key',
    });
    expect(sdkFactory).not.toHaveBeenCalled();
  });

  it('calls searchLibrary(query, libraryName, options) and normalizes compact candidates', async () => {
    const searchLibrary = vi.fn().mockResolvedValue([
      {
        id: '/facebook/react',
        name: 'React',
        description: 'UI library',
        totalSnippets: 123,
        trustScore: 9,
        benchmarkScore: 91,
        versions: ['19.0.0'],
      },
      { id: '/ignored/overflow', name: 'Overflow', description: '', totalSnippets: 1, trustScore: 1, benchmarkScore: 1 },
    ]);
    const client = createContext7Client({ env: TEST_ENV, sdkFactory: () => ({ searchLibrary }) });

    const results = await client.searchLibrary({ libraryName: 'react', query: 'hooks', limit: 1 });

    expect(searchLibrary).toHaveBeenCalledWith('hooks', 'react', { type: 'json' });
    expect(results).toEqual([
      {
        id: '/facebook/react',
        name: 'React',
        description: 'UI library',
        totalSnippets: 123,
        trustScore: 9,
        benchmarkScore: 91,
        versions: ['19.0.0'],
      },
    ]);
  });

  it('calls getContext(query, libraryId, options) and normalizes JSON documentation', async () => {
    const getContext = vi.fn().mockResolvedValue([
      { title: 'Hooks', content: 'Use hooks carefully.', source: 'https://react.dev/reference/react' },
    ]);
    const client = createContext7Client({ env: TEST_ENV, sdkFactory: () => ({ getContext }) });

    const docs = await client.getContext({ libraryId: '/facebook/react', query: 'hooks', type: 'json', maxChars: 12000 });

    expect(getContext).toHaveBeenCalledWith('hooks', '/facebook/react', { type: 'json' });
    expect(docs).toEqual({
      libraryId: '/facebook/react',
      query: 'hooks',
      type: 'json',
      snippets: [{ title: 'Hooks', content: 'Use hooks carefully.', source: 'https://react.dev/reference/react' }],
      sources: [{ title: 'Hooks', source: 'https://react.dev/reference/react' }],
    });
  });

  it('normalizes txt documentation responses', async () => {
    const getContext = vi.fn().mockResolvedValue('plain documentation');
    const client = createContext7Client({ env: TEST_ENV, sdkFactory: () => ({ getContext }) });

    const docs = await client.getContext({ libraryId: '/facebook/react', query: 'hooks', type: 'txt', maxChars: 12000 });

    expect(getContext).toHaveBeenCalledWith('hooks', '/facebook/react', { type: 'txt' });
    expect(docs).toEqual({
      libraryId: '/facebook/react',
      query: 'hooks',
      type: 'txt',
      text: 'plain documentation',
      sources: [],
    });
  });

  it('maps Context7-like errors and redacts generic error messages', async () => {
    const authError = Object.assign(new Error(`forbidden for ${AUTH_SENTINEL}`), { name: 'Context7Error', status: 403 });
    const searchLibrary = vi.fn().mockRejectedValueOnce(authError).mockRejectedValueOnce(new Error(`boom ${AUTH_SENTINEL}`));
    const client = createContext7Client({ env: TEST_ENV, sdkFactory: () => ({ searchLibrary }) });

    try {
      await client.searchLibrary({ libraryName: 'react', query: 'hooks', limit: 5 });
      throw new Error('expected search to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Context7ClientError);
      expect(error).toMatchObject({ status: 403 });
    }

    await expect(client.searchLibrary({ libraryName: 'react', query: 'hooks', limit: 5 })).rejects.toThrow('[REDACTED]');
  });
});
