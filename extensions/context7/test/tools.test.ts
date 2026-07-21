import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import context7Extension from '../index.js';
import { CONTEXT7_TOOL_NAMES, registerContext7Tools } from '../src/tools.js';
import type { Context7RuntimeConfig, LibraryCandidate } from '../src/types.js';

function createMockPi() {
  const tools: any[] = [];
  return {
    tools,
    registerTool(tool: any) {
      tools.push(tool);
    },
  };
}

function baseConfig(overrides: Partial<Context7RuntimeConfig> = {}): Context7RuntimeConfig {
  return {
    apiKeyPresent: true,
    cache: { enabled: false, ttlSeconds: 86400, location: 'disabled' },
    defaults: { maxChars: 12000, resultLimit: 5 },
    warnings: [],
    ...overrides,
  };
}

function registerWithDeps(deps: Record<string, unknown>) {
  const pi = createMockPi();
  (registerContext7Tools as any)(pi, deps);
  return pi;
}

function toolByName(pi: ReturnType<typeof createMockPi>, name: string) {
  return pi.tools.find((tool) => tool.name === name);
}

async function executeTool(tool: any, params: unknown, ctx: Record<string, unknown> = {}) {
  return tool.execute('tool-call', params, undefined, undefined, {
    cwd: await mkdtemp(join(tmpdir(), 'context7-tools-cwd-')),
    env: { CONTEXT7_API_KEY: 'redaction-sentinel' },
    ...ctx,
  });
}

const reactCandidate: LibraryCandidate = {
  id: '/facebook/react',
  name: 'React',
  description: 'UI library',
  totalSnippets: 123,
  trustScore: 9,
  benchmarkScore: 91,
  versions: ['19.0.0'],
};

describe('context7 tool registration', () => {
  it('registers the four public Context7 tools with object schemas', () => {
    const pi = createMockPi();

    context7Extension(pi);

    expect(pi.tools.map((tool) => tool.name)).toEqual(CONTEXT7_TOOL_NAMES);
    for (const tool of pi.tools) {
      expect(tool.parameters?.type).toBe('object');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.execute).toBe('function');
      expect(typeof tool.renderCall).toBe('function');
      expect(typeof tool.renderResult).toBe('function');
    }
  });

  it('registers expected parameter fields for foundation schemas', () => {
    const pi = createMockPi();

    context7Extension(pi);

    const byName = Object.fromEntries(pi.tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName.context7_status.parameters.properties ?? {})).toEqual([]);
    expect(Object.keys(byName.context7_search_library.parameters.properties)).toEqual(['libraryName', 'query', 'limit']);
    expect(Object.keys(byName.context7_get_context.parameters.properties)).toEqual(['libraryId', 'query', 'type', 'max_chars']);
    expect(Object.keys(byName.context7_resolve_and_get_context.parameters.properties)).toEqual(['libraryName', 'query', 'version', 'max_chars']);
  });

  it('executes context7_status without exposing an API key value', async () => {
    const pi = createMockPi();
    const cwd = await mkdtemp(join(tmpdir(), 'context7-tools-status-'));
    context7Extension(pi);
    const statusTool = pi.tools.find((tool) => tool.name === 'context7_status');

    const result = await statusTool.execute('tool-call', {}, undefined, undefined, {
      cwd,
      env: { CONTEXT7_API_KEY: 'redaction-sentinel' },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).toContain('apiKeyPresent');
    expect(serialized).toContain('cache');
    expect(serialized).not.toContain('redaction-sentinel');
  });
});

describe('context7_status public behavior', () => {
  it('does not construct the SDK when the API key is absent', async () => {
    const createClient = vi.fn();
    const pi = registerWithDeps({
      createClient,
      loadConfig: vi.fn().mockResolvedValue(baseConfig({ apiKeyPresent: false })),
    });

    const result = await executeTool(toolByName(pi, 'context7_status'), {}, { env: {} });

    expect(createClient).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('CONTEXT7_API_KEY');
    expect(result.details.apiKeyPresent).toBe(false);
  });
});

