import type { EntityType } from './types.ts';
import { ENTITY_TYPES } from './types.ts';

export function normalizeFilePath(rawPath: string): string {
  if (typeof rawPath !== 'string') {
    throw new Error('invalid_input: File path must be a string');
  }

  if (rawPath.includes('\0')) {
    throw new Error('invalid_input: File path cannot contain NUL bytes');
  }

  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    throw new Error('invalid_input: File path cannot be empty');
  }

  // Reject UNC paths
  if (trimmed.startsWith('//') || trimmed.startsWith('\\\\')) {
    throw new Error('invalid_input: UNC paths are unsupported');
  }

  // Reject Windows drive letters
  if (/^[a-zA-Z]:/.test(trimmed)) {
    throw new Error('invalid_input: Drive letter paths are unsupported');
  }

  // Normalize backslashes to slashes
  const unified = trimmed.replace(/\\/g, '/');

  // Reject absolute paths
  if (unified.startsWith('/')) {
    throw new Error('invalid_input: Absolute paths are unsupported');
  }

  const rawSegments = unified.split('/');
  const stack: string[] = [];

  for (const seg of rawSegments) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      if (stack.length === 0) {
        throw new Error("invalid_input: File path cannot escape project root with '..'");
      }
      stack.pop();
    } else {
      stack.push(seg);
    }
  }

  if (stack.length === 0) {
    throw new Error('invalid_input: File path cannot resolve to project root');
  }

  return stack.join('/');
}

export function canonicalizeName(
  type: EntityType,
  name: string,
  options?: { memoryId?: number },
): string {
  if (!ENTITY_TYPES.includes(type)) {
    throw new Error(`invalid_input: Invalid entity type '${type}'`);
  }

  if (type === 'memory') {
    const memId = options?.memoryId;
    if (memId === undefined || memId === null || !Number.isSafeInteger(memId) || memId <= 0) {
      throw new Error('invalid_input: Memory entity requires a positive integer memoryId');
    }
    return String(memId);
  }

  if (typeof name !== 'string') {
    throw new Error('invalid_input: Entity name must be a string');
  }

  if (type === 'file') {
    return normalizeFilePath(name);
  }

  if (type === 'project') {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (trimmed.length === 0) {
      throw new Error('invalid_input: Project name cannot be empty');
    }
    return trimmed;
  }

  if (type === 'technology' || type === 'concept') {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (trimmed.length === 0) {
      throw new Error(`invalid_input: ${type} name cannot be empty`);
    }
    return trimmed.toLowerCase();
  }

  throw new Error(`invalid_input: Unsupported entity type '${type}'`);
}

export function canonicalizeDisplayName(
  type: EntityType,
  name: string,
  options?: { memoryId?: number },
): string {
  if (type === 'file') {
    return normalizeFilePath(name);
  }
  if (type === 'memory') {
    const trimmed = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    return trimmed.length > 0 ? trimmed : `Memory #${options?.memoryId}`;
  }
  const trimmed = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (trimmed.length === 0) {
    throw new Error('invalid_input: Display name cannot be empty');
  }
  return trimmed;
}

export function canonicalizeAlias(type: EntityType, alias: string): string {
  if (type === 'memory') {
    throw new Error('invalid_input: Memory entities cannot have aliases');
  }
  if (type === 'file') {
    return normalizeFilePath(alias);
  }
  if (type === 'project') {
    const trimmed = alias.trim().replace(/\s+/g, ' ');
    if (trimmed.length === 0) {
      throw new Error('invalid_input: Alias cannot be empty');
    }
    return trimmed;
  }
  if (type === 'technology' || type === 'concept') {
    const trimmed = alias.trim().replace(/\s+/g, ' ');
    if (trimmed.length === 0) {
      throw new Error('invalid_input: Alias cannot be empty');
    }
    return trimmed.toLowerCase();
  }
  throw new Error(`invalid_input: Unsupported entity type '${type}'`);
}
