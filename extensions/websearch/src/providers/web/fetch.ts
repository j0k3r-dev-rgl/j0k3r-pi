import { Buffer } from 'node:buffer';
import dns from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import net from 'node:net';
import { TextDecoder } from 'node:util';
import { convert } from 'html-to-text';
import { ProviderFailure, fetchProviderErrorFromError, truncateText } from '../../security.js';
import type { WebFetchClient, WebFetchRequest, WebFetchResult, WebFetchLink, WebFetchRedirect } from '../../types.js';
import { WEB_FETCH_MAX_LINKS, WEB_FETCH_MAX_REDIRECTS } from '../../types.js';

export type ResolvedSafeAddress = { address: string; family: 4 | 6 };
export type ResolveHost = (hostname: string) => Promise<ResolvedSafeAddress[]>;
export type SafeWebFetchTransportRequest = {
  url: string;
  headers: Record<string, string>;
  address: ResolvedSafeAddress;
  maxBytes: number;
  signal?: AbortSignal;
};
export type SafeWebFetchTransportResponse = {
  status: number;
  headers: Headers;
  body: Uint8Array;
  bytesRead: number;
  truncated: boolean;
};
export type SafeWebFetchTransport = (request: SafeWebFetchTransportRequest) => Promise<SafeWebFetchTransportResponse>;

export type SafeWebFetchClientDeps = {
  resolveHost?: ResolveHost;
  request?: SafeWebFetchTransport;
  now?: () => Date;
};

const USER_AGENT = 'pi-websearch-web-fetch/0.1';
const HTML_MIMES = new Set(['text/html', 'application/xhtml+xml']);
const PLAIN_MIMES = new Set(['text/plain', 'text/markdown', 'text/x-markdown']);
const JSON_MIMES = new Set(['application/json', 'application/ld+json']);
const textDecoder = new TextDecoder('utf-8', { fatal: false });

function validationFailure(message: string): ProviderFailure {
  return new ProviderFailure({
    code: 'validation_error',
    category: 'validation',
    message,
    recoverable: true,
    provider: 'web_fetch',
  });
}

function providerFailure(message: string, status?: number): ProviderFailure {
  return new ProviderFailure({
    code: 'provider_error',
    category: 'provider_payload',
    message,
    recoverable: true,
    provider: 'web_fetch',
    status,
  });
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

function blockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === 'ip6-localhost'
    || normalized === 'ip6-loopback'
    || normalized === 'metadata.google.internal';
}

function ipv4Parts(address: string): number[] | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return numbers;
}

function isPrivateIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8')) return true;
  const mapped = /(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized)?.[1];
  return mapped ? isPrivateIpv4(mapped) : false;
}

function assertSafeAddress(address: string): void {
  const normalized = normalizeHostname(address);
  const family = net.isIP(normalized);
  if (family === 4 && isPrivateIpv4(normalized)) {
    throw validationFailure(`web_fetch blocked unsafe private/local address: ${address}`);
  }
  if (family === 6 && isPrivateIpv6(normalized)) {
    throw validationFailure(`web_fetch blocked unsafe private/local address: ${address}`);
  }
  if (family !== 4 && family !== 6) {
    throw validationFailure(`web_fetch received an invalid resolved address: ${address}`);
  }
}

function parseAndValidateUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw validationFailure('web_fetch url must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:') throw validationFailure('web_fetch only supports https:// URLs.');
  if (url.username || url.password) throw validationFailure('web_fetch does not allow embedded URL credentials.');
  if (!url.hostname) throw validationFailure('web_fetch URL must include a hostname.');
  if (url.hostname.includes('%')) throw validationFailure('web_fetch does not allow IPv6 zone identifiers.');
  if (blockedHostname(url.hostname)) throw validationFailure('web_fetch blocked unsafe local/metadata hostname.');
  if (net.isIP(normalizeHostname(url.hostname))) assertSafeAddress(url.hostname);
  return url;
}

