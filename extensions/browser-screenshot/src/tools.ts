import { readFile } from 'node:fs/promises';
import { Type } from 'typebox';
import { captureBrowserPageScreenshot, getBrowserCdpStatus, listBrowserPageTargets, navigateBrowserPage, type CdpTransportFactory, type FetchLike } from './cdp.js';
import { ensureDefaultScreenshotGitIgnored, modelCanAcceptImages, normalizeMaxInlineBytes } from './config.js';
import { renderBrowserCall, renderBrowserResult } from './render.js';
import type { BrowserGoToPageResult, BrowserPageScreenshotResult, BrowserTabsListResult, PiToolResult, ToolExecutionContext, ToolContent } from './types.js';

interface BrowserToolOverrides {
  fetchFn?: FetchLike;
  transportFactory?: CdpTransportFactory;
  now?: () => Date;
}

export interface BrowserCdpStatusParams extends BrowserToolOverrides {
  cdpUrl?: string;
}

export interface BrowserTabsListParams extends BrowserToolOverrides {
  cdpUrl?: string;
  limit?: number;
}

export interface GoToPageParams extends BrowserToolOverrides {
  url: string;
  cdpUrl?: string;
  targetId?: string;
  urlContains?: string;
  titleContains?: string;
}

export interface BrowserPageScreenshotParams extends BrowserToolOverrides {
  cdpUrl?: string;
  targetId?: string;
  urlContains?: string;
  titleContains?: string;
  outputPath?: string;
  maxInlineBytes?: number;
}

const statusParameters = Type.Object({
  cdpUrl: Type.Optional(Type.String({ description: 'Optional CDP base URL. Defaults to http://127.0.0.1:9222.' })),
});

const listParameters = Type.Object({
  cdpUrl: Type.Optional(Type.String({ description: 'Optional CDP base URL. Defaults to http://127.0.0.1:9222.' })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: 'Maximum number of page tabs to return. Defaults to 20.' })),
});

const goToPageParameters = Type.Object({
  url: Type.String({ description: 'Absolute http: or https: destination URL. Credentials and non-web schemes are rejected.' }),
  cdpUrl: Type.Optional(Type.String({ description: 'Optional CDP base URL. Defaults to http://127.0.0.1:9222.' })),
  targetId: Type.Optional(Type.String({ description: 'Exact existing CDP page target id to navigate.' })),
  urlContains: Type.Optional(Type.String({ description: 'Navigate the first existing page whose current URL contains this case-insensitive text.' })),
  titleContains: Type.Optional(Type.String({ description: 'Navigate the first existing page whose title contains this case-insensitive text.' })),
}, { additionalProperties: false });

const screenshotParameters = Type.Object({
  cdpUrl: Type.Optional(Type.String({ description: 'Optional CDP base URL. Defaults to http://127.0.0.1:9222.' })),
  targetId: Type.Optional(Type.String({ description: 'Exact CDP page target id to capture.' })),
  urlContains: Type.Optional(Type.String({ description: 'Capture the first page whose URL contains this case-insensitive text.' })),
  titleContains: Type.Optional(Type.String({ description: 'Capture the first page whose title contains this case-insensitive text.' })),
  outputPath: Type.Optional(Type.String({ description: 'Optional PNG output path. Defaults to .pi/browser-screenshots/browser-screenshot-<timestamp>.png under the current workspace.' })),
  maxInlineBytes: Type.Optional(Type.Number({ minimum: 1024, maximum: 50 * 1024 * 1024, description: 'Maximum PNG size to attach inline. Defaults to 5 MiB.' })),
});

