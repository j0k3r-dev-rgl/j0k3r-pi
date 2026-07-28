import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LAST_GOOD_STATE_RELATIVE_PATH,
  QUARANTINE_RELATIVE_DIR,
  RUNTIME_RELATIVE_DIR,
  STATE_RELATIVE_PATH,
} from '../config.js';
import {
  closePinnedDirectory,
  pinnedLeafExists,
  pinRelativeWorkspaceDirectory,
  readPinnedDirectory,
  readPinnedTextFile,
  removePinnedLeafIfEmpty,
  renamePinnedLeaf,
  safeRelativePath,
  writePinnedTextFile,
  writePinnedTextFileAtomically,
} from '../security.js';
import type { PinnedDirectoryHandle } from '../security.js';
import type { RuntimeStateV1, WorkspaceServicesConfig } from '../types.js';

const MAX_STATE_BYTES = 1024 * 1024;
const SERVICE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const STATE_LEAF = 'state.json';
const LAST_GOOD_LEAF = 'state.last-good.json';

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function assertPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer`);
  return Number(value);
}

function validateManagedIdentity(value: unknown, name: string): void {
  if (!isRecord(value)) throw new Error(`managed identity for ${name} must be an object`);
  assertPositiveInteger(value.pid, `pid for ${name}`);
  assertPositiveInteger(value.processGroupId, `process group for ${name}`);
  assertPositiveInteger(value.sessionId, `session for ${name}`);
  assertNonEmptyString(value.bootId, `boot id for ${name}`);
  assertNonEmptyString(value.startTimeTicks, `start time for ${name}`);
  const cmdlineSha256 = assertNonEmptyString(value.cmdlineSha256, `command line hash for ${name}`);
  const serviceCommandSha256 = assertNonEmptyString(value.serviceCommandSha256, `service command hash for ${name}`);
  if (!HEX_64_PATTERN.test(cmdlineSha256)) throw new Error(`command line hash for ${name} must be sha256`);
  if (!HEX_64_PATTERN.test(serviceCommandSha256)) throw new Error(`service command hash for ${name} must be sha256`);
  assertNonEmptyString(value.cwdRelative, `cwd path for ${name}`);
  assertNonEmptyString(value.cwdDevice, `cwd device for ${name}`);
  assertNonEmptyString(value.cwdInode, `cwd inode for ${name}`);
}

export interface OpenRuntimeStateResult {
  state: RuntimeStateV1;
  recovered: boolean;
  source: 'primary' | 'last-good' | 'empty';
}

function emptyState(config: WorkspaceServicesConfig): RuntimeStateV1 {
  return { schemaVersion: 1, generation: 0, workspaceId: safeRelativePath(config.workspaceRealRoot, config.workspaceRoot), services: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRuntimeState(parsed: unknown): RuntimeStateV1 {
  if (!isRecord(parsed)) throw new Error('runtime state must be an object');
  if (parsed.schemaVersion !== 1) throw new Error('unsupported runtime state schema version');
  if (!Number.isSafeInteger(parsed.generation) || Number(parsed.generation) < 0) throw new Error('invalid runtime state generation');
  assertNonEmptyString(parsed.workspaceId, 'runtime state workspace id');
  if (!isRecord(parsed.services)) throw new Error('runtime state services must be an object');
  for (const [name, service] of Object.entries(parsed.services)) {
    if (!SERVICE_NAME_PATTERN.test(name) || name === '.' || name === '..') throw new Error(`invalid service key ${name}`);
    if (!isRecord(service)) throw new Error(`runtime state for ${name} must be an object`);
    if (!['starting', 'running', 'stopping', 'recovery_required'].includes(String(service.phase))) throw new Error(`invalid phase for ${name}`);
    assertNonEmptyString(service.operationId, `operation id for ${name}`);
    assertNonEmptyString(service.updatedAt, `updatedAt for ${name}`);
    if (service.startedAt !== undefined) assertNonEmptyString(service.startedAt, `startedAt for ${name}`);
    if (service.identity !== undefined) validateManagedIdentity(service.identity, name);
    if ((service.phase === 'running' || service.phase === 'stopping' || service.phase === 'recovery_required') && service.identity === undefined) {
      throw new Error(`managed identity is required for ${name} while phase=${service.phase}`);
    }
  }
  return parsed as unknown as RuntimeStateV1;
}

interface RuntimeRoots {
  runtimeDir: PinnedDirectoryHandle;
  quarantineDir: PinnedDirectoryHandle;
}

async function openRuntimeRoots(config: WorkspaceServicesConfig): Promise<RuntimeRoots> {
  const runtimeDir = await pinRelativeWorkspaceDirectory(config.workspaceRealRoot, RUNTIME_RELATIVE_DIR, 'Workspace Services runtime directory', true);
  const quarantineDir = await pinRelativeWorkspaceDirectory(config.workspaceRealRoot, QUARANTINE_RELATIVE_DIR, 'Workspace Services quarantine directory', true);
  return { runtimeDir, quarantineDir };
}

async function closeRuntimeRoots(roots: RuntimeRoots): Promise<void> {
  await closePinnedDirectory(roots.quarantineDir);
  await closePinnedDirectory(roots.runtimeDir);
}

async function readCandidate(directory: PinnedDirectoryHandle, leaf: string): Promise<RuntimeStateV1 | undefined> {
  if (!(await pinnedLeafExists(directory, leaf))) return undefined;
  const raw = await readPinnedTextFile(directory, leaf, MAX_STATE_BYTES, leaf);
  if (!raw.trim()) throw new Error(`${leaf} is empty.`);
  return validateRuntimeState(JSON.parse(raw));
}

async function quarantine(roots: RuntimeRoots, leaf: string, reason: string): Promise<string> {
  const target = `${leaf}.${Date.now()}.${randomUUID()}.quarantine.json`;
  await renamePinnedLeaf(roots.runtimeDir, leaf, roots.quarantineDir, target);
  await writePinnedTextFile(roots.quarantineDir, `${target}.reason.txt`, `${reason}\n`);
  return join(configuredQuarantineRelativeDir(), target);
}

function configuredQuarantineRelativeDir(): string {
  return QUARANTINE_RELATIVE_DIR;
}

async function atomicWriteJson(directory: PinnedDirectoryHandle, leaf: string, value: RuntimeStateV1): Promise<void> {
  await writePinnedTextFileAtomically(directory, leaf, `${JSON.stringify(value, null, 2)}\n`);
}

export async function openRuntimeState(config: WorkspaceServicesConfig): Promise<OpenRuntimeStateResult> {
  const roots = await openRuntimeRoots(config);
  try {
    const primaryExists = await pinnedLeafExists(roots.runtimeDir, STATE_LEAF);
    const lastGoodExists = await pinnedLeafExists(roots.runtimeDir, LAST_GOOD_LEAF);
    if (!primaryExists && !lastGoodExists) return { state: emptyState(config), recovered: false, source: 'empty' };

    let primary: RuntimeStateV1 | undefined;
    let primaryError: Error | undefined;
    try {
      primary = await readCandidate(roots.runtimeDir, STATE_LEAF);
    } catch (error) {
      primaryError = error as Error;
    }
    if (primary) return { state: primary, recovered: false, source: 'primary' };

    let lastGood: RuntimeStateV1 | undefined;
    let lastGoodError: Error | undefined;
    try {
      lastGood = await readCandidate(roots.runtimeDir, LAST_GOOD_LEAF);
    } catch (error) {
      lastGoodError = error as Error;
    }

    if (primaryExists) await quarantine(roots, STATE_LEAF, primaryError?.message ?? 'invalid runtime state');
    if (lastGood) {
      await atomicWriteJson(roots.runtimeDir, STATE_LEAF, lastGood);
      return { state: lastGood, recovered: true, source: 'last-good' };
    }

    throw new Error(
      `Runtime state recovery required. Primary=${primaryError?.message ?? 'missing'}; last-known-good=${lastGoodError?.message ?? 'missing'}. Manual reconciliation is required.`,
    );
  } finally {
    await closeRuntimeRoots(roots);
  }
}

export async function commitRuntimeState(config: WorkspaceServicesConfig, current: RuntimeStateV1, next: RuntimeStateV1): Promise<RuntimeStateV1> {
  const roots = await openRuntimeRoots(config);
  try {
    const generation = Math.max(current.generation + 1, next.generation || 0);
    const committed = { ...next, generation, schemaVersion: 1 } satisfies RuntimeStateV1;
    validateRuntimeState(committed);
    await atomicWriteJson(roots.runtimeDir, LAST_GOOD_LEAF, committed);
    await atomicWriteJson(roots.runtimeDir, STATE_LEAF, committed);
    return committed;
  } finally {
    await closeRuntimeRoots(roots);
  }
}

export async function cleanupRuntimeArtifacts(config: WorkspaceServicesConfig): Promise<void> {
  const roots = await openRuntimeRoots(config);
  try {
    await removePinnedLeafIfEmpty(roots.runtimeDir, STATE_LEAF);
    await removePinnedLeafIfEmpty(roots.runtimeDir, LAST_GOOD_LEAF);
    for (const file of await readPinnedDirectory(roots.runtimeDir)) {
      if (file.startsWith(`${STATE_LEAF}.`) && file.endsWith('.tmp')) await rm(join(roots.runtimeDir.procPath, file), { force: true });
      if (file.startsWith(`${LAST_GOOD_LEAF}.`) && file.endsWith('.tmp')) await rm(join(roots.runtimeDir.procPath, file), { force: true });
    }
  } finally {
    await closeRuntimeRoots(roots);
  }
}

export async function initializeLastGoodState(config: WorkspaceServicesConfig): Promise<void> {
  const roots = await openRuntimeRoots(config);
  try {
    if ((await pinnedLeafExists(roots.runtimeDir, STATE_LEAF)) || (await pinnedLeafExists(roots.runtimeDir, LAST_GOOD_LEAF))) return;
    const initial = emptyState(config);
    await atomicWriteJson(roots.runtimeDir, LAST_GOOD_LEAF, initial);
    await atomicWriteJson(roots.runtimeDir, STATE_LEAF, initial);
  } finally {
    await closeRuntimeRoots(roots);
  }
}

export const RUNTIME_STATE_PATHS = {
  runtimeDir: RUNTIME_RELATIVE_DIR,
  statePath: STATE_RELATIVE_PATH,
  lastGoodStatePath: LAST_GOOD_STATE_RELATIVE_PATH,
};
