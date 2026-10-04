import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { selectAccountCandidate } from './pool.js';
import { abortable } from './http.js';

const DEFAULT_STATE_FILE = path.join(os.homedir(), '.pi', 'agent', 'cpamc-subagent-pool-state.json');
const LOCK_TIMEOUT_MS = 5000;

/**
 * Canonical owner-inclusive lease key avoiding delimiter collisions.
 * Unambiguously distinguishes sessionId (including undefined vs literal 'undefined'),
 * PID, taskId, and attempt.
 *
 * @param {Object} identity
 * @param {string} [identity.sessionId]
 * @param {number} [identity.pid]
 * @param {string} identity.taskId
 * @param {number} [identity.attempt=1]
 * @returns {string}
 */
export function buildLeaseId({ sessionId, pid, taskId, attempt = 1 }) {
  const sessionTag = sessionId === undefined
    ? 'u'
    : sessionId === null
      ? 'n'
      : `s:${encodeURIComponent(String(sessionId))}`;
  const pidTag = pid === undefined
    ? 'u'
    : pid === null
      ? 'n'
      : `p:${pid}`;
  const taskTag = `t:${encodeURIComponent(String(taskId ?? ''))}`;
  const attemptTag = `a:${Number(attempt) || 1}`;
  return `${sessionTag}/${pidTag}/${taskTag}/${attemptTag}`;
}

export function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === 'EPERM') return true;
    if (err && err.code === 'ESRCH') return false;
    return true; // Reclaim only on proven ESRCH, not an unknown liveness failure.
  }
}

export class PoolStateStore {
  /**
   * @param {Object} [options]
   * @param {string} [options.stateFile]
   */
  constructor(options = {}) {
    this.stateFile = options.stateFile || DEFAULT_STATE_FILE;
    this.lockFile = `${this.stateFile}.lock`;
    this.mutex = Promise.resolve();
    this.isPidAlive = typeof options.isPidAlive === 'function' ? options.isPidAlive : isPidAlive;
  }

