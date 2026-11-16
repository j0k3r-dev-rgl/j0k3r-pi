import type { ProviderGroup } from './api.ts';

/** Human-only quota cache. Never publishes messages, tool results or provider errors. */
export function createUsageCache(fetcher: (signal?: AbortSignal) => Promise<ProviderGroup[]>, intervalMs = 30_000) {
  let groups: ProviderGroup[] | null = null;
  let updatedAt = '';
  let error = '';
  let pending: Promise<ProviderGroup[]> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let controller: AbortController | undefined;

  function load(force = false, signal?: AbortSignal): Promise<ProviderGroup[]> {
    if (pending) return pending;
    if (!force && groups) return Promise.resolve(groups);
    const generation = controller;
    const signals = [signal, generation?.signal].filter((s): s is AbortSignal => !!s);
    const combined = signals.length ? AbortSignal.any(signals) : undefined;
    pending = Promise.resolve().then(() => fetcher(combined)).then(value => {
      combined?.throwIfAborted();
      groups = value;
      updatedAt = new Date().toISOString();
      error = '';
      return value;
    }).catch(cause => {
      if (!combined?.aborted) error = 'No se pudo actualizar quota';
      throw cause;
    }).finally(() => { pending = undefined; });
    return pending;
  }

  return {
    load,
    snapshot: () => ({ groups, updatedAt, error }),
    start() {
      if (timer) return;
      controller = new AbortController();
      void load(true).catch(() => undefined);
      timer = setInterval(() => { void load(true).catch(() => undefined); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      controller?.abort();
      controller = undefined;
    },
  };
}
