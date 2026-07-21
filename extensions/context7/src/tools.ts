import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { createCacheKey, createContext7Cache, type Context7Cache } from './cache.js';
import { createContext7Client } from './client.js';
import { loadContext7Config } from './config.js';
import { appendContext7ArtifactNotice, writeContext7OutputArtifact } from './core/output-artifact.js';
import { context7ToolRenderers } from './render/index.js';
import { resolveLibraryCandidate, type ScoredLibraryCandidate } from './resolve.js';
import { clampMaxChars, formatSafeContext7Error, redactSecrets, truncateSnippets, truncateText } from './security.js';
import type { Context7Client, Context7Documentation, Context7OutputArtifact, Context7RuntimeConfig, DocumentationSnippet, LibraryCandidate } from './types.js';
import { isNonEmptyString } from './utils.js';

export const CONTEXT7_TOOL_NAMES = [
  'context7_status',
  'context7_search_library',
  'context7_get_context',
  'context7_resolve_and_get_context',
] as const;

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details?: Record<string, unknown>;
};

type ToolContext = {
  cwd?: string;
  env?: Record<string, string | undefined>;
};

type LoadConfig = typeof loadContext7Config;

export interface RegisterContext7ToolsOptions {
  client?: Context7Client;
  createClient?: (options: { env: Record<string, string | undefined> }) => Context7Client;
  cache?: Context7Cache;
  loadConfig?: LoadConfig;
}

interface ToolRuntime {
  cwd: string;
  env: Record<string, string | undefined>;
  config: Context7RuntimeConfig;
}

interface CacheRuntime {
  cache: Context7Cache;
  enabled: boolean;
  warnings: string[];
}

interface CacheMeta {
  enabled: boolean;
  hit: boolean;
  key?: string;
}

function ok(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: 'text', text }], details };
}

const emptyParameters = Type.Object({});

const searchParameters = Type.Object({
  libraryName: Type.String({ description: 'Human library/package name, e.g. next.js' }),
  query: Type.String({ description: 'Documentation topic or API area to search for' }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
});

const getContextParameters = Type.Object({
  libraryId: Type.String({ description: 'Context7 library ID, e.g. /vercel/next.js' }),
  query: Type.String({ description: 'Focused documentation question or topic' }),
  type: Type.Optional(StringEnum(['json', 'txt'] as const)),
  max_chars: Type.Optional(Type.Number({ minimum: 1000, maximum: 50000 })),
});

const resolveAndGetParameters = Type.Object({
  libraryName: Type.String(),
  query: Type.String(),
  version: Type.Optional(Type.String()),
  max_chars: Type.Optional(Type.Number({ minimum: 1000, maximum: 50000 })),
});

async function runtimeFor(ctx: ToolContext | undefined, deps: RegisterContext7ToolsOptions): Promise<ToolRuntime> {
  const cwd = ctx?.cwd ?? process.cwd();
  const env = ctx?.env ?? process.env;
  const loadConfig = deps.loadConfig ?? loadContext7Config;
  const config = await loadConfig({ cwd, env });
  return { cwd, env, config };
}

function cacheFor(runtime: ToolRuntime, deps: RegisterContext7ToolsOptions): CacheRuntime {
  if (deps.cache) return { cache: deps.cache, enabled: runtime.config.cache.enabled, warnings: [] };
  const created = createContext7Cache({
    enabled: runtime.config.cache.enabled,
    directory: runtime.config.cache.directory,
    repositoryRoot: runtime.cwd,
  });
  return created;
}

function clientFor(runtime: ToolRuntime, deps: RegisterContext7ToolsOptions): Context7Client {
  return deps.client ?? deps.createClient?.({ env: runtime.env }) ?? createContext7Client({ env: runtime.env });
}

function requireNonEmpty(params: Record<string, unknown>, field: string): string {
  const value = params[field];
  if (!isNonEmptyString(value)) throw new Error(`${field} is required.`);
  return value.trim();
}

function normalizeLimit(value: unknown, fallback: number): number {
  if (typeof value === 'undefined') return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error('limit must be an integer from 1 to 10.');
  }
  return value;
}

function normalizeType(value: unknown): 'json' | 'txt' {
  if (typeof value === 'undefined') return 'json';
  if (value !== 'json' && value !== 'txt') throw new Error('type must be one of json, txt.');
  return value;
}

