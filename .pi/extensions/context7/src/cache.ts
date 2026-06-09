import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import type { Context7CacheLocation } from './types.js';

const CACHE_VERSION = 1;
const SECRET_KEY_RE = /(?:context7_api_key|api[_-]?key|token|secret|password)/i;

export interface CacheKey {
  raw: string;
  hash: string;
  filename: string;
}

export interface Context7Cache {
  get<T>(key: CacheKey, now?: number): Promise<{ hit: true; value: T } | { hit: false }>;
  set<T>(key: CacheKey, value: T, ttlSeconds: number, now?: number): Promise<void>;
}

export interface UserCacheDirectoryOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  homeDir: string;
}

export interface CreateContext7CacheOptions {
  enabled: boolean;
  directory?: string;
  repositoryRoot: string;
}

interface CacheFile<T> {
  version: 1;
  key: string;
  createdAt: string;
  expiresAt: string;
  value: T;
}

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && rel !== '..');
}

function stableSanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSanitize);
  if (!value || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (SECRET_KEY_RE.test(key)) continue;
    output[key] = stableSanitize((value as Record<string, unknown>)[key]);
  }
  return output;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableSanitize(value));
}

export function createCacheKey(method: string, request: Record<string, unknown>): CacheKey {
  const raw = `context7:v1:${method}:${stableJson(request)}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash, filename: `${hash}.json` };
}

export function resolveUserCacheDirectory(options: UserCacheDirectoryOptions): { directory: string; location: Exclude<Context7CacheLocation, 'disabled'> } {
  const xdg = options.env?.XDG_CACHE_HOME;
  if (xdg) return { directory: join(xdg, 'pi', 'context7'), location: 'xdg' };
  return { directory: join(options.homeDir, '.cache', 'pi', 'context7'), location: 'home' };
}

export function createDisabledContext7Cache(): Context7Cache {
  return {
    async get() {
      return { hit: false };
    },
    async set() {
      // Disabled cache is intentionally inert.
    },
  };
}

export class FileContext7Cache implements Context7Cache {
  constructor(private readonly directory: string) {}

  async get<T>(key: CacheKey, now = Date.now()): Promise<{ hit: true; value: T } | { hit: false }> {
    try {
      const raw = await readFile(join(this.directory, key.filename), 'utf8');
      const parsed = JSON.parse(raw) as CacheFile<T>;
      if (parsed.version !== CACHE_VERSION || parsed.key !== key.raw) return { hit: false };
      if (Date.parse(parsed.expiresAt) <= now) return { hit: false };
      return { hit: true, value: parsed.value };
    } catch {
      return { hit: false };
    }
  }

  async set<T>(key: CacheKey, value: T, ttlSeconds: number, now = Date.now()): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlSeconds * 1000).toISOString();
    const entry: CacheFile<T> = { version: CACHE_VERSION, key: key.raw, createdAt, expiresAt, value };
    await writeFile(join(this.directory, key.filename), JSON.stringify(entry, null, 2), { mode: 0o600 });
  }
}

export function createContext7Cache(options: CreateContext7CacheOptions): {
  enabled: boolean;
  cache: Context7Cache;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!options.enabled || !options.directory) {
    return { enabled: false, cache: createDisabledContext7Cache(), warnings };
  }

  if (isPathInside(options.directory, options.repositoryRoot)) {
    warnings.push('cache directory resolved inside the repository; disabling Context7 cache for safety.');
    return { enabled: false, cache: createDisabledContext7Cache(), warnings };
  }

  return { enabled: true, cache: new FileContext7Cache(options.directory), warnings };
}
