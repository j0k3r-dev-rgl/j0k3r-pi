import { randomUUID } from 'node:crypto';
import type { PermissionRequiredPayload } from './types.js';

export interface PublishedPermissionRequest {
  handle: string;
  payload: PermissionRequiredPayload;
  createdAt: string;
  consumed?: boolean;
}

const PERMISSION_CHANNEL_KEY = Symbol.for('pi.permissionGuard.permissionChannel');
const PERMISSION_REQUIRED_MARKER = 'permission_required:';

function permissionChannelRegistry(): Map<string, PublishedPermissionRequest> {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[PERMISSION_CHANNEL_KEY];
  if (existing instanceof Map) return existing as Map<string, PublishedPermissionRequest>;
  const registry = new Map<string, PublishedPermissionRequest>();
  holder[PERMISSION_CHANNEL_KEY] = registry;
  return registry;
}

export function publishPermissionRequest(payload: PermissionRequiredPayload): PublishedPermissionRequest {
  const published: PublishedPermissionRequest = {
    handle: `perm_${randomUUID().replace(/-/g, '')}`,
    payload,
    createdAt: new Date().toISOString(),
  };
  permissionChannelRegistry().set(published.handle, published);
  return published;
}

export function resolvePermissionRequest(handle: string): PermissionRequiredPayload | undefined {
  return permissionChannelRegistry().get(handle)?.payload;
}

export function consumePermissionRequest(handle: string): PermissionRequiredPayload | undefined {
  const registry = permissionChannelRegistry();
  const published = registry.get(handle);
  if (!published) return undefined;
  registry.delete(handle);
  return published.payload;
}

export function sanitizePermissionTransportText(text: string): string {
  if (!text) return text;
  const pattern = /permission_required:[^\r\n]*/g;
  return text.replace(pattern, '[permission request hidden]');
}
