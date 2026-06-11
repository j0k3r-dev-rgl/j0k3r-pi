import { Context7 } from '@upstash/context7-sdk';
import { formatSafeContext7Error, redactSecrets } from './security.js';
import type {
  Context7Client,
  Context7Documentation,
  DocumentationSnippet,
  GetContextInput,
  LibraryCandidate,
  SearchLibraryInput,
} from './types.js';
import { toErrorMessage } from './utils.js';

export interface Context7SdkLike {
  searchLibrary?(query: string, libraryName: string, options?: { type?: 'json' | 'txt' }): Promise<unknown>;
  getContext?(query: string, libraryId: string, options?: { type?: 'json' | 'txt' }): Promise<unknown>;
}

export type Context7SdkFactory = (config: { apiKey: string }) => Context7SdkLike;

export interface CreateContext7ClientOptions {
  env?: Record<string, string | undefined>;
  sdkFactory?: Context7SdkFactory;
}

export class Context7ClientError extends Error {
  code?: string;
  status?: number;
  retryAfter?: string | number;

  constructor(message: string, options: { code?: string; status?: number; retryAfter?: string | number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'Context7ClientError';
    this.code = options.code;
    this.status = options.status;
    this.retryAfter = options.retryAfter;
  }
}

function defaultSdkFactory(config: { apiKey: string }): Context7SdkLike {
  return new Context7(config);
}

function getApiKey(options: CreateContext7ClientOptions): string | undefined {
  if (options.env) return options.env.CONTEXT7_API_KEY;
  return process.env.CONTEXT7_API_KEY;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function inferStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return numberOrUndefined(record.status) ?? numberOrUndefined(record.statusCode) ?? numberOrUndefined((record.response as Record<string, unknown> | undefined)?.status);
  }

  const message = toErrorMessage(error);
  const match = message.match(/\b(401|403|404|429|5\d\d)\b/);
  return match ? Number(match[1]) : undefined;
}

function inferRetryAfter(error: unknown): string | number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  return (record.retryAfter as string | number | undefined) ?? ((record.response as Record<string, unknown> | undefined)?.retryAfter as string | number | undefined);
}

function toClientError(error: unknown, apiKey?: string): Context7ClientError {
  if (error instanceof Context7ClientError) return error;
  const status = inferStatus(error);
  const retryAfter = inferRetryAfter(error);
  const message = formatSafeContext7Error(
    {
      status,
      retryAfter,
      message: redactSecrets(toErrorMessage(error), [apiKey]),
    },
    { apiKey },
  );
  return new Context7ClientError(message, { status, retryAfter, cause: error });
}

function normalizeCandidate(raw: unknown): LibraryCandidate | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return undefined;
  return {
    id: record.id,
    name: record.name,
    description: typeof record.description === 'string' ? record.description : undefined,
    totalSnippets: numberOrUndefined(record.totalSnippets),
    trustScore: numberOrUndefined(record.trustScore),
    benchmarkScore: numberOrUndefined(record.benchmarkScore),
    versions: Array.isArray(record.versions) ? record.versions.filter((version): version is string => typeof version === 'string') : undefined,
  };
}

function normalizeSnippet(raw: unknown): DocumentationSnippet | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.content !== 'string') return undefined;
  return {
    title: typeof record.title === 'string' ? record.title : undefined,
    content: record.content,
    source: typeof record.source === 'string' ? record.source : undefined,
    sourceUrl: typeof record.sourceUrl === 'string' ? record.sourceUrl : undefined,
  };
}

function normalizeDocumentation(input: GetContextInput, raw: unknown): Context7Documentation {
  if (input.type === 'txt') {
    return {
      libraryId: input.libraryId,
      query: input.query,
      type: 'txt',
      text: typeof raw === 'string' ? raw : '',
      sources: [],
    };
  }

  const snippets = Array.isArray(raw) ? raw.map(normalizeSnippet).filter((snippet): snippet is DocumentationSnippet => Boolean(snippet)) : [];
  return {
    libraryId: input.libraryId,
    query: input.query,
    type: 'json',
    snippets,
    sources: snippets.map((snippet) => ({ title: snippet.title, source: snippet.source, sourceUrl: snippet.sourceUrl })),
  };
}

export function createContext7Client(options: CreateContext7ClientOptions = {}): Context7Client {
  const sdkFactory = options.sdkFactory ?? defaultSdkFactory;
  let sdk: Context7SdkLike | undefined;

  function ensureSdk(): { sdk: Context7SdkLike; apiKey: string } {
    const apiKey = getApiKey(options);
    if (!apiKey) {
      throw new Context7ClientError(formatSafeContext7Error({ code: 'missing_api_key' }), { code: 'missing_api_key' });
    }
    sdk ??= sdkFactory({ apiKey });
    return { sdk, apiKey };
  }

  return {
    async searchLibrary(input: SearchLibraryInput): Promise<LibraryCandidate[]> {
      const { sdk: liveSdk, apiKey } = ensureSdk();
      try {
        const raw = await liveSdk.searchLibrary?.(input.query, input.libraryName, { type: 'json' });
        const candidates = Array.isArray(raw) ? raw.map(normalizeCandidate).filter((candidate): candidate is LibraryCandidate => Boolean(candidate)) : [];
        return candidates.slice(0, input.limit);
      } catch (error) {
        throw toClientError(error, apiKey);
      }
    },

    async getContext(input: GetContextInput): Promise<Context7Documentation> {
      const { sdk: liveSdk, apiKey } = ensureSdk();
      try {
        const raw = await liveSdk.getContext?.(input.query, input.libraryId, { type: input.type });
        return normalizeDocumentation(input, raw);
      } catch (error) {
        throw toClientError(error, apiKey);
      }
    },
  };
}