describe('context7_search_library public behavior', () => {
  it('validates required libraryName and query fields', async () => {
    const pi = registerWithDeps({ loadConfig: vi.fn().mockResolvedValue(baseConfig()) });
    const searchTool = toolByName(pi, 'context7_search_library');

    await expect(executeTool(searchTool, { libraryName: '  ', query: 'hooks' })).rejects.toThrow('libraryName is required');
    await expect(executeTool(searchTool, { libraryName: 'react', query: '' })).rejects.toThrow('query is required');
  });

  it('applies the requested limit and returns compact candidates', async () => {
    const searchLibrary = vi.fn().mockResolvedValue([reactCandidate]);
    const pi = registerWithDeps({
      client: { searchLibrary },
      loadConfig: vi.fn().mockResolvedValue(baseConfig()),
    });

    const result = await executeTool(toolByName(pi, 'context7_search_library'), {
      libraryName: 'react',
      query: 'hooks',
      limit: 1,
    });

    expect(searchLibrary).toHaveBeenCalledWith({ libraryName: 'react', query: 'hooks', limit: 1 }, undefined);
    expect(result.content[0].text).toContain('/facebook/react');
    expect(result.details.results).toEqual([reactCandidate]);
    expect(result.details.cache).toMatchObject({ enabled: false, hit: false });
  });

  it('truncates long candidate descriptions in search output and details', async () => {
    const longDescription = `start-${'a'.repeat(900)}-end`;
    const candidate = { ...reactCandidate, description: longDescription };
    const pi = registerWithDeps({
      client: { searchLibrary: vi.fn().mockResolvedValue([candidate]) },
      loadConfig: vi.fn().mockResolvedValue(baseConfig()),
    });

    const result = await executeTool(toolByName(pi, 'context7_search_library'), {
      libraryName: 'react',
      query: 'hooks',
    });

    expect(result.content[0].text).toContain('[truncated: showing');
    expect(result.content[0].text).toContain('start-');
    expect(result.content[0].text).not.toContain('-end');
    expect((result.details.results as LibraryCandidate[])[0].description).toContain('[truncated: showing');
    expect((result.details.results as LibraryCandidate[])[0].description).not.toContain('-end');
    expect(result.details.artifact).toMatchObject({ kind: 'file', mediaType: 'text/plain' });
    expect(result.content[0].text).toContain(result.details.artifact.path);
    await expect(readFile(result.details.artifact.path, 'utf8')).resolves.toContain('-end');
  });

  it('uses cache when enabled and returns cached search results without calling the client', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue({ hit: true, value: [reactCandidate] }),
      set: vi.fn(),
    };
    const searchLibrary = vi.fn();
    const pi = registerWithDeps({
      cache,
      client: { searchLibrary },
      loadConfig: vi.fn().mockResolvedValue(baseConfig({
        cache: { enabled: true, ttlSeconds: 60, location: 'xdg', directory: '/tmp/pi/context7' },
      })),
    });

    const result = await executeTool(toolByName(pi, 'context7_search_library'), {
      libraryName: 'react',
      query: 'hooks',
    });

    expect(cache.get).toHaveBeenCalledOnce();
    expect(cache.set).not.toHaveBeenCalled();
    expect(searchLibrary).not.toHaveBeenCalled();
    expect(result.details.cache).toMatchObject({ enabled: true, hit: true });
    expect(result.details.results).toEqual([reactCandidate]);
  });

  it('returns no-results guidance as a successful response', async () => {
    const pi = registerWithDeps({
      client: { searchLibrary: vi.fn().mockResolvedValue([]) },
      loadConfig: vi.fn().mockResolvedValue(baseConfig()),
    });

    const result = await executeTool(toolByName(pi, 'context7_search_library'), {
      libraryName: 'missing-lib',
      query: 'usage',
    });

    expect(result.content[0].text).toContain('No Context7 libraries found');
    expect(result.content[0].text).toContain('more specific');
    expect(result.details.results).toEqual([]);
  });

  it('redacts authentication failures from the client', async () => {
    const pi = registerWithDeps({
      client: { searchLibrary: vi.fn().mockRejectedValue(Object.assign(new Error('denied redaction-sentinel'), { status: 403 })) },
      loadConfig: vi.fn().mockResolvedValue(baseConfig()),
    });

    await expect(executeTool(toolByName(pi, 'context7_search_library'), {
      libraryName: 'react',
      query: 'hooks',
    })).rejects.toThrow('[REDACTED]');
  });
});