function normalizeMaxChars(value: unknown, fallback: number): number {
  return clampMaxChars(value, fallback);
}

const SEARCH_DESCRIPTION_MAX_CHARS = 500;

function truncateSearchDescription(description: string): string {
  if (description.length <= SEARCH_DESCRIPTION_MAX_CHARS) return description;
  const notice = `\n[truncated: showing ${SEARCH_DESCRIPTION_MAX_CHARS} of ${description.length} chars]`;
  const bodyBudget = Math.max(0, SEARCH_DESCRIPTION_MAX_CHARS - notice.length);
  return `${description.slice(0, bodyBudget)}${notice}`;
}

function redactCandidate(candidate: LibraryCandidate, apiKey?: string): LibraryCandidate {
  return {
    ...candidate,
    id: redactSecrets(candidate.id, [apiKey]),
    name: redactSecrets(candidate.name, [apiKey]),
    description: candidate.description ? redactSecrets(candidate.description, [apiKey]) : candidate.description,
    versions: candidate.versions?.map((version) => redactSecrets(version, [apiKey])),
  };
}

function boundCandidate(candidate: LibraryCandidate): LibraryCandidate {
  return {
    ...candidate,
    description: candidate.description ? truncateSearchDescription(candidate.description) : candidate.description,
  };
}

function safeCandidate(candidate: LibraryCandidate, apiKey?: string): LibraryCandidate {
  return boundCandidate(redactCandidate(candidate, apiKey));
}

function safeScoredCandidate(scored: ScoredLibraryCandidate, apiKey?: string): Record<string, unknown> {
  return {
    candidate: safeCandidate(scored.candidate, apiKey),
    score: scored.score,
    exactName: scored.exactName,
    exactId: scored.exactId,
    versionMatch: scored.versionMatch,
    rationale: scored.rationale,
  };
}

function safeSnippet(snippet: DocumentationSnippet, apiKey?: string): DocumentationSnippet {
  return {
    ...snippet,
    title: snippet.title ? redactSecrets(snippet.title, [apiKey]) : snippet.title,
    content: redactSecrets(snippet.content, [apiKey]),
    source: snippet.source ? redactSecrets(snippet.source, [apiKey]) : snippet.source,
    sourceUrl: snippet.sourceUrl ? redactSecrets(snippet.sourceUrl, [apiKey]) : snippet.sourceUrl,
  };
}

function safeDocumentation(documentation: Context7Documentation, apiKey?: string): Context7Documentation {
  return {
    ...documentation,
    libraryId: redactSecrets(documentation.libraryId, [apiKey]),
    query: redactSecrets(documentation.query, [apiKey]),
    text: documentation.text ? redactSecrets(documentation.text, [apiKey]) : documentation.text,
    snippets: documentation.snippets?.map((snippet) => safeSnippet(snippet, apiKey)),
    sources: documentation.sources.map((source) => ({
      title: source.title ? redactSecrets(source.title, [apiKey]) : source.title,
      source: source.source ? redactSecrets(source.source, [apiKey]) : source.source,
      sourceUrl: source.sourceUrl ? redactSecrets(source.sourceUrl, [apiKey]) : source.sourceUrl,
    })),
  };
}

async function getCacheable<T>(options: {
  cacheRuntime: CacheRuntime;
  method: string;
  request: Record<string, unknown>;
  ttlSeconds: number;
  fetch: () => Promise<T>;
}): Promise<{ value: T; meta: CacheMeta }> {
  const key = createCacheKey(options.method, options.request);
  if (!options.cacheRuntime.enabled) {
    return { value: await options.fetch(), meta: { enabled: false, hit: false } };
  }

  const cached = await options.cacheRuntime.cache.get<T>(key);
  if (cached.hit) return { value: cached.value, meta: { enabled: true, hit: true, key: key.hash } };

  const value = await options.fetch();
  await options.cacheRuntime.cache.set(key, value, options.ttlSeconds);
  return { value, meta: { enabled: true, hit: false, key: key.hash } };
}

