import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectMemoryConfig } from './types.js';

export const DEFAULT_CLOUD_URL_ENV = 'PI_MEMORY_CLOUD_URL';
export const DEFAULT_CLOUD_TOKEN_ENV = 'PI_MEMORY_CLOUD_TOKEN';
export const DEFAULT_BACKUP_DIR = '.pi/mempry-backups';
export const DEFAULT_BACKUP_FILE = 'memory-backup.jsonl';

export function resolveMemoryHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_MEMORY_HOME) return path.resolve(env.PI_MEMORY_HOME);
  const xdg = env.XDG_DATA_HOME;
  return xdg ? path.join(xdg, 'pi', 'memory') : path.join(os.homedir(), '.local', 'share', 'pi', 'memory');
}

export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_MEMORY_DB_PATH) return path.resolve(env.PI_MEMORY_DB_PATH);
  return path.join(resolveMemoryHome(env), 'memory.sqlite');
}

export function ensureMemoryDirForDb(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(dbPath), 0o700); } catch {}
}

export function normalizeRelativeBackupPath(value: unknown, warnings: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    warnings.push('Ignoring invalid backups.path in .pi/memory.json; expected non-empty relative path.');
    return undefined;
  }
  const input = value.trim();
  if (path.isAbsolute(input)) {
    warnings.push('Ignoring invalid backups.path in .pi/memory.json; absolute paths are not allowed.');
    return undefined;
  }
  const normalized = path.posix.normalize(input.replace(/\\/g, '/'));
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    warnings.push('Ignoring invalid backups.path in .pi/memory.json; path must stay inside the working directory.');
    return undefined;
  }
  return normalized;
}

export function resolveBackupPath(cwd: string, configuredPath?: string): string {
  const relative = configuredPath ?? path.posix.join(DEFAULT_BACKUP_DIR, DEFAULT_BACKUP_FILE);
  return path.resolve(cwd, relative);
}

export function findMemoryConfigPath(cwd: string): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, '.pi', 'memory.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function buildBaseConfig(): Omit<ProjectMemoryConfig, 'project_name' | 'aliases' | 'default_scope' | 'warnings' | 'path'> {
  return {
    enabled: false,
    debug: false,
    session_end: { semantic: false },
    import: {},
    backups: { include_sessions: false },
    cloud: {
      enabled: false,
      organization_id: null,
      actor_id: null,
      remote_project_id: null,
      url_env: DEFAULT_CLOUD_URL_ENV,
      token_env: DEFAULT_CLOUD_TOKEN_ENV,
    },
  };
}

