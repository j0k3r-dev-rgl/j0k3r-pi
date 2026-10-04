import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAccountQuota, clearQuotaCache } from '../src/quota.ts';

describe('Quota client and Gemini 5-hour consumption calculator', () => {
  beforeEach(() => {
    clearQuotaCache();
  });

  it('correctly matches Gemini 5h bucket and calculates consumption percentage', async () => {
    let apiCallCount = 0;
    const fakeFetch = async (url, options) => {
      apiCallCount++;
      const body = JSON.parse(options.body);
      assert.equal(body.auth_index, '0');
      assert.equal(body.url, 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary');

      const mockQuotaBody = JSON.stringify({
        groups: [
          {
            displayName: 'Claude Models',
            buckets: [
              { remainingFraction: 0.1, window: '5 hours' },
            ],
          },
          {
            displayName: 'Google Models (Gemini)',
            buckets: [
              { remainingFraction: 0.88, window: '5 hours', resetTime: '2026-10-03T04:00:00Z' },
              { remainingFraction: 0.95, window: '1 day' },
            ],
          },
        ],
      });

      return Response.json({ status_code: 200, body: mockQuotaBody });
    };

    const quota = await fetchAccountQuota('0', {
      baseUrl: 'http://127.0.0.1:8317',
      managementKey: 'secret',
      fetchFn: fakeFetch,
    });

    assert.equal(quota.remainingFraction, 0.88);
    assert.equal(quota.usedPercentage, 12.0);
    assert.equal(quota.window, '5 hs');
    assert.ok(quota.lastCheckedAt);
    assert.equal(apiCallCount, 1);

    // Call again within 30s cache TTL - should hit cache with 0 network calls
    const cachedQuota = await fetchAccountQuota('0', {
      baseUrl: 'http://127.0.0.1:8317',
      managementKey: 'secret',
      fetchFn: fakeFetch,
    });

    assert.equal(cachedQuota.remainingFraction, 0.88);
    assert.equal(apiCallCount, 1); // No new network request

    // Call with forceFresh: true - should bypass cache and issue a new network request
    const freshQuota = await fetchAccountQuota('0', {
      baseUrl: 'http://127.0.0.1:8317',
      managementKey: 'secret',
      fetchFn: fakeFetch,
      forceFresh: true,
    });

    assert.equal(freshQuota.remainingFraction, 0.88);
    assert.equal(apiCallCount, 2); // Bypassed cache!
  });

  it('out-of-order response does not poison in-memory quotaCache', async () => {
    let callCount = 0;
    const fakeFetch = async () => {
      callCount++;
      const remaining = callCount === 1 ? 0.9 : 0.7;
      return Response.json({
        status_code: 200,
        body: JSON.stringify({
          groups: [{
            displayName: 'Google Models (Gemini)',
            buckets: [{ remainingFraction: remaining, window: '5 hours' }],
          }],
        }),
      });
    };

    // Request 1 starts first (token 100), but finishes second
    // Request 2 starts second (token 200), finishes first
    const p2 = fetchAccountQuota('0', {
      fetchFn: fakeFetch,
      forceFresh: true,
      requestStartedAt: 200,
    });
    const q2 = await p2;
    assert.equal(q2.remainingFraction, 0.9);

    // Now Request 1 completes with older requestStartedAt (100)
    const q1 = await fetchAccountQuota('0', {
      fetchFn: fakeFetch,
      forceFresh: true,
      requestStartedAt: 100,
    });
    assert.equal(q1.remainingFraction, 0.7);

    // Cache should retain the quota from requestStartedAt: 200 (not poisoned by 100)
    const cached = await fetchAccountQuota('0');
    assert.equal(cached.remainingFraction, 0.9);
  });

  it('rejects non-Gemini buckets and handles missing 5h bucket gracefully', async () => {
    const fakeFetch = async () => {
      const mockQuotaBody = JSON.stringify({
        groups: [
          {
            displayName: 'OpenAI Models',
            buckets: [{ remainingFraction: 0.5, window: '5 hs' }],
          },
        ],
      });
      return Response.json({ status_code: 200, body: mockQuotaBody });
    };

    const quota = await fetchAccountQuota('1', {
      fetchFn: fakeFetch,
    });

    assert.ok(quota);
    assert.equal(quota.remainingFraction, 0.0);
    assert.equal(quota.status, 'unknown');
    assert.equal(quota.lastCheckedAt, undefined);
  });

  it('sends the token substitution header and rejects inner status failures', async () => {
    let payload;
    const quota = await fetchAccountQuota('auth-x', { fetchFn: async (_url, options) => {
      payload = JSON.parse(options.body);
      return Response.json({ status_code: 401, body: { groups: [{ name: 'Gemini', buckets: [{ window: '5h', remainingFraction: 1 }] }] } });
    } });
    assert.equal(payload.header.Authorization, 'Bearer $TOKEN$');
    assert.equal(payload.header['User-Agent'], 'antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)');
    assert.equal(quota.remainingFraction, 0);
    assert.equal(quota.status, 'unknown');
  });

  it('bounds stalled fetch and response reads and combines caller cancellation', async () => {
    for (const stallRead of [false, true]) {
      const quota = await Promise.race([fetchAccountQuota(`stall-${stallRead}`, { timeoutMs: 20, fetchFn: async () => {
        if (!stallRead) return new Promise(() => {});
        return new Response(new ReadableStream({ start() {} }));
      } }), new Promise((resolve) => setTimeout(() => resolve({ status: 'still pending' }), 100))]);
      assert.equal(quota.status, 'unknown');
    }
    const controller = new AbortController();
    let requestSignal;
    const pending = fetchAccountQuota('abort', { fetchFn: async (_url, options) => {
      requestSignal = options.signal;
      return new Promise(() => {});
    }, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(requestSignal.aborted, true);
  });

  it('rejects oversized and malformed responses without inventing fresh quota', async () => {
    for (const body of ['x'.repeat(1024 * 1024 + 1), '{bad']) {
      const quota = await fetchAccountQuota(body.length.toString(), { fetchFn: async () => new Response(body) });
      assert.equal(quota.status, 'unknown');
      assert.equal(quota.lastCheckedAt, undefined);
    }
  });

  it('retains stale known quota on inner error with its original check time', async () => {
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
      const known = await fetchAccountQuota('stale', { fetchFn: async () => Response.json({ status_code: 200, body: { groups: [{ name: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.7 }] }] } }) });
      now += 30_001;
      const stale = await fetchAccountQuota('stale', { fetchFn: async () => Response.json({ status_code: 429, body: {} }) });
      assert.equal(stale.remainingFraction, 0.7);
      assert.equal(stale.lastCheckedAt, known.lastCheckedAt);
      assert.equal(stale.status, 'stale');
    } finally { Date.now = originalNow; }
  });

  it('handles HTTP error gracefully without throwing', async () => {
    const fakeFetch = async () => ({ ok: false, status: 500 });
    const quota = await fetchAccountQuota('2', { fetchFn: fakeFetch });

    assert.ok(quota);
    assert.equal(quota.remainingFraction, 0.0);
    assert.equal(quota.status, 'unknown');
    assert.equal(quota.lastCheckedAt, undefined);
  });
});