async function defaultResolveHost(hostname: string): Promise<ResolvedSafeAddress[]> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.flatMap((entry) => (entry.family === 4 || entry.family === 6) ? [{ address: entry.address, family: entry.family }] : []);
}

function headersFromIncoming(headers: Record<string, string | string[] | number | undefined>): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) result.append(key, entry);
    } else if (value !== undefined) {
      result.set(key, String(value));
    }
  }
  return result;
}

export function pinnedLookup(address: ResolvedSafeAddress) {
  return (_hostname: string, options: { all?: boolean }, callback: (error: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: 4 | 6 }>, family?: 4 | 6) => void): void => {
    if (options.all) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

function defaultTransport(input: SafeWebFetchTransportRequest): Promise<SafeWebFetchTransportResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(input.url);
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let truncated = false;
    let settled = false;
    let responseStatus = 0;
    let responseHeaders = new Headers();

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({
        status: responseStatus,
        headers: responseHeaders,
        body: Buffer.concat(chunks),
        bytesRead: Math.min(bytesRead, input.maxBytes),
        truncated,
      });
    };

    const req = httpsRequest(url, {
      method: 'GET',
      headers: input.headers,
      signal: input.signal,
      lookup: pinnedLookup(input.address),
      timeout: 10_000,
    }, (res) => {
      responseStatus = res.statusCode ?? 0;
      responseHeaders = headersFromIncoming(res.headers as Record<string, string | string[] | number | undefined>);
      res.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = input.maxBytes - chunks.reduce((total, entry) => total + entry.byteLength, 0);
        bytesRead += buffer.byteLength;
        if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
        if (bytesRead > input.maxBytes) {
          truncated = true;
          finish();
          res.destroy();
          req.destroy();
        }
      });
      res.on('end', finish);
      res.on('error', (error) => {
        if (truncated) finish();
        else if (!settled) reject(error);
      });
    });

    req.on('timeout', () => req.destroy(new Error('web_fetch request timed out.')));
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
    req.end();
  });
}

function mimeFromContentType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

function decodeBody(body: Uint8Array): string {
  return textDecoder.decode(body);
}

function stripDangerousHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
}

function htmlToText(html: string): string {
  const cleaned = stripDangerousHtml(html);
  return cleanExtractedText(convert(cleaned, {
    wordwrap: false,
    limits: { maxInputLength: html.length + 1 },
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'h1', options: { uppercase: false } },
      { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
      { selector: 'h4', options: { uppercase: false } },
      { selector: 'h5', options: { uppercase: false } },
      { selector: 'h6', options: { uppercase: false } },
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'iframe', format: 'skip' },
    ],
  }));
}

function cleanExtractedText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function titleFromHtml(html: string): string | undefined {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (!raw) return undefined;
  const text = htmlToText(raw).replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function excerptFromText(text: string): string {
  return truncateText(text.replace(/\s+/g, ' ').trim(), 700) ?? '';
}

function linkText(innerHtml: string, fallback: string): string {
  const text = htmlToText(innerHtml).replace(/\s+/g, ' ').trim();
  return truncateText(text || fallback, 160) ?? fallback;
}

function extractLinks(html: string, baseUrl: string): WebFetchLink[] {
  const links: WebFetchLink[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = match[1] ?? match[2] ?? match[3] ?? '';
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== 'https:') continue;
      const normalized = url.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push({ text: linkText(match[4] ?? '', normalized), url: normalized });
      if (links.length >= WEB_FETCH_MAX_LINKS) break;
    } catch {
      // Ignore malformed page links.
    }
  }
  return links;
}

