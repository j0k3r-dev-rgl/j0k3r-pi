import { resolveBaseUrl, resolveManagementKey } from './accounts.ts';
import { requestJson } from './http.ts';

const CACHE_TTL_MS = 30_000;
const quotaCache = new Map();
export function clearQuotaCache() { quotaCache.clear(); }

/** Fetch only verified Gemini 5h quotas; unknown uses conservative ranking, not a fabricated check. */
export async function fetchAccountQuota(authIndex, options = {}) {
  const { signal } = options;
  signal?.throwIfAborted();
  const baseUrl = options.baseUrl ?? resolveBaseUrl();
  const managementKey = options.managementKey ?? resolveManagementKey();
  const cacheKey = `${baseUrl}:${authIndex}`;
  const cached = quotaCache.get(cacheKey);
  if (!options.forceFresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.quota;
  const fallback = () => cached
    ? { ...cached.quota, status: 'stale' }
    : { remainingFraction: 0, window: '5 hs', status: 'unknown' };
  try {
    const data = await requestJson(`${baseUrl}/v0/management/api-call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${managementKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        auth_index: authIndex,
        method: 'POST',
        url: 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
        header: {
          Authorization: 'Bearer $TOKEN$',
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)',
        },
        data: JSON.stringify({ project: 'aicode-consumers' }),
      }),
    }, options);
    if (data?.status_code !== 200) return fallback();
    const body = typeof data.body === 'string' ? JSON.parse(data.body) : data.body;
    for (const group of Array.isArray(body?.groups) ? body.groups : []) {
      if (!/gemini|google models/i.test(`${group.displayName ?? ''} ${group.name ?? ''}`)) continue;
      for (const bucket of Array.isArray(group.buckets) ? group.buckets : []) {
        if (!/\b5\s*(h|hs|hr|hour|hours)\b/i.test(String(bucket.window ?? ''))) continue;
        const remainingFraction = bucket.remainingFraction;
        if (typeof remainingFraction !== 'number' || !Number.isFinite(remainingFraction) || remainingFraction < 0 || remainingFraction > 1) continue;
        const quota = {
          remainingFraction,
          usedPercentage: Math.round((1 - remainingFraction) * 1000) / 10,
          window: '5 hs',
          status: 'known',
          lastCheckedAt: new Date().toISOString(),
        };
        const current = quotaCache.get(cacheKey);
        const reqStartedAt = typeof options.requestStartedAt === 'number' ? options.requestStartedAt : Date.now();
        if (!current || !current.requestStartedAt || reqStartedAt >= current.requestStartedAt) {
          quotaCache.set(cacheKey, { timestamp: Date.now(), quota, requestStartedAt: reqStartedAt });
        }
        return quota;
      }
    }
    return fallback();
  } catch {
    signal?.throwIfAborted();
    return fallback();
  }
}
