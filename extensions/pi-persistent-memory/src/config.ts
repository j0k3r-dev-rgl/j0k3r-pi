import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_DB_PATH = join(homedir(), '.memory', 'memories.db');
export const SCHEMA_VERSION = 1;
export const BUSY_TIMEOUT_MS = 5000;
export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;
export const INVOCATION_BIND_CHANNEL = 'memory:invocation:bind:v1';
export const INLINE_INVOCATION_ADAPTER_NAME = 'memory-invocation-adapter-v1';
