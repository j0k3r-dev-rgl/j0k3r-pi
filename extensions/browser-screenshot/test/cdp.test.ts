import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureBrowserPageScreenshot, getBrowserCdpStatus, listBrowserPageTargets, selectBrowserPageTarget, type CdpTransport } from '../src/cdp.js';

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
