import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync } from 'node:fs';
import { homedir as nodeHomedir } from 'node:os';
import { join } from 'node:path';

export type GitHubWebsearchProvider = 'api' | 'gh';

export type WebsearchConfig = {
  github: {
    provider: GitHubWebsearchProvider;
  };
  request: {
    timeoutMs: number;
    maxRetries: number;
  };
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RETRIES = 1;
const MIN_MAX_RETRIES = 0;
const MAX_MAX_RETRIES = 5;

export class WebsearchConfigError extends Error {
  readonly code = 'invalid_configuration' as const;

  constructor(message: string) {
    super(message);
    this.name = 'WebsearchConfigError';
  }
}

type ConfigLoaderDeps = {
  homedir?: () => string;
  existsSync?: (path: string) => boolean;
  readFileSync?: (path: string, encoding: BufferEncoding) => string;
};

export function WEBSEARCH_CONFIG_PATH(home = nodeHomedir()): string {
  return join(home, '.pi', 'agent', 'websearch.json');
}

function defaultWebsearchConfig(): WebsearchConfig {
  return {
    github: {
      provider: 'api',
    },
    request: {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
    },
  };
}

function parseProvider(value: unknown): GitHubWebsearchProvider {
  if (value === undefined || value === null) {
    return 'api';
  }
  if (value === 'api' || value === 'gh') {
    return value;
  }
  throw new WebsearchConfigError('Invalid websearch config: github.provider must be "api" or "gh".');
}

function parseBoundedInteger(value: unknown, path: string, defaultValue: number, min: number, max: number): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new WebsearchConfigError(`Invalid websearch config: ${path} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function loadWebsearchConfig(deps: ConfigLoaderDeps = {}): WebsearchConfig {
  const homedir = deps.homedir ?? nodeHomedir;
  const existsSync = deps.existsSync ?? nodeExistsSync;
  const readFileSync = deps.readFileSync ?? nodeReadFileSync;
  const path = WEBSEARCH_CONFIG_PATH(homedir());

  if (!existsSync(path)) {
    return defaultWebsearchConfig();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WebsearchConfigError(`Invalid websearch config JSON at ${path}: ${message}`);
  }

  const root = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const github = root.github && typeof root.github === 'object' ? root.github as Record<string, unknown> : {};
  const request = root.request && typeof root.request === 'object' ? root.request as Record<string, unknown> : {};

  return {
    github: {
      provider: parseProvider(github.provider),
    },
    request: {
      timeoutMs: parseBoundedInteger(request.timeoutMs, 'request.timeoutMs', DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
      maxRetries: parseBoundedInteger(request.maxRetries, 'request.maxRetries', DEFAULT_MAX_RETRIES, MIN_MAX_RETRIES, MAX_MAX_RETRIES),
    },
  };
}
