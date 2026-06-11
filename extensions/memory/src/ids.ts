import os from 'node:os';
import type { MemoryScope } from './types.js';
import { slug, uuidPart } from './utils.js';

export function localUserSlug(): string {
  return slug(process.env.USER || process.env.USERNAME || os.userInfo().username || 'user', 'user');
}

export function generateMemoryId(input: { userSlug?: string; scope: MemoryScope; projectName?: string | null; timeMs?: number }): string {
  const user = slug(input.userSlug ?? localUserSlug(), 'user');
  const scopeOrProject = input.scope === 'project' ? slug(input.projectName, 'project') : input.scope;
  return `mem_${user}_${scopeOrProject}_${input.timeMs ?? Date.now()}_${uuidPart()}`;
}

export function generateSessionId(input: { userSlug?: string; scope: MemoryScope; projectName?: string | null; timeMs?: number }): string {
  const user = slug(input.userSlug ?? localUserSlug(), 'user');
  const scopeOrProject = input.scope === 'project' ? slug(input.projectName, 'project') : input.scope;
  return `session_${user}_${scopeOrProject}_${input.timeMs ?? Date.now()}_${uuidPart()}`;
}

export function generateGenericId(prefix: string): string { return `${slug(prefix)}_${Date.now()}_${uuidPart()}`; }