describe('context7_get_context public behavior', () => {
  it('validates libraryId, query, and supported response type', async () => {
    const pi = registerWithDeps({ loadConfig: vi.fn().mockResolvedValue(baseConfig()) });
    const getTool = toolByName(pi, 'context7_get_context');

    await expect(executeTool(getTool, { libraryId: ' ', query: 'hooks' })).rejects.toThrow('libraryId is required');
    await expect(executeTool(getTool, { libraryId: '/facebook/react', query: '' })).rejects.toThrow('query is required');
    await expect(executeTool(getTool, { libraryId: '/facebook/react', query: 'hooks', type: 'xml' })).rejects.toThrow('type must be one of json, txt');
  });

  it('defaults to json and returns compact snippets with source metadata', async () => {
    const getContext = vi.fn().mockResolvedValue({
      libraryId: '/facebook/react',
      query: 'hooks',
      type: 'json',
      snippets: [{ title: 'Hooks', content: 'Use hooks carefully.', source: 'react docs', sourceUrl: 'https://react.dev/reference/react' }],
      sources: [{ title: 'Hooks', source: 'react docs', sourceUrl: 'https://react.dev/reference/react' }],
    });
    const pi = registerWithDeps({
      client: { searchLibrary: vi.fn(), getContext },
      loadConfig: vi.fn().mockResolvedValue(baseConfig()),
    });

    const result = await executeTool(toolByName(pi, 'context7_get_context'), {
      libraryId: '/facebook/react',
      query: 'hooks',
    });

    expect(getContext).toHaveBeenCalledWith({ libraryId: '/facebook/react', query: 'hooks', type: 'json', maxChars: 12000 }, undefined);
    expect(result.content[0].text).toContain('Hooks');
    expect(result.details.documentation).toMatchObject({
      libraryId: '/facebook/react',
      query: 'hooks',
      type: 'json',
      snippets: [{ title: 'Hooks', content: 'Use hooks carefully.', source: 'react docs' }],
      sources: [{ title: 'Hooks', source: 'react docs', sourceUrl: 'https://react.dev/reference/react' }],
    });
    expect(result.details.truncation).toMatchObject({ truncated: false });
  });

  it('returns bounded txt documentation with truncation metadata', async () => {
    const getContext = vi.fn().mockResolvedValue({
      libraryId: '/facebook/react',
      query: 'hooks',
      type: 'txt',
      text: 'a'.repeat(1200),
      sources: [],
    });
    const pi = registerWithDeps({
      client: { searchLibrary: vi.fn(), getContext },
      loadConfig: vi.fn().mockResolvedValue(baseConfig()),
    });

    const result = await executeTool(toolByName(pi, 'context7_get_context'), {
      libraryId: '/facebook/react',
      query: 'hooks',
      type: 'txt',
      max_chars: 1000,
    });

    expect(result.content[0].text).toContain('[truncated: showing');
    expect(result.details.truncation).toMatchObject({ truncated: true, originalChars: 1200 });
    expect(result.details.artifact).toMatchObject({ kind: 'file', mediaType: 'text/plain' });
    expect(result.details.artifact.chars).toBeGreaterThan(1200);
    expect(result.content[0].text).toContain(result.details.artifact.path);
    await expect(readFile(result.details.artifact.path, 'utf8')).resolves.toContain('a'.repeat(1200));
    expect(JSON.stringify(result)).not.toContain('redaction-sentinel');
  });

  it('uses cache for get-context responses when enabled', async () => {
    const cachedDocs = {
      libraryId: '/facebook/react',
      query: 'hooks',
      type: 'json' as const,
      snippets: [{ title: 'Cached', content: 'Cached docs', source: 'cache' }],
      sources: [{ title: 'Cached', source: 'cache' }],
    };
    const cache = {
      get: vi.fn().mockResolvedValue({ hit: true, value: cachedDocs }),
      set: vi.fn(),
    };
    const getContext = vi.fn();
    const pi = registerWithDeps({
      cache,
      client: { searchLibrary: vi.fn(), getContext },
      loadConfig: vi.fn().mockResolvedValue(baseConfig({
        cache: { enabled: true, ttlSeconds: 60, location: 'xdg', directory: '/tmp/pi/context7' },
      })),
    });

    const result = await executeTool(toolByName(pi, 'context7_get_context'), {
      libraryId: '/facebook/react',
      query: 'hooks',
    });

    expect(cache.get).toHaveBeenCalledOnce();
    expect(getContext).not.toHaveBeenCalled();
    expect(result.details.cache).toMatchObject({ enabled: true, hit: true });
    expect(result.details.documentation).toMatchObject({ snippets: [{ title: 'Cached', content: 'Cached docs' }] });
  });

  it('returns missing-library guidance without exposing secrets', async () => {
    const pi = registerWithDeps({
      client: { searchLibrary: vi.fn(), getContext: vi.fn().mockRejectedValue(Object.assign(new Error('not found redaction-sentinel'), { status: 404 })) },
      loadConfig: vi.fn().mockResolvedValue(baseConfig()),
    });

    await expect(executeTool(toolByName(pi, 'context7_get_context'), {
      libraryId: '/missing/lib',
      query: 'usage',
    })).rejects.toThrow('context7_search_library');
  });
});