function formatSearchContent(libraryName: string, query: string, results: LibraryCandidate[]): string {
  if (results.length === 0) {
    return `No Context7 libraries found for "${libraryName}" and query "${query}". Try a more specific library name, package name, framework owner, or alternate query.`;
  }

  const lines = results.map((candidate, index) => {
    const scoreParts = [
      typeof candidate.trustScore === 'number' ? `trust ${candidate.trustScore}` : undefined,
      typeof candidate.benchmarkScore === 'number' ? `benchmark ${candidate.benchmarkScore}` : undefined,
      typeof candidate.totalSnippets === 'number' ? `${candidate.totalSnippets} snippets` : undefined,
    ].filter(Boolean).join(', ');
    return `${index + 1}. ${candidate.name} (${candidate.id})${scoreParts ? ` — ${scoreParts}` : ''}${candidate.description ? ` — ${candidate.description}` : ''}`;
  });

  return `Context7 search returned ${results.length} result(s) for "${libraryName}" and query "${query}":\n${lines.join('\n')}`;
}

async function preserveFullOutput(content: string, fullContent: string, truncated: boolean): Promise<{
  content: string;
  artifact?: Context7OutputArtifact;
}> {
  if (!truncated) return { content };
  const artifact = await writeContext7OutputArtifact(fullContent);
  return { content: appendContext7ArtifactNotice(content, artifact), artifact };
}

async function executeSearch(params: unknown, signal: AbortSignal | undefined, ctx: ToolContext | undefined, deps: RegisterContext7ToolsOptions): Promise<ToolResult> {
  const request = (params ?? {}) as Record<string, unknown>;
  const runtime = await runtimeFor(ctx, deps);
  const libraryName = requireNonEmpty(request, 'libraryName');
  const query = requireNonEmpty(request, 'query');
  const limit = normalizeLimit(request.limit, runtime.config.defaults.resultLimit);
  const cacheRuntime = cacheFor(runtime, deps);

  try {
    const { value, meta } = await getCacheable<LibraryCandidate[]>({
      cacheRuntime,
      method: 'search-library',
      request: { libraryName, query, limit },
      ttlSeconds: runtime.config.cache.ttlSeconds,
      fetch: () => clientFor(runtime, deps).searchLibrary({ libraryName, query, limit }, signal),
    });
    const fullResults = value.slice(0, limit).map((candidate) => redactCandidate(candidate, runtime.env.CONTEXT7_API_KEY));
    const results = fullResults.map(boundCandidate);
    const truncated = fullResults.some((candidate, index) => candidate.description !== results[index]?.description);
    const output = await preserveFullOutput(
      formatSearchContent(libraryName, query, results),
      formatSearchContent(libraryName, query, fullResults),
      truncated,
    );
    return ok(output.content, {
      request: { libraryName, query, limit },
      results,
      count: results.length,
      truncation: { truncated },
      artifact: output.artifact,
      cache: meta,
      warnings: [...runtime.config.warnings, ...cacheRuntime.warnings],
    });
  } catch (error) {
    throw new Error(formatSafeContext7Error(error, { apiKey: runtime.env.CONTEXT7_API_KEY }));
  }
}

function formatJsonDocumentationContent(documentation: Context7Documentation): string {
  const snippets = documentation.snippets ?? [];
  if (snippets.length === 0) {
    return `No Context7 documentation snippets returned for ${documentation.libraryId} and query "${documentation.query}".`;
  }
  const lines = snippets.map((snippet, index) => {
    const title = snippet.title ?? `Snippet ${index + 1}`;
    const source = snippet.sourceUrl ?? snippet.source;
    return `${index + 1}. ${title}${source ? `\nSource: ${source}` : ''}\n${snippet.content}`;
  });
  return `Context7 documentation for ${documentation.libraryId} and query "${documentation.query}":\n${lines.join('\n\n')}`;
}

function formatDocumentationContent(documentation: Context7Documentation): string {
  if (documentation.type === 'txt') {
    return `Context7 documentation for ${documentation.libraryId} and query "${documentation.query}":\n${documentation.text ?? ''}`;
  }
  return formatJsonDocumentationContent(documentation);
}

