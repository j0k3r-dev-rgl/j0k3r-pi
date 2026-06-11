import type { ResolvedContext, SyncStatus } from './types.js';

export interface CloudRuntimeConfig {
  enabled: boolean;
  organization_id?: string | null;
  actor_id?: string | null;
  remote_project_id?: string | null;
  url?: string;
  token?: string;
  warnings: string[];
  ready: boolean;
}

export function resolveCloudRuntime(context: ResolvedContext, env: NodeJS.ProcessEnv = process.env): CloudRuntimeConfig {
  const cloud = context.config?.cloud;
  if (!cloud?.enabled) return { enabled: false, warnings: [], ready: false };
  const url = env[cloud.url_env];
  const token = env[cloud.token_env];
  const warnings = [...(context.config?.warnings ?? [])];
  if (!url) warnings.push(`Missing cloud URL env var: ${cloud.url_env}.`);
  if (!token) warnings.push(`Missing cloud token env var: ${cloud.token_env}.`);
  const ready = Boolean(url && token && cloud.organization_id && cloud.actor_id && cloud.remote_project_id);
  return { enabled: true, organization_id: cloud.organization_id, actor_id: cloud.actor_id, remote_project_id: cloud.remote_project_id, url, token, warnings, ready };
}

export function initialSyncStatus(context: ResolvedContext): SyncStatus {
  return context.scope === 'project' && context.config?.cloud.enabled ? 'pending' : 'local';
}
