import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { BUSY_TIMEOUT_MS, DIR_MODE, FILE_MODE } from '../config.ts';

export interface OpenDatabaseOptions {
  busyTimeoutMs?: number;
}

function parseBusyTimeout(options?: OpenDatabaseOptions | number): number {
  const raw = typeof options === 'number'
    ? options
    : options?.busyTimeoutMs;

  if (raw === undefined) {
    return BUSY_TIMEOUT_MS;
  }

  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new TypeError(`Invalid busyTimeoutMs: expected a non-negative safe integer, got ${raw}`);
  }

  return raw;
}

function isSqliteContentionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { errcode?: number; code?: string; message?: string };
  if (typeof err.errcode === 'number') {
    const primary = err.errcode & 0xff;
    return primary === 5 || primary === 6;
  }
  if (typeof err.message === 'string') {
    const msg = err.message.toLowerCase();
    return msg.includes('database is locked') || msg.includes('database table is locked') || msg.includes('busy');
  }
  return false;
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  try {
    const sab = new SharedArrayBuffer(4);
    const int32 = new Int32Array(sab);
    Atomics.wait(int32, 0, 0, ms);
  } catch {
    const end = performance.now() + ms;
    while (performance.now() < end) {}
  }
}

export function openDatabase(
  dbPath: string,
  options?: OpenDatabaseOptions | number
): DatabaseSync {
  const busyTimeoutMs = parseBusyTimeout(options);

  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    try { chmodSync(dir, DIR_MODE); } catch {}
  }

  const db = new DatabaseSync(dbPath, { allowExtension: true });
  try {
    if (existsSync(dbPath)) {
      try { chmodSync(dbPath, FILE_MODE); } catch {}
    }

    const startTime = performance.now();
    const deadline = startTime + busyTimeoutMs;

    let inWal = false;
    let lastError: unknown = null;
    let attempt = 0;

    while (attempt === 0 || (busyTimeoutMs > 0 && performance.now() < deadline)) {
      attempt++;

      const remainingMs = busyTimeoutMs === 0
        ? 0
        : Math.max(0, Math.ceil(deadline - performance.now()));

      if (busyTimeoutMs > 0 && remainingMs <= 0 && attempt > 1) {
        break;
      }

      try {
        db.exec(`PRAGMA busy_timeout = ${remainingMs};`);
      } catch (err) {
        if (!isSqliteContentionError(err)) {
          throw err;
        }
        lastError = err;
      }

      try {
        const modeRow = db.prepare('PRAGMA journal_mode;').get() as { journal_mode?: string } | undefined;
        if (modeRow && typeof modeRow.journal_mode === 'string' && modeRow.journal_mode.toLowerCase() === 'wal') {
          inWal = true;
          break;
        }
      } catch (err) {
        if (!isSqliteContentionError(err)) {
          throw err;
        }
        lastError = err;
      }

      // Check deadline between read and WAL transition:
      // If busyTimeoutMs > 0 and deadline has expired, never start additional blocking work after expiry.
      // If busyTimeoutMs === 0 and attempt === 1, allow the one nonblocking transition attempt.
      if (busyTimeoutMs > 0 && performance.now() >= deadline) {
        break;
      }

      const remainingBeforeWal = busyTimeoutMs === 0
        ? 0
        : Math.max(0, Math.ceil(deadline - performance.now()));

      if (busyTimeoutMs > 0 && remainingBeforeWal <= 0) {
        break;
      }

      try {
        db.exec(`PRAGMA busy_timeout = ${remainingBeforeWal};`);
      } catch (err) {
        if (!isSqliteContentionError(err)) {
          throw err;
        }
        lastError = err;
      }

      try {
        const row = db.prepare('PRAGMA journal_mode = WAL;').get() as { journal_mode?: string } | undefined;
        if (row && typeof row.journal_mode === 'string' && row.journal_mode.toLowerCase() === 'wal') {
          inWal = true;
          break;
        }
      } catch (err) {
        if (!isSqliteContentionError(err)) {
          throw err;
        }
        lastError = err;
      }

      if (busyTimeoutMs === 0) {
        break;
      }

      const now = performance.now();
      if (now >= deadline) {
        break;
      }

      const backoff = Math.min(50, Math.max(5, 5 * attempt), Math.ceil(deadline - now));
      if (backoff > 0) {
        sleepSync(backoff);
      }
    }

    if (!inWal) {
      throw lastError ?? new Error('database is locked: WAL mode transition timed out');
    }

    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
    db.exec(`PRAGMA foreign_keys = ON;`);

    // Load sqlite-vec and immediately disable extension loading
    sqliteVec.load(db);
    db.enableLoadExtension(false);

    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function withDatabase<T>(
  dbPath: string,
  fn: (db: DatabaseSync) => T,
  options?: OpenDatabaseOptions | number
): T {
  const db = openDatabase(dbPath, options);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