function boundDocumentation(documentation: Context7Documentation, maxChars: number): {
  documentation: Context7Documentation;
  truncation: Record<string, unknown>;
  content: string;
} {
  if (documentation.type === 'txt') {
    const truncated = truncateText(documentation.text ?? '', maxChars);
    const bounded = { ...documentation, text: truncated.text };
    return {
      documentation: bounded,
      truncation: { truncated: truncated.truncated, originalChars: truncated.originalChars },
      content: formatDocumentationContent(bounded),
    };
  }

  const truncated = truncateSnippets(documentation.snippets ?? [], maxChars);
  const bounded = { ...documentation, snippets: truncated.snippets };
  return {
    documentation: bounded,
    truncation: { truncated: truncated.truncated },
    content: formatJsonDocumentationContent(bounded),
  };
}

async function executeGetContext(params: unknown, signal: AbortSignal | undefined, ctx: ToolContext | undefined, deps: RegisterContext7ToolsOptions): Promise<ToolResult> {
  const request = (params ?? {}) as Record<string, unknown>;
  const runtime = await runtimeFor(ctx, deps);
  const libraryId = requireNonEmpty(request, 'libraryId');
  const query = requireNonEmpty(request, 'query');
  const type = normalizeType(request.type);
  const maxChars = normalizeMaxChars(request.max_chars, runtime.config.defaults.maxChars);
  const cacheRuntime = cacheFor(runtime, deps);

  try {
    const { value, meta } = await getCacheable<Context7Documentation>({
      cacheRuntime,
      method: 'get-context',
      request: { libraryId, query, type },
      ttlSeconds: runtime.config.cache.ttlSeconds,
      fetch: () => clientFor(runtime, deps).getContext({ libraryId, query, type, maxChars }, signal),
    });
    const safeDocs = safeDocumentation(value, runtime.env.CONTEXT7_API_KEY);
    const bounded = boundDocumentation(safeDocs, maxChars);
    const output = await preserveFullOutput(
      bounded.content,
      formatDocumentationContent(safeDocs),
      Boolean(bounded.truncation.truncated),
    );
    return ok(output.content, {
      request: { libraryId, query, type, maxChars },
      documentation: bounded.documentation,
      truncation: bounded.truncation,
      artifact: output.artifact,
      cache: meta,
      warnings: [...runtime.config.warnings, ...cacheRuntime.warnings],
    });
  } catch (error) {
    throw new Error(formatSafeContext7Error(error, { apiKey: runtime.env.CONTEXT7_API_KEY }));
  }
}

async function executeResolveAndGet(params: unknown, signal: AbortSignal | undefined, ctx: ToolContext | undefined, deps: RegisterContext7ToolsOptions): Promise<ToolResult> {
  const request = (params ?? {}) as Record<string, unknown>;
  const runtime = await runtimeFor(ctx, deps);
  const libraryName = requireNonEmpty(request, 'libraryName');
  const query = requireNonEmpty(request, 'query');
  const version = isNonEmptyString(request.version) ? request.version.trim() : undefined;
  const maxChars = normalizeMaxChars(request.max_chars, runtime.config.defaults.maxChars);
  const limit = runtime.config.defaults.resultLimit;
  const cacheRuntime = cacheFor(runtime, deps);

  try {
    const search = await getCacheable<LibraryCandidate[]>({
      cacheRuntime,
      method: 'search-library',
      request: { libraryName, query, limit },
      ttlSeconds: runtime.config.cache.ttlSeconds,
      fetch: () => clientFor(runtime, deps).searchLibrary({ libraryName, query, limit }, signal),
    });
    const candidates = search.value.slice(0, limit).map((candidate) => safeCandidate(candidate, runtime.env.CONTEXT7_API_KEY));
    const resolution = resolveLibraryCandidate({ libraryName, query, version, candidates });

    if (resolution.status === 'no_results') {
      return ok(`No Context7 library candidates were found for "${libraryName}". Refine the library name or query before fetching documentation.`, {
        status: 'no_results',
        request: { libraryName, query, version, maxChars },
        candidates: [],
        rationale: resolution.rationale,
        cache: { search: search.meta },
        warnings: [...runtime.config.warnings, ...cacheRuntime.warnings],
      });
    }

    if (resolution.status === 'ambiguous') {
      return ok(`Context7 library resolution is ambiguous for "${libraryName}". Choose a specific Context7 library ID before fetching documentation.`, {
        status: 'ambiguous',
        request: { libraryName, query, version, maxChars },
        candidates: resolution.candidates.map((candidate) => safeScoredCandidate(candidate, runtime.env.CONTEXT7_API_KEY)),
        rationale: resolution.rationale,
        cache: { search: search.meta },
        warnings: [...runtime.config.warnings, ...cacheRuntime.warnings],
      });
    }

    const selected = safeCandidate(resolution.selected, runtime.env.CONTEXT7_API_KEY);
    const get = await getCacheable<Context7Documentation>({
      cacheRuntime,
      method: 'get-context',
      request: { libraryId: selected.id, query, type: 'json' },
      ttlSeconds: runtime.config.cache.ttlSeconds,
      fetch: () => clientFor(runtime, deps).getContext({ libraryId: selected.id, query, type: 'json', maxChars }, signal),
    });
    const safeDocs = safeDocumentation(get.value, runtime.env.CONTEXT7_API_KEY);
    const bounded = boundDocumentation(safeDocs, maxChars);
    const boundedContent = `Selected ${selected.id}. ${resolution.rationale}\n\n${bounded.content}`;
    const fullContent = `Selected ${selected.id}. ${resolution.rationale}\n\n${formatDocumentationContent(safeDocs)}`;
    const output = await preserveFullOutput(boundedContent, fullContent, Boolean(bounded.truncation.truncated));

    return ok(output.content, {
      status: 'selected',
      request: { libraryName, query, version, maxChars },
      selected,
      selectionRationale: resolution.rationale,
      candidates: resolution.candidates.map((candidate) => safeScoredCandidate(candidate, runtime.env.CONTEXT7_API_KEY)),
      documentation: bounded.documentation,
      truncation: bounded.truncation,
      artifact: output.artifact,
      cache: { search: search.meta, get: get.meta },
      warnings: [...runtime.config.warnings, ...cacheRuntime.warnings],
    });
  } catch (error) {
    throw new Error(formatSafeContext7Error(error, { apiKey: runtime.env.CONTEXT7_API_KEY }));
  }
}

