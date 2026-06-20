import { execFile } from 'node:child_process';
import { createWebsearchClients } from '../../client.js';
import { loadWebsearchConfig } from '../../config.js';
import { ProviderFailure, isAbortLike } from '../../security.js';
import type { RegisterWebsearchToolsDeps, WebsearchRuntime } from '../../types.js';

export type ExecuteContext = { signal?: AbortSignal } | undefined;

function defaultCommandRunner(file: string, args: string[], options?: { signal?: AbortSignal }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, signal: options?.signal }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function timeoutSignal(timeoutMs: number, parent?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    abort();
    return { signal: controller.signal, cleanup: () => undefined };
  }
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`)), timeoutMs);
  parent?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
  };
}

async function retrying<T>(maxRetries: number, run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (isAbortLike(error) || attempt >= maxRetries) throw error;
    }
  }
  throw lastError;
}

function withRequestConfig(runtime: WebsearchRuntime, fetchImpl: typeof fetch, commandRunner: NonNullable<WebsearchRuntime['commandRunner']>): Pick<WebsearchRuntime, 'fetch' | 'commandRunner'> {
  const { timeoutMs, maxRetries } = runtime.config.request;
  return {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => retrying(maxRetries, async () => {
      const { signal, cleanup } = timeoutSignal(timeoutMs, init?.signal ?? undefined);
      try {
        return await fetchImpl(input, { ...init, signal });
      } finally {
        cleanup();
      }
    })) as typeof fetch,
    commandRunner: (file, args, options) => retrying(maxRetries, async () => {
      const { signal, cleanup } = timeoutSignal(timeoutMs, options?.signal);
      try {
        return await commandRunner(file, args, { ...options, signal });
      } finally {
        cleanup();
      }
    }),
  };
}

export function runtimeFromDeps(deps: RegisterWebsearchToolsDeps): WebsearchRuntime {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new ProviderFailure({
      code: 'missing_configuration',
      category: 'provider_unavailable',
      message: 'A fetch implementation is required for websearch tools.',
      recoverable: true,
    });
  }
  const config = deps.config ?? loadWebsearchConfig();
  const baseRuntime: WebsearchRuntime = {
    env: deps.env ?? process.env,
    fetch: fetchImpl,
    config,
    commandRunner: deps.commandRunner ?? defaultCommandRunner,
  };
  return {
    ...baseRuntime,
    ...withRequestConfig(baseRuntime, fetchImpl, baseRuntime.commandRunner ?? defaultCommandRunner),
  };
}

export function clientsFromDeps(deps: RegisterWebsearchToolsDeps) {
  if (deps.clients) {
    const runtime = runtimeFromDeps(deps);
    const fallback = deps.createClients ? deps.createClients(runtime) : createWebsearchClients(runtime);
    return {
      stackExchange: deps.clients.stackExchange ?? fallback.stackExchange,
      github: deps.clients.github ?? fallback.github,
      devto: deps.clients.devto ?? fallback.devto,
      hackerNews: deps.clients.hackerNews ?? fallback.hackerNews,
      research: deps.clients.research ?? fallback.research,
    };
  }
  const runtime = runtimeFromDeps(deps);
  return deps.createClients ? deps.createClients(runtime) : createWebsearchClients(runtime);
}

export function signalFromContext(context: ExecuteContext): AbortSignal | undefined {
  return context?.signal;
}
