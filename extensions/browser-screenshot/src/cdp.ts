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
  send<T = unknown>(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
  waitForEvent?<T = unknown>(method: string, signal?: AbortSignal, timeoutMs?: number): Promise<T>;
  close(): Promise<void>;
}

export type CdpTransportFactory = (webSocketDebuggerUrl: string, signal?: AbortSignal) => Promise<CdpTransport>;

export interface NavigateBrowserPageInput {
  url: string;
  cdpUrl?: string;
  targetId?: string;
  urlContains?: string;
  titleContains?: string;
  fetchFn?: FetchLike;
  transportFactory?: CdpTransportFactory;
  signal?: AbortSignal;
}

export interface NavigateBrowserPageData {
  target: Pick<BrowserPageTarget, 'id' | 'title' | 'url'>;
  requestedUrl: string;
  completionMode: 'loadEventFired';
  durationMs: number;
  warnings: string[];
}

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

export async function getBrowserCdpStatus(cdpUrl?: string, fetchFn: FetchLike = fetch as unknown as FetchLike, signal?: AbortSignal): Promise<BrowserCdpStatus> {
  const normalizedUrl = normalizeCdpUrl(cdpUrl);
  const warnings: string[] = [];
  let versionReachable = false;
  let tabsReachable = false;
  let browser: string | undefined;
  let protocolVersion: string | undefined;
  let pageTargetCount: number | undefined;

  try {
    const version = await fetchJson<Record<string, unknown>>(new URL('/json/version', `${normalizedUrl}/`).toString(), fetchFn, signal);
    versionReachable = true;
    browser = stringValue(version.Browser);
    protocolVersion = stringValue(version['Protocol-Version']);
  } catch (error) {
    warnings.push(`version endpoint unavailable: ${errorMessage(error)}`);
  }

  try {
    const tabs = await fetchJson<unknown[]>(new URL('/json/list', `${normalizedUrl}/`).toString(), fetchFn, signal);
    tabsReachable = true;
    pageTargetCount = tabs.filter((entry) => parsePageTarget(entry)).length;
  } catch (error) {
    warnings.push(`tabs endpoint unavailable: ${errorMessage(error)}`);
  }

  return { cdpUrl: normalizedUrl, versionReachable, tabsReachable, browser, protocolVersion, pageTargetCount, warnings };
}