export function registerContext7Tools(pi: any, deps: RegisterContext7ToolsOptions = {}): void {
  pi.registerTool({
    name: 'context7_status',
    label: 'Context7 Status',
    description: 'Report Context7 extension readiness without exposing secrets.',
    parameters: emptyParameters,
    ...context7ToolRenderers('context7_status'),
    async execute(_id: string, _params: unknown, _signal: unknown, _onUpdate: unknown, ctx: any) {
      const runtime = await runtimeFor(ctx, deps);
      const guidance = runtime.config.apiKeyPresent
        ? 'Context7 API key is present.'
        : 'Context7 API key is absent. Set CONTEXT7_API_KEY in the Pi process environment for live Context7 calls.';
      return ok(`Context7 status: SDK dependency configured, ${guidance} Cache is ${runtime.config.cache.enabled ? 'enabled' : 'disabled'}.`, {
        sdkAvailable: true,
        apiKeyPresent: runtime.config.apiKeyPresent,
        cache: runtime.config.cache,
        defaults: runtime.config.defaults,
        warnings: runtime.config.warnings,
      });
    },
  });

  pi.registerTool({
    name: 'context7_search_library',
    label: 'Context7 Search Library',
    description: 'Search Context7 libraries and return compact candidates.',
    parameters: searchParameters,
    ...context7ToolRenderers('context7_search_library'),
    async execute(_id: string, params: unknown, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
      return executeSearch(params, signal, ctx, deps);
    },
  });

  pi.registerTool({
    name: 'context7_get_context',
    label: 'Context7 Get Context',
    description: 'Fetch focused Context7 documentation for a known library ID.',
    parameters: getContextParameters,
    ...context7ToolRenderers('context7_get_context'),
    async execute(_id: string, params: unknown, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
      return executeGetContext(params, signal, ctx, deps);
    },
  });

  pi.registerTool({
    name: 'context7_resolve_and_get_context',
    label: 'Context7 Resolve And Get Context',
    description: 'Resolve a library and fetch focused Context7 documentation when unambiguous.',
    parameters: resolveAndGetParameters,
    ...context7ToolRenderers('context7_resolve_and_get_context'),
    async execute(_id: string, params: unknown, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
      return executeResolveAndGet(params, signal, ctx, deps);
    },
  });
}
