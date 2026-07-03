import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalizeCdpUrl, resolveScreenshotOutputPath } from './config.js';
import type { BrowserCdpStatus, BrowserPageTarget } from './types.js';

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<FetchResponseLike>;

export interface CdpTransport {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

export type CdpTransportFactory = (webSocketDebuggerUrl: string, signal?: AbortSignal) => Promise<CdpTransport>;

export interface CapturePageScreenshotInput {
  cwd: string;
  cdpUrl?: string;
  targetId?: string;
  urlContains?: string;
  titleContains?: string;
  outputPath?: string;
  now?: () => Date;
  fetchFn?: FetchLike;
  transportFactory?: CdpTransportFactory;
  signal?: AbortSignal;
}

export interface CapturePageScreenshotData {
  target: Pick<BrowserPageTarget, 'id' | 'title' | 'url'>;
  outputPath: string;
  outputSizeBytes: number;
  width: number;
  height: number;
  warnings: string[];
  imageBase64: string;
}

export async function getBrowserCdpStatus(cdpUrl?: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<BrowserCdpStatus> {
  const normalizedUrl = normalizeCdpUrl(cdpUrl);
  const warnings: string[] = [];
  let versionReachable = false;
  let tabsReachable = false;
  let browser: string | undefined;
  let protocolVersion: string | undefined;
  let pageTargetCount: number | undefined;

  try {
    const version = await fetchJson<Record<string, unknown>>(new URL('/json/version', `${normalizedUrl}/`).toString(), fetchFn);
    versionReachable = true;
    browser = stringValue(version.Browser);
    protocolVersion = stringValue(version['Protocol-Version']);
  } catch (error) {
    warnings.push(`version endpoint unavailable: ${errorMessage(error)}`);
  }

  try {
    const tabs = await fetchJson<unknown[]>(new URL('/json/list', `${normalizedUrl}/`).toString(), fetchFn);
    tabsReachable = true;
    pageTargetCount = tabs.filter((entry) => parsePageTarget(entry)).length;
  } catch (error) {
    warnings.push(`tabs endpoint unavailable: ${errorMessage(error)}`);
  }

  return { cdpUrl: normalizedUrl, versionReachable, tabsReachable, browser, protocolVersion, pageTargetCount, warnings };
}

export async function listBrowserPageTargets(cdpUrl?: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<BrowserPageTarget[]> {
  const normalizedUrl = normalizeCdpUrl(cdpUrl);
  const targets = await fetchJson<unknown[]>(new URL('/json/list', `${normalizedUrl}/`).toString(), fetchFn);
  return targets.map(parsePageTarget).filter((target): target is BrowserPageTarget => Boolean(target));
}

export function selectBrowserPageTarget(targets: BrowserPageTarget[], selectors: { targetId?: string; urlContains?: string; titleContains?: string }): BrowserPageTarget {
  if (targets.length === 0) throw new Error('No page targets were returned by CDP');

  const targetId = selectors.targetId?.trim();
  if (targetId) {
    const match = targets.find((target) => target.id === targetId);
    if (!match) throw new Error(`No page target matched targetId ${targetId}`);
    return requireWebSocketTarget(match);
  }

  const urlContains = selectors.urlContains?.trim().toLowerCase();
  const titleContains = selectors.titleContains?.trim().toLowerCase();

  const filtered = targets.filter((target) => {
    if (urlContains && !target.url.toLowerCase().includes(urlContains)) return false;
    if (titleContains && !target.title.toLowerCase().includes(titleContains)) return false;
    return true;
  });

  if (filtered.length === 0) throw new Error('No page target matched the provided selectors');
  return requireWebSocketTarget(filtered[0]);
}

export async function captureBrowserPageScreenshot(input: CapturePageScreenshotInput): Promise<CapturePageScreenshotData> {
  const targets = await listBrowserPageTargets(input.cdpUrl, input.fetchFn);
  const target = selectBrowserPageTarget(targets, input);
  const transport = await (input.transportFactory ?? createWebSocketTransport)(target.webSocketDebuggerUrl!, input.signal);

  try {
    await transport.send('Page.enable');
    const metrics = await transport.send<LayoutMetricsResult>('Page.getLayoutMetrics');
    const clip = buildFullPageClip(metrics);
    const screenshot = await transport.send<{ data?: string }>('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip,
    });
    const imageBase64 = screenshot.data?.trim();
    if (!imageBase64) throw new Error('CDP did not return screenshot data');
    const imageBytes = Buffer.from(imageBase64, 'base64');

    const resolved = resolveScreenshotOutputPath(input.cwd, input.outputPath, input.now);
    await mkdir(dirname(resolved.outputPath), { recursive: true });
    await writeFile(resolved.outputPath, imageBytes);

    return {
      target: { id: target.id, title: target.title, url: target.url },
      outputPath: resolved.outputPath,
      outputSizeBytes: imageBytes.byteLength,
      width: clip.width,
      height: clip.height,
      warnings: [],
      imageBase64,
    };
  } finally {
    await transport.close();
  }
}

export async function createWebSocketTransport(webSocketDebuggerUrl: string, signal?: AbortSignal): Promise<CdpTransport> {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new Error('CDP connection aborted'));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.addEventListener('open', () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => reject(new Error('Failed to connect to CDP websocket')), { once: true });
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string } };
    if (!payload.id) return;
    const entry = pending.get(payload.id);
    if (!entry) return;
    pending.delete(payload.id);
    if (payload.error) entry.reject(new Error(payload.error.message || 'CDP command failed'));
    else entry.resolve(payload.result);
  });

  socket.addEventListener('close', () => {
    for (const entry of pending.values()) entry.reject(new Error('CDP websocket closed'));
    pending.clear();
  });

  return {
    async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
      const id = nextId++;
      const promise = new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return await promise;
    },
    async close(): Promise<void> {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    },
  };
}

interface LayoutMetricsResult {
  cssContentSize?: { x?: number; y?: number; width?: number; height?: number };
  contentSize?: { x?: number; y?: number; width?: number; height?: number };
}

function buildFullPageClip(metrics: LayoutMetricsResult): { x: number; y: number; width: number; height: number; scale: number } {
  const content = metrics.cssContentSize ?? metrics.contentSize;
  if (!content) throw new Error('CDP layout metrics did not include content size');
  const width = positiveNumber(content.width, 'width');
  const height = positiveNumber(content.height, 'height');
  return {
    x: finiteNumber(content.x ?? 0),
    y: finiteNumber(content.y ?? 0),
    width,
    height,
    scale: 1,
  };
}

async function fetchJson<T>(url: string, fetchFn: FetchLike): Promise<T> {
  const response = await fetchFn(url, { method: 'GET' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  return await response.json() as T;
}

function parsePageTarget(value: unknown): BrowserPageTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'page') return null;
  const id = stringValue(record.id);
  const title = stringValue(record.title) ?? '';
  const url = stringValue(record.url) ?? '';
  if (!id) return null;
  const webSocketDebuggerUrl = stringValue(record.webSocketDebuggerUrl);
  return { id, title, url, hasWebSocketDebuggerUrl: Boolean(webSocketDebuggerUrl), webSocketDebuggerUrl };
}

function requireWebSocketTarget(target: BrowserPageTarget): BrowserPageTarget {
  if (!target.webSocketDebuggerUrl) throw new Error(`Selected page target ${target.id} has no webSocketDebuggerUrl`);
  return target;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('CDP returned invalid numeric layout metrics');
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  const number = finiteNumber(value);
  if (number <= 0) throw new Error(`CDP returned invalid ${label} in layout metrics`);
  return number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
