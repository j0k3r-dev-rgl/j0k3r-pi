import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join, parse, resolve } from 'node:path';

import type { TelegramControlConfig, TelegramRuntimeConfig } from './types.js';

interface InternalDefaults {
  telegram: {
    allowedUserIds: number[];
    polling: {
      timeoutSeconds: number;
      limit: number;
    };
  };
}

const DEFAULT_TELEGRAM_SETTINGS: InternalDefaults['telegram'] = {
  allowedUserIds: [],
  polling: {
    timeoutSeconds: 30,
    limit: 100,
  },
};

const DEFAULTS: InternalDefaults = {
  telegram: DEFAULT_TELEGRAM_SETTINGS,
};

const DEFAULT_POLICY = {
  armDurationSeconds: 300,
  maxArmDurationSeconds: 900,
  maxPromptChars: 4096,
};

const UNSAFE_PI_ARGS = ['--approve'];

const DEFAULT_RELAY = {
  maxTelegramMessageChars: 3900,
  flushIntervalMs: 400,
  toolOutputMode: 'summary' as const,
};

const DEFAULT_AUDIT = {
  enabled: true,
  includePromptPreviewChars: 0,
  redactPaths: true,
  maxBytes: 1_000_000,
  maxFiles: 10,
};

const SECRET_KEY_RE = /(?:api[_-]?key|token|secret|password)/i;

function coerceInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function coercePositiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isPositiveNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item) && item > 0);
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUnsafePiArg(arg: string): boolean {
  return UNSAFE_PI_ARGS.some((unsafe) => arg === unsafe || arg.startsWith(`${unsafe}=`));
}

function filterUnsafePiArgs(args: string[], warnings: string[]): string[] {
  const safe: string[] = [];
  for (const arg of args) {
    if (isUnsafePiArg(arg)) {
      warnings.push(`Ignoring unsafe pi.extraArgs value "${arg}".`);
      continue;
    }
    safe.push(arg);
  }
  return safe;
}

function collectSecretKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const keys: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (SECRET_KEY_RE.test(key)) keys.push(path);
    keys.push(...collectSecretKeys(child, path));
  }
  return keys;
}

function stripSecrets<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const source = value as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(source)) {
    if (SECRET_KEY_RE.test(key)) {
      continue;
    }
    cleaned[key] = child && typeof child === 'object' && !Array.isArray(child)
      ? stripSecrets(child)
      : child;
  }

  return cleaned as T;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeWorkspaceList(raw: unknown, warnings: string[]): TelegramControlConfig['workspaces'] {
  if (!Array.isArray(raw)) {
    warnings.push('workspaces must be a non-empty array');
    return [];
  }

  const entries: TelegramControlConfig['workspaces'] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      warnings.push('Ignoring non-object workspace entry.');
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const id = isNonEmptyString(record.id) ? record.id : '';
    const root = isNonEmptyString(record.root) ? record.root : '';
    const label = isNonEmptyString(record.label) ? record.label : undefined;

    if (!id || !root) {
      warnings.push('Ignoring workspace entry missing id/root.');
      continue;
    }

    entries.push({ id, root, ...(label ? { label } : {}) });
  }
  return entries;
}

function trustFileCandidates(options: { cwd: string; env: Record<string, string | undefined>; homeDir: string }): string[] {
  return [resolve(options.homeDir, '.pi', 'agent', 'trust.json')];
}

async function readTrustedWorkspaceRoots(options: { cwd: string; env: Record<string, string | undefined>; homeDir: string; warnings: string[] }): Promise<string[]> {
  const roots: string[] = [];
  for (const candidate of trustFileCandidates(options)) {
    const raw = await readFile(candidate, 'utf8').catch(() => undefined);
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      options.warnings.push(`Ignoring invalid trust.json at ${candidate}.`);
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      options.warnings.push(`Ignoring invalid trust.json at ${candidate}.`);
      continue;
    }

    for (const [root, trusted] of Object.entries(parsed as Record<string, unknown>)) {
      if (trusted !== true || !root.trim()) continue;
      const resolvedRoot = resolve(options.cwd, root);
      if (!roots.includes(resolvedRoot)) roots.push(resolvedRoot);
    }
  }
  return roots;
}

function workspaceIdFromRoot(root: string): string {
  return basename(resolve(root))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'workspace';
}

function mergeTrustedWorkspaces(configured: TelegramControlConfig['workspaces'], trustedRoots: string[]): TelegramControlConfig['workspaces'] {
  if (trustedRoots.length === 0) return configured;

  const merged: TelegramControlConfig['workspaces'] = [...configured];
  const existingRoots = new Set(merged.map((workspace) => resolve(workspace.root)));
  const usedIds = new Set(merged.map((workspace) => workspace.id));

  for (const root of trustedRoots) {
    const resolvedRoot = resolve(root);
    if (existingRoots.has(resolvedRoot)) continue;

    const baseId = workspaceIdFromRoot(resolvedRoot);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    merged.push({ id, label: id, root: resolvedRoot });
    existingRoots.add(resolvedRoot);
    usedIds.add(id);
  }

  return merged;
}

