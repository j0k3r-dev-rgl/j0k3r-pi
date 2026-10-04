import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PoolStateStore, buildLeaseId } from '../src/store.js';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

describe('PoolStateStore atomic transactions, multi-owner leases, and orphan recovery', () => {
  it('refreshes inventory atomically preserving cached quotas only for the same account identity', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-inventory-'));
    try {
      const store = new PoolStateStore({ stateFile: path.join(dir, 'state.json') });
      const quota = { remainingFraction: 0.8, status: 'known', window: '5 hs', lastCheckedAt: '2026-01-01T00:00:00Z' };
      await store.initAccounts([{ prefix: 'keep', authIndex: 'keep', quota, status: 'healthy', lastRequestStartedAt: 100 }, { prefix: 'changed', authIndex: 'old', quota }, { prefix: 'removed', authIndex: 'removed' }]);
      await store.allocateAccount(new Map(), { taskId: 'live' });
      const leases = store.readState().leases;
      await store.initAccounts([{ prefix: 'keep', authIndex: 'keep', status: 'unknown' }, { prefix: 'changed', authIndex: 'new', status: 'unknown' }]);
      const state = store.readState();
      assert.deepEqual(state.accounts.map((a) => a.prefix), ['keep', 'changed']);
      assert.deepEqual(state.accounts[0].quota, quota);
      assert.equal(state.accounts[0].status, 'healthy');
      assert.equal(state.accounts[0].lastRequestStartedAt, 100);
      assert.equal(state.accounts[1].quota.status, 'unknown');
      assert.equal(state.accounts[1].lastRequestStartedAt, undefined);
      assert.deepEqual(state.leases, leases);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('cancels inventory refresh before committing a new state', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-inventory-cancel-'));
    try {
      const store = new PoolStateStore({ stateFile: path.join(dir, 'state.json') });
      await store.initAccounts([{ prefix: 'keep', authIndex: 'keep' }]);
      const before = fs.readFileSync(store.stateFile, 'utf8');
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(store.initAccounts([{ prefix: 'late', authIndex: 'late' }], { signal: controller.signal }), { name: 'AbortError' });
      assert.equal(fs.readFileSync(store.stateFile, 'utf8'), before);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('cancels advisory and in-process lock waits without a late lease or foreign lock deletion', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-lock-cancel-'));
    try {
      const store = new PoolStateStore({ stateFile: path.join(dir, 'state.json') });
      await store.initAccounts([{ prefix: 'a', authIndex: 'a' }]);
      for (const inProcess of [false, true]) {
        const controller = new AbortController();
        let release;
        let holder;
        if (inProcess) holder = store.withLock(() => new Promise((resolve) => { release = resolve; }));
        else fs.writeFileSync(store.lockFile, 'foreign lock');
        await new Promise((resolve) => setTimeout(resolve, 10));
        const pending = store.allocateAccount(new Map(), { taskId: 'cancelled', signal: controller.signal });
        controller.abort();
        const outcome = await Promise.race([pending.then(() => 'committed', (err) => err.name), new Promise((resolve) => setTimeout(() => resolve('pending'), 100))]);
        assert.equal(outcome, 'AbortError');
        assert.equal(store.readState().leases['cancelled:1'], undefined);
        assert.ok(fs.existsSync(store.lockFile));
        if (inProcess) { release(); await holder; } else fs.unlinkSync(store.lockFile);
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('serializes real overlapping process allocations without stealing a live old lock', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-process-lock-'));
    const children = [];
    try {
      const stateFile = path.join(dir, 'state.json');
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([{ prefix: 'a', authIndex: 'a' }, { prefix: 'b', authIndex: 'b' }]);
      fs.writeFileSync(store.lockFile, JSON.stringify({ pid: process.pid }));
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(store.lockFile, old, old);
      const modulePath = fileURLToPath(new URL('../src/store.js', import.meta.url));
      for (let i = 0; i < 2; i++) {
        const child = fork(fileURLToPath(new URL('./store-worker.js', import.meta.url)), [modulePath, stateFile, `child-${i}`], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
        children.push(child);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(Object.keys(store.readState().leases).length, 0);
      assert.ok(fs.existsSync(store.lockFile));
      const results = children.map((child) => once(child, 'message'));
      fs.unlinkSync(store.lockFile);
      await Promise.all(results);
      const state = store.readState();
      assert.equal(Object.keys(state.leases).length, 2);
      assert.deepEqual(new Set(Object.values(state.leases).map((lease) => lease.account)), new Set(['a', 'b']));
      for (const child of children) child.send('exit');
      await Promise.all(children.map((child) => once(child, 'exit')));
    } finally {
      for (const child of children) if (child.exitCode === null) child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('checks cancellation at commit boundary', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-commit-cancel-'));
    try {
      const store = new PoolStateStore({ stateFile: path.join(dir, 'state.json') });
      await store.initAccounts([{ prefix: 'a', authIndex: 'a' }]);
      const controller = new AbortController();
      const read = store.readState.bind(store);
      store.readState = () => { const state = read(); controller.abort(); return state; };
      await assert.rejects(store.allocateAccount(new Map(), { taskId: 'cancelled', signal: controller.signal }), { name: 'AbortError' });
      assert.equal(read().leases['cancelled:1'], undefined);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('retains persisted known quota as stale when refreshed discovery cannot verify quota', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-stale-store-'));
    try {
      const store = new PoolStateStore({ stateFile: path.join(dir, 'state.json') });
      const quota = { remainingFraction: 0.6, usedPercentage: 40, lastCheckedAt: '2026-01-01T00:00:00Z', status: 'known' };
      await store.initAccounts([{ prefix: 'a', authIndex: 'a', status: 'healthy', quota }]);
      await store.allocateAccount(new Map([['a', { remainingFraction: 0, status: 'unknown' }]]), { taskId: 'stale' }, [{ prefix: 'a', authIndex: 'a', status: 'unknown' }]);
      const account = store.readState().accounts[0];
      assert.equal(account.quota.remainingFraction, 0.6);
      assert.equal(account.quota.lastCheckedAt, quota.lastCheckedAt);
      assert.equal(account.quota.status, 'stale');
      assert.equal(account.status, 'degraded');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('performs atomic choose + acquire transaction under advisory lockfile', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-store-test-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      const accounts = [
        { prefix: 'pdas', authIndex: '0', email: 'pdas@test.com', status: 'healthy' },
        { prefix: 'j0k3r2', authIndex: '1', email: 'j0k3r2@test.com', status: 'healthy' },
      ];
      await store.initAccounts(accounts);

      const quotaMap = new Map([
        ['pdas', { remainingFraction: 0.9, usedPercentage: 10.0 }],
        ['j0k3r2', { remainingFraction: 0.8, usedPercentage: 20.0 }],
      ]);

      const allocated = await store.allocateAccount(quotaMap, {
        taskId: 'task-1',
        attempt: 1,
        sessionId: 'session-A',
        pid: process.pid,
      });

      assert.equal(allocated, 'pdas');

      // Verify state file on disk
      const leaseKey1 = buildLeaseId({ sessionId: 'session-A', pid: process.pid, taskId: 'task-1', attempt: 1 });
      const diskState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.equal(diskState.version, 1);
      assert.ok(diskState.leases[leaseKey1]);
      assert.equal(diskState.leases[leaseKey1].account, 'pdas');
      assert.equal(diskState.leases[leaseKey1].attempt, 1);
      assert.equal(diskState.leases[leaseKey1].sessionId, 'session-A');
      assert.equal(diskState.leases[leaseKey1].pid, process.pid);

      // Now pdas is busy; next allocation should pick j0k3r2
      const allocated2 = await store.allocateAccount(quotaMap, {
        taskId: 'task-2',
        attempt: 1,
        sessionId: 'session-A',
        pid: process.pid,
      });
      assert.equal(allocated2, 'j0k3r2');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('preserves attempt-specific leases so old terminal callback does not remove new continuation lease', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-continuation-test-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'pdas', authIndex: '0', email: 'pdas@test.com', status: 'healthy' },
      ]);

      // Attempt 1 allocated
      await store.allocateAccount(new Map(), {
        taskId: 'task-cont',
        attempt: 1,
        sessionId: 'session-1',
        pid: process.pid,
      });

      // Attempt 2 allocated (continuation)
      await store.allocateAccount(new Map(), {
        taskId: 'task-cont',
        attempt: 2,
        sessionId: 'session-1',
        pid: process.pid,
      });

      let state = await store.getState();
      const cont1 = buildLeaseId({ sessionId: 'session-1', pid: process.pid, taskId: 'task-cont', attempt: 1 });
      const cont2 = buildLeaseId({ sessionId: 'session-1', pid: process.pid, taskId: 'task-cont', attempt: 2 });
      assert.ok(state.leases[cont1]);
      assert.ok(state.leases[cont2]);

      // Attempt 1 terminal callback runs late
      await store.removeLease({
        taskId: 'task-cont',
        attempt: 1,
        sessionId: 'session-1',
        pid: process.pid,
      });

      state = await store.getState();
      assert.equal(state.leases[cont1], undefined);
      // Attempt 2 lease MUST be intact!
      assert.ok(state.leases[cont2]);
      assert.equal(state.leases[cont2].attempt, 2);

      // Now attempt 2 finishes
      await store.removeLease({
        taskId: 'task-cont',
        attempt: 2,
        sessionId: 'session-1',
        pid: process.pid,
      });

      state = await store.getState();
      assert.equal(state.leases[cont2], undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reclaims dead-process leases while preserving live subagents indefinitely', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-orphan-test-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      // Create state with one live PID (process.pid) and one dead PID (e.g. 99999999)
      const deadPid = 99999999;
      const initial = {
        version: 1,
        updatedAt: new Date().toISOString(),
        accounts: [
          { prefix: 'pdas', authIndex: '0', email: 'pdas@test.com', status: 'healthy' },
          { prefix: 'j0k3r2', authIndex: '1', email: 'j0k3r2@test.com', status: 'healthy' },
        ],
        leases: {
          'dead-task:1': {
            id: 'dead-task:1',
            account: 'pdas',
            taskId: 'dead-task',
            attempt: 1,
            sessionId: 'session-dead',
            pid: deadPid,
            createdAt: '2026-10-02T00:00:00.000Z',
          },
          'live-task:1': {
            id: 'live-task:1',
            account: 'j0k3r2',
            taskId: 'live-task',
            attempt: 1,
            sessionId: 'session-live',
            pid: process.pid,
            createdAt: '2026-10-02T00:00:00.000Z',
          },
        },
      };
      fs.writeFileSync(stateFile, JSON.stringify(initial));

      const store = new PoolStateStore({ stateFile });
      // Trigger orphan recovery via allocate or getState
      await store.recoverDeadProcessLeases();

      const diskState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      // Dead lease was reclaimed
      assert.equal(diskState.leases['dead-task:1'], undefined);
      // Live lease is preserved indefinitely
      assert.ok(diskState.leases['live-task:1']);
      assert.equal(diskState.leases['live-task:1'].pid, process.pid);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('releases session leases without touching sibling session leases', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-session-release-test-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'pdas', authIndex: '0', email: 'pdas@test.com', status: 'healthy' },
        { prefix: 'j0k3r2', authIndex: '1', email: 'j0k3r2@test.com', status: 'healthy' },
      ]);

      await store.allocateAccount(new Map(), {
        taskId: 't-sess-A',
        attempt: 1,
        sessionId: 'session-A',
        pid: process.pid,
      });

      await store.allocateAccount(new Map(), {
        taskId: 't-sess-B',
        attempt: 1,
        sessionId: 'session-B',
        pid: process.pid,
      });

      // Release session A
      await store.releaseSessionLeases('session-A', process.pid);

      const state = await store.getState();
      const sessA = buildLeaseId({ sessionId: 'session-A', pid: process.pid, taskId: 't-sess-A', attempt: 1 });
      const sessB = buildLeaseId({ sessionId: 'session-B', pid: process.pid, taskId: 't-sess-B', attempt: 1 });
      assert.equal(state.leases[sessA], undefined);
      assert.ok(state.leases[sessB]);
      assert.equal(state.leases[sessB].sessionId, 'session-B');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('isolates distinct PIDs in same session with injectable liveness recovery', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-pid-sess-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const livePid = 1001;
      const deadPid = 1002;
      const store = new PoolStateStore({
        stateFile,
        isPidAlive: (pid) => pid === livePid,
      });
      await store.initAccounts([
        { prefix: 'pdas', authIndex: '0', email: 'pdas@test.com', status: 'healthy' },
        { prefix: 'j0k3r2', authIndex: '1', email: 'j0k3r2@test.com', status: 'healthy' },
      ]);

      const keyLive = buildLeaseId({ sessionId: 'shared-sess', pid: livePid, taskId: 'same-task', attempt: 1 });
      const keyDead = buildLeaseId({ sessionId: 'shared-sess', pid: deadPid, taskId: 'same-task', attempt: 1 });

      await store.allocateAccount(new Map(), {
        taskId: 'same-task',
        attempt: 1,
        sessionId: 'shared-sess',
        pid: livePid,
      });

      await store.allocateAccount(new Map(), {
        taskId: 'same-task',
        attempt: 1,
        sessionId: 'shared-sess',
        pid: deadPid,
      });

      let state = store.readState();
      assert.ok(state.leases[keyLive], 'Live PID lease must exist');
      assert.ok(state.leases[keyDead], 'Dead PID lease must exist before recovery');
      assert.equal(Object.keys(state.leases).length, 2);

      // Trigger recovery with injectable liveness
      await store.recoverDeadProcessLeases();

      state = store.readState();
      assert.ok(state.leases[keyLive], 'Live PID lease must be preserved');
      assert.equal(state.leases[keyDead], undefined, 'Dead PID lease must be reclaimed');
      assert.equal(Object.keys(state.leases).length, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('unambiguously distinguishes undefined vs literal session string and complex delimiters', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-delim-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'pdas', authIndex: '0', status: 'healthy' },
        { prefix: 'j0k3r2', authIndex: '1', status: 'healthy' },
        { prefix: 'j0k3r3', authIndex: '2', status: 'healthy' },
      ]);

      const keyUndef = buildLeaseId({ sessionId: undefined, pid: process.pid, taskId: 'delim-task', attempt: 1 });
      const keyLiteralUndef = buildLeaseId({ sessionId: 'undefined', pid: process.pid, taskId: 'delim-task', attempt: 1 });
      const keyComplex = buildLeaseId({ sessionId: 'sess:1/2', pid: process.pid, taskId: 'task:a/b', attempt: 1 });

      assert.notEqual(keyUndef, keyLiteralUndef, 'undefined session must not collide with literal "undefined" string');
      assert.notEqual(keyUndef, keyComplex);
      assert.notEqual(keyLiteralUndef, keyComplex);

      await store.allocateAccount(new Map(), { taskId: 'delim-task', attempt: 1, sessionId: undefined, pid: process.pid });
      await store.allocateAccount(new Map(), { taskId: 'delim-task', attempt: 1, sessionId: 'undefined', pid: process.pid });
      await store.allocateAccount(new Map(), { taskId: 'task:a/b', attempt: 1, sessionId: 'sess:1/2', pid: process.pid });

      let state = store.readState();
      assert.equal(Object.keys(state.leases).length, 3);
      assert.ok(state.leases[keyUndef]);
      assert.ok(state.leases[keyLiteralUndef]);
      assert.ok(state.leases[keyComplex]);

      // Remove undefined session lease; literal "undefined" and complex must survive
      await store.removeLease({ taskId: 'delim-task', attempt: 1, sessionId: undefined, pid: process.pid });
      state = store.readState();
      assert.equal(state.leases[keyUndef], undefined);
      assert.ok(state.leases[keyLiteralUndef]);
      assert.ok(state.leases[keyComplex]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('preserves earlier reservation affinity idempotently on repeated allocation with identical owner identity', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-idempotent-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'pdas', authIndex: '0', status: 'healthy' },
        { prefix: 'j0k3r2', authIndex: '1', status: 'healthy' },
      ]);

      const quotaMap = new Map([
        ['pdas', { remainingFraction: 0.9 }],
        ['j0k3r2', { remainingFraction: 0.8 }],
      ]);

      const firstAlloc = await store.allocateAccount(quotaMap, {
        taskId: 'idempotent-task',
        attempt: 1,
        sessionId: 'owner-idem',
        pid: process.pid,
      });
      assert.equal(firstAlloc, 'pdas');

      // Now change quota so j0k3r2 has higher quota; repeated allocation for same owner MUST retain earlier pdas affinity
      const updatedQuota = new Map([
        ['pdas', { remainingFraction: 0.5 }],
        ['j0k3r2', { remainingFraction: 0.95 }],
      ]);

      const secondAlloc = await store.allocateAccount(updatedQuota, {
        taskId: 'idempotent-task',
        attempt: 1,
        sessionId: 'owner-idem',
        pid: process.pid,
      });
      assert.equal(secondAlloc, 'pdas', 'Repeated allocation for same complete owner identity must return earlier reservation');

      const state = store.readState();
      assert.equal(Object.keys(state.leases).length, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('safely releases legacy taskId:attempt records only when owner matches, protecting unrelated owners', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-legacy-release-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const store = new PoolStateStore({ stateFile, isPidAlive: () => true });
      const initial = {
        version: 1,
        updatedAt: new Date().toISOString(),
        accounts: [{ prefix: 'pdas', authIndex: '0', status: 'healthy' }],
        leases: {
          'legacy-task:1': {
            id: 'legacy-task:1',
            account: 'pdas',
            taskId: 'legacy-task',
            attempt: 1,
            sessionId: 'owner-orig',
            pid: 5555,
            createdAt: '2026-10-02T00:00:00.000Z',
          },
        },
      };
      fs.writeFileSync(stateFile, JSON.stringify(initial));

      // Attempt release by foreign session; must NOT delete legacy record
      await store.removeLease({ taskId: 'legacy-task', attempt: 1, sessionId: 'owner-foreign', pid: 5555 });
      assert.ok(store.readState().leases['legacy-task:1'], 'Unrelated session must not remove legacy record');

      // Attempt release by foreign PID; must NOT delete legacy record
      await store.removeLease({ taskId: 'legacy-task', attempt: 1, sessionId: 'owner-orig', pid: 9999 });
      assert.ok(store.readState().leases['legacy-task:1'], 'Unrelated PID must not remove legacy record');

      // Release by exact owner; MUST delete legacy record
      await store.removeLease({ taskId: 'legacy-task', attempt: 1, sessionId: 'owner-orig', pid: 5555 });
      assert.equal(store.readState().leases['legacy-task:1'], undefined, 'Exact owner must safely remove legacy record');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('removeLease returns { account, authIndex } of released lease or null on mismatch', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-release-info-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'pdas', authIndex: 'auth-0', email: 'pdas@test.com', status: 'healthy' },
      ]);

      await store.allocateAccount(new Map(), {
        taskId: 'info-task',
        attempt: 1,
        sessionId: 'sess-owner',
        pid: process.pid,
      });

      // Mismatched session should return null
      const mismatch = await store.removeLease({
        taskId: 'info-task',
        attempt: 1,
        sessionId: 'sess-wrong',
        pid: process.pid,
      });
      assert.equal(mismatch, null);

      // Non-existent task should return null
      const nonExistent = await store.removeLease({
        taskId: 'non-existent',
        attempt: 1,
        sessionId: 'sess-owner',
        pid: process.pid,
      });
      assert.equal(nonExistent, null);

      // Exact owner should release and return { account, authIndex }
      const released = await store.removeLease({
        taskId: 'info-task',
        attempt: 1,
        sessionId: 'sess-owner',
        pid: process.pid,
      });
      assert.deepEqual(released, { account: 'pdas', authIndex: 'auth-0' });

      // Second release of already removed lease returns null
      const secondRelease = await store.removeLease({
        taskId: 'info-task',
        attempt: 1,
        sessionId: 'sess-owner',
        pid: process.pid,
      });
      assert.equal(secondRelease, null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('updateAccountQuota updates only targeted account and preserves leases and other accounts', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-update-quota-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'acc-1', authIndex: 'idx-1', status: 'healthy', quota: { remainingFraction: 0.9, status: 'known', window: '5 hs', lastCheckedAt: '2026-01-01T00:00:00Z' } },
        { prefix: 'acc-2', authIndex: 'idx-2', status: 'healthy', quota: { remainingFraction: 0.8, status: 'known', window: '5 hs', lastCheckedAt: '2026-01-01T00:00:00Z' } },
      ]);

      // Create an active lease on acc-2
      await store.allocateAccount(new Map(), {
        taskId: 'task-keep',
        attempt: 1,
        sessionId: 'sess-1',
        pid: process.pid,
      });

      // Update quota for acc-1 only
      const freshQuota = {
        remainingFraction: 0.75,
        usedPercentage: 25.0,
        window: '5 hs',
        status: 'known',
        lastCheckedAt: '2026-10-03T05:00:00Z',
      };
      await store.updateAccountQuota('acc-1', freshQuota, { requestStartedAt: 1000 });

      const state = store.readState();
      // acc-1 is updated
      const acc1 = state.accounts.find((a) => a.prefix === 'acc-1');
      assert.equal(acc1.quota.remainingFraction, 0.75);
      assert.equal(acc1.quota.lastCheckedAt, '2026-10-03T05:00:00Z');
      assert.equal(acc1.status, 'healthy');

      // acc-2 is untouched
      const acc2 = state.accounts.find((a) => a.prefix === 'acc-2');
      assert.equal(acc2.quota.remainingFraction, 0.8);
      assert.equal(acc2.quota.lastCheckedAt, '2026-01-01T00:00:00Z');

      // Lease on acc-2 is intact
      const leaseKey = buildLeaseId({ sessionId: 'sess-1', pid: process.pid, taskId: 'task-keep', attempt: 1 });
      assert.ok(state.leases[leaseKey]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('updateAccountQuota rejects out-of-order older response via request-start ordering', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-out-of-order-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'acc-1', authIndex: 'idx-1', status: 'healthy', quota: { remainingFraction: 0.9, status: 'known', window: '5 hs', lastCheckedAt: '2026-01-01T00:00:00Z' } },
      ]);

      // Request 2 (started at t=2000) arrives FIRST
      const quotaNew = {
        remainingFraction: 0.6,
        status: 'known',
        window: '5 hs',
        lastCheckedAt: '2026-10-03T05:02:00Z',
      };
      const ok2 = await store.updateAccountQuota('acc-1', quotaNew, { requestStartedAt: 2000 });
      assert.equal(ok2, true);

      // Verify newer quota committed
      let state = store.readState();
      assert.equal(state.accounts[0].quota.remainingFraction, 0.6);

      // Request 1 (started earlier at t=1000) arrives LATER
      const quotaOld = {
        remainingFraction: 0.85,
        status: 'known',
        window: '5 hs',
        lastCheckedAt: '2026-10-03T05:01:00Z',
      };
      const ok1 = await store.updateAccountQuota('acc-1', quotaOld, { requestStartedAt: 1000 });
      assert.equal(ok1, false, 'Older request must be rejected');

      // State must still hold quotaNew (0.6), NOT quotaOld (0.85)
      state = store.readState();
      assert.equal(state.accounts[0].quota.remainingFraction, 0.6);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('updateAccountQuota retains verified quota as stale with original lastCheckedAt on refresh failure', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-failure-retention-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      const origTimestamp = '2026-10-03T01:00:00.000Z';
      await store.initAccounts([
        {
          prefix: 'acc-1',
          authIndex: 'idx-1',
          status: 'healthy',
          quota: {
            remainingFraction: 0.88,
            usedPercentage: 12.0,
            window: '5 hs',
            lastCheckedAt: origTimestamp,
            status: 'known',
          },
        },
      ]);

      // Refresh fails: returns { status: 'unknown', remainingFraction: 0 }
      await store.updateAccountQuota('acc-1', { remainingFraction: 0, status: 'unknown' }, { requestStartedAt: 5000 });

      const state = store.readState();
      const acc = state.accounts[0];
      // Verified fraction must NOT be wiped to 0
      assert.equal(acc.quota.remainingFraction, 0.88);
      // Original timestamp MUST be preserved
      assert.equal(acc.quota.lastCheckedAt, origTimestamp);
      // Status annotated as stale, account degraded
      assert.equal(acc.quota.status, 'stale');
      assert.equal(acc.status, 'degraded');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('updateAccountQuota respects abort signal', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-quota-abort-'));
    const stateFile = path.join(tmpDir, 'pool-state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'acc-1', authIndex: 'idx-1', status: 'healthy', quota: { remainingFraction: 0.9, status: 'known', window: '5 hs' } },
      ]);

      const controller = new AbortController();
      controller.abort(); // already aborted

      await assert.rejects(
        store.updateAccountQuota('acc-1', { remainingFraction: 0.5, status: 'known' }, { signal: controller.signal }),
        { name: 'AbortError' },
      );

      // Verify no changes committed
      const state = store.readState();
      assert.equal(state.accounts[0].quota.remainingFraction, 0.9);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