function textForBody(mime: string, bodyText: string): { text: string; title?: string; links: WebFetchLink[] } {
  if (HTML_MIMES.has(mime)) {
    throw new Error('html body needs base url');
  }
  if (JSON_MIMES.has(mime)) {
    try {
      return { text: JSON.stringify(JSON.parse(bodyText), null, 2), links: [] };
    } catch {
      return { text: cleanExtractedText(bodyText), links: [] };
    }
  }
  return { text: cleanExtractedText(bodyText), links: [] };
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function responseHeaders(): Record<string, string> {
  return {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/xhtml+xml,text/plain,text/markdown,text/x-markdown,application/json;q=0.9,*/*;q=0.1',
    'accept-encoding': 'identity',
  };
}

export class SafeWebFetchClient implements WebFetchClient {
  private readonly resolveHost: ResolveHost;
  private readonly request: SafeWebFetchTransport;
  private readonly now: () => Date;

  constructor(deps: SafeWebFetchClientDeps = {}) {
    this.resolveHost = deps.resolveHost ?? defaultResolveHost;
    this.request = deps.request ?? defaultTransport;
    this.now = deps.now ?? (() => new Date());
  }

  async fetch(input: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const originalUrl = parseAndValidateUrl(input.url).toString();
    let currentUrl = originalUrl;
    const redirects: WebFetchRedirect[] = [];

    for (;;) {
      const url = parseAndValidateUrl(currentUrl);
      const address = await this.resolveSafeAddress(url.hostname);
      let response: SafeWebFetchTransportResponse;
      try {
        response = await this.request({
          url: url.toString(),
          headers: responseHeaders(),
          address,
          maxBytes: input.maxBytes,
          signal,
        });
      } catch (error) {
        throw new ProviderFailure(fetchProviderErrorFromError('web_fetch', error, 'web_fetch request failed.'));
      }

      if (isRedirect(response.status)) {
        if (redirects.length >= WEB_FETCH_MAX_REDIRECTS) throw validationFailure(`web_fetch exceeded ${WEB_FETCH_MAX_REDIRECTS} redirects.`);
        const location = response.headers.get('location');
        if (!location) throw providerFailure('web_fetch redirect response did not include a Location header.', response.status);
        const nextUrl = parseAndValidateUrl(new URL(location, url).toString()).toString();
        redirects.push({ url: url.toString(), status: response.status, location: nextUrl });
        currentUrl = nextUrl;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw providerFailure(`web_fetch request failed with HTTP ${response.status}.`, response.status);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const mime = mimeFromContentType(contentType);
      if (!HTML_MIMES.has(mime) && !PLAIN_MIMES.has(mime) && !JSON_MIMES.has(mime)) {
        throw providerFailure(`web_fetch blocked unsupported content type: ${contentType || 'unknown'}.`, response.status);
      }

      const bodyText = decodeBody(response.body);
      const extracted = HTML_MIMES.has(mime)
        ? { text: htmlToText(bodyText), title: titleFromHtml(bodyText), links: extractLinks(bodyText, url.toString()) }
        : textForBody(mime, bodyText);
      const text = extracted.text;

      return {
        url: originalUrl,
        final_url: url.toString(),
        status: response.status,
        content_type: contentType,
        title: extracted.title,
        text,
        excerpt: excerptFromText(text),
        links: extracted.links,
        fetched_at: this.now().toISOString(),
        bytes_read: response.bytesRead,
        truncated: response.truncated,
        redirects,
      };
    }
  }

  private async resolveSafeAddress(hostname: string): Promise<ResolvedSafeAddress> {
    const normalizedHost = normalizeHostname(hostname);
    if (net.isIP(normalizedHost)) {
      assertSafeAddress(normalizedHost);
      return { address: normalizedHost, family: net.isIP(normalizedHost) as 4 | 6 };
    }

    let addresses: ResolvedSafeAddress[];
    try {
      addresses = await this.resolveHost(normalizedHost);
    } catch (error) {
      throw new ProviderFailure(fetchProviderErrorFromError('web_fetch', error, `web_fetch could not resolve ${normalizedHost}.`));
    }
    if (addresses.length === 0) throw providerFailure(`web_fetch could not resolve ${normalizedHost}.`);
    for (const entry of addresses) assertSafeAddress(entry.address);
    return addresses[0]!;
  }
}

export function createSafeWebFetchClient(): WebFetchClient {
  return new SafeWebFetchClient();
}
