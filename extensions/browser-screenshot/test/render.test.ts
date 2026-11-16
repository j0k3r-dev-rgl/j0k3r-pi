import { describe, expect, it, vi } from 'vitest';
import browserScreenshotExtension from '../index.js';
import {
  COMPACT_TOOL_RENDERING,
  RED,
  extractBrowserBadge,
  renderBrowserCall,
  renderBrowserResult,
  visibleWidth,
} from '../src/render.js';

const FRAME = /[╭╮╰╯│]/;

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  keybinding: (action: string) => (action === 'app.tools.expand' ? 'ctrl+o' : undefined),
};

async function registeredTools(): Promise<any[]> {
  const tools: any[] = [];
  // The enabling guard reads the process cwd, so run inside an isolated enabled project.
  const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'browser-screenshot-render-'));
  const previous = process.cwd();
  try {
    await mkdir(join(root, '.pi'), { recursive: true });
    await writeFile(join(root, '.pi', 'extensions.json'), JSON.stringify({ 'browser-screenshot': true }), 'utf8');
    process.chdir(root);
    browserScreenshotExtension({ registerTool: (tool: any) => tools.push(tool) } as any);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
  return tools;
}

describe('browser-screenshot renderers', () => {
  it('registers the compact marker, renderShell self and both safe slots on all 4 tools', async () => {
    expect(COMPACT_TOOL_RENDERING.compactToolRenderingVersion).toBe(1);
    const tools = await registeredTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'browser_cdp_status',
      'browser_tabs_list',
      'go_to_page',
      'browser_page_screenshot',
    ]);
    for (const tool of tools) {
      expect(tool.renderShell, `${tool.name} renderShell`).toBe('self');
      expect(tool.compactToolRenderingVersion, `${tool.name} marker`).toBe(1);
      expect(tool.renderCall, `${tool.name} renderCall`).toBeTypeOf('function');
      expect(tool.renderResult, `${tool.name} renderResult`).toBeTypeOf('function');
    }
  });

  it('keeps every returned text block reachable when expanded', () => {
    const result = {
      content: [
        { type: 'text', text: 'BLOCK_ONE' },
        { type: 'text', text: 'BLOCK_TWO' },
      ],
      details: { status: 'success', data: { cdpUrl: 'http://127.0.0.1:9222', warnings: [] } },
    };
    const expanded = renderBrowserResult('browser_cdp_status', result, { expanded: true }, mockTheme, { state: {} }).render(200).join('\n');
    expect(expanded).toContain('BLOCK_ONE');
    expect(expanded).toContain('BLOCK_TWO');
  });

  it('wraps very long single-line payloads without quadratic blowup', () => {
    const result = { content: [{ type: 'text', text: 'x'.repeat(20000) }], details: { status: 'success', data: {} } };
    const started = Date.now();
    const lines = renderBrowserResult('browser_cdp_status', result, { expanded: true }, mockTheme, { state: {} }).render(2);
    expect(lines.length).toBeGreaterThan(1000);
    expect(Date.now() - started).toBeLessThan(2000);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(2);
  });

  it('extracts correct badges for all 4 browser tools', () => {
    expect(extractBrowserBadge('browser_cdp_status', {})).toBe('cdp_status');
    expect(extractBrowserBadge('browser_tabs_list', {})).toBe('tabs_list');
    expect(extractBrowserBadge('go_to_page', { url: 'https://example.com' })).toBe('go_to [https://example.com]');
    expect(extractBrowserBadge('browser_page_screenshot', { targetId: 'tab-123' })).toBe('page_screenshot [tab-123]');
    expect(extractBrowserBadge('browser_page_screenshot', { urlContains: 'dashboard' })).toBe('page_screenshot [dashboard]');
  });

  it('renders the pending call as one compact inline row inside the supplied width', () => {
    const context = { state: {} };
    const lines = renderBrowserCall('browser_cdp_status', {}, mockTheme, context).render(80);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('browser_cdp_status');
    expect(lines[0]).toContain('cdp_status');
    expect(lines[0]).toContain('running');
    expect(lines[0]).toContain('─');
    expect(lines[0]).not.toMatch(FRAME);
    expect(lines[0]).not.toMatch(/ctrl\+o|to expand/i);
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(80);
  });

  it('coordinates two-phase slot assembly via context.state without borders', () => {
    const context: any = { state: {} };

    const pendingLines = renderBrowserCall('go_to_page', { url: 'https://test.com' }, mockTheme, context).render(80);
    expect(pendingLines).toHaveLength(1);
    expect(pendingLines[0]).not.toMatch(FRAME);

    const resultComp = renderBrowserResult(
      'go_to_page',
      {
        details: {
          status: 'success',
          data: {
            targetId: 't-1',
            target: { id: 't-1', title: 'Test Page', url: 'https://test.com' },
            requestedUrl: 'https://test.com',
            completionMode: 'loadEventFired',
            durationMs: 340,
            warnings: [],
          },
        },
      },
      { expanded: false },
      mockTheme,
      context,
    );

    expect(context.state.hasResult).toBe(true);

    const resolvedCall = renderBrowserCall('go_to_page', { url: 'https://test.com' }, mockTheme, context).render(80);
    expect(resolvedCall).toEqual([]);

    const resultLines = resultComp.render(80);
    expect(resultLines).toHaveLength(1);
    expect(resultLines[0]).toContain('go_to_page');
    expect(resultLines[0]).toContain('navigated -> https://test.com [Test Page]');
    expect(resultLines[0]).not.toMatch(FRAME);
  });

  it('renders browser_cdp_status compact identity plus complete expanded metadata', () => {
    const result = {
      details: {
        status: 'success',
        data: {
          cdpUrl: 'http://127.0.0.1:9222',
          versionReachable: true,
          tabsReachable: true,
          browser: 'Chrome/124.0',
          protocolVersion: '1.3',
          pageTargetCount: 3,
          warnings: [],
        },
      },
    };

    const collapsedLines = renderBrowserResult('browser_cdp_status', result, { expanded: false }, mockTheme).render(80);
    const collapsed = collapsedLines.join('\n');
    expect(collapsedLines).toHaveLength(1);
    expect(collapsed).toContain('CDP connected (Chrome/124.0) · http://127.0.0.1:9222');
    expect(collapsed).not.toMatch(/ctrl\+o|to expand/i);
    expect(collapsed).not.toMatch(FRAME);

    const expanded = renderBrowserResult('browser_cdp_status', result, { expanded: true }, mockTheme).render(80).join('\n');
    expect(expanded).toContain('cdp endpoint: http://127.0.0.1:9222');
    expect(expanded).toContain('browser: Chrome/124.0');
    expect(expanded).toContain('protocol: 1.3');
    expect(expanded).toContain('page targets: 3');
    expect(expanded).not.toMatch(/ctrl\+o|to collapse/i);
  });

  it('renders browser_tabs_list without exposing raw websocket URLs', () => {
    const result = {
      details: {
        status: 'success',
        data: {
          cdpUrl: 'http://127.0.0.1:9222',
          totalPageTargets: 2,
          returnedCount: 2,
          tabs: [
            { id: 'tab-1', title: 'Google', url: 'https://google.com', hasWebSocketDebuggerUrl: true },
            { id: 'tab-2', title: 'GitHub', url: 'https://github.com', hasWebSocketDebuggerUrl: false },
          ],
          warnings: [],
        },
      },
    };

    const collapsedLines = renderBrowserResult('browser_tabs_list', result, { expanded: false }, mockTheme).render(80);
    expect(collapsedLines).toHaveLength(1);
    expect(collapsedLines[0]).toContain('2 page tab(s) available');

    const expanded = renderBrowserResult('browser_tabs_list', result, { expanded: true }, mockTheme).render(80).join('\n');
    expect(expanded).toContain('id=tab-1 | "Google" | https://google.com | websocket=yes');
    expect(expanded).toContain('id=tab-2 | "GitHub" | https://github.com | websocket=no');
    expect(expanded).not.toContain('ws://');
  });

  it('renders go_to_page compact identity plus expanded navigation metadata', () => {
    const result = {
      details: {
        status: 'success',
        data: {
          targetId: 'tab-9',
          target: { id: 'tab-9', title: 'Example Domain', url: 'https://example.com' },
          requestedUrl: 'https://example.com',
          completionMode: 'loadEventFired',
          durationMs: 250,
          warnings: [],
        },
      },
    };

    const collapsedLines = renderBrowserResult('go_to_page', result, { expanded: false }, mockTheme).render(80);
    expect(collapsedLines).toHaveLength(1);
    expect(collapsedLines[0]).toContain('navigated -> https://example.com [Example Domain]');

    const expanded = renderBrowserResult('go_to_page', result, { expanded: true }, mockTheme).render(80).join('\n');
    expect(expanded).toContain('target id: tab-9');
    expect(expanded).toContain('duration: 250ms');
  });

  it('renders browser_page_screenshot identity and keeps image metadata available', () => {
    const result = {
      details: {
        status: 'success',
        data: {
          target: { id: 'tab-9', title: 'Example', url: 'https://example.com' },
          outputPath: '/path/to/shot.png',
          outputSizeBytes: 524288,
          width: 1280,
          height: 800,
          inlineAttached: true,
          warnings: [],
        },
      },
    };

    const collapsedLines = renderBrowserResult('browser_page_screenshot', result, { expanded: false }, mockTheme).render(120);
    expect(collapsedLines).toHaveLength(1);
    expect(collapsedLines[0]).toContain('browser_page_screenshot');
    expect(collapsedLines[0]).toContain('captured page 1280x800');
    expect(collapsedLines[0]).toContain('512.0 KiB');
    expect(collapsedLines[0]).toContain('/path/to/shot.png');

    const expanded = renderBrowserResult('browser_page_screenshot', result, { expanded: true }, mockTheme).render(80).join('\n');
    expect(expanded).toContain('dimensions: 1280x800');
    expect(expanded).toContain('file size: 512.0 KiB');
    expect(expanded).toContain('inline image: attached');
  });

  it('marks failures in one red inline row and keeps returned text on expansion', () => {
    const context: any = { state: {} };
    const errResult = {
      isError: true,
      details: {
        status: 'failure',
        error: { code: 'cdp_status_failed', message: 'Connection refused to 127.0.0.1:9222' },
      },
    };

    const lines = renderBrowserResult('browser_cdp_status', errResult, { expanded: false }, mockTheme, context).render(80);
    expect(context.state.isError).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('error');
    expect(lines[0]).toContain('Connection refused to 127.0.0.1:9222');
    expect(lines[0]).not.toMatch(FRAME);

    const redTheme = { ...mockTheme, fg: (name: string, text: string) => (name === 'error' ? `${RED}${text}\x1b[0m` : text) };
    const redLines = renderBrowserResult('browser_cdp_status', errResult, { expanded: false }, redTheme, { state: {} }).render(80);
    expect(redLines[0]).toContain(RED);

    const expanded = renderBrowserResult(
      'browser_cdp_status',
      { ...errResult, content: [{ type: 'text', text: 'Connection refused to 127.0.0.1:9222' }] },
      { expanded: true },
      mockTheme,
      { state: {} },
    ).render(80);
    expect(expanded.every((l) => l.startsWith(' '))).toBe(true);
    expect(expanded.slice(1)).toContain(' Connection refused to 127.0.0.1:9222');
  });

  it('stays width-safe at narrow widths and emits no cells at zero width', () => {
    const callLines = renderBrowserCall('browser_cdp_status', {}, mockTheme).render(16);
    expect(callLines).toHaveLength(1);
    expect(visibleWidth(callLines[0])).toBeLessThanOrEqual(16);
    expect(callLines[0]).not.toMatch(FRAME);

    for (const width of [1, 2, 10, 23]) {
      const resultLines = renderBrowserResult('browser_cdp_status', {
        details: { status: 'success', data: { versionReachable: true, tabsReachable: true, cdpUrl: 'http://127.0.0.1:9222' } },
      }, { expanded: true }, mockTheme, { state: {} }).render(width);
      expect(resultLines.length).toBeGreaterThan(0);
      for (const line of resultLines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }

    expect(renderBrowserResult('browser_cdp_status', { details: {} }, { expanded: false }, mockTheme, { state: {} }).render(0)).toEqual([]);
  });

  it('is reachable through the extension entrypoint in an isolated enabled project', async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = await mkdtemp(join(tmpdir(), 'browser-screenshot-entry-'));
    const previous = process.cwd();
    try {
      await mkdir(join(root, '.pi'), { recursive: true });
      await writeFile(join(root, '.pi', 'extensions.json'), JSON.stringify({ 'browser-screenshot': true }), 'utf8');
      process.chdir(root);
      const tools: any[] = [];
      browserScreenshotExtension({ registerTool: vi.fn((tool: any) => tools.push(tool)) });
      expect(tools).toHaveLength(4);
      for (const tool of tools) expect(tool.compactToolRenderingVersion).toBe(1);
    } finally {
      process.chdir(previous);
      await rm(root, { recursive: true, force: true });
    }
  });
});
