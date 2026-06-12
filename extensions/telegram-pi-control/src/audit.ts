import { chmod, mkdir, open, rename, rm, stat as statFs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { AuditEvent } from './types.js';

export interface AuditLoggerConfig {
  enabled?: boolean;
  path?: string;
  maxBytes?: number;
  maxFiles?: number;
}

export interface FileAuditLoggerOptions {
  enabled: boolean;
  path?: string;
  maxBytes?: number;
  maxFiles?: number;
  redactPaths?: boolean;
  auditPath?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export function resolveAuditFilePath(config: AuditLoggerConfig, options: { env?: NodeJS.ProcessEnv; homeDir?: string } = {}): string {
  if (config.path) {
    return isAbsolute(config.path) ? config.path : resolve(config.path);
  }

  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const stateRoot = env.XDG_STATE_HOME && env.XDG_STATE_HOME.trim() ? env.XDG_STATE_HOME : join(home, '.local', 'state');
  return join(stateRoot, 'pi', 'telegram-pi-control', 'audit.ndjson');
}

function normalizeAuditConfig(value: FileAuditLoggerOptions): Required<Pick<FileAuditLoggerOptions, 'enabled' | 'maxBytes' | 'maxFiles' | 'redactPaths'>> {
  return {
    enabled: value.enabled !== false,
    maxBytes: value.maxBytes ?? 2_000_000,
    maxFiles: Math.max(1, value.maxFiles ?? 10),
    redactPaths: value.redactPaths !== false,
  };
}

function redactSecrets(input: string): string {
  return input
    .replace(/(?:api[_-]?key|secret|token|password)\s*(?:=|:|\s+)\S+/gi, '[REDACTED]')
    .replace(/(--(?:token|secret|password|api[_-]?key)\s+)(\S+)/gi, '$1[REDACTED]')
    .replace(/(?:\b|\$\{?)([A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z_]*)\}?=\S+/gi, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
}

function redactText(value: string, redactPaths: boolean): string {
  let redacted = redactSecrets(value);

  if (redactPaths) {
    redacted = redacted.replace(/\/(?:[^\s"]+\/?)+/g, '<path>');
  }

  return redacted;
}

function redactMetadata(value: unknown, redactPaths: boolean): unknown {
  if (typeof value === 'string') {
    return redactText(value, redactPaths);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactMetadata(entry, redactPaths));
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, rawValue] of Object.entries(source)) {
      if (/token|secret|password|api[_-]?key/i.test(key)) {
        output[key] = '[REDACTED]';
        continue;
      }

      output[key] = redactMetadata(rawValue, redactPaths);
    }

    return output;
  }

  return value;
}

function normalizeEvent(event: AuditEvent, config: ReturnType<typeof normalizeAuditConfig>): AuditEvent {
  const eventCopy: AuditEvent = {
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
    metadata: event.metadata ? redactMetadata(event.metadata, config.redactPaths) as Record<string, unknown> : event.metadata,
  };

  return {
    ...eventCopy,
    outputPreview: event.outputPreview ? redactText(event.outputPreview, config.redactPaths) : event.outputPreview,
    command: event.command ? redactText(event.command, config.redactPaths) : event.command,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await statFs(path);
    return true;
  } catch {
    return false;
  }
}

async function rotateIfNeeded(path: string, maxBytes: number, maxFiles: number): Promise<void> {
  let fileStat;
  try {
    fileStat = await statFs(path);
  } catch {
    return;
  }

  if (fileStat.size <= maxBytes) return;

  const files = Math.max(1, maxFiles);
  await rm(`${path}.${files}`, { force: true });
  for (let index = files - 1; index >= 1; index -= 1) {
    const source = `${path}.${index}`;
    const target = `${path}.${index + 1}`;
    if (await exists(source)) {
      await rm(target, { force: true });
      await rename(source, target);
    }
  }

  await rm(`${path}.1`, { force: true });
  await rename(path, `${path}.1`);
}

async function appendLine(path: string, line: string, maxBytes: number, maxFiles: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700).catch(() => undefined);

  await rotateIfNeeded(path, maxBytes, maxFiles);

  const handle = await open(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(line, 'utf8');
  } finally {
    await handle.close();
  }

  await chmod(path, 0o600).catch(() => undefined);
}

export class FileAuditLogger {
  private readonly enabled: boolean;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly path: string;
  private readonly redactPaths: boolean;

  constructor(options: FileAuditLoggerOptions) {
    const normalized = normalizeAuditConfig(options);
    this.enabled = normalized.enabled;
    this.maxBytes = normalized.maxBytes;
    this.maxFiles = normalized.maxFiles;
    this.redactPaths = normalized.redactPaths;
    this.path = resolveAuditFilePath({
      enabled: this.enabled,
      path: options.path,
      maxBytes: this.maxBytes,
      maxFiles: this.maxFiles,
    }, {
      env: options.env,
      homeDir: options.homeDir,
    });
  }

  async record(event: AuditEvent): Promise<void> {
    if (!this.enabled) return;

    const sanitized = normalizeEvent(event, {
      enabled: this.enabled,
      maxBytes: this.maxBytes,
      maxFiles: this.maxFiles,
      redactPaths: this.redactPaths,
    });

    await appendLine(this.path, `${JSON.stringify(sanitized)}\n`, this.maxBytes, this.maxFiles).catch(() => undefined);
  }
}
