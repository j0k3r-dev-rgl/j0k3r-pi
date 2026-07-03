import { readFile, writeFile } from 'node:fs/promises';
import type { RuntimeState, WorkspaceServicesConfig } from './types.js';
import { ensureRuntimeDirs, pathExists } from './config.js';

function emptyState(): RuntimeState {
  return { services: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readRuntimeState(config: WorkspaceServicesConfig): Promise<RuntimeState> {
  if (!(await pathExists(config.statePath))) return emptyState();

  const raw = await readFile(config.statePath, 'utf8');
  if (!raw.trim()) return emptyState();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse error';
    throw new Error(`Invalid workspace services runtime state: ${message}`);
  }

  if (!isRecord(parsed) || !isRecord(parsed.services)) return emptyState();
  return parsed as unknown as RuntimeState;
}

export async function writeRuntimeState(config: WorkspaceServicesConfig, state: RuntimeState): Promise<void> {
  await ensureRuntimeDirs(config);
  await writeFile(config.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