  /**
   * Execute an operation serialized under in-process mutex and cross-process file lock.
   *
   * @template T
   * @param {() => Promise<T> | T} operation
   * @returns {Promise<T>}
   */
  async withLock(operation, signal) {
    signal?.throwIfAborted();
    const runInMutex = async () => {
      signal?.throwIfAborted();
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      let lockFd = null;
      const start = Date.now();

      while (lockFd === null) {
        signal?.throwIfAborted();
        try {
          lockFd = fs.openSync(this.lockFile, 'wx');
          fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid }));
        } catch (err) {
          if (err && err.code === 'EEXIST') {
            // Never steal a live owner's lock based on elapsed time.
            try {
              const owner = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
              const checkAlive = this.isPidAlive || isPidAlive;
              if (Number.isInteger(owner.pid) && owner.pid > 0 && !checkAlive(owner.pid)) {
                fs.unlinkSync(this.lockFile);
                continue;
              }
            } catch {
              // Unreadable/partially initialized lock is not proof of a dead owner.
            }

            if (Date.now() - start > LOCK_TIMEOUT_MS) {
              throw new Error(`Timeout waiting for pool lock ${this.lockFile}`);
            }
            await abortable(new Promise((r) => setTimeout(r, 15)), signal);
          } else {
            throw err;
          }
        }
      }

      try {
        signal?.throwIfAborted();
        return await operation();
      } finally {
        try {
          if (lockFd !== null) fs.closeSync(lockFd);
        } catch {}
        try {
          fs.unlinkSync(this.lockFile);
        } catch {}
      }
    };

    const previous = this.mutex;
    const nextMutex = abortable(previous, signal).then(runInMutex);
    // Cancelling a queued waiter must not release the previous holder's mutex.
    this.mutex = Promise.allSettled([previous, nextMutex]).then(() => undefined);
    return nextMutex;
  }

  /**
   * Load state from disk or return default template.
   *
   * @returns {import('./types.js').PoolState}
   */
  readState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = fs.readFileSync(this.stateFile, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          version: 1,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
          accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
          leases: parsed.leases && typeof parsed.leases === 'object' ? parsed.leases : {},
        };
      }
    } catch {
      // Fall through to empty default
    }

    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      accounts: [],
      leases: {},
    };
  }

  /**
   * Write state to disk atomically using temporary file and rename.
   * Strictly avoids persisting sensitive credentials.
   *
   * @param {import('./types.js').PoolState} state
   */
  writeState(state) {
    const parentDir = path.dirname(this.stateFile);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Sanitize state: ensure no credentials or secrets exist
    const sanitizedAccounts = (state.accounts || []).map((acc) => ({
      prefix: acc.prefix,
      authIndex: acc.authIndex,
      email: acc.email,
      status: acc.status,
      lastRequestStartedAt: typeof acc.lastRequestStartedAt === 'number' ? acc.lastRequestStartedAt : undefined,
      quota: acc.quota ? {
        remainingFraction: acc.quota.remainingFraction,
        usedPercentage: acc.quota.usedPercentage,
        window: acc.quota.window,
        lastCheckedAt: acc.quota.lastCheckedAt,
        status: acc.quota.status,
      } : undefined,
    }));

    const cleanState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      accounts: sanitizedAccounts,
      leases: state.leases || {},
    };

    const tmpPath = `${this.stateFile}.tmp.${randomUUID()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(cleanState, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.stateFile);
  }

  /**
   * Reclaim leases from processes that are no longer alive.
   *
   * @param {import('./types.js').PoolState} state
   * @returns {boolean} True if any lease was reclaimed
   */
  cleanDeadProcessLeases(state) {
    let changed = false;
    const checkAlive = this.isPidAlive || isPidAlive;
    for (const [key, lease] of Object.entries(state.leases || {})) {
      if (!checkAlive(lease.pid)) {
        delete state.leases[key];
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Public helper to recover dead-process leases.
   */
  async recoverDeadProcessLeases() {
    return this.withLock(async () => {
      const state = this.readState();
      const changed = this.cleanDeadProcessLeases(state);
      if (changed) {
        this.writeState(state);
      }
      return state;
    });
  }

  /**
   * Initialize or update available accounts in pool.
   *
   * Preserve saved quotas and ordering tokens only for unchanged account identities.
   * @param {import('./types.js').PoolAccount[]} accounts
   * @param {{ signal?: AbortSignal }} [options]
   */
  async initAccounts(accounts, { signal } = {}) {
    return this.withLock(async () => {
      const state = this.readState();
      state.accounts = accounts.map((account) => {
        const previous = state.accounts.find((old) => old.prefix === account.prefix && old.authIndex === account.authIndex);
        const quota = account.quota ?? previous?.quota ?? { remainingFraction: 0, status: 'unknown', window: '5 hs' };
        return {
          ...account,
          quota,
          status: quota.status === 'known' ? 'healthy' : quota.status === 'stale' ? 'degraded' : 'unknown',
          lastRequestStartedAt: account.lastRequestStartedAt ?? previous?.lastRequestStartedAt,
        };
      });
      this.cleanDeadProcessLeases(state);
      signal?.throwIfAborted();
      this.writeState(state);
      return state;
    }, signal);
  }

  /**
   * Return current snapshot of pool state.
   *
   * @returns {Promise<import('./types.js').PoolState>}
   */
  async getState() {
    return this.withLock(async () => {
      const state = this.readState();
      const changed = this.cleanDeadProcessLeases(state);
      if (changed) {
        this.writeState(state);
      }
      return state;
    });
  }

  /**
   * Atomic Choose + Acquire transaction:
   * Selects an optimal candidate account and commits a new lease record under file lock.
   *
   * @param {Map<string, import('./types.js').QuotaBucket>} [quotaMap]
   * @param {import('./types.js').AllocateOptions} options
   * @param {import('./types.js').PoolAccount[]} [accountsOverride]
   * @returns {Promise<string>} Account prefix
   */
  async allocateAccount(quotaMap = new Map(), options, accountsOverride) {
    const { taskId, attempt = 1, sessionId, pid = process.pid, signal } = options;
    if (!taskId) throw new Error('taskId is required for allocation');

    return this.withLock(async () => {
      const state = this.readState();
      this.cleanDeadProcessLeases(state);

      const leaseId = buildLeaseId({ sessionId, pid, taskId, attempt });

      // Idempotent reservation: preserve earlier reservation/affinity if identical owner re-allocates
      const existingLease = state.leases[leaseId];
      if (existingLease) {
        signal?.throwIfAborted();
        return existingLease.account;
      }

      // Safe lookup for pre-existing legacy record matching this complete owner identity
      const legacyKey = `${taskId}:${attempt}`;
      const legacy = state.leases[legacyKey];
      if (legacy && legacy.taskId === taskId && (legacy.attempt ?? 1) === attempt && legacy.sessionId === sessionId && legacy.pid === pid) {
        signal?.throwIfAborted();
        return legacy.account;
      }

      const previousAccounts = state.accounts;
      if (accountsOverride && accountsOverride.length > 0) {
        state.accounts = accountsOverride.map((account) => ({ ...account }));
      }

      const effectiveQuotas = new Map();
      for (const acc of state.accounts) {
        const fresh = quotaMap.get(acc.prefix) ?? quotaMap.get(acc.authIndex);
        const previous = previousAccounts.find((old) => old.prefix === acc.prefix && old.authIndex === acc.authIndex)?.quota;
        if (fresh && fresh.status !== 'unknown') {
          acc.quota = fresh;
        } else if (fresh && fresh.status === 'unknown') {
          if (previous?.lastCheckedAt && previous.status !== 'unknown') acc.quota = { ...previous, status: 'stale' };
          else acc.quota = fresh;
        } else if (acc.quota) {
          // Preserve existing verified quota on disk if no fresh query was attempted
        } else if (previous) {
          acc.quota = previous;
        } else {
          acc.quota = { remainingFraction: 0, status: 'unknown', window: '5 hs' };
        }
        acc.status = acc.quota.status === 'known' ? 'healthy' : acc.quota.status === 'stale' ? 'degraded' : 'unknown';
        effectiveQuotas.set(acc.prefix, acc.quota);
      }

      const activeLeases = Object.values(state.leases || {});
      const selected = selectAccountCandidate(state.accounts, activeLeases, effectiveQuotas);

      if (!selected) {
        throw new Error('No candidate account available in CPAMC pool');
      }

      state.leases[leaseId] = {
        id: leaseId,
        account: selected.prefix,
        taskId,
        attempt,
        sessionId,
        pid,
        createdAt: new Date().toISOString(),
      };

      signal?.throwIfAborted();
      this.writeState(state);
      return selected.prefix;
    }, signal);
  }

  /**
   * Ownership-safe attempt-specific lease removal:
   * Removes lease matching exact owner identity (session + PID + taskId + attempt).
   * Also safely looks up owner-matching pre-existing legacy taskId:attempt records.
   * Returns released account and authIndex snapshot, or null on mismatch.
   *
   * @param {import('./types.js').ReleaseOptions} options
   * @returns {Promise<{ account: string, authIndex: string | undefined } | null>}
   */
  async removeLease(options) {
    const { taskId, attempt = 1, sessionId, pid } = options;
    if (!taskId) return null;

    return this.withLock(async () => {
      const state = this.readState();
      let changed = this.cleanDeadProcessLeases(state);

      const targetPid = pid !== undefined ? pid : process.pid;
      const leaseId = buildLeaseId({ sessionId, pid: targetPid, taskId, attempt });
      let existing = state.leases[leaseId];
      let targetKey = leaseId;

      if (!existing) {
        // Safe release lookup for pre-existing legacy taskId:attempt records
        const legacyKey = `${taskId}:${attempt}`;
        const legacy = state.leases[legacyKey];
        if (legacy && legacy.taskId === taskId && (legacy.attempt ?? 1) === attempt) {
          // Verify owner match before removing legacy record
          if (legacy.sessionId === sessionId && (pid === undefined || legacy.pid === targetPid)) {
            existing = legacy;
            targetKey = legacyKey;
          }
        }
      }

      if (!existing) {
        if (changed) this.writeState(state);
        return null;
      }

      // Ownership safety: verify exact session and PID
      if (existing.sessionId !== sessionId) {
        if (changed) this.writeState(state);
        return null;
      }
      if (pid !== undefined && existing.pid !== pid) {
        if (changed) this.writeState(state);
        return null;
      }

      const account = existing.account;
      const acc = (state.accounts || []).find((a) => a.prefix === account);
      const authIndex = acc ? acc.authIndex : undefined;
      const releasedInfo = { account, authIndex };

      delete state.leases[targetKey];
      this.writeState(state);
      return releasedInfo;
    });
  }

  /**
   * Update quota for a single account in pool state under store lock.
   * Merges only the targeted account; preserves all other accounts and active leases.
   * Rejects out-of-order older responses via monotonic requestStartedAt token.
   * Retains verified quota as stale on failure, preserving original lastCheckedAt.
   * Signal propagation aborts lock waits and final commit.
   *
   * @param {string} prefix
   * @param {import('./types.js').QuotaBucket | { status: string, remainingFraction?: number, usedPercentage?: number, window?: string, lastCheckedAt?: string }} quotaResult
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal]
   * @param {number} [options.requestStartedAt]
   * @returns {Promise<boolean>} True if updated, false if rejected or not found
   */
  async updateAccountQuota(prefix, quotaResult, options = {}) {
    const { signal, requestStartedAt } = options;
    signal?.throwIfAborted();

    return this.withLock(async () => {
      signal?.throwIfAborted();
      const state = this.readState();
      this.cleanDeadProcessLeases(state);

      const acc = (state.accounts || []).find((a) => a.prefix === prefix);
      if (!acc) return false;

      // Monotonic request-start ordering: reject older out-of-order data
      if (typeof requestStartedAt === 'number') {
        if (typeof acc.lastRequestStartedAt === 'number' && requestStartedAt < acc.lastRequestStartedAt) {
          return false;
        }
        acc.lastRequestStartedAt = Math.max(acc.lastRequestStartedAt ?? 0, requestStartedAt);
      }

      // Account-only merge
      const isKnown = quotaResult && quotaResult.status === 'known' &&
        typeof quotaResult.remainingFraction === 'number' &&
        Number.isFinite(quotaResult.remainingFraction);

      if (isKnown) {
        acc.quota = {
          remainingFraction: quotaResult.remainingFraction,
          usedPercentage: typeof quotaResult.usedPercentage === 'number'
            ? quotaResult.usedPercentage
            : Math.round((1 - quotaResult.remainingFraction) * 1000) / 10,
          window: quotaResult.window || '5 hs',
          status: 'known',
          lastCheckedAt: quotaResult.lastCheckedAt || new Date().toISOString(),
        };
        acc.status = 'healthy';
      } else {
        // Refresh failure or degraded response: retain verified quota if present
        if (acc.quota && typeof acc.quota.remainingFraction === 'number' && acc.quota.status !== 'unknown') {
          acc.quota = {
            ...acc.quota,
            status: 'stale',
          };
          acc.status = 'degraded';
        } else {
          acc.quota = {
            remainingFraction: 0,
            window: '5 hs',
            status: 'unknown',
          };
          acc.status = 'unknown';
        }
      }

      signal?.throwIfAborted();
      this.writeState(state);
      return true;
    }, signal);
  }

  /**
   * Release all leases belonging to a specific session and PID.
   *
   * @param {string} sessionId
   * @param {number} [pid]
   */
  async releaseSessionLeases(sessionId, pid = process.pid) {
    if (!sessionId) return;

    return this.withLock(async () => {
      const state = this.readState();
      this.cleanDeadProcessLeases(state);

      let changed = false;
      for (const [key, lease] of Object.entries(state.leases || {})) {
        if (lease.sessionId === sessionId && lease.pid === pid) {
          delete state.leases[key];
          changed = true;
        }
      }

      if (changed) {
        this.writeState(state);
      }
    });
  }
}
