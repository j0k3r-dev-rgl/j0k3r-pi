import { closeSync, constants, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Durability primitives for the supervisor's JSON configuration.
 *
 * Configuration is read and rewritten by a live interactive session while another process
 * may do the same, so a write is: take an exclusive lock file, re-read inside it, then
 * create the replacement and rename it over the original with a private mode.
 */

const LOCK_ATTEMPTS = 5;
const LOCK_WAIT_MS = 10;

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Runs `action` while holding `<filePath>.lock`. Creating the lock file with `O_EXCL`
 * makes concurrent writers fail rather than interleave; the lock is always released, and
 * a held lock surfaces as an explicit error instead of a blocking wait.
 */
export function withExclusiveFileLock<T>(filePath: string, label: string, action: () => T): T {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = `${filePath}.lock`;
  let lockFd: number | null = null;

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      lockFd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      break;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        if (attempt === LOCK_ATTEMPTS - 1) {
          throw new Error(`${capitalize(label)} lock held by another process`);
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS);
        continue;
      }
      throw new Error(`Failed to acquire ${label} lock: ${err.message}`);
    }
  }

  try {
    return action();
  } finally {
    if (lockFd !== null) {
      try { closeSync(lockFd); } catch {}
      try { unlinkSync(lockPath); } catch {}
    }
  }
}

/** Writes `value` as JSON through a private temp file and a rename, mode 0o600. */
export function writeJsonAtomic(filePath: string, value: unknown, label: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const content = JSON.stringify(value, null, 2) + '\n';
  const tempPath = join(dir, `.${basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);

  try {
    writeFileSync(tempPath, content, { mode: 0o600 });
    renameSync(tempPath, filePath);
  } catch (err: any) {
    try { unlinkSync(tempPath); } catch {}
    throw new Error(`Failed to write ${label}: ${err.message}`);
  }
}
