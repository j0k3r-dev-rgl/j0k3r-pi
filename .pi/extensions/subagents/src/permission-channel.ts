import { randomUUID } from 'node:crypto';

export type PermissionApprovalChoice = 'Allow once' | 'Allow for session' | 'Allow for project' | 'Allow this file for project' | 'Allow this folder for project' | 'Deny';

export interface PermissionRequiredPayload {
  type: 'permission_required';
  requestId: string;
  tool?: string;
  action?: string;
  origin?: string;
  requester?: { subagentId?: string; subagentName?: string; taskId?: string; description?: string };
  reason?: string;
  reasonCode?: string;
  riskLevel?: string;
  prompt?: {
    title?: string;
    message?: string;
    choices?: PermissionApprovalChoice[];
    safeTarget?: string;
    safeCommandSummary?: string;
    workspaceRoot?: string;
    limitations?: string[];
  };
  sessionScope?: {
    cacheKey: string;
    action?: string;
    tool?: string;
    targetPattern?: string;
    commandPattern?: string;
    policyIdentity?: string;
  };
  projectScope?: {
    safeCommandPattern?: string;
    pathApprovalOptions?: {
      file?: {
        version: 1;
        id: string;
        createdAt: string;
        scope: 'file' | 'folder';
        raw: string;
        normalizedAbsolute: string;
        resolvedRealpath?: string;
        tools: Array<'read' | 'ls' | 'find' | 'grep'>;
        reasonCode?: string;
        source?: 'project' | 'subagent';
      };
      folder?: {
        version: 1;
        id: string;
        createdAt: string;
        scope: 'file' | 'folder';
        raw: string;
        normalizedAbsolute: string;
        resolvedRealpath?: string;
        tools: Array<'read' | 'ls' | 'find' | 'grep'>;
        reasonCode?: string;
        source?: 'project' | 'subagent';
      };
    };
  };
}

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

export function consumeLatestPermissionRequest(options: { maxAgeMs?: number; origin?: string } = {}): PermissionRequiredPayload | undefined {
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  const now = Date.now();
  const candidates = [...permissionChannelRegistry().entries()]
    .map(([handle, published]) => ({ handle, published, timestamp: Date.parse(published.createdAt) }))
    .filter(({ published, timestamp }) => Number.isFinite(timestamp)
      && now - timestamp <= maxAgeMs
      && (!options.origin || published.payload.origin === options.origin))
    .sort((a, b) => b.timestamp - a.timestamp);
  const latest = candidates[0];
  if (!latest) return undefined;
  permissionChannelRegistry().delete(latest.handle);
  return latest.published.payload;
}

export function sanitizePermissionTransportText(text: string): string {
  if (!text) return text;
  const pattern = /permission_required:[^\r\n]*/g;
  return text.replace(pattern, '[permission request hidden]');
}