export function registerBrowserScreenshotTools(pi: any): void {
  pi.registerTool({
    name: 'browser_cdp_status',
    label: 'Browser CDP Status',
    description: 'Check whether the local Chrome DevTools Protocol endpoint is reachable without exposing sensitive target websocket URLs.',
    promptSnippet: 'Check whether the local Chrome DevTools Protocol endpoint is reachable.',
    promptGuidelines: [
      'Use browser_cdp_status before browser tab or screenshot actions when you need to verify local Chrome DevTools Protocol connectivity without exposing debugger URLs.',
    ],
    parameters: statusParameters,
    renderShell: 'self',
    renderCall(args: any, theme: any, context: any) {
      return renderBrowserCall('browser_cdp_status', args, theme, context);
    },
    renderResult(result: any, options: any, theme: any, context: any) {
      return renderBrowserResult('browser_cdp_status', result, options, theme, context);
    },
    async execute(_id: string, params: BrowserCdpStatusParams, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: ToolExecutionContext): Promise<PiToolResult> {
      try {
        const data = await getBrowserCdpStatus(params.cdpUrl, params.fetchFn);
        return buildSuccess([textContent(formatStatus(data))], data);
      } catch (error) {
        return buildFailure('cdp_status_failed', error instanceof Error ? error.message : 'browser_cdp_status failed');
      }
    },
  });

  pi.registerTool({
    name: 'browser_tabs_list',
    label: 'Browser Tabs List',
    description: 'List current Chrome page tabs from CDP with bounded text-friendly output and without exposing websocket debugger URLs.',
    promptSnippet: 'List current Chrome page tabs available through CDP.',
    promptGuidelines: [
      'Use browser_tabs_list when you need to choose an existing Chrome page target before go_to_page or browser_page_screenshot.',
    ],
    parameters: listParameters,
    renderShell: 'self',
    renderCall(args: any, theme: any, context: any) {
      return renderBrowserCall('browser_tabs_list', args, theme, context);
    },
    renderResult(result: any, options: any, theme: any, context: any) {
      return renderBrowserResult('browser_tabs_list', result, options, theme, context);
    },
    async execute(_id: string, params: BrowserTabsListParams, _signal?: AbortSignal, _onUpdate?: unknown, _ctx?: ToolExecutionContext): Promise<PiToolResult<BrowserTabsListResult>> {
      try {
        const targets = await listBrowserPageTargets(params.cdpUrl, params.fetchFn);
        const limit = normalizeListLimit(params.limit);
        const tabs = targets.slice(0, limit).map((target) => ({
          id: target.id,
          title: target.title,
          url: target.url,
          hasWebSocketDebuggerUrl: target.hasWebSocketDebuggerUrl,
        }));
        const data: BrowserTabsListResult = {
          cdpUrl: params.cdpUrl?.trim() || 'http://127.0.0.1:9222',
          totalPageTargets: targets.length,
          returnedCount: tabs.length,
          tabs,
          warnings: [],
        };
        return buildSuccess([textContent(formatTabsList(data))], data);
      } catch (error) {
        return buildFailure('tabs_list_failed', error instanceof Error ? error.message : 'browser_tabs_list failed');
      }
    },
  });

  pi.registerTool({
    name: 'go_to_page',
    label: 'Go To Page',
    description: 'Navigate one existing Chrome page target through CDP and wait for its document load event; use the returned target id with browser_page_screenshot.',
    promptSnippet: 'Navigate one existing Chrome tab through CDP and return its target id.',
    promptGuidelines: [
      'Use go_to_page when the user wants an existing Chrome tab navigated to a URL before capture; use browser_tabs_list first if the target tab is ambiguous.',
      'Use go_to_page results with browser_page_screenshot when the user needs visual confirmation after navigation.',
    ],
    parameters: goToPageParameters,
    renderShell: 'self',
    renderCall(args: any, theme: any, context: any) {
      return renderBrowserCall('go_to_page', args, theme, context);
    },
    renderResult(result: any, options: any, theme: any, context: any) {
      return renderBrowserResult('go_to_page', result, options, theme, context);
    },
    async execute(_id: string, params: GoToPageParams, signal?: AbortSignal): Promise<PiToolResult<BrowserGoToPageResult>> {
      const navigation = await navigateBrowserPage({ ...params, signal });
      const data: BrowserGoToPageResult = { ...navigation, targetId: navigation.target.id };
      return buildSuccess([textContent(formatNavigationSummary(data))], data);
    },
  });

  pi.registerTool({
    name: 'browser_page_screenshot',
    label: 'Browser Page Screenshot',
    description: 'Capture the current content of an existing Chrome page tab through CDP without navigation, scrolling, focus changes, or other page mutation.',
    promptSnippet: 'Capture a PNG screenshot of an existing Chrome tab through CDP.',
    promptGuidelines: [
      'Use browser_page_screenshot when the user asks to inspect the current visual content of an existing Chrome tab without navigating or mutating the page.',
      'Use browser_page_screenshot with targetId from browser_tabs_list or go_to_page when multiple tabs may match.',
    ],
    parameters: screenshotParameters,
    renderShell: 'self',
    renderCall(args: any, theme: any, context: any) {
      return renderBrowserCall('browser_page_screenshot', args, theme, context);
    },
    renderResult(result: any, options: any, theme: any, context: any) {
      return renderBrowserResult('browser_page_screenshot', result, options, theme, context);
    },
    async execute(_id: string, params: BrowserPageScreenshotParams, signal?: AbortSignal, _onUpdate?: unknown, ctx?: ToolExecutionContext): Promise<PiToolResult<BrowserPageScreenshotResult>> {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const capture = await captureBrowserPageScreenshot({
          cwd,
          cdpUrl: params.cdpUrl,
          targetId: params.targetId,
          urlContains: params.urlContains,
          titleContains: params.titleContains,
          outputPath: params.outputPath,
          now: params.now,
          fetchFn: params.fetchFn,
          transportFactory: params.transportFactory,
          signal,
        });

        if (!params.outputPath) await ensureDefaultScreenshotGitIgnored(cwd).catch(() => false);

        const warnings = [...capture.warnings];
        const content: ToolContent[] = [];
        let inlineAttached = false;

        if (modelCanAcceptImages(ctx)) {
          const maxInlineBytes = normalizeMaxInlineBytes(params.maxInlineBytes);
          if (capture.outputSizeBytes <= maxInlineBytes) {
            content.push(textContent(formatScreenshotSummary({ ...capture, inlineAttached: true, warnings })));
            content.push({ type: 'image', data: capture.imageBase64, mimeType: 'image/png' });
            inlineAttached = true;
          } else {
            warnings.push(`PNG was saved but not attached inline because it is ${capture.outputSizeBytes.toLocaleString('en-US')} bytes and maxInlineBytes is ${maxInlineBytes.toLocaleString('en-US')}`);
          }
        } else {
          warnings.push('current model does not support image inputs; PNG was saved but not attached inline');
        }

        if (!inlineAttached) content.push(textContent(formatScreenshotSummary({ ...capture, inlineAttached: false, warnings })));

        return buildSuccess(content, {
          target: capture.target,
          outputPath: capture.outputPath,
          outputSizeBytes: capture.outputSizeBytes,
          inlineAttached,
          width: capture.width,
          height: capture.height,
          warnings,
        });
      } catch (error) {
        return buildFailure('page_screenshot_failed', error instanceof Error ? error.message : 'browser_page_screenshot failed');
      }
    },
  });
}