export function readProjectMemoryConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): ProjectMemoryConfig {
  const warnings: string[] = [];
  const configPath = findMemoryConfigPath(cwd);
  const base = buildBaseConfig();
  if (!configPath) return { ...base, warnings };

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const cloudRaw = (raw.cloud && typeof raw.cloud === 'object') ? raw.cloud as Record<string, unknown> : {};
    const sessionEndRaw = (raw.session_end && typeof raw.session_end === 'object') ? raw.session_end as Record<string, unknown> : {};
    const importRaw = (raw.import && typeof raw.import === 'object') ? raw.import as Record<string, unknown> : {};
    const backupsRaw = (raw.backups && typeof raw.backups === 'object') ? raw.backups as Record<string, unknown> : {};

    if (raw.import !== undefined && (typeof raw.import !== 'object' || raw.import === null)) warnings.push('Ignoring invalid import config; expected object.');
    if (raw.backups !== undefined && (typeof raw.backups !== 'object' || raw.backups === null)) warnings.push('Ignoring invalid backups config; expected object.');
    if (raw.cloud !== undefined && (typeof raw.cloud !== 'object' || raw.cloud === null)) warnings.push('Ignoring invalid cloud config; expected object.');

    if ('token' in cloudRaw) warnings.push('Do not store cloud.token in .pi/memory.json; use token_env.');

    const importMode = importRaw.mode === 'merge' || importRaw.mode === 'dry_run' ? importRaw.mode : undefined;
    const importOnConflict = importRaw.on_conflict === 'keep_local' || importRaw.on_conflict === 'keep_imported' || importRaw.on_conflict === 'mark_conflict' ? importRaw.on_conflict : undefined;
    if (importRaw.mode !== undefined && importMode === undefined) warnings.push('Ignoring invalid import.mode in .pi/memory.json; expected "merge" or "dry_run".');
    if (importRaw.on_conflict !== undefined && importOnConflict === undefined) warnings.push('Ignoring invalid import.on_conflict in .pi/memory.json; expected "keep_local", "keep_imported", or "mark_conflict".');

    const backupPath = normalizeRelativeBackupPath(backupsRaw.path, warnings);

    const includeSessionsRaw = backupsRaw.include_sessions;
    const hasLegacyIncludePrompts = backupsRaw.include_prompts;
    const includeSessionsWasSpecified = includeSessionsRaw === true || includeSessionsRaw === false;
    const legacySessions = typeof hasLegacyIncludePrompts === 'boolean' ? hasLegacyIncludePrompts : undefined;

    if (includeSessionsRaw !== undefined && !includeSessionsWasSpecified) {
      warnings.push('Ignoring invalid backups.include_sessions in .pi/memory.json; expected boolean.');
    }

    if ('include_sessions' in backupsRaw && 'include_prompts' in backupsRaw && includeSessionsWasSpecified) {
      warnings.push('Ignoring backups.include_prompts in .pi/memory.json because backups.include_sessions is authoritative.');
    }

    const includeSessions = includeSessionsWasSpecified
      ? includeSessionsRaw as boolean
      : legacySessions === true
        ? true
        : false;

    if (!includeSessionsWasSpecified && typeof legacySessions === 'boolean') {
      if (legacySessions) warnings.push('backups.include_prompts in .pi/memory.json is deprecated; use backups.include_sessions instead.');
      else warnings.push('Ignoring false value of legacy backups.include_prompts in .pi/memory.json; use backups.include_sessions for explicit control.');
    }

    const rawEnabled = raw.enabled;
    const enabled = rawEnabled === true;
    if (rawEnabled !== undefined && typeof rawEnabled !== 'boolean') {
      warnings.push('Ignoring invalid enabled flag in .pi/memory.json; expected true or false.');
    }

    const cfg: ProjectMemoryConfig = {
      enabled,
      project_name: typeof raw.project_name === 'string' ? raw.project_name : undefined,
      aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((x): x is string => typeof x === 'string') : undefined,
      default_scope: raw.default_scope === 'general' || raw.default_scope === 'project' || raw.default_scope === 'global' ? raw.default_scope : undefined,
      debug: raw.debug === true,
      session_end: {
        semantic: sessionEndRaw.semantic === true,
      },
      import: {
        mode: importMode,
        on_conflict: importOnConflict,
      },
      backups: {
        path: backupPath,
        include_sessions: includeSessions,
      },
      cloud: {
        enabled: cloudRaw.enabled === true,
        organization_id: typeof cloudRaw.organization_id === 'string' ? cloudRaw.organization_id : null,
        actor_id: typeof cloudRaw.actor_id === 'string' ? cloudRaw.actor_id : null,
        remote_project_id: typeof cloudRaw.remote_project_id === 'string' ? cloudRaw.remote_project_id : null,
        url_env: typeof cloudRaw.url_env === 'string' && cloudRaw.url_env.trim() ? cloudRaw.url_env : DEFAULT_CLOUD_URL_ENV,
        token_env: typeof cloudRaw.token_env === 'string' && cloudRaw.token_env.trim() ? cloudRaw.token_env : DEFAULT_CLOUD_TOKEN_ENV,
      },
      warnings,
      path: configPath,
    };

    if (cfg.cloud.enabled) {
      if (!cfg.cloud.organization_id) warnings.push('cloud.organization_id is required when cloud.enabled=true.');
      if (!cfg.cloud.actor_id) warnings.push('cloud.actor_id is required when cloud.enabled=true.');
      if (!cfg.cloud.remote_project_id) warnings.push('cloud.remote_project_id is required when cloud.enabled=true.');
      if (!env[cfg.cloud.url_env]) warnings.push(`Missing cloud URL env var: ${cfg.cloud.url_env}.`);
      if (!env[cfg.cloud.token_env]) warnings.push(`Missing cloud token env var: ${cfg.cloud.token_env}.`);
    }

    return cfg;
  } catch (error) {
    warnings.push(`Invalid .pi/memory.json: ${error instanceof Error ? error.message : String(error)}`);
    return { ...buildBaseConfig(), warnings, path: configPath };
  }
}
