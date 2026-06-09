import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { ensureMemoryDirForDb, resolveDbPath } from './config.js';

export type Db = DatabaseSync;

export function openMemoryDb(dbPath = resolveDbPath()): Db {
  if (dbPath !== ':memory:') ensureMemoryDirForDb(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  try { db.exec('PRAGMA journal_mode = WAL;'); } catch {}
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export function fts5Available(db: Db): boolean {
  try { db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS __pi_memory_fts_test USING fts5(x); DROP TABLE IF EXISTS __pi_memory_fts_test;'); return true; }
  catch { return false; }
}

export function dbExists(dbPath = resolveDbPath()): boolean { return dbPath === ':memory:' || fs.existsSync(dbPath); }
