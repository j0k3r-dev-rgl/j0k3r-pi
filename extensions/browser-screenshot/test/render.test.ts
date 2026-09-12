import { describe, expect, it, vi } from 'vitest';
import browserScreenshotExtension from '../index.js';
import {
  CYAN,
  DIM,
  LIME,
  RED,
  RESET,
  extractBrowserBadge,
  renderBrowserCall,
  renderBrowserResult,
  visibleWidth,
} from '../src/render.js';

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  keybinding: (action: string) => (action === 'app.tools.expand' ? 'ctrl+o' : undefined),
};

describe('browser-screenshot renderers', () => {
  it('registers all 4 tools with renderShell: "self", renderCall, and renderResult', () => {
    const tools: any[] = [];
    const pi = {
      registerTool: vi.fn((tool: any) => tools.push(tool)),
    };

    browserScreenshotExtension(pi);

    const names = ['browser_cdp_status', 'browser_tabs_list', 'go_to_page', 'browser_page_screenshot'];
    for (const name of names) {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool.renderShell).toBe('self');
      expect(typeof tool.renderCall).toBe('function');
      expect(typeof tool.renderResult).toBe('function');
    }
  });

  it('extracts correct badges for all 4 browser tools', () => {
    expect(extractBrowserBadge('browser_cdp_status', {})).toBe('cdp_status');
    expect(extractBrowserBadge('browser_tabs_list', {})).toBe('tabs_list');
    expect(extractBrowserBadge('go_to_page', { url: 'https://example.com' })).toBe('go_to [https://example.com]');
    expect(extractBrowserBadge('browser_page_screenshot', { targetId: 'tab-123' })).toBe('page_screenshot [tab-123]');
    expect(extractBrowserBadge('browser_page_screenshot', { urlContains: 'dashboard' })).toBe('page_screenshot [dashboard]');
  });

  it('renders pending call card with rounded corners and consistent line widths', () => {
    const context = { state: {} };
    const call = renderBrowserCall('browser_cdp_status', {}, mockTheme, context);
    const lines = call.render(80);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('╭');
    expect(lines[0]).toContain('╮');
    expect(lines[0]).toContain('browser_cdp_status [cdp_status]');
    expect(lines[1]).toContain('│');
    expect(lines[1]).toContain('Pending: Checking CDP status...');
    expect(lines[2]).toContain('╰');
    expect(lines[2]).toContain('╯');

    for (const line of lines) {
      expect(visibleWidth(line)).toBe(80);
      expect(line).not.toMatch(/\x1b\[4[0-7]m/);
    }
  });

  it('coordinates two-phase slot assembly via context.state', () => {
    const context: any = { state: {} };

    // Phase 1: Pending call
    const pendingLines = renderBrowserCall('go_to_page', { url: 'https://test.com' }, mockTheme, context).render(80);
    expect(pendingLines).toHaveLength(3);
    expect(pendingLines[0]).toContain('╭');
    expect(pendingLines[2]).toContain('╰');

    // Result arrives
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
    expect(context.state.borderColor).toBe(LIME);

    // Phase 2: Call re-renders as top border only
    const resolvedCall = renderBrowserCall('go_to_page', { url: 'https://test.com' }, mockTheme, context).render(80);
    expect(resolvedCall).toHaveLength(1);
    expect(resolvedCall[0]).toContain('╭');
    expect(resolvedCall[0]).toContain(LIME);

    // Result renders framed lines + bottom border
    const resultLines = resultComp.render(80);
    expect(resultLines[resultLines.length - 1]).toContain('╰');

    const assembled = [...resolvedCall, ...resultLines];
    const tops = assembled.filter((l) => l.includes('╭'));
    const bottoms = assembled.filter((l) => l.includes('╰'));
    expect(tops).toHaveLength(1);
    expect(bottoms).toHaveLength(1);

    for (const line of assembled) {
      expect(visibleWidth(line)).toBe(80);
    }
  });

  it('renders browser_cdp_status collapsed and expanded views', () => {
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

    const collapsed = renderBrowserResult('browser_cdp_status', result, { expanded: false }, mockTheme).render(80).join('\n');
    expect(collapsed).toContain('✓ CDP connected (Chrome/124.0) · http://127.0.0.1:9222');
    expect(collapsed).toContain('ctrl+o expand');

    const expanded = renderBrowserResult('browser_cdp_status', result, { expanded: true }, mockTheme).render(80).join('\n');
    expect(expanded).toContain('cdp endpoint: http://127.0.0.1:9222');
    expect(expanded).toContain('browser: Chrome/124.0');
    expect(expanded).toContain('protocol: 1.3');
    expect(expanded).toContain('page targets: 3');
    expect(expanded).toContain('ctrl+o collapse');
  });

  it('renders browser_tabs_list collapsed and expanded views without exposing raw websocket URLs', () => {
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

    const collapsed = renderBrowserResult('browser_tabs_list', result, { expanded: false }, mockTheme).render(80).join('\n');
    expect(collapsed).toContain('✓ 2 page tab(s) available');
    expect(collapsed).toContain('ctrl+o expand');

    const expanded = renderBrowserResult('browser_tabs_list', result, { expanded: true }, mockTheme).render(80).join('\n');
    expect(expanded).toContain('id=tab-1 | "Google" | https://google.com | websocket=yes');
    expect(expanded).toContain('id=tab-2 | "GitHub" | https://github.com | websocket=no');
    // Raw ws:// URL must not appear
    expect(expanded).not.toContain('ws://');
    expect(expanded).toContain('ctrl+o collapse');
  });

  it('renders go_to_page collapsed and expanded views', () => {
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

    const collapsed = renderBrowserResult('go_to_page', result, { expanded: false }, mockTheme).render(80).join('\n');
    expect(collapsed).toContain('✓ navigated -> https://example.com [Example Domain]');
    expect(collapsed).toContain('ctrl+o expand');

    const expanded = renderBrowserResult('go_to_page', result, { expanded: true }, mockTheme).render(80).join('\n');
    expect(expanded).toContain('target id: tab-9');
    expect(expanded).toContain('duration: 250ms');
    expect(expanded).toContain('ctrl+o collapse');
  });

  it('renders browser_page_screenshot collapsed and expanded views', () => {
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

    const collapsed = renderBrowserResult('browser_page_screenshot', result, { expanded: false }, mockTheme).render(80).join('\n');
    expect(collapsed).toContain('✓ captured page 1280x800 (512.0 KiB) -> /path/to/shot.png');
    expect(collapsed).toContain('ctrl+o expand');

    const expanded = renderBrowserResult('browser_page_screenshot', result, { expanded: true }, mockTheme).render(80).join('\n');
    expect(expanded).toContain('dimensions: 1280x800');
    expect(expanded).toContain('file size: 512.0 KiB');
    expect(expanded).toContain('inline image: attached');
    expect(expanded).toContain('ctrl+o collapse');
  });

  it('renders electric red border and error message on failure', () => {
    const context: any = { state: {} };
    const errResult = {
      isError: true,
      details: {
        status: 'failure',
        error: { code: 'cdp_status_failed', message: 'Connection refused to 127.0.0.1:9222' },
      },
    };

    const lines = renderBrowserResult('browser_cdp_status', errResult, { expanded: false }, mockTheme, context).render(80);
    expect(context.state.borderColor).toBe(RED);
    expect(lines[lines.length - 1]).toContain(RED);
    expect(lines.join('\n')).toContain('Error: Connection refused to 127.0.0.1:9222');
  });

  it('safeguards against narrow width (< 24 columns)', () => {
    const callLines = renderBrowserCall('browser_cdp_status', {}, mockTheme).render(16);
    expect(callLines).toHaveLength(1);
    expect(callLines[0]).not.toContain('╭');

    const resultLines = renderBrowserResult('browser_cdp_status', {
      details: { status: 'success', data: { versionReachable: true, tabsReachable: true } },
    }, { expanded: false }, mockTheme).render(16);
    expect(resultLines.length).toBeGreaterThan(0);
    expect(resultLines[resultLines.length - 1]).not.toContain('╰');
  });
});
