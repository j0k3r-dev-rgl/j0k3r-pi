import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, parse } from 'node:path';
import { homedir } from 'node:os';
import type { Context7ProjectConfigFile, Context7RuntimeConfig } from './types.js';

const DEFAULT_MAX_CHARS = 12000;
const DEFAULT_RESULT_LIMIT = 5;
const DEFAULT_TTL_SECONDS = 86400;
const MIN_MAX_CHARS = 1000;
const HARD_MAX_CHARS = 50000;
const MIN_RESULT_LIMIT = 1;
const MAX_RESULT_LIMIT = 10;
const SECRET_KEY_RE = /(?:api[_-]?key|token|secret|password)/i;

export interface LoadContext7ConfigOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function findConfigPath(cwd: string): Promise<string | undefined> {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, '.pi', 'context7.json');
    if (await exists(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return undefined;
    current = parent;
  }
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number, name: string, warnings: string[]): number {
  if (typeof value === 'undefined') return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    warnings.push(`${name} must be an integer from ${min} to ${max}; using ${fallback}.`);
    return fallback;
  }
  return value;
}

function normalizePositiveInteger(value: unknown, fallback: number, name: string, warnings: string[]): number {
  if (typeof value === 'undefined') return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    warnings.push(`${name} must be a positive integer; using ${fallback}.`);
    return fallback;
  }
  return value;
}

function collectSecretLikeKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (SECRET_KEY_RE.test(key)) found.push(path);
    found.push(...collectSecretLikeKeys(child, path));
  }
  return found;
}

function isPathInside(child: string, parent: string): boolean {
  const normalizedChild = resolve(child);
  const normalizedParent = resolve(parent);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

async function readProjectConfig(configPath: string | undefined, warnings: string[]): Promise<Context7ProjectConfigFile> {
  if (!configPath) return {};
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Context7ProjectConfigFile;
    for (const key of collectSecretLikeKeys(parsed)) {
      warnings.push(`Ignoring secret-like config key "${key}". Set secrets with CONTEXT7_API_KEY in the environment instead.`);
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Could not read .pi/context7.json: ${message}`);
    return {};
  }
}

export async function loadContext7Config(options: LoadContext7ConfigOptions = {}): Promise<Context7RuntimeConfig> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const warnings: string[] = [];
  const configPath = await findConfigPath(cwd);
  const file = await readProjectConfig(configPath, warnings);

  const maxChars = normalizeInteger(
    file.defaults?.max_chars,
    DEFAULT_MAX_CHARS,
    MIN_MAX_CHARS,
    HARD_MAX_CHARS,
    'defaults.max_chars',
    warnings,
  );
  const resultLimit = normalizeInteger(
    file.defaults?.result_limit,
    DEFAULT_RESULT_LIMIT,
    MIN_RESULT_LIMIT,
    MAX_RESULT_LIMIT,
    'defaults.result_limit',
    warnings,
  );
  const ttlSeconds = normalizePositiveInteger(file.cache?.ttl_seconds, DEFAULT_TTL_SECONDS, 'cache.ttl_seconds', warnings);

  const cacheEnabled = file.cache?.enabled === true;
  const home = options.homeDir ?? env.HOME ?? homedir();
  const xdg = env.XDG_CACHE_HOME;
  let directory: string | undefined;
  let location: Context7RuntimeConfig['cache']['location'] = 'disabled';
  let enabled = cacheEnabled;

  if (cacheEnabled) {
    if (xdg) {
      directory = join(xdg, 'pi', 'context7');
      location = 'xdg';
    } else {
      directory = join(home, '.cache', 'pi', 'context7');
      location = 'home';
    }
    if (isPathInside(directory, cwd)) {
      warnings.push('cache directory resolved inside the repository; disabling Context7 cache for safety.');
      enabled = false;
      directory = undefined;
      location = 'disabled';
    }
  }

  return {
    configPath,
    apiKeyPresent: Boolean(env.CONTEXT7_API_KEY),
    cache: {
      enabled,
      ttlSeconds,
      directory,
      location,
    },
    defaults: {
      maxChars,
      resultLimit,
    },
    warnings,
  };
}
