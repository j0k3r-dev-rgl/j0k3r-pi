import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectMemoryConfig } from './types.js';

export const DEFAULT_CLOUD_URL_ENV = 'PI_MEMORY_CLOUD_URL';
export const DEFAULT_CLOUD_TOKEN_ENV = 'PI_MEMORY_CLOUD_TOKEN';

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

export function readProjectMemoryConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): ProjectMemoryConfig {
  const warnings: string[] = [];
  const configPath = findMemoryConfigPath(cwd);
  const baseCloud = {
    enabled: false,
    organization_id: null,
    actor_id: null,
    remote_project_id: null,
    url_env: DEFAULT_CLOUD_URL_ENV,
    token_env: DEFAULT_CLOUD_TOKEN_ENV,
  };
  if (!configPath) return { cloud: baseCloud, warnings };

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const cloudRaw = (raw.cloud && typeof raw.cloud === 'object') ? raw.cloud as Record<string, unknown> : {};
    if ('token' in cloudRaw) warnings.push('Do not store cloud.token in .pi/memory.json; use token_env.');
    const cfg: ProjectMemoryConfig = {
      project_name: typeof raw.project_name === 'string' ? raw.project_name : undefined,
      aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((x): x is string => typeof x === 'string') : undefined,
      default_scope: raw.default_scope === 'general' || raw.default_scope === 'project' || raw.default_scope === 'global' ? raw.default_scope : undefined,
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
    return { cloud: baseCloud, warnings, path: configPath };
  }
}