describe('context7_resolve_and_get_context public behavior', () => {
  it('searches first, selects a clear best candidate, fetches docs, and includes rationale', async () => {
    const weakCandidate: LibraryCandidate = {
      id: '/reactjs/react-router',
      name: 'react-router',
      description: 'routing library',
      totalSnippets: 20,
      trustScore: 5,
      benchmarkScore: 40,
    };
    const searchLibrary = vi.fn().mockResolvedValue([reactCandidate, weakCandidate]);
    const getContext = vi.fn().mockResolvedValue({
      libraryId: '/facebook/react',
      query: 'hooks',
      type: 'json',
      snippets: [{ title: 'Hooks', content: 'React hooks docs', source: 'react docs' }],
      sources: [{ title: 'Hooks', source: 'react docs' }],
    });
    const pi = registerWithDeps({
      client: { searchLibrary, getContext },
      loadConfig: vi.fn().mockResolvedValue(baseConfig()),
    });

    const result = await executeTool(toolByName(pi, 'context7_resolve_and_get_context'), {
      libraryName: 'react',
      query: 'hooks',
    });

    expect(searchLibrary).toHaveBeenCalledWith({ libraryName: 'react', query: 'hooks', limit: 5 }, undefined);
    expect(getContext).toHaveBeenCalledWith({ libraryId: '/facebook/react', query: 'hooks', type: 'json', maxChars: 12000 }, undefined);
    expect(result.content[0].text).toContain('Selected /facebook/react');
    expect(result.details.status).toBe('selected');
    expect(result.details.selected).toMatchObject({ id: '/facebook/react' });
    expect(result.details.selectionRationale).toContain('selected /facebook/react');
  });

  it('returns candidates without fetching when resolution is ambiguous', async () => {
    const searchLibrary = vi.fn().mockResolvedValue([
      { ...reactCandidate, id: '/alpha/router', name: 'router' },
      { ...reactCandidate, id: '/beta/router', name: 'router' },
    ]);
    const getContext = vi.fn();
    const pi = registerWithDeps({
      client: { searchLibrary, getContext },
      loadConfig: vi.fn().mockResolvedValue(baseConfig()),
    });

    const result = await executeTool(toolByName(pi, 'context7_resolve_and_get_context'), {
      libraryName: 'router',
      query: 'routing docs',
    });

    expect(getContext).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('ambiguous');
    expect(result.content[0].text).toContain('specific Context7 library ID');
    expect(result.details.status).toBe('ambiguous');
    expect(result.details.candidates).toHaveLength(2);
  });

  it('returns no-results guidance without fetching documentation', async () => {
    const searchLibrary = vi.fn().mockResolvedValue([]);
    const getContext = vi.fn();
    const pi = registerWithDeps({
      client: { searchLibrary, getContext },
      loadConfig: vi.fn().mockResolvedValue(baseConfig()),
    });

    const result = await executeTool(toolByName(pi, 'context7_resolve_and_get_context'), {
      libraryName: 'missing-lib',
      query: 'usage',
    });

    expect(getContext).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('No Context7 library candidates');
    expect(result.details.status).toBe('no_results');
  });

  it('prefers a requested version when resolving candidates', async () => {
    const searchLibrary = vi.fn().mockResolvedValue([
      { ...reactCandidate, id: '/vercel/next.js', name: 'next.js', versions: ['14.2.0'] },
      { ...reactCandidate, id: '/vercel/next.js/v15', name: 'next.js', versions: ['15.0.0'], trustScore: 8, benchmarkScore: 80 },
    ]);
    const getContext = vi.fn().mockResolvedValue({
      libraryId: '/vercel/next.js/v15',
      query: 'app router',
      type: 'json',
      snippets: [{ title: 'App Router', content: 'Next.js v15 docs', source: 'next docs' }],
      sources: [{ title: 'App Router', source: 'next docs' }],
    });
    const pi = registerWithDeps({
      client: { searchLibrary, getContext },
      loadConfig: vi.fn().mockResolvedValue(baseConfig()),
    });

    const result = await executeTool(toolByName(pi, 'context7_resolve_and_get_context'), {
      libraryName: 'next.js',
      query: 'app router',
      version: '15.0.0',
    });

    expect(getContext).toHaveBeenCalledWith({ libraryId: '/vercel/next.js/v15', query: 'app router', type: 'json', maxChars: 12000 }, undefined);
    expect(result.details.selected).toMatchObject({ id: '/vercel/next.js/v15' });
  });

  it('reuses search/get cache paths and bounds selected documentation output', async () => {
    const cachedDocs = {
      libraryId: '/facebook/react',
      query: 'hooks',
      type: 'json' as const,
      snippets: [{ title: 'Cached Hooks', content: 'a'.repeat(1200), source: 'cache' }],
      sources: [{ title: 'Cached Hooks', source: 'cache' }],
    };
    const cache = {
      get: vi.fn()
        .mockResolvedValueOnce({ hit: false })
        .mockResolvedValueOnce({ hit: true, value: cachedDocs }),
      set: vi.fn(),
    };
    const searchLibrary = vi.fn().mockResolvedValue([reactCandidate]);
    const getContext = vi.fn();
    const pi = registerWithDeps({
      cache,
      client: { searchLibrary, getContext },
      loadConfig: vi.fn().mockResolvedValue(baseConfig({
        cache: { enabled: true, ttlSeconds: 60, location: 'xdg', directory: '/tmp/pi/context7' },
      })),
    });

    const result = await executeTool(toolByName(pi, 'context7_resolve_and_get_context'), {
      libraryName: 'react',
      query: 'hooks',
      max_chars: 1000,
    });

    expect(cache.get).toHaveBeenCalledTimes(2);
    expect(cache.set).toHaveBeenCalledOnce();
    expect(getContext).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('[truncated: showing');
    expect(result.details.cache).toMatchObject({ search: { enabled: true, hit: false }, get: { enabled: true, hit: true } });
    expect(result.details.truncation).toMatchObject({ truncated: true });
  });
});
