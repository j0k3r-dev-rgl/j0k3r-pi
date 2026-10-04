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

describe('Pool extension lifecycle wiring and Pi events', () => {
  it('discovers at session start even with cached inventory, preserving quotas and live leases', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-startup-'));
    try {
      const store = new PoolStateStore({ stateFile: path.join(dir, 'state.json') });
      const quota = { remainingFraction: 0.6, status: 'known', window: '5 hs', lastCheckedAt: '2026-01-01T00:00:00Z' };
      await store.initAccounts([{ prefix: 'existing', authIndex: 'old-index', quota, status: 'healthy', lastRequestStartedAt: 123 }]);
      await store.allocateAccount(new Map(), { taskId: 'running', sessionId: 'other-owner' });
      const leases = store.readState().leases;
      const bus = new MockPiEventBus();
      const handlers = new Map();
      let discoveries = 0;
      registerPoolLifecycle({ events: bus, on: (name, fn) => { handlers.set(name, fn); } }, {
        store,
        discoverAccountsFn: async ({ signal }) => {
          assert.equal(signal.aborted, false);
          discoveries++;
          return [{ prefix: 'existing', authIndex: 'old-index', status: 'unknown' }, { prefix: 'new-gemini', authIndex: 'new-index', status: 'unknown' }];
        },
        fetchQuotaFn: async () => { throw new Error('Startup must not request quotas'); },
      });
      await handlers.get('session_start')({});
      const state = store.readState();
      assert.equal(discoveries, 1);
      assert.deepEqual(state.accounts.map((a) => a.prefix), ['existing', 'new-gemini']);
      assert.deepEqual(state.accounts[0].quota, quota);
      assert.equal(state.accounts[0].lastRequestStartedAt, 123);
      assert.equal(state.accounts[0].status, 'healthy');
      assert.equal(state.accounts[1].quota.status, 'unknown');
      assert.deepEqual(state.leases, leases);
      // A warm subagent launch still uses only saved state.
      let allocator;
      bus.emit('subagents:task:allocate', { taskId: 'warm', claimModel: (fn) => { allocator = fn; } });
      assert.ok(await allocator());
      assert.equal(discoveries, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves cached inventory unchanged on empty/failed startup discovery', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-startup-failure-'));
    try {
      const store = new PoolStateStore({ stateFile: path.join(dir, 'state.json') });
      await store.initAccounts([{ prefix: 'cached', authIndex: 'cached' }]);
      const before = fs.readFileSync(store.stateFile, 'utf8');
      for (const fails of [false, true]) {
        const handlers = new Map();
        registerPoolLifecycle({ events: new MockPiEventBus(), on: (name, fn) => { handlers.set(name, fn); } }, {
          store, discoverAccountsFn: async () => { if (fails) throw new Error('offline'); return []; }, warnFn: () => {},
        });
        await handlers.get('session_start')({});
        assert.equal(fs.readFileSync(store.stateFile, 'utf8'), before);
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('aborts and awaits startup discovery on instance shutdown without committing accounts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-startup-abort-'));
    try {
      const store = new PoolStateStore({ stateFile: path.join(dir, 'state.json') });
      const handlers = new Map();
      let entered;
      const started = new Promise((resolve) => { entered = resolve; });
      let discoverySignal;
      registerPoolLifecycle({ events: new MockPiEventBus(), on: (name, fn) => { handlers.set(name, fn); } }, {
        store, discoverAccountsFn: ({ signal }) => new Promise((resolve) => {
          discoverySignal = signal;
          signal.addEventListener('abort', () => resolve([{ prefix: 'late', authIndex: 'late' }]), { once: true });
          entered();
        }),
      });
      const startup = handlers.get('session_start')({});
      // Fail deterministically instead of hanging against the pre-change handler.
      await Promise.race([started, Promise.resolve(startup)]);
      assert.ok(discoverySignal, 'session_start must initiate discovery');
      await handlers.get('session_shutdown')({ reason: 'reload' });
      await startup;
      assert.equal(discoverySignal.aborted, true);
      assert.equal(fs.existsSync(store.stateFile), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('releases only its owned attempt when cancellation arrives after commit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-postcommit-'));
    try {
      const store = new PoolStateStore({ stateFile: path.join(dir, 'state.json') });
      const accounts = [{ prefix: 'a', authIndex: 'a' }];
      await store.initAccounts(accounts);
      await store.allocateAccount(new Map(), { taskId: 'task', attempt: 2, sessionId: 'owner' });
      const controller = new AbortController();
      const allocate = store.allocateAccount.bind(store);
      store.allocateAccount = async (...args) => { const result = await allocate(...args); controller.abort(); return result; };
      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, { store, discoverAccountsFn: async () => accounts, fetchQuotaFn: async () => ({ remainingFraction: 0.9 }) });
      let allocator;
      bus.emit('subagents:task:allocate', { taskId: 'task', attempt: 1, parentSessionId: 'owner', claimModel: (fn) => { allocator = fn; } });
      assert.equal(await allocator(controller.signal), undefined);
      const lease1 = buildLeaseId({ sessionId: 'owner', pid: process.pid, taskId: 'task', attempt: 1 });
      const lease2 = buildLeaseId({ sessionId: 'owner', pid: process.pid, taskId: 'task', attempt: 2 });
      assert.equal(store.readState().leases[lease1], undefined);
      assert.ok(store.readState().leases[lease2]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('registers claimModel on subagents:task:allocate and allocates model', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-lifecycle-test-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      const accounts = [
        { prefix: 'pdas', authIndex: '0', email: 'pdas@test.com', status: 'healthy' },
      ];
      await store.initAccounts(accounts);

      const bus = new MockPiEventBus();
      const mockPi = { events: bus };

      const fakeDiscover = async () => accounts;
      const fakeFetchQuota = async () => ({
        remainingFraction: 0.9,
        usedPercentage: 10.0,
        window: '5 hs',
        lastCheckedAt: new Date().toISOString(),
      });

      registerPoolLifecycle(mockPi, {
        store,
        discoverAccountsFn: fakeDiscover,
        fetchQuotaFn: fakeFetchQuota,
      });

      let registeredAllocator = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-alloc-1',
        attempt: 1,
        parentSessionId: 'sess-1',
        agent: 'discovery',
        cwd: tmpDir,
        signal: new AbortController().signal,
        claimModel: (allocator) => {
          registeredAllocator = allocator;
        },
      });

      assert.ok(registeredAllocator);
      const claimed = await registeredAllocator(new AbortController().signal);

      assert.deepEqual(claimed, {
        model: { provider: 'cliproxyapi', id: 'pdas/gemini-3.8-flash-high' },
        effort: 'high',
      });

      // Verify lease is present in store
      const leaseKey = buildLeaseId({ sessionId: 'sess-1', pid: process.pid, taskId: 'task-alloc-1', attempt: 1 });
      const state = await store.getState();
      assert.ok(state.leases[leaseKey]);
      assert.equal(state.leases[leaseKey].account, 'pdas');

      // Now emit terminal event
      let cleanupFn = null;
      bus.emit('subagents:task:terminal', {
        taskId: 'task-alloc-1',
        attempt: 1,
        parentSessionId: 'sess-1',
        status: 'completed',
        registerCleanup: (cleanup) => {
          cleanupFn = cleanup;
        },
      });

      assert.ok(cleanupFn);
      await cleanupFn();

      const afterState = await store.getState();
      assert.equal(afterState.leases[leaseKey], undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('prevents late lease commit if signal is aborted before or during allocation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-abort-test-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'pdas', authIndex: '0', email: 'pdas@test.com', status: 'healthy' },
      ]);

      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, {
        store,
        discoverAccountsFn: async () => [{ prefix: 'pdas', authIndex: '0', status: 'healthy' }],
        fetchQuotaFn: async () => ({ remainingFraction: 0.9, usedPercentage: 10.0 }),
      });

      let allocator = null;
      const abortController = new AbortController();
      abortController.abort(); // already aborted!

      bus.emit('subagents:task:allocate', {
        taskId: 'aborted-task',
        attempt: 1,
        parentSessionId: 'sess-1',
        agent: 'discovery',
        cwd: tmpDir,
        signal: abortController.signal,
        claimModel: (fn) => { allocator = fn; },
      });

      assert.ok(allocator);
      const res = await allocator(abortController.signal);
      assert.equal(res, undefined);

      // Verify NO lease was committed
      const abortedKey = buildLeaseId({ sessionId: 'sess-1', pid: process.pid, taskId: 'aborted-task', attempt: 1 });
      const state = await store.getState();
      assert.equal(state.leases[abortedKey], undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('preserves distinct owner leases when different sessions allocate identical task and attempt (ISSUE-003 regression)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-owner-collision-'));
    try {
      const store = new PoolStateStore({ stateFile: path.join(dir, 'state.json') });
      const accounts = [{ prefix: 'a', authIndex: 'opaque-a' }, { prefix: 'b', authIndex: 'opaque-b' }];
      await store.initAccounts(accounts);
      const bus = new MockPiEventBus();
      const unsubscribe = registerPoolLifecycle({ events: bus }, {
        store,
        discoverAccountsFn: async () => accounts,
        fetchQuotaFn: async () => ({ remainingFraction: 0.8, status: 'known', window: '5 hs', lastCheckedAt: new Date().toISOString() }),
      });
      const allocate = async (owner) => {
        let claim;
        bus.emit('subagents:task:allocate', {
          taskId: 'identical-task', attempt: 1, parentSessionId: owner,
          claimModel(fn) { claim = fn; },
        });
        return claim(new AbortController().signal);
      };
      const a = await allocate('owner-A');
      const b = await allocate('owner-B');
      const after = store.readState();

      // Independent model choices across two active allocations
      assert.notEqual(a?.model?.id, b?.model?.id);
      // Both still-active owner attempts must remain leased; B allocation must not overwrite A
      assert.equal(Object.keys(after.leases).length, 2, 'Both still-active owner attempts must remain leased; B allocation must not overwrite A');

      // A terminal removes only A and vice versa
      let releaseA;
      bus.emit('subagents:task:terminal', {
        taskId: 'identical-task', attempt: 1, parentSessionId: 'owner-A',
        registerCleanup(fn) { releaseA = fn; },
      });
      await releaseA();
      const afterATerminal = store.readState();
      assert.equal(Object.keys(afterATerminal.leases).length, 1);
      assert.ok(Object.values(afterATerminal.leases).some((l) => l.sessionId === 'owner-B'));
      assert.ok(!Object.values(afterATerminal.leases).some((l) => l.sessionId === 'owner-A'));

      let releaseB;
      bus.emit('subagents:task:terminal', {
        taskId: 'identical-task', attempt: 1, parentSessionId: 'owner-B',
        registerCleanup(fn) { releaseB = fn; },
      });
      await releaseB();
      const afterBTerminal = store.readState();
      assert.equal(Object.keys(afterBTerminal.leases).length, 0);

      unsubscribe();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('warm launch issues zero HTTP requests (no discoverAccounts, no fetchQuota)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-warm-launch-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      const accounts = [
        {
          prefix: 'pdas',
          authIndex: '0',
          email: 'pdas@test.com',
          status: 'healthy',
          quota: {
            remainingFraction: 0.88,
            usedPercentage: 12.0,
            window: '5 hs',
            lastCheckedAt: '2026-10-03T04:00:00Z',
            status: 'known',
          },
        },
      ];
      await store.initAccounts(accounts);

      let discoverCount = 0;
      let quotaCount = 0;
      const fakeDiscover = async () => { discoverCount++; return accounts; };
      const fakeQuota = async () => { quotaCount++; return { remainingFraction: 0.9 }; };

      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, {
        store,
        discoverAccountsFn: fakeDiscover,
        fetchQuotaFn: fakeQuota,
      });

      let claimFn = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-warm',
        attempt: 1,
        parentSessionId: 'sess-warm',
        agent: 'discovery',
        cwd: tmpDir,
        signal: new AbortController().signal,
        claimModel: (fn) => { claimFn = fn; },
      });

      assert.ok(claimFn);
      const claimed = await claimFn(new AbortController().signal);

      // Allocates model using saved quota directly
      assert.equal(claimed?.model?.id, 'pdas/gemini-3.8-flash-high');
      // ZERO HTTP calls!
      assert.equal(discoverCount, 0, 'Warm launch must issue zero discoverAccounts requests');
      assert.equal(quotaCount, 0, 'Warm launch must issue zero fetchQuota requests');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('cold empty inventory lazily discovers auth files only, never calls quota at launch', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-cold-launch-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      // Cold empty state: 0 accounts
      await store.initAccounts([]);

      let discoverCount = 0;
      let quotaCount = 0;
      const discoveredAccounts = [
        { prefix: 'cold-acc', authIndex: 'auth-cold', email: 'cold@test.com', status: 'unknown' },
      ];
      const fakeDiscover = async () => {
        discoverCount++;
        return discoveredAccounts;
      };
      const fakeQuota = async () => {
        quotaCount++;
        return { remainingFraction: 0.9 };
      };

      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, {
        store,
        discoverAccountsFn: fakeDiscover,
        fetchQuotaFn: fakeQuota,
      });

      let claimFn = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-cold',
        attempt: 1,
        parentSessionId: 'sess-cold',
        agent: 'discovery',
        cwd: tmpDir,
        signal: new AbortController().signal,
        claimModel: (fn) => { claimFn = fn; },
      });

      assert.ok(claimFn);
      const claimed = await claimFn(new AbortController().signal);

      // Discovers auth files lazily
      assert.equal(discoverCount, 1, 'Cold launch must discover auth files');
      // ZERO quota calls even on cold launch!
      assert.equal(quotaCount, 0, 'Cold launch must NEVER call quota endpoints');

      assert.equal(claimed?.model?.id, 'cold-acc/gemini-3.8-flash-high');

      // Accounts committed with unknown quota
      const state = store.readState();
      assert.equal(state.accounts.length, 1);
      assert.equal(state.accounts[0].quota.status, 'unknown');
      assert.equal(state.accounts[0].quota.remainingFraction, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('cold empty inventory cleanly returns undefined when discovery yields no accounts', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-cold-empty-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([]);

      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, {
        store,
        discoverAccountsFn: async () => [],
      });

      let claimFn = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-empty',
        attempt: 1,
        parentSessionId: 'sess-empty',
        agent: 'discovery',
        cwd: tmpDir,
        signal: new AbortController().signal,
        claimModel: (fn) => { claimFn = fn; },
      });

      assert.ok(claimFn);
      const claimed = await claimFn(new AbortController().signal);
      // Clean fallback to undefined
      assert.equal(claimed, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('nonblocking terminal hand-off resolves cleanup immediately while quota fetch is still pending', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-nonblocking-term-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        {
          prefix: 'pdas',
          authIndex: '0',
          email: 'pdas@test.com',
          status: 'healthy',
          quota: { remainingFraction: 0.9, status: 'known', window: '5 hs', lastCheckedAt: '2026-01-01T00:00:00Z' },
        },
      ]);

      let resolveDeferredQuota;
      const deferredQuotaPromise = new Promise((resolve) => {
        resolveDeferredQuota = resolve;
      });

      let quotaFetchStarted = false;
      const fakeQuota = async (authIndex, opts) => {
        quotaFetchStarted = true;
        assert.equal(opts.forceFresh, true, 'Post-run refresh must use forceFresh: true');
        return deferredQuotaPromise;
      };

      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, {
        store,
        fetchQuotaFn: fakeQuota,
      });

      // 1. Allocate task
      let claimFn = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-nonblocking',
        attempt: 1,
        parentSessionId: 'sess-nb',
        claimModel: (fn) => { claimFn = fn; },
      });
      await claimFn(new AbortController().signal);

      const leaseKey = buildLeaseId({ sessionId: 'sess-nb', pid: process.pid, taskId: 'task-nonblocking', attempt: 1 });
      assert.ok(store.readState().leases[leaseKey]);

      // 2. Terminal event fires
      let cleanupFn = null;
      bus.emit('subagents:task:terminal', {
        taskId: 'task-nonblocking',
        attempt: 1,
        parentSessionId: 'sess-nb',
        registerCleanup: (fn) => { cleanupFn = fn; },
      });

      // 3. Await cleanup callback: it MUST resolve immediately while deferredQuotaPromise is still pending!
      assert.ok(cleanupFn);
      await cleanupFn();

      // Lease must be removed ALREADY!
      assert.equal(store.readState().leases[leaseKey], undefined);

      // Meanwhile, background quota fetch was initiated
      assert.equal(quotaFetchStarted, true);

      // Now resolve the background quota fetch
      resolveDeferredQuota({
        remainingFraction: 0.72,
        usedPercentage: 28.0,
        window: '5 hs',
        status: 'known',
        lastCheckedAt: '2026-10-03T05:30:00Z',
      });

      // Wait a tick for background promise to commit
      await new Promise((resolve) => setTimeout(resolve, 50));

      // State file should reflect fresh quota
      const updatedState = store.readState();
      assert.equal(updatedState.accounts[0].quota.remainingFraction, 0.72);
      assert.equal(updatedState.accounts[0].quota.lastCheckedAt, '2026-10-03T05:30:00Z');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('release strictly precedes post-run fetch', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-release-first-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'pdas', authIndex: '0', status: 'healthy', quota: { remainingFraction: 0.9, status: 'known', window: '5 hs' } },
      ]);

      const leaseKey = buildLeaseId({ sessionId: 'sess-rf', pid: process.pid, taskId: 'task-rf', attempt: 1 });

      let leaseAbsentAtFetchStart = false;
      const fakeQuota = async () => {
        // Check store at the exact moment fetch starts: lease MUST already be gone!
        const currentState = store.readState();
        leaseAbsentAtFetchStart = currentState.leases[leaseKey] === undefined;
        return { remainingFraction: 0.85, status: 'known', window: '5 hs', lastCheckedAt: new Date().toISOString() };
      };

      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, {
        store,
        fetchQuotaFn: fakeQuota,
      });

      let claimFn = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-rf',
        attempt: 1,
        parentSessionId: 'sess-rf',
        claimModel: (fn) => { claimFn = fn; },
      });
      await claimFn(new AbortController().signal);

      assert.ok(store.readState().leases[leaseKey]);

      let cleanupFn = null;
      bus.emit('subagents:task:terminal', {
        taskId: 'task-rf',
        attempt: 1,
        parentSessionId: 'sess-rf',
        registerCleanup: (fn) => { cleanupFn = fn; },
      });
      await cleanupFn();

      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(leaseAbsentAtFetchStart, true, 'Lease must be absent from store when post-run fetch initiates');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('failure in background quota refresh retains verified quota as stale and logs visible warning', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-warn-failure-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      const origTimestamp = '2026-10-03T01:00:00.000Z';
      await store.initAccounts([
        {
          prefix: 'pdas',
          authIndex: '0',
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

      const warnings = [];
      const fakeWarn = (msg) => { warnings.push(msg); };

      const fakeQuota = async () => {
        throw new Error('HTTP 500 Internal Server Error Bearer secret-token-xyz');
      };

      const bus = new MockPiEventBus();
      registerPoolLifecycle({ events: bus }, {
        store,
        fetchQuotaFn: fakeQuota,
        warnFn: fakeWarn,
      });

      let claimFn = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-fail',
        attempt: 1,
        parentSessionId: 'sess-fail',
        claimModel: (fn) => { claimFn = fn; },
      });
      await claimFn(new AbortController().signal);

      let cleanupFn = null;
      bus.emit('subagents:task:terminal', {
        taskId: 'task-fail',
        attempt: 1,
        parentSessionId: 'sess-fail',
        registerCleanup: (fn) => { cleanupFn = fn; },
      });
      await cleanupFn();

      // Wait a tick for background fetch failure handling
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Warning was logged and sanitized
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /\[cpamc-subagent-pool\] Background quota refresh failed for account pdas:/);
      assert.doesNotMatch(warnings[0], /secret-token-xyz/, 'Secrets must be sanitized from warnings');

      // Store retains verified quota annotated as stale
      const state = store.readState();
      const acc = state.accounts[0];
      assert.equal(acc.quota.remainingFraction, 0.88);
      assert.equal(acc.quota.lastCheckedAt, origTimestamp);
      assert.equal(acc.quota.status, 'stale');
      assert.equal(acc.status, 'degraded');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('shutdown stops admission first, aborts in-flight, and awaits registry settlement in both handler orders', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-shutdown-orders-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'pdas', authIndex: '0', status: 'healthy', quota: { remainingFraction: 0.9, status: 'known', window: '5 hs' } },
      ]);

      // --- Order A: Pool shutdown runs FIRST, then SubagentManager drains tasks (terminal event fires second) ---
      let quotaCallsA = 0;
      const busA = new MockPiEventBus();
      const mockPiA = {
        events: busA,
        on: (ev, fn) => busA.on(ev, fn),
      };
      registerPoolLifecycle(mockPiA, {
        store,
        fetchQuotaFn: async () => { quotaCallsA++; return { remainingFraction: 0.9 }; },
      });

      // Allocate task
      let claimA = null;
      busA.emit('subagents:task:allocate', {
        taskId: 'task-order-a',
        attempt: 1,
        parentSessionId: 'sess-a',
        claimModel: (fn) => { claimA = fn; },
      });
      await claimA(new AbortController().signal);

      // 1. Shutdown runs first
      busA.emit('session_shutdown', { reason: 'quit' });

      // 2. SubagentManager drains tasks second: terminal event fires
      let cleanupA = null;
      busA.emit('subagents:task:terminal', {
        taskId: 'task-order-a',
        attempt: 1,
        parentSessionId: 'sess-a',
        registerCleanup: (fn) => { cleanupA = fn; },
      });
      assert.ok(cleanupA);
      await cleanupA();

      // Lease was released
      const leaseA = buildLeaseId({ sessionId: 'sess-a', pid: process.pid, taskId: 'task-order-a', attempt: 1 });
      assert.equal(store.readState().leases[leaseA], undefined);
      // Zero new quota requests admitted!
      assert.equal(quotaCallsA, 0, 'No quota refresh should be admitted after shutdown');

      // --- Order B: Terminal event fires FIRST (SubagentManager drains tasks first), then Pool shutdown runs ---
      let abortedSignalB = false;
      let resolveQuotaB;
      const busB = new MockPiEventBus();
      const mockPiB = {
        events: busB,
        on: (ev, fn) => busB.on(ev, fn),
      };
      registerPoolLifecycle(mockPiB, {
        store,
        fetchQuotaFn: async (_idx, opts) => {
          opts.signal?.addEventListener('abort', () => { abortedSignalB = true; });
          return new Promise((resolve) => { resolveQuotaB = resolve; });
        },
      });

      // Allocate task
      let claimB = null;
      busB.emit('subagents:task:allocate', {
        taskId: 'task-order-b',
        attempt: 1,
        parentSessionId: 'sess-b',
        claimModel: (fn) => { claimB = fn; },
      });
      await claimB(new AbortController().signal);

      // 1. Terminal event fires: lease removed, background refresh registered
      let cleanupB = null;
      busB.emit('subagents:task:terminal', {
        taskId: 'task-order-b',
        attempt: 1,
        parentSessionId: 'sess-b',
        registerCleanup: (fn) => { cleanupB = fn; },
      });
      await cleanupB();

      // 2. Shutdown runs second: aborts in-flight and awaits settlement
      let shutdownResolved = false;
      const shutdownPromise = (async () => {
        busB.emit('session_shutdown', { reason: 'quit' });
        shutdownResolved = true;
      })();
      await shutdownPromise;

      assert.equal(shutdownResolved, true);
      assert.equal(abortedSignalB, true, 'In-flight background request must be aborted by shutdown');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('ordinary session replacement does not permanently disable future refreshes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpamc-ordinary-switch-'));
    const stateFile = path.join(tmpDir, 'state.json');
    try {
      const store = new PoolStateStore({ stateFile });
      await store.initAccounts([
        { prefix: 'pdas', authIndex: '0', status: 'healthy', quota: { remainingFraction: 0.9, status: 'known', window: '5 hs' } },
      ]);

      let quotaCount = 0;
      const bus = new MockPiEventBus();
      const mockPi = {
        events: bus,
        on: (ev, fn) => bus.on(ev, fn),
      };

      registerPoolLifecycle(mockPi, {
        store,
        fetchQuotaFn: async () => {
          quotaCount++;
          return { remainingFraction: 0.8, status: 'known', window: '5 hs', lastCheckedAt: new Date().toISOString() };
        },
      });

      // Session switch event: reason 'new'
      bus.emit('session_shutdown', { reason: 'new' });

      // Now allocate and complete a task in new session
      let claimFn = null;
      bus.emit('subagents:task:allocate', {
        taskId: 'task-new-session',
        attempt: 1,
        parentSessionId: 'sess-new',
        claimModel: (fn) => { claimFn = fn; },
      });
      await claimFn(new AbortController().signal);

      let cleanupFn = null;
      bus.emit('subagents:task:terminal', {
        taskId: 'task-new-session',
        attempt: 1,
        parentSessionId: 'sess-new',
        registerCleanup: (fn) => { cleanupFn = fn; },
      });
      await cleanupFn();

      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(quotaCount, 1, 'Ordinary session switch must not disable future quota refreshes');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  for (const reason of ['new', 'resume', 'fork']) {
    it(`in-flight quota refresh for owner A survives ordinary session switch (${reason}) and owner B refresh is admitted`, async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `cpamc-switch-${reason}-`));
      const stateFile = path.join(tmpDir, 'state.json');
      try {
        const store = new PoolStateStore({ stateFile });
        await store.initAccounts([
          { prefix: 'pdas', authIndex: '0', status: 'healthy', quota: { remainingFraction: 0.95, status: 'known', window: '5 hs' } },
          { prefix: 'accB', authIndex: '1', status: 'healthy', quota: { remainingFraction: 0.85, status: 'known', window: '5 hs' } },
        ]);

        let signalA = null;
        let resolveQuotaA = null;
        const deferredQuotaA = new Promise((resolve) => {
          resolveQuotaA = resolve;
        });

        let quotaCountB = 0;
        let signalB = null;

        const bus = new MockPiEventBus();
        const mockPi = {
          events: bus,
          on: (ev, fn) => bus.on(ev, fn),
        };

        registerPoolLifecycle(mockPi, {
          store,
          fetchQuotaFn: async (authIndex, opts) => {
            if (authIndex === '0') {
              signalA = opts.signal;
              return deferredQuotaA;
            }
            if (authIndex === '1') {
              signalB = opts.signal;
              quotaCountB++;
              return { remainingFraction: 0.75, status: 'known', window: '5 hs', lastCheckedAt: '2026-10-03T06:00:00Z' };
            }
            return { remainingFraction: 0.5 };
          },
        });

        // 1. Owner A allocates task
        let claimA = null;
        bus.emit('subagents:task:allocate', {
          taskId: 'task-A',
          attempt: 1,
          parentSessionId: 'sess-A',
          claimModel: (fn) => { claimA = fn; },
        });
        const claimResultA = await claimA(new AbortController().signal);
        assert.equal(claimResultA.model.id, 'pdas/gemini-3.8-flash-high');

        // 2. Owner A task terminates
        let cleanupA = null;
        bus.emit('subagents:task:terminal', {
          taskId: 'task-A',
          attempt: 1,
          parentSessionId: 'sess-A',
          registerCleanup: (fn) => { cleanupA = fn; },
        });

        assert.ok(cleanupA);
        await cleanupA();

        // Lease A is released immediately
        const leaseA = buildLeaseId({ sessionId: 'sess-A', pid: process.pid, taskId: 'task-A', attempt: 1 });
        assert.equal(store.readState().leases[leaseA], undefined);

        // At this point, quota fetch for owner A is in-flight
        assert.ok(signalA, 'Quota fetch for owner A must have started');
        assert.equal(signalA.aborted, false);

        // 3. Ordinary session shutdown fires for session switch with given reason
        bus.emit('session_shutdown', { reason });

        // Owner A signal MUST NOT be aborted by ordinary session switch
        assert.equal(signalA.aborted, false, `Signal for owner A must not be aborted on session switch reason: ${reason}`);

        // 4. Resolve Owner A deferred quota
        resolveQuotaA({
          remainingFraction: 0.45,
          status: 'known',
          window: '5 hs',
          lastCheckedAt: '2026-10-03T05:45:00Z',
        });

        // Wait a tick for background quota commit
        await new Promise((resolve) => setTimeout(resolve, 50));

        // State must reflect Owner A's fresh quota write
        const stateAfterA = store.readState();
        const accountA = stateAfterA.accounts.find((a) => a.prefix === 'pdas');
        assert.equal(accountA.quota.remainingFraction, 0.45, `Owner A quota must be persisted to store after session switch ${reason}`);

        // 5. Subsequent task for Owner B allocates and terminates
        let claimB = null;
        bus.emit('subagents:task:allocate', {
          taskId: 'task-B',
          attempt: 1,
          parentSessionId: 'sess-B',
          claimModel: (fn) => { claimB = fn; },
        });
        const claimResultB = await claimB(new AbortController().signal);
        assert.equal(claimResultB.model.id, 'accB/gemini-3.8-flash-high');

        let cleanupB = null;
        bus.emit('subagents:task:terminal', {
          taskId: 'task-B',
          attempt: 1,
          parentSessionId: 'sess-B',
          registerCleanup: (fn) => { cleanupB = fn; },
        });
        assert.ok(cleanupB);
        await cleanupB();

        // Lease B is released immediately without task result wait
        const leaseB = buildLeaseId({ sessionId: 'sess-B', pid: process.pid, taskId: 'task-B', attempt: 1 });
        assert.equal(store.readState().leases[leaseB], undefined);

        // Wait a tick for Owner B background quota refresh
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.equal(quotaCountB, 1, `Subsequent refresh for owner B must be admitted after switch with reason ${reason}`);
        assert.ok(signalB);
        assert.equal(signalB.aborted, false);

        const stateAfterB = store.readState();
        const accountB = stateAfterB.accounts.find((a) => a.prefix === 'accB');
        assert.equal(accountB.quota.remainingFraction, 0.75, `Owner B quota must be persisted to store`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  }
});
