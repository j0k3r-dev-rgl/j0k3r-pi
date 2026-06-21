import { describe, expect, it, vi } from 'vitest';
import { pinnedLookup, SafeWebFetchClient } from '../src/providers/web/fetch.js';
import { ProviderFailure } from '../src/security.js';

function publicAddress() {
  return [{ address: '93.184.216.34', family: 4 as const }];
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function expectProviderFailure(error: unknown, message: RegExp) {
  expect(error).toBeInstanceOf(ProviderFailure);
  expect((error as ProviderFailure).toolError).toMatchObject({ code: 'validation_error', provider: 'web_fetch' });
  expect((error as ProviderFailure).toolError.message).toMatch(message);
}

describe('SafeWebFetchClient', () => {
  it('returns an address array when Node HTTPS asks lookup with all=true', () => {
    const lookup = pinnedLookup({ address: '93.184.216.34', family: 4 });
    const callback = vi.fn();

    lookup('example.com', { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  });

  it('returns address and family when Node HTTPS asks lookup without all=true', () => {
    const lookup = pinnedLookup({ address: '93.184.216.34', family: 4 });
    const callback = vi.fn();

    lookup('example.com', {}, callback);

    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  it('fetches https html, extracts readable text, title, links, redirects, and byte metadata', async () => {
    const resolveHost = vi.fn().mockResolvedValue(publicAddress());
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: '/docs' }),
        body: new Uint8Array(),
        bytesRead: 0,
        truncated: false,
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        body: bytes(`<!doctype html><html><head><title>Docs page</title></head><body><nav>Skip nav</nav><main><h1>Docs page</h1><p>Install with npm.</p><a href="/migration">Migration guide</a><a href="javascript:alert(1)">bad</a></main><script>evil()</script></body></html>`),
        bytesRead: 247,
        truncated: false,
      });
    const client = new SafeWebFetchClient({ resolveHost, request, now: () => new Date('2026-06-20T12:00:00.000Z') });

    const result = await client.fetch({ url: 'https://example.com/start', maxBytes: 4096 });

    expect(resolveHost).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toMatchObject({ url: 'https://example.com/start', maxBytes: 4096, address: publicAddress()[0] });
    expect(request.mock.calls[1]?.[0]).toMatchObject({ url: 'https://example.com/docs', maxBytes: 4096, address: publicAddress()[0] });
    expect(result).toMatchObject({
      url: 'https://example.com/start',
      final_url: 'https://example.com/docs',
      status: 200,
      content_type: 'text/html; charset=utf-8',
      title: 'Docs page',
      fetched_at: '2026-06-20T12:00:00.000Z',
      bytes_read: 247,
      truncated: false,
      redirects: [{ url: 'https://example.com/start', status: 302, location: 'https://example.com/docs' }],
      links: [{ text: 'Migration guide', url: 'https://example.com/migration' }],
    });
    expect(result.text).toContain('Docs page');
    expect(result.text).toContain('Install with npm.');
    expect(result.text).not.toContain('evil');
    expect(result.excerpt).toContain('Install with npm.');
  });

  it('formats json and plain text without html extraction', async () => {
    const client = new SafeWebFetchClient({
      resolveHost: vi.fn().mockResolvedValue(publicAddress()),
      request: vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: bytes('{"ok":true,"name":"pi"}'),
        bytesRead: 23,
        truncated: false,
      }),
      now: () => new Date('2026-06-20T12:00:00.000Z'),
    });

    const result = await client.fetch({ url: 'https://api.example.com/data', maxBytes: 4096 });

    expect(result.text).toBe('{\n  "ok": true,\n  "name": "pi"\n}');
    expect(result.links).toEqual([]);
  });

  it('blocks non-https schemes, embedded credentials, and private literal addresses', async () => {
    const client = new SafeWebFetchClient({ resolveHost: vi.fn().mockResolvedValue(publicAddress()), request: vi.fn() });

    await client.fetch({ url: 'http://example.com', maxBytes: 4096 }).then(
      () => { throw new Error('expected http to be blocked'); },
      (error) => expectProviderFailure(error, /https/i),
    );
    await client.fetch({ url: 'https://user:pass@example.com', maxBytes: 4096 }).then(
      () => { throw new Error('expected credentials to be blocked'); },
      (error) => expectProviderFailure(error, /credentials/i),
    );
    await client.fetch({ url: 'https://127.0.0.1/private', maxBytes: 4096 }).then(
      () => { throw new Error('expected loopback to be blocked'); },
      (error) => expectProviderFailure(error, /private|local|unsafe/i),
    );
    await client.fetch({ url: 'https://[::1]/private', maxBytes: 4096 }).then(
      () => { throw new Error('expected ipv6 loopback to be blocked'); },
      (error) => expectProviderFailure(error, /private|local|unsafe/i),
    );
  });

  it('blocks DNS results and redirects to private or non-https targets', async () => {
    const privateDnsClient = new SafeWebFetchClient({
      resolveHost: vi.fn().mockResolvedValue([{ address: '10.0.0.8', family: 4 as const }]),
      request: vi.fn(),
    });
    await privateDnsClient.fetch({ url: 'https://example.com', maxBytes: 4096 }).then(
      () => { throw new Error('expected private DNS to be blocked'); },
      (error) => expectProviderFailure(error, /private|local|unsafe/i),
    );

    const redirectClient = new SafeWebFetchClient({
      resolveHost: vi.fn().mockResolvedValue(publicAddress()),
      request: vi.fn().mockResolvedValue({
        status: 302,
        headers: new Headers({ location: 'http://example.com/insecure' }),
        body: new Uint8Array(),
        bytesRead: 0,
        truncated: false,
      }),
    });
    await redirectClient.fetch({ url: 'https://example.com', maxBytes: 4096 }).then(
      () => { throw new Error('expected insecure redirect to be blocked'); },
      (error) => expectProviderFailure(error, /https/i),
    );
  });
});