async function fileExists(path: string): Promise<boolean> {
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
    const candidate = join(current, '.pi', 'telegram-pi-control.json');
    if (await fileExists(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current || parent === parse(current).root) return undefined;
    current = parent;
  }
}

async function readJsonConfig(path: string | undefined, warnings: string[]): Promise<Record<string, unknown>> {
  if (!path) return {};
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push('Config file is not a JSON object. Using defaults.');
      return {};
    }

    const secretKeys = collectSecretKeys(parsed);
    if (secretKeys.length > 0) {
      for (const key of secretKeys) {
        warnings.push(`Ignoring secret-like config key \"${key}\"`);
      }
      return stripSecrets(parsed) as Record<string, unknown>;
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Could not read .pi/telegram-pi-control.json: ${message}`);
    return {};
  }
}

function parseEnvConfig(raw: string | undefined, warnings: string[]): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push('PI_TELEGRAM_CONTROL_CONFIG must be a JSON object. Falling back to file config.');
      return undefined;
    }

    const secretKeys = collectSecretKeys(parsed);
    for (const key of secretKeys) {
      warnings.push(`Ignoring secret-like config key "${key}"`);
    }
    return stripSecrets(parsed);
  } catch {
    warnings.push('Could not parse PI_TELEGRAM_CONTROL_CONFIG. Falling back to file config.');
    return undefined;
  }
}

function normalizeConfig(raw: Record<string, unknown>, warnings: string[]): TelegramControlConfig {
  const telegramSection = (raw.telegram as Record<string, unknown>) ?? {};
  const pollingSection = telegramSection?.polling as Record<string, unknown>;
  const policySection = raw.policy as Record<string, unknown>;
  const piSection = raw.pi as Record<string, unknown>;
  const auditSection = raw.audit as Record<string, unknown>;
  const relaySection = raw.relay as Record<string, unknown>;

  const allowedUserIdsRaw = telegramSection.allowedUserIds;
  const allowedChatIdsRaw = telegramSection.allowedChatIds;
  const allowedUserIds = isPositiveNumberArray(allowedUserIdsRaw) ? [...allowedUserIdsRaw] : [];
  if (!isPositiveNumberArray(allowedUserIdsRaw)) {
    warnings.push('telegram.allowedUserIds should be a non-empty array of positive integers.');
  }

  const allowedChatIds = isIntegerArray(allowedChatIdsRaw) ? [...allowedChatIdsRaw] : undefined;
  if (allowedChatIdsRaw !== undefined && !isIntegerArray(allowedChatIdsRaw)) {
    warnings.push('telegram.allowedChatIds should be an array of integers.');
  }

  const timeoutSeconds = clamp(coercePositiveInt(pollingSection?.timeoutSeconds, DEFAULTS.telegram.polling.timeoutSeconds), 1, 300, DEFAULTS.telegram.polling.timeoutSeconds);
  const limit = clamp(coercePositiveInt(pollingSection?.limit, DEFAULTS.telegram.polling.limit), 1, 200, DEFAULTS.telegram.polling.limit);

  const armDurationSeconds = clamp(coercePositiveInt(policySection?.armDurationSeconds, DEFAULT_POLICY.armDurationSeconds), 1, 3600, DEFAULT_POLICY.armDurationSeconds);
  const maxArmDurationSeconds = clamp(
    coercePositiveInt(policySection?.maxArmDurationSeconds, DEFAULT_POLICY.maxArmDurationSeconds),
    armDurationSeconds,
    3600,
    DEFAULT_POLICY.maxArmDurationSeconds,
  );

  const maxPromptChars = coercePositiveInt(policySection?.maxPromptChars, DEFAULT_POLICY.maxPromptChars);

  const piCommand = isNonEmptyString(piSection?.command) ? piSection.command : 'pi';
  const piSessionDir = isNonEmptyString(piSection?.sessionDir) ? piSection.sessionDir : undefined;
  const piExtraArgsRaw = Array.isArray(piSection?.extraArgs) && piSection.extraArgs.every((item) => typeof item === 'string')
    ? piSection.extraArgs as string[]
    : undefined;
  const piExtraArgs = piExtraArgsRaw ? filterUnsafePiArgs(piExtraArgsRaw, warnings) : undefined;

  if (Array.isArray(piSection?.extraArgs) && !piSection.extraArgs.every((item) => typeof item === 'string')) {
    warnings.push('pi.extraArgs must be an array of strings.');
  }

  if (piExtraArgsRaw && piExtraArgsRaw.length > 0 && !piExtraArgs?.length) {
    warnings.push('All provided pi.extraArgs were unsafe and have been ignored.');
  }

  const auditEnabled = auditSection?.enabled === undefined ? DEFAULT_AUDIT.enabled : auditSection.enabled === true;
  const includePromptPreviewChars = asNumber(auditSection?.includePromptPreviewChars);
  const redactPaths = auditSection?.redactPaths === undefined ? DEFAULT_AUDIT.redactPaths : auditSection.redactPaths === true;
  const auditMaxBytes = coercePositiveInt(auditSection?.maxBytes, DEFAULT_AUDIT.maxBytes);
  const auditMaxFiles = coercePositiveInt(auditSection?.maxFiles, DEFAULT_AUDIT.maxFiles);

  const relayMode = relaySection?.toolOutputMode;
  const toolOutputMode = relayMode === 'off' || relayMode === 'summary' || relayMode === 'redacted'
    ? relayMode
    : DEFAULT_RELAY.toolOutputMode;
  if (relayMode !== undefined && toolOutputMode !== relayMode) {
    warnings.push('relay.toolOutputMode should be one of off|summary|redacted.');
  }

  const relayMaxChars = coercePositiveInt(relaySection?.maxTelegramMessageChars, DEFAULT_RELAY.maxTelegramMessageChars);
  const flushIntervalMs = coercePositiveInt(relaySection?.flushIntervalMs, DEFAULT_RELAY.flushIntervalMs);

  return {
    telegram: {
      allowedUserIds,
      ...(allowedChatIds ? { allowedChatIds } : {}),
      polling: {
        timeoutSeconds,
        limit,
      },
    },
    workspaces: normalizeWorkspaceList(raw.workspaces, warnings),
    ...(raw.workspacesFromTrust === true ? { workspacesFromTrust: true } : {}),
    policy: {
      armDurationSeconds,
      maxArmDurationSeconds,
      maxPromptChars: maxPromptChars ?? DEFAULT_POLICY.maxPromptChars,
    },
    pi: {
      command: piCommand,
      ...(piSessionDir ? { sessionDir: piSessionDir } : {}),
      ...(piExtraArgs ? { extraArgs: piExtraArgs } : {}),
    },
    audit: {
      enabled: auditEnabled,
      ...(typeof includePromptPreviewChars === 'number' ? { includePromptPreviewChars } : { includePromptPreviewChars: DEFAULT_AUDIT.includePromptPreviewChars }),
      redactPaths,
      maxBytes: auditMaxBytes,
      maxFiles: auditMaxFiles,
      ...(typeof (raw.audit as Record<string, unknown>)?.path === 'string' && (raw.audit as Record<string, unknown>)?.path
        ? { path: String((raw.audit as Record<string, unknown>).path) }
        : {}),
    },
    relay: {
      maxTelegramMessageChars: relayMaxChars,
      flushIntervalMs,
      toolOutputMode,
    },
  };
}

export async function loadTelegramControlConfig(options: {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
} = {}): Promise<TelegramRuntimeConfig> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const homeDir = resolve(options.homeDir ?? process.env.HOME ?? process.cwd());

  const warnings: string[] = [];
  const errors: string[] = [];
  const configPath = await findConfigPath(cwd);
  const fileConfig = await readJsonConfig(configPath, warnings);

  const envConfig = parseEnvConfig(env.PI_TELEGRAM_CONTROL_CONFIG, warnings);

  const effectiveConfig = envConfig ?? fileConfig;
  const configSource: TelegramRuntimeConfig['configSource'] = envConfig
    ? 'env'
    : configPath
      ? 'file'
      : 'fallback';

  const config = normalizeConfig(effectiveConfig, warnings);
  if (config.telegram.allowedUserIds.length > 0 && (config.workspacesFromTrust === true || config.workspaces.length === 0)) {
    const trustedWorkspaceRoots = await readTrustedWorkspaceRoots({ cwd, env, homeDir, warnings });
    config.workspaces = mergeTrustedWorkspaces(config.workspaces, trustedWorkspaceRoots);
  }

  if (!envConfig && !configPath) {
    warnings.push('No config file found and PI_TELEGRAM_CONTROL_CONFIG is not set. Using defaults.');
  }

  if (!Array.isArray(config.telegram.allowedUserIds) || config.telegram.allowedUserIds.length === 0) {
    errors.push('telegram.allowedUserIds must be a non-empty array of integers');
  }
  if (!Array.isArray(config.workspaces) || config.workspaces.length === 0) {
    errors.push('workspaces must be a non-empty array');
  }
  if (!config.policy?.maxArmDurationSeconds || !config.policy.armDurationSeconds || config.policy.maxArmDurationSeconds < config.policy.armDurationSeconds) {
    errors.push('policy.maxArmDurationSeconds must be >= policy.armDurationSeconds');
  }

  const botToken = env.PI_TELEGRAM_CONTROL_BOT_TOKEN;

  if (!botToken) {
    warnings.push('PI_TELEGRAM_CONTROL_BOT_TOKEN is not set.');
  }

  return {
    configPath,
    configSource: configPath && !envConfig ? 'file' : envConfig ? 'env' : 'fallback',
    botToken,
    botTokenSource: botToken ? 'env' : undefined,
    config,
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
