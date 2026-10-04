import path from 'node:path';
import os from 'node:os';
import { requestJson } from './http.ts';

export function resolveBaseUrl() {
  const raw = process.env.CLIPROXYAPI_BASE_URL || 'http://127.0.0.1:8317';
  return raw.trim().replace(/\/+$/, '');
}

export function resolveManagementKey() {
  return (process.env.CLIPROXYAPI_MANAGEMENT_KEY || '').trim();
}

export function resolveAuthDir() {
  return process.env.CLIPROXYAPI_AUTH_DIR || path.join(os.homedir(), '.cli-proxy-api');
}

/**
 * Discover only Gemini account prefixes advertised by per-auth Management API models.
 * Unprefixed models and prefixes shared by different auth indexes are not attributable.
 *
 * @param {Object} [options]
 * @param {string} [options.baseUrl]
 * @param {string} [options.managementKey]
 * @param {typeof fetch} [options.fetchFn]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<import('./types.ts').PoolAccount[]>}
 */
export async function discoverAccounts(options = {}) {
  const baseUrl = options.baseUrl ?? resolveBaseUrl();
  const managementKey = options.managementKey ?? resolveManagementKey();
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const signal = options.signal;
  signal?.throwIfAborted();
  if (!managementKey) return [];

  try {
    const url = `${baseUrl}/v0/management/auth-files`;
    const headers = { Accept: 'application/json' };
    if (managementKey) {
      headers.Authorization = `Bearer ${managementKey}`;
    }

    const data = await requestJson(url, { headers }, { fetchFn, signal, timeoutMs: options.timeoutMs });
    const files = Array.isArray(data?.files) ? data.files : [];
    const accounts = new Map();
    const ambiguous = new Set();

    for (const file of files) {
      signal?.throwIfAborted();
      if (!file || file.disabled || typeof file.name !== 'string' || !file.name.trim() || typeof file.auth_index !== 'string' || !file.auth_index.trim()) continue;
      const modelData = await requestJson(
        `${url}/models?name=${encodeURIComponent(file.name)}`,
        { headers },
        { fetchFn, signal, timeoutMs: options.timeoutMs },
      );
      // A failed/incomplete inventory cannot safely replace saved account mappings.
      if (!Array.isArray(modelData?.models)) return [];
      for (const model of modelData.models) {
        if (typeof model?.id !== 'string') continue;
        const match = /^([^/\s]+)\/gemini-[^/\s]+$/i.exec(model.id);
        if (!match) continue;
        const prefix = match[1];
        const authIndex = file.auth_index.trim();
        const existing = accounts.get(prefix);
        if (existing && existing.authIndex !== authIndex) ambiguous.add(prefix);
        else accounts.set(prefix, {
          prefix,
          authIndex,
          email: typeof file.email === 'string' ? file.email.trim() : '',
          status: 'unknown',
        });
      }
    }

    signal?.throwIfAborted();
    return [...accounts.values()].filter((account) => !ambiguous.has(account.prefix))
      .sort((a, b) => a.prefix.localeCompare(b.prefix));
  } catch (error) {
    signal?.throwIfAborted();
    return [];
  }
}