function normalizeListLimit(value?: number): number {
  if (value === undefined) return 20;
  if (!Number.isFinite(value) || value < 1 || value > 50) throw new Error('limit must be between 1 and 50');
  return Math.round(value);
}

function formatStatus(data: { cdpUrl: string; versionReachable: boolean; tabsReachable: boolean; browser?: string; protocolVersion?: string; pageTargetCount?: number; warnings: string[] }): string {
  const lines = [
    `browser_cdp_status: ${data.cdpUrl}`,
    `version endpoint: ${data.versionReachable ? 'reachable' : 'unreachable'}`,
    `tabs endpoint: ${data.tabsReachable ? 'reachable' : 'unreachable'}`,
    data.browser ? `browser: ${data.browser}` : undefined,
    data.protocolVersion ? `protocol: ${data.protocolVersion}` : undefined,
    typeof data.pageTargetCount === 'number' ? `page targets: ${data.pageTargetCount}` : undefined,
    data.warnings.length ? `warnings: ${data.warnings.join('; ')}` : undefined,
  ].filter(Boolean);
  return lines.join('\n');
}

function formatTabsList(data: BrowserTabsListResult): string {
  const lines = [
    `browser_tabs_list: ${data.cdpUrl}`,
    `page targets: ${data.totalPageTargets}`,
    ...data.tabs.map((tab) => `- ${tab.id} | ${truncate(tab.title || '(untitled)', 120)} | ${truncate(tab.url, 180)} | websocket=${tab.hasWebSocketDebuggerUrl ? 'yes' : 'no'}`),
    data.totalPageTargets > data.returnedCount ? `... ${data.totalPageTargets - data.returnedCount} more page target(s) omitted` : undefined,
    data.warnings.length ? `warnings: ${data.warnings.join('; ')}` : undefined,
  ].filter(Boolean);
  return lines.join('\n');
}

function formatNavigationSummary(data: BrowserGoToPageResult): string {
  return [
    `go_to_page: navigation completed for ${truncate(data.requestedUrl, 240)}`,
    `target: ${data.targetId}`,
    `completion: ${data.completionMode}`,
    `follow-up: call browser_page_screenshot with { targetId: "${data.targetId}" }`,
  ].join('\n');
}

function formatScreenshotSummary(data: { target: { id: string; title: string; url: string }; outputPath: string; outputSizeBytes: number; width: number; height: number; inlineAttached: boolean; warnings: string[] }): string {
  const lines = [
    `browser_page_screenshot: ${data.outputPath}`,
    `target: ${data.target.id} | ${truncate(data.target.title || '(untitled)', 120)} | ${truncate(data.target.url, 180)}`,
    `content size: ${data.width}x${data.height}`,
    `png size: ${data.outputSizeBytes.toLocaleString('en-US')} bytes`,
    `inline image: ${data.inlineAttached ? 'attached' : 'not attached'}`,
    data.warnings.length ? `warnings: ${data.warnings.join('; ')}` : undefined,
  ].filter(Boolean);
  return lines.join('\n');
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function textContent(text: string): ToolContent {
  return { type: 'text', text };
}

function buildSuccess<T extends { warnings?: string[] }>(content: ToolContent[], data: T): PiToolResult<T> {
  return {
    content,
    details: { status: 'success', data, warnings: data.warnings?.length ? data.warnings : undefined },
  };
}

function buildFailure(code: string, message: string): PiToolResult<never> {
  return {
    content: [{ type: 'text', text: message }],
    details: { status: 'failure', error: { code, message, recoverable: true } },
    isError: true,
  };
}
