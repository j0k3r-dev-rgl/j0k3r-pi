import { PoolStateStore } from './store.js';
import { discoverAccounts } from './accounts.js';
import { fetchAccountQuota } from './quota.js';

const DEFAULT_TARGET_MODEL = 'gemini-3.8-flash-high';
const DEFAULT_TARGET_EFFORT = 'high';

let lastRequestToken = 0;
export function nextRequestStartToken() {
  const now = Date.now();
  lastRequestToken = now > lastRequestToken ? now : lastRequestToken + 1;
  return lastRequestToken;
}

export function sanitizeWarning(msg) {
  if (typeof msg !== 'string') return '';
  return msg
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(?:key|token|secret|password|auth)=([A-Za-z0-9._~+/-]+)/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

/**
 * Register pool allocation and terminal cleanup listeners on Pi EventBus.
 *
 * @param {any} pi
 * @param {Object} [options]
 * @param {PoolStateStore} [options.store]
 * @param {typeof discoverAccounts} [options.discoverAccountsFn]
 * @param {typeof fetchAccountQuota} [options.fetchQuotaFn]
 * @param {(msg: string) => void} [options.warnFn]
 * @returns {() => void} Unsubscribe function
 */
export function registerPoolLifecycle(pi, options = {}) {
  const bus = pi?.events;
  if (!bus || typeof bus.on !== 'function') {
    return () => {};
  }

  const store = options.store || new PoolStateStore();
  const discoverFn = options.discoverAccountsFn || discoverAccounts;
  const fetchQuotaFn = options.fetchQuotaFn || fetchAccountQuota;
  const warn = options.warnFn || console.warn;

  let isOpen = true;
  let isShuttingDown = false;
  const activeRefreshes = new Set();
  let lifecycleAbortController = new AbortController();
  let lifecycleSignal = lifecycleAbortController.signal;

  const handleShutdown = async (event) => {
    const reason = event?.reason;
    const isInstanceShutdown = reason === 'quit' || reason === 'reload';

    if (!isInstanceShutdown) {
      // Ordinary session replacement ('new' | 'resume' | 'fork'):
      // In-flight background quota refreshes continue intact regardless of owner,
      // and future refreshes remain admitted without controller reset.
      return;
    }

    // Pi instance shutdown: 'quit' | 'reload'
    isOpen = false;
    isShuttingDown = true;
    lifecycleAbortController.abort();
    await Promise.allSettled(Array.from(activeRefreshes));
  };

  const handleSessionStart = async () => {
    if (isShuttingDown) return;
    isOpen = true;
    const discovery = (async () => {
      try {
        const accounts = await discoverFn({ signal: lifecycleSignal });
        if (isShuttingDown || lifecycleSignal.aborted || !accounts?.length) return;
        await store.initAccounts(accounts, { signal: lifecycleSignal });
      } catch (err) {
        if (lifecycleSignal.aborted || err?.name === 'AbortError') return;
        warn('[cpamc-subagent-pool] Startup account discovery failed; saved inventory retained');
      }
    })();
    activeRefreshes.add(discovery);
    try {
      await discovery;
    } finally {
      activeRefreshes.delete(discovery);
    }
  };

  let removeShutdownPi = null;
  let removeStartPi = null;
  if (typeof pi?.on === 'function') {
    removeShutdownPi = pi.on('session_shutdown', handleShutdown);
    removeStartPi = pi.on('session_start', handleSessionStart);
  }

  // Also support bus-emitted session events for testing
  let removeShutdownBus = null;
  let removeStartBus = null;
  if (pi?.on !== bus.on) {
    removeShutdownBus = bus.on('session_shutdown', handleShutdown);
    removeStartBus = bus.on('session_start', handleSessionStart);
  }

  const removeAlloc = bus.on('subagents:task:allocate', (event) => {
    if (!event || typeof event.claimModel !== 'function') return;

    event.claimModel(async (signal) => {
      // 1. Check if cancelled before starting
      if (signal?.aborted) return undefined;

      let committed = false;
      try {
        const state = store.readState();
        let accounts = state.accounts;
        let discoveredOverride;

        // Cold fallback if startup discovery did not populate the Gemini inventory.
        if (!accounts || accounts.length === 0) {
          try {
            const discovered = await discoverFn({ signal });
            if (signal?.aborted) return undefined;
            if (!discovered || discovered.length === 0) return undefined;
            discoveredOverride = discovered.map((acc) => ({
              ...acc,
              status: 'unknown',
              quota: acc.quota ?? { remainingFraction: 0, status: 'unknown', window: '5 hs' },
            }));
          } catch {
            return undefined;
          }
        }

        if (signal?.aborted) return undefined;

        // Atomic choose + acquire transaction under store lock with zero quota HTTP calls
        const accountPrefix = await store.allocateAccount(
          new Map(),
          {
            taskId: event.taskId,
            attempt: event.attempt ?? 1,
            sessionId: event.parentSessionId,
            pid: process.pid,
            signal,
          },
          discoveredOverride,
        );
        committed = true;

        if (signal?.aborted) {
          await store.removeLease({ taskId: event.taskId, attempt: event.attempt ?? 1, sessionId: event.parentSessionId, pid: process.pid });
          return undefined;
        }
        return {
          model: {
            provider: 'cliproxyapi',
            id: `${accountPrefix}/${DEFAULT_TARGET_MODEL}`,
          },
          effort: DEFAULT_TARGET_EFFORT,
        };
      } catch {
        if (committed && signal?.aborted) {
          await store.removeLease({ taskId: event.taskId, attempt: event.attempt ?? 1, sessionId: event.parentSessionId, pid: process.pid });
        }
        return undefined;
      }
    });
  });

  const removeTerm = bus.on('subagents:task:terminal', (event) => {
    if (!event || typeof event.registerCleanup !== 'function') return;

    event.registerCleanup(async () => {
      // Guaranteed order: Lease removal strictly precedes initiating any quota request
      const released = await store.removeLease({
        taskId: event.taskId,
        attempt: event.attempt ?? 1,
        sessionId: event.parentSessionId,
        pid: process.pid,
      });

      // Terminal cleanup callback resolves immediately once lease removal completes;
      // runner settlement delivers result without waiting for quota network latency.
      if (!isOpen || isShuttingDown) {
        return;
      }

      if (!released || !released.account) {
        return;
      }

      const { account, authIndex } = released;
      if (!authIndex) return;

      // Off the critical path: asynchronous single-account fresh refresh
      const requestStartedAt = nextRequestStartToken();
      const refreshPromise = (async () => {
        try {
          if (!isOpen || isShuttingDown || lifecycleSignal.aborted) return;
          const freshQuota = await fetchQuotaFn(authIndex, {
            forceFresh: true,
            signal: lifecycleSignal,
            requestStartedAt,
          });
          if (!isOpen || isShuttingDown || lifecycleSignal.aborted) return;
          if (!freshQuota || freshQuota.status === 'unknown') {
            warn(`[cpamc-subagent-pool] Background quota refresh failed for account ${account}: Quota fetch returned status unknown`);
          }
          await store.updateAccountQuota(account, freshQuota, {
            signal: lifecycleSignal,
            requestStartedAt,
          });
        } catch (err) {
          if (lifecycleSignal.aborted || err?.name === 'AbortError') return;
          const msg = err instanceof Error ? err.message : String(err ?? '');
          warn(`[cpamc-subagent-pool] Background quota refresh failed for account ${account}: ${sanitizeWarning(msg)}`);
          try {
            if (!lifecycleSignal.aborted) {
              await store.updateAccountQuota(account, { status: 'stale' }, {
                signal: lifecycleSignal,
                requestStartedAt,
              });
            }
          } catch {}
        }
      })();

      activeRefreshes.add(refreshPromise);
      refreshPromise.finally(() => {
        activeRefreshes.delete(refreshPromise);
      }).catch(() => {});
    });
  });

  return () => {
    removeAlloc?.();
    removeTerm?.();
    removeShutdownPi?.();
    removeShutdownBus?.();
    removeStartPi?.();
    removeStartBus?.();
  };
}
