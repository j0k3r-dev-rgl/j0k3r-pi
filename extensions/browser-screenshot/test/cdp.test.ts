import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureBrowserPageScreenshot, createWebSocketTransport, getBrowserCdpStatus, listBrowserPageTargets, navigateBrowserPage, selectBrowserPageTarget, type CdpTransport } from '../src/cdp.js';

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function createFetch(map: Record<string, unknown>) {
  return async (input: string | URL) => {
    const url = String(input);
    if (!(url in map)) {
      return {
        ok: false,
        status: 404,
        async json() { return {}; },
        async text() { return 'not found'; },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() { return map[url]; },
      async text() { return JSON.stringify(map[url]); },
    };
  };
}

describe('CDP endpoint parsing', () => {
  it('reads status and counts only page targets', async () => {
    const fetchFn = createFetch({
      'http://127.0.0.1:9222/json/version': { Browser: 'Chrome/150.0.0.0', 'Protocol-Version': '1.3' },
      'http://127.0.0.1:9222/json/list': [
        { id: 'page-1', type: 'page', title: 'SIAS', url: 'https://sias.example', webSocketDebuggerUrl: 'ws://secret-1' },
        { id: 'worker-1', type: 'service_worker', title: 'worker', url: 'chrome-extension://worker' },
        { id: 'page-2', type: 'page', title: 'Docs', url: 'https://docs.example' },
      ],
    });

    const result = await getBrowserCdpStatus(undefined, fetchFn as any);
    expect(result).toMatchObject({
      versionReachable: true,
      tabsReachable: true,
      browser: 'Chrome/150.0.0.0',
      protocolVersion: '1.3',
      pageTargetCount: 2,
    });
  });

  it('lists page targets without dropping websocket presence metadata', async () => {
    const fetchFn = createFetch({
      'http://127.0.0.1:9222/json/list': [
        { id: 'page-1', type: 'page', title: 'SIAS', url: 'https://sias.example', webSocketDebuggerUrl: 'ws://secret-1' },
        { id: 'page-2', type: 'page', title: 'Docs', url: 'https://docs.example' },
      ],
    });

    const result = await listBrowserPageTargets(undefined, fetchFn as any);
    expect(result).toEqual([
      { id: 'page-1', title: 'SIAS', url: 'https://sias.example', hasWebSocketDebuggerUrl: true, webSocketDebuggerUrl: 'ws://secret-1' },
      { id: 'page-2', title: 'Docs', url: 'https://docs.example', hasWebSocketDebuggerUrl: false, webSocketDebuggerUrl: undefined },
    ]);
  });
});

describe('page target selection', () => {
  const targets = [
    { id: 'page-1', title: 'SIAS Dashboard', url: 'https://sias.example/home', hasWebSocketDebuggerUrl: true, webSocketDebuggerUrl: 'ws://page-1' },
    { id: 'page-2', title: 'Docs', url: 'https://docs.example', hasWebSocketDebuggerUrl: true, webSocketDebuggerUrl: 'ws://page-2' },
  ];

  it('selects by target id, title, url, or default order', () => {
    expect(selectBrowserPageTarget(targets, { targetId: 'page-2' }).id).toBe('page-2');
    expect(selectBrowserPageTarget(targets, { titleContains: 'sias' }).id).toBe('page-1');
    expect(selectBrowserPageTarget(targets, { urlContains: 'docs' }).id).toBe('page-2');
    expect(selectBrowserPageTarget(targets, {}).id).toBe('page-1');
  });
});

describe('page navigation', () => {
  it('validates URLs before CDP and arms load-event waiting before navigation to avoid the response race', async () => {
    const calls: string[] = [];
    let loadWaitArmed = false;
    const fetchFn = createFetch({
      'http://127.0.0.1:9222/json/list': [
        { id: 'page-1', type: 'page', title: 'Dashboard', url: 'https://app.example', webSocketDebuggerUrl: 'ws://page-1' },
      ],
    });
    const result = await navigateBrowserPage({
      url: 'https://example.test/next',
      targetId: 'page-1',
      fetchFn: fetchFn as any,
      transportFactory: async (): Promise<CdpTransport> => ({
        async send(method, params) {
          calls.push(`${method}:${JSON.stringify(params)}`);
          if (method === 'Page.navigate' && !loadWaitArmed) throw new Error('load waiter must be armed before navigate');
          return {} as any;
        },
        async waitForEvent<T = unknown>(method: string): Promise<T> {
          calls.push(`wait:${method}`);
          loadWaitArmed = true;
          return {} as T;
        },
        async close() { calls.push('close'); },
      }),
    });
    expect(result.target.id).toBe('page-1');
    expect(calls).toEqual(['Page.enable:undefined', 'wait:Page.loadEventFired', 'Page.navigate:{"url":"https://example.test/next"}', 'close']);
    await expect(navigateBrowserPage({ url: 'file:///tmp/secret', fetchFn: fetchFn as any })).rejects.toThrow('absolute http: or https: URL');
  });

  it('rejects navigation errors, propagates abort through fetch and pending commands, and closes transports', async () => {
    const controller = new AbortController();
    let closed = false;
    const fetchFn = createFetch({ 'http://127.0.0.1:9222/json/list': [{ id: 'p', type: 'page', title: '', url: '', webSocketDebuggerUrl: 'ws://p' }] });
    await expect(navigateBrowserPage({
      url: 'https://example.test', fetchFn: fetchFn as any,
      transportFactory: async () => ({
        async send<T = unknown>(method: string): Promise<T> { if (method === 'Page.navigate') return { errorText: 'blocked' } as T; return {} as T; },
        async waitForEvent<T = unknown>(): Promise<T> { return {} as T; }, async close() { closed = true; },
      }),
    })).rejects.toThrow('blocked');
    expect(closed).toBe(true);
    controller.abort();
    await expect(navigateBrowserPage({ url: 'https://user:pass@example.test', signal: controller.signal, fetchFn: fetchFn as any })).rejects.toThrow('credentials');

    let transportCalled = false;
    const listController = new AbortController();
    const listPending = navigateBrowserPage({
      url: 'https://example.test',
      signal: listController.signal,
      fetchFn: async (_input, init) => {
        if (!init?.signal) throw new Error('missing abort signal on target-list fetch');
        return await new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('target-list fetch aborted')), { once: true })) as never;
      },
      transportFactory: async () => {
        transportCalled = true;
        throw new Error('transport should not be created after list abort');
      },
    });
    setTimeout(() => listController.abort(), 0);
    await expect(listPending).rejects.toThrow('target-list fetch aborted');
    expect(transportCalled).toBe(false);

    for (const pendingMethod of ['Page.enable', 'Page.navigate']) {
      const commandController = new AbortController();
      let commandClosed = false;
      const commandCalls: string[] = [];
      const pending = navigateBrowserPage({
        url: 'https://example.test',
        signal: commandController.signal,
        fetchFn: fetchFn as any,
        transportFactory: async () => ({
          async send<T = unknown>(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
            commandCalls.push(`${method}:${JSON.stringify(params)}`);
            if (method !== pendingMethod) return {} as T;
            if (!signal) throw new Error(`missing abort signal on ${pendingMethod}`);
            return await new Promise<T>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error(`${pendingMethod} aborted`)), { once: true }));
          },
          async waitForEvent<T = unknown>(): Promise<T> { return {} as T; },
          async close() { commandClosed = true; },
        }),
      });
      setTimeout(() => commandController.abort(), 0);
      await expect(pending).rejects.toThrow(`${pendingMethod} aborted`);
      expect(commandClosed).toBe(true);
      expect(commandCalls[0]).toBe('Page.enable:undefined');
    }
  });

  it('cleans deadline timer and parent abort listener on representative pre-transport failure', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const originalAdd = controller.signal.addEventListener.bind(controller.signal);
      const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
      const added: EventListenerOrEventListenerObject[] = [];
      const removed: EventListenerOrEventListenerObject[] = [];
      controller.signal.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) => {
        if (type === 'abort' && listener) added.push(listener);
        return (originalAdd as any)(type, listener, options);
      }) as typeof controller.signal.addEventListener;
      controller.signal.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) => {
        if (type === 'abort' && listener) removed.push(listener);
        return (originalRemove as any)(type, listener, options);
      }) as typeof controller.signal.removeEventListener;

      let transportCalled = false;
      await expect(navigateBrowserPage({
        url: 'https://example.test',
        signal: controller.signal,
        fetchFn: async () => { throw new Error('target-list failed fast'); },
        transportFactory: async () => {
          transportCalled = true;
          throw new Error('transport should not be created');
        },
      })).rejects.toThrow('target-list failed fast');

      expect(transportCalled).toBe(false);
      expect(added.length).toBeGreaterThan(0);
      expect(removed).toEqual(added);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out hung Page.enable and Page.navigate responses within the fixed navigation deadline and closes transport state', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = createFetch({ 'http://127.0.0.1:9222/json/list': [{ id: 'p', type: 'page', title: '', url: '', webSocketDebuggerUrl: 'ws://p' }] });

      let enableClosed = false;
      let enableTimedOut = false;
      const enablePending = navigateBrowserPage({
        url: 'https://example.test',
        fetchFn: fetchFn as any,
        transportFactory: async () => ({
          async send<T = unknown>(method: string, _params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
            if (method !== 'Page.enable') return {} as T;
            return await new Promise<T>((_resolve, reject) => signal?.addEventListener('abort', () => {
              enableTimedOut = true;
              reject(signal.reason instanceof Error ? signal.reason : new Error('unexpected abort'));
            }, { once: true }));
          },
          async waitForEvent<T = unknown>(): Promise<T> { return {} as T; },
          async close() { enableClosed = true; },
        }),
      });

      const enableAssertion = expect(enablePending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(30_000);
      await enableAssertion;
      expect(enableTimedOut).toBe(true);
      expect(enableClosed).toBe(true);

      let navigateClosed = false;
      let navigateTimedOut = false;
      let waiterTimedOut = false;
      const navigatePending = navigateBrowserPage({
        url: 'https://example.test',
        fetchFn: fetchFn as any,
        transportFactory: async () => ({
          async send<T = unknown>(method: string, _params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
            if (method !== 'Page.navigate') return {} as T;
            return await new Promise<T>((_resolve, reject) => signal?.addEventListener('abort', () => {
              navigateTimedOut = true;
              reject(signal.reason instanceof Error ? signal.reason : new Error('unexpected abort'));
            }, { once: true }));
          },
          async waitForEvent<T = unknown>(_method: string, signal?: AbortSignal): Promise<T> {
            return await new Promise<T>((_resolve, reject) => signal?.addEventListener('abort', () => {
              waiterTimedOut = true;
              reject(signal.reason instanceof Error ? signal.reason : new Error('unexpected abort'));
            }, { once: true }));
          },
          async close() { navigateClosed = true; },
        }),
      });

      const navigateAssertion = expect(navigatePending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(30_000);
      await navigateAssertion;
      expect(navigateTimedOut).toBe(true);
      expect(waiterTimedOut).toBe(true);
      expect(navigateClosed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('websocket transport connection cleanup', () => {
  it('closes the connecting socket and removes open-phase listeners on abort before connect', async () => {
    const controller = new AbortController();
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    let closeCalls = 0;

    class MockWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      readyState = MockWebSocket.CONNECTING;
      constructor(_url: string) {}
      addEventListener(type: string, handler: (...args: any[]) => void) {
        const handlers = listeners.get(type) ?? new Set();
        handlers.add(handler);
        listeners.set(type, handlers);
      }
      removeEventListener(type: string, handler: (...args: any[]) => void) {
        listeners.get(type)?.delete(handler);
      }
      close() { closeCalls += 1; }
      send() {}
    }

    const pending = createWebSocketTransport('ws://page-1', controller.signal, (url) => new MockWebSocket(url) as any);
    controller.abort();
    await expect(pending).rejects.toThrow('CDP connection aborted');
    expect(closeCalls).toBe(1);
    expect((listeners.get('open')?.size ?? 0) + (listeners.get('error')?.size ?? 0)).toBe(0);
  });
});

describe('screenshot command sequence', () => {
  it('uses Page.enable, Page.getLayoutMetrics, then Page.captureScreenshot with full-page clip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-browser-cdp-'));
    cleanup.push(dir);
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const fetchFn = createFetch({
      'http://127.0.0.1:9222/json/list': [
        { id: 'page-1', type: 'page', title: 'SIAS Dashboard', url: 'https://sias.example/home', webSocketDebuggerUrl: 'ws://page-1' },
      ],
    });

    const result = await captureBrowserPageScreenshot({
      cwd: dir,
      outputPath: join(dir, 'test-output.png'),
      fetchFn: fetchFn as any,
      transportFactory: async (): Promise<CdpTransport> => ({
        async send(method, params) {
          calls.push({ method, params });
          if (method === 'Page.getLayoutMetrics') return { cssContentSize: { x: 0, y: 0, width: 1897, height: 4712 } } as any;
          if (method === 'Page.captureScreenshot') return { data: TINY_PNG } as any;
          return {} as any;
        },
        async close() {},
      }),
    });

    expect(calls).toEqual([
      { method: 'Page.enable', params: undefined },
      { method: 'Page.getLayoutMetrics', params: undefined },
      {
        method: 'Page.captureScreenshot',
        params: {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: 1897, height: 4712, scale: 1 },
        },
      },
    ]);
    expect(result.width).toBe(1897);
    expect(result.height).toBe(4712);
  });
});
