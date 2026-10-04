import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PoolStateStore, buildLeaseId } from '../src/store.js';
import { registerPoolLifecycle } from '../src/lifecycle.js';

class MockPiEventBus {
  constructor() {
    this.handlers = new Map();
  }
  on(channel, handler) {
    const list = this.handlers.get(channel) ?? [];
    list.push(handler);
    this.handlers.set(channel, list);
    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }
  emit(channel, data) {
    const list = this.handlers.get(channel) ?? [];
    for (const h of list) h(data);
  }
}

describe('CPAMC Pool comprehensive scenario suite', () => {
  it('handles overlapping concurrent launches with atomic serialized candidate selection', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-overlap-test-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      const accounts = [
        { prefix: 'pdas', authIndex: '0', status: 'healthy' },
        { prefix: 'j0k3r2', authIndex: '1', status: 'healthy' },
        { prefix: 'j0k3r3', authIndex: '2', status: 'healthy' },
      ];
      await store.initAccounts(accounts);

      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, {
        store,
        discoverAccountsFn: async () => accounts,
        fetchQuotaFn: async (idx) => {
          // pdas: 90% remaining, j0k3r2: 80% remaining, j0k3r3: 70% remaining
          const remaining = idx === '0' ? 0.9 : idx === '1' ? 0.8 : 0.7;
          return { remainingFraction: remaining, usedPercentage: (1 - remaining) * 100 };
        },
      });

      // Launch 3 tasks concurrently
      const launchTask = async (taskId) => {
        let claimFn = null;
        bus.emit('subagents:task:allocate', {
          taskId,
          attempt: 1,
          parentSessionId: 'session-main',
          agent: 'discovery',
          cwd: tmpDir,
          signal: new AbortController().signal,
          claimModel: (fn) => { claimFn = fn; },
        });
        assert.ok(claimFn);
        return claimFn(new AbortController().signal);
      };

      const [res1, res2, res3] = await Promise.all([
        launchTask('task-a'),
        launchTask('task-b'),
        launchTask('task-c'),
      ]);

      const models = [res1?.model?.id, res2?.model?.id, res3?.model?.id];
      // All 3 accounts should have been chosen without double-assigning the same idle account
      assert.ok(models.includes('pdas/gemini-3.8-flash-high'));
      assert.ok(models.includes('j0k3r2/gemini-3.8-flash-high'));
      assert.ok(models.includes('j0k3r3/gemini-3.8-flash-high'));

      const finalState = await store.getState();
      assert.equal(Object.keys(finalState.leases).length, 3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles continuation race where attempt 1 cleanup fires concurrently with attempt 2 launch', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-race-test-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      const accounts = [{ prefix: 'pdas', authIndex: '0', status: 'healthy' }];
      await store.initAccounts(accounts);

      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, {
        store,
        discoverAccountsFn: async () => accounts,
        fetchQuotaFn: async () => ({ remainingFraction: 0.9, usedPercentage: 10.0 }),
      });

      // Attempt 1 allocated
      let claimFn1 = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'cont-task',
        attempt: 1,
        parentSessionId: 'sess-1',
        agent: 'discovery',
        cwd: tmpDir,
        signal: new AbortController().signal,
        claimModel: (fn) => { claimFn1 = fn; },
      });
      await claimFn1(new AbortController().signal);

      // Attempt 1 registers terminal cleanup callback
      let termCleanup1 = null;
      bus.emit('subagents:task:terminal', {
        taskId: 'cont-task',
        attempt: 1,
        parentSessionId: 'sess-1',
        status: 'completed',
        registerCleanup: (fn) => { termCleanup1 = fn; },
      });

      // Meanwhile, continuation starts attempt 2
      let claimFn2 = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'cont-task',
        attempt: 2,
        parentSessionId: 'sess-1',
        agent: 'discovery',
        cwd: tmpDir,
        signal: new AbortController().signal,
        claimModel: (fn) => { claimFn2 = fn; },
      });
      await claimFn2(new AbortController().signal);

      // Now run terminal cleanup 1 (which raced)
      assert.ok(termCleanup1);
      await termCleanup1();

      // State MUST retain attempt 2 lease
      const cont1 = buildLeaseId({ sessionId: 'sess-1', pid: process.pid, taskId: 'cont-task', attempt: 1 });
      const cont2 = buildLeaseId({ sessionId: 'sess-1', pid: process.pid, taskId: 'cont-task', attempt: 2 });
      const state = await store.getState();
      assert.equal(state.leases[cont1], undefined);
      assert.ok(state.leases[cont2]);
      assert.equal(state.leases[cont2].attempt, 2);
      assert.equal(state.leases[cont2].account, 'pdas');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles abort during launch discovery without committing a lease', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-abort-lock-test-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([]);

      const bus = new MockPiEventBus();
      const abortCtrl = new AbortController();

      registerPoolLifecycle({ events: bus }, {
        store,
        discoverAccountsFn: async () => {
          // Abort during discovery
          abortCtrl.abort();
          return [{ prefix: 'pdas', authIndex: '0', status: 'healthy' }];
        },
      });

      let claimFn = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'abort-during-discovery',
        attempt: 1,
        parentSessionId: 'sess-1',
        agent: 'discovery',
        cwd: tmpDir,
        signal: abortCtrl.signal,
        claimModel: (fn) => { claimFn = fn; },
      });

      const res = await claimFn(abortCtrl.signal);
      assert.equal(res, undefined);

      const state = await store.getState();
      const leaseKey = buildLeaseId({ sessionId: 'sess-1', pid: process.pid, taskId: 'abort-during-discovery', attempt: 1 });
      assert.equal(state.leases[leaseKey], undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('propagates cancellation into a real allocator lock wait without needing terminal cleanup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-lifecycle-lock-'));
    try {
      const store = new PoolStateStore({ stateFile: path.join(dir, 'state.json') });
      const accounts = [{ prefix: 'a', authIndex: 'a' }];
      await store.initAccounts(accounts);
      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, { store });
      fs.writeFileSync(store.lockFile, JSON.stringify({ pid: process.pid }));
      let allocate;
      bus.emit('subagents:task:allocate', { taskId: 'cancelled', parentSessionId: 'A', claimModel: (fn) => { allocate = fn; } });
      const controller = new AbortController();
      const pending = allocate(controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 30));
      controller.abort();
      const result = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve('pending'), 100))]);
      assert.equal(result, undefined);
      const leaseKey = buildLeaseId({ sessionId: 'A', pid: process.pid, taskId: 'cancelled', attempt: 1 });
      assert.equal(store.readState().leases[leaseKey], undefined);
      assert.ok(fs.existsSync(store.lockFile));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('isolates explicit session lease release (not a runtime shutdown simulation)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-multi-sess-test-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      const accounts = [
        { prefix: 'pdas', authIndex: '0', status: 'healthy' },
        { prefix: 'j0k3r2', authIndex: '1', status: 'healthy' },
      ];
      await store.initAccounts(accounts);

      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, {
        store,
        discoverAccountsFn: async () => accounts,
        fetchQuotaFn: async () => ({ remainingFraction: 0.9, usedPercentage: 10.0 }),
      });

      // Session A allocates
      let claimA = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-A',
        attempt: 1,
        parentSessionId: 'session-A',
        agent: 'discovery',
        cwd: tmpDir,
        signal: new AbortController().signal,
        claimModel: (fn) => { claimA = fn; },
      });
      await claimA(new AbortController().signal);

      // Session B allocates
      let claimB = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-B',
        attempt: 1,
        parentSessionId: 'session-B',
        agent: 'discovery',
        cwd: tmpDir,
        signal: new AbortController().signal,
        claimModel: (fn) => { claimB = fn; },
      });
      await claimB(new AbortController().signal);

      let state = await store.getState();
      const leaseA = buildLeaseId({ sessionId: 'session-A', pid: process.pid, taskId: 'task-A', attempt: 1 });
      const leaseB = buildLeaseId({ sessionId: 'session-B', pid: process.pid, taskId: 'task-B', attempt: 1 });
      assert.ok(state.leases[leaseA]);
      assert.ok(state.leases[leaseB]);

      // Session A shuts down
      await store.releaseSessionLeases('session-A', process.pid);

      state = await store.getState();
      assert.equal(state.leases[leaseA], undefined);
      assert.ok(state.leases[leaseB]); // Session B intact
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('end-to-end cached launch, nonblocking terminal, asynchronous single-account refresh, and updated ranking', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-e2e-scenario-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      // Initially, acc-1 has 0.90 quota, acc-2 has 0.80 quota
      const accounts = [
        { prefix: 'acc-1', authIndex: 'auth-1', status: 'healthy', quota: { remainingFraction: 0.9, usedPercentage: 10, window: '5 hs', lastCheckedAt: '2026-10-03T00:00:00Z', status: 'known' } },
        { prefix: 'acc-2', authIndex: 'auth-2', status: 'healthy', quota: { remainingFraction: 0.8, usedPercentage: 20, window: '5 hs', lastCheckedAt: '2026-10-03T00:00:00Z', status: 'known' } },
      ];
      await store.initAccounts(accounts);

      let quotaFetchCalls = [];
      let resolveRefresh;
      const refreshGate = new Promise((resolve) => { resolveRefresh = resolve; });

      const fakeQuota = async (authIndex, opts) => {
        quotaFetchCalls.push({ authIndex, opts });
        // Return refreshed quota after refreshGate resolves
        await refreshGate;
        // Used acc-1 now consumed quota down to 0.50
        return {
          remainingFraction: 0.5,
          usedPercentage: 50.0,
          window: '5 hs',
          status: 'known',
          lastCheckedAt: '2026-10-03T05:00:00Z',
        };
      };

      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, {
        store,
        fetchQuotaFn: fakeQuota,
      });

      // 1. Task 1 launches: allocates acc-1 based on saved quota without any HTTP calls
      let claim1 = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-1',
        attempt: 1,
        parentSessionId: 'sess-main',
        claimModel: (fn) => { claim1 = fn; },
      });
      const res1 = await claim1(new AbortController().signal);
      assert.equal(res1?.model?.id, 'acc-1/gemini-3.8-flash-high');
      assert.equal(quotaFetchCalls.length, 0, 'Zero HTTP calls during launch');

      // 2. Task 1 finishes: terminal cleanup registered
      let cleanup1 = null;
      bus.emit('subagents:task:terminal', {
        taskId: 'task-1',
        attempt: 1,
        parentSessionId: 'sess-main',
        registerCleanup: (fn) => { cleanup1 = fn; },
      });
      assert.ok(cleanup1);

      // 3. Cleanup resolves IMMEDIATELY upon lease release while refreshGate is still unresolved
      await cleanup1();

      // Lease is already gone from store!
      const lease1 = buildLeaseId({ sessionId: 'sess-main', pid: process.pid, taskId: 'task-1', attempt: 1 });
      assert.equal(store.readState().leases[lease1], undefined);

      // Quota fetch was initiated for ONLY acc-1 (auth-1)
      assert.equal(quotaFetchCalls.length, 1);
      assert.equal(quotaFetchCalls[0].authIndex, 'auth-1');
      assert.equal(quotaFetchCalls[0].opts.forceFresh, true);

      // 4. Resolve the background quota fetch
      resolveRefresh();
      await new Promise((resolve) => setTimeout(resolve, 30));

      // 5. Store now has acc-1 updated to 0.50, and acc-2 preserved at 0.80
      const stateAfter = store.readState();
      assert.equal(stateAfter.accounts.find((a) => a.prefix === 'acc-1').quota.remainingFraction, 0.5);
      assert.equal(stateAfter.accounts.find((a) => a.prefix === 'acc-2').quota.remainingFraction, 0.8);

      // 6. Next task launch: acc-2 (0.80 remaining) is now preferred over acc-1 (0.50 remaining)!
      let claim2 = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-2',
        attempt: 1,
        parentSessionId: 'sess-main',
        claimModel: (fn) => { claim2 = fn; },
      });
      const res2 = await claim2(new AbortController().signal);
      assert.equal(res2?.model?.id, 'acc-2/gemini-3.8-flash-high');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
