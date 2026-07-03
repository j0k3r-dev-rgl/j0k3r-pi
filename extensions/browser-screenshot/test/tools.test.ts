import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import browserScreenshotExtension from '../index.js';
import type { CdpTransport } from '../src/cdp.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

type Tool = {
  name: string;
  description: string;
  parameters: { type: string; [key: string]: unknown };
  execute: (...args: unknown[]) => Promise<unknown> | unknown;
};

function createMockPi() {
  const tools: Tool[] = [];
  return {
    tools,
    registerTool(tool: Tool) {
      tools.push(tool);
    },
  };
}

function createFetch(map: Record<string, unknown>) {
  return async (input: string | URL) => ({
    ok: true,
    status: 200,
    async json() { return map[String(input)]; },
    async text() { return JSON.stringify(map[String(input)]); },
  });
}

describe('tool registration', () => {
  it('registers the required browser screenshot tools', () => {
    const pi = createMockPi();
    browserScreenshotExtension(pi as any);
    expect(pi.tools.map((tool) => tool.name)).toEqual([
      'browser_cdp_status',
      'browser_tabs_list',
      'browser_page_screenshot',
    ]);
  });

  it('returns bounded tab output without websocket urls', async () => {
    const pi = createMockPi();
    browserScreenshotExtension(pi as any);
    const tool = pi.tools.find((entry) => entry.name === 'browser_tabs_list');

    const result: any = await tool?.execute('call-1', {
      limit: 1,
      fetchFn: createFetch({
        'http://127.0.0.1:9222/json/list': [
          { id: 'page-1', type: 'page', title: 'SIAS', url: 'https://sias.example', webSocketDebuggerUrl: 'ws://secret-1' },
          { id: 'page-2', type: 'page', title: 'Docs', url: 'https://docs.example', webSocketDebuggerUrl: 'ws://secret-2' },
        ],
      }),
    });

    expect(result.details.data.returnedCount).toBe(1);
    expect(JSON.stringify(result.content)).not.toContain('ws://secret');
  });

  it('returns inline screenshot content when the model supports images', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-browser-tool-'));
    cleanup.push(dir);
    const pi = createMockPi();
    browserScreenshotExtension(pi as any);
    const tool = pi.tools.find((entry) => entry.name === 'browser_page_screenshot');

    const result: any = await tool?.execute('call-2', {
      outputPath: join(dir, 'tool-output.png'),
      fetchFn: createFetch({
        'http://127.0.0.1:9222/json/list': [
          { id: 'page-1', type: 'page', title: 'SIAS', url: 'https://sias.example', webSocketDebuggerUrl: 'ws://secret-1' },
        ],
      }),
      transportFactory: async (): Promise<CdpTransport> => ({
        async send(method: string) {
          if (method === 'Page.getLayoutMetrics') return { cssContentSize: { x: 0, y: 0, width: 1897, height: 4712 } } as any;
          if (method === 'Page.captureScreenshot') return { data: TINY_PNG.toString('base64') } as any;
          return {} as any;
        },
        async close() {},
      }),
    }, undefined, undefined, {
      cwd: dir,
      model: { input: ['text', 'image'] },
    });

    expect(result.details.data.inlineAttached).toBe(true);
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('browser_page_screenshot:') }),
      expect.objectContaining({ type: 'image', mimeType: 'image/png' }),
    ]));
  });
});