export async function listBrowserPageTargets(cdpUrl?: string, fetchFn: FetchLike = fetch as unknown as FetchLike, signal?: AbortSignal): Promise<BrowserPageTarget[]> {
  const normalizedUrl = normalizeCdpUrl(cdpUrl);
  const targets = await fetchJson<unknown[]>(new URL('/json/list', `${normalizedUrl}/`).toString(), fetchFn, signal);
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

export async function navigateBrowserPage(input: NavigateBrowserPageInput): Promise<NavigateBrowserPageData> {
  const destination = validateNavigationUrl(input.url);
  const startedAt = Date.now();
  const deadline = createNavigationDeadline(input.signal, NAVIGATION_TIMEOUT_MS);
  let transport: CdpTransport | undefined;
  let loadEventPromise: Promise<unknown> | undefined;
  try {
    const targets = await listBrowserPageTargets(input.cdpUrl, input.fetchFn, deadline.signal);
    const target = selectBrowserPageTarget(targets, input);
    transport = await (input.transportFactory ?? createWebSocketTransport)(target.webSocketDebuggerUrl!, deadline.signal);
    await transport.send('Page.enable', undefined, deadline.signal);
    if (!transport.waitForEvent) throw new Error('CDP transport does not support event waiting');
    loadEventPromise = transport.waitForEvent('Page.loadEventFired', deadline.signal, NAVIGATION_TIMEOUT_MS);
    const navigation = await transport.send<{ errorText?: string; isDownload?: boolean }>('Page.navigate', { url: destination }, deadline.signal);
    if (navigation.errorText) throw new Error(`CDP navigation failed: ${navigation.errorText}`);
    if (navigation.isDownload) throw new Error('CDP navigation produced a download instead of a document');
    await loadEventPromise;
    return {
      target: { id: target.id, title: target.title, url: target.url },
      requestedUrl: destination,
      completionMode: 'loadEventFired',
      durationMs: Date.now() - startedAt,
      warnings: [],
    };
  } catch (error) {
    void loadEventPromise?.catch(() => undefined);
    throw error;
  } finally {
    deadline.cleanup();
    await transport?.close();
  }
}

export async function captureBrowserPageScreenshot(input: CapturePageScreenshotInput): Promise<CapturePageScreenshotData> {
  const targets = await listBrowserPageTargets(input.cdpUrl, input.fetchFn, input.signal);
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

const NAVIGATION_TIMEOUT_MS = 30_000;
const NAVIGATION_TIMEOUT_MESSAGE = `CDP navigation timed out after ${NAVIGATION_TIMEOUT_MS}ms`;

export function validateNavigationUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('url must be an absolute http: or https: URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('url must be an absolute http: or https: URL');
  if (url.username || url.password) throw new Error('url must not contain credentials');
  return url.toString();
}

export async function createWebSocketTransport(
  webSocketDebuggerUrl: string,
  signal?: AbortSignal,
  webSocketFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
): Promise<CdpTransport> {
  const socket = webSocketFactory(webSocketDebuggerUrl);
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void; cleanup: () => void }>();
  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      safeCloseSocket(socket);
      reject(new Error('CDP connection aborted'));
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      safeCloseSocket(socket);
      reject(new Error('Failed to connect to CDP websocket'));
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('error', onError, { once: true });
  });

  const eventWaiters = new Map<string, Set<{ resolve: (value: unknown) => void; reject: (error: unknown) => void; cleanup: () => void }>>();
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
    if (payload.method) {
      const waiters = eventWaiters.get(payload.method);
      if (waiters) {
        eventWaiters.delete(payload.method);
        for (const waiter of waiters) { waiter.cleanup(); waiter.resolve(payload.params); }
      }
    }
    if (!payload.id) return;
    const entry = pending.get(payload.id);
    if (!entry) return;
    pending.delete(payload.id);
    if (payload.error) entry.reject(new Error(payload.error.message || 'CDP command failed'));
    else entry.resolve(payload.result);
  });

  socket.addEventListener('close', () => {
    for (const entry of pending.values()) {
      entry.cleanup();
      entry.reject(new Error('CDP websocket closed'));
    }
    pending.clear();
    for (const waiters of eventWaiters.values()) for (const waiter of waiters) { waiter.cleanup(); waiter.reject(new Error('CDP websocket closed')); }
    eventWaiters.clear();
  });

  return {
    async send<T = unknown>(method: string, params?: Record<string, unknown>, waitSignal?: AbortSignal): Promise<T> {
      if (waitSignal?.aborted) throw abortReasonError(waitSignal, 'CDP navigation cancelled');
      const id = nextId++;
      const promise = new Promise<T>((resolve, reject) => {
        const onAbort = () => {
          pending.delete(id);
          cleanup();
          reject(abortReasonError(waitSignal, 'CDP navigation cancelled'));
        };
        const cleanup = () => waitSignal?.removeEventListener('abort', onAbort);
        pending.set(id, {
          resolve: (value) => { cleanup(); resolve(value as T); },
          reject: (error) => { cleanup(); reject(error); },
          cleanup,
        });
        waitSignal?.addEventListener('abort', onAbort, { once: true });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return await promise;
    },
    async waitForEvent<T = unknown>(method: string, waitSignal?: AbortSignal, timeoutMs = NAVIGATION_TIMEOUT_MS): Promise<T> {
      if (waitSignal?.aborted) throw abortReasonError(waitSignal, 'CDP navigation cancelled');
      return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          eventWaiters.get(method)?.delete(waiter);
          waiter.cleanup();
          reject(new Error('CDP navigation timed out waiting for Page.loadEventFired'));
        }, timeoutMs);
        const onAbort = () => { eventWaiters.get(method)?.delete(waiter); waiter.cleanup(); reject(abortReasonError(waitSignal, 'CDP navigation cancelled')); };
        const waiter = {
          resolve: resolve as (value: unknown) => void,
          reject,
          cleanup: () => { clearTimeout(timer); waitSignal?.removeEventListener('abort', onAbort); },
        };
        waitSignal?.addEventListener('abort', onAbort, { once: true });
        const waiters = eventWaiters.get(method) ?? new Set();
        waiters.add(waiter); eventWaiters.set(method, waiters);
      });
    },
    async close(): Promise<void> {
      safeCloseSocket(socket);
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

async function fetchJson<T>(url: string, fetchFn: FetchLike, signal?: AbortSignal): Promise<T> {
  const response = await fetchFn(url, { method: 'GET', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  return await response.json() as T;
}

function createNavigationDeadline(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(NAVIGATION_TIMEOUT_MESSAGE)), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason instanceof Error ? signal.reason : new Error('CDP navigation cancelled'));
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function abortReasonError(signal: AbortSignal | undefined, fallback: string): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error(fallback);
}

function safeCloseSocket(socket: Pick<WebSocket, 'readyState' | 'close'>): void {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
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
