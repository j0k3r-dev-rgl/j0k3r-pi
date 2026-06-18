import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';
import type { MemoryImportConflictPolicy, MemoryImportMode, ResolvedContext } from './types.js';
import { getMeta, SCHEMA_VERSION } from './migrations.js';
import { nowIso, sha256 } from './utils.js';

const BACKUP_FORMAT = 'pi-memory-backup';
const BACKUP_VERSION = 2;
const TABLES = ['memories', 'memory_sessions', 'memory_session_prompts', 'memory_links', 'memory_entities'] as const;
type TableName = typeof TABLES[number];
type BackupRecord = { type: TableName; id: string; hash: string; row: Record<string, unknown> };

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function rowHash(table: string, row: Record<string, unknown>): string {
  return sha256(stableStringify({ table, row }));
}

function contextWhere(context: ResolvedContext | undefined, alias: string): { sql: string; args: unknown[] } {
  if (!context) return { sql: '1=1', args: [] };
  if (context.scope === 'project') return { sql: `${alias}.scope = 'project' AND ${alias}.project_id = ?`, args: [context.project_id] };
  return { sql: `${alias}.scope = ?`, args: [context.scope] };
}

function exportRows(
  db: Db,
  table: TableName,
  input: { include_archived?: boolean; include_sessions?: boolean; context?: ResolvedContext },
): Record<string, unknown>[] {
  const scoped = contextWhere(input.context, table);
  if (table === 'memories') {
    const statusWhere = input.include_archived === false ? ' AND status = \'active\'' : '';
    return db.prepare(`SELECT * FROM memories WHERE ${scoped.sql}${statusWhere} ORDER BY id`).all(...scoped.args as any[]) as Record<string, unknown>[];
  }
  if (table === 'memory_sessions') {
    if (input.include_sessions !== true) return [];
    return db.prepare(`SELECT * FROM memory_sessions WHERE ${scoped.sql} ORDER BY id`).all(...scoped.args as any[]) as Record<string, unknown>[];
  }
  if (table === 'memory_session_prompts') {
    if (input.include_sessions !== true) return [];
    const sessionScoped = contextWhere(input.context, 's');
    return db.prepare(`SELECT p.* FROM memory_session_prompts p JOIN memory_sessions s ON s.id = p.session_id WHERE ${sessionScoped.sql} ORDER BY p.id`).all(...sessionScoped.args as any[]) as Record<string, unknown>[];
  }
  if (table === 'memory_links') {
    const fromScoped = contextWhere(input.context, 'from_mem');
    const toScoped = contextWhere(input.context, 'to_mem');
    const args = [...fromScoped.args, ...toScoped.args] as any[];
    return db.prepare(`SELECT l.* FROM memory_links l JOIN memories from_mem ON from_mem.id = l.from_memory_id JOIN memories to_mem ON to_mem.id = l.to_memory_id WHERE ${fromScoped.sql} AND ${toScoped.sql} ORDER BY l.id`).all(...args) as Record<string, unknown>[];
  }
  const memoryScoped = contextWhere(input.context, 'm');
  return db.prepare(`SELECT e.* FROM memory_entities e JOIN memories m ON m.id = e.memory_id WHERE ${memoryScoped.sql} ORDER BY e.id`).all(...memoryScoped.args as any[]) as Record<string, unknown>[];
}

export function exportMemory(db: Db, input: { path?: string; format?: 'jsonl' | 'sqlite'; include_archived?: boolean; include_sessions?: boolean; context?: ResolvedContext } = {}) {
  const outPath = input.path ?? path.resolve(process.cwd(), '.pi', 'mempry-backups', 'memory-backup.jsonl');
  if (input.format === 'sqlite') throw new Error('sqlite export is reserved for future implementation; use jsonl.');
  fs.mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
  const records: BackupRecord[] = [];
  for (const table of TABLES) {
    const rows = exportRows(db, table, input);
    for (const row of rows) {
      const id = String(row.id ?? '');
      if (!id) continue;
      records.push({ type: table, id, hash: rowHash(table, row), row });
    }
  }
  records.sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
  const manifest = records.reduce((acc, record) => {
    (acc.rows[record.type] ??= {})[record.id] = record.hash;
    return acc;
  }, { mirror: true, rows: {} as Record<TableName, Record<string, string>> });
  const includeSessions = input.include_sessions === true;
  const lines = [
    JSON.stringify({
      type: 'meta',
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      schema_version: SCHEMA_VERSION,
      brain_id: getMeta(db, 'brain_id'),
      exported_at: nowIso(),
      includes_sessions: includeSessions,
      mirror: true,
    }),
    JSON.stringify({ type: 'manifest', ...manifest }),
    ...records.map((record) => JSON.stringify(record)),
  ];
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  return { path: outPath, rows: records.length, mirror: true, format: BACKUP_FORMAT, version: BACKUP_VERSION };
}

function rebuildFts(db: Db): void {
  for (const table of ['memories_fts', 'memory_sessions_fts', 'memory_session_prompts_fts']) {
    try { db.prepare(`INSERT INTO ${table}(${table}) VALUES('rebuild')`).run(); } catch {}
  }
}

export function importMemory(db: Db, input: { path: string; mode?: MemoryImportMode; on_conflict?: MemoryImportConflictPolicy }) {
  const mode = input.mode ?? 'dry_run';
  const onConflict = input.on_conflict ?? 'mark_conflict';
  const lines = fs.readFileSync(input.path, 'utf8').split(/\r?\n/).filter(Boolean);
  const items = lines.map((line, index) => {
    try { return JSON.parse(line) as { type: string; format?: string; version?: number; schema_version?: number; row?: Record<string, unknown> }; }
    catch (error) { throw new Error(`Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
  });
  const meta = items.find((item) => item.type === 'meta');
  if (!meta) throw new Error('Invalid memory import: missing meta record.');
  if (meta.format !== BACKUP_FORMAT || meta.version !== BACKUP_VERSION) throw new Error(`Invalid memory import: expected ${BACKUP_FORMAT} v${BACKUP_VERSION}.`);
  if (typeof meta.schema_version !== 'number') throw new Error('Invalid memory import: missing schema_version.');
  if (meta.schema_version > SCHEMA_VERSION) throw new Error(`Unsupported schema_version ${meta.schema_version}; current schema_version is ${SCHEMA_VERSION}.`);

  let seen = 0, inserted = 0, conflicts = 0, replaced = 0;
  const conflictDetails: Array<{ table: string; id: unknown; action: string }> = [];
  for (const item of items) {
    if (!TABLES.includes(item.type as any) || !item.row?.id) continue;
    seen++;
    const table = item.type;
    const id = item.row.id;
    const exists = db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id as any);
    if (exists) {
      conflicts++;
      let action = 'kept_local';
      if (mode === 'merge' && onConflict === 'mark_conflict' && 'sync_status' in item.row) {
        db.prepare(`UPDATE ${table} SET sync_status='conflict' WHERE id=?`).run(id as any);
        action = 'marked_conflict';
      }
      if (mode === 'merge' && onConflict === 'keep_imported') {
        action = 'replaced_with_imported';
        const cols = Object.keys(item.row);
        const assignments = cols.filter((c) => c !== 'id').map((c) => `${c}=?`).join(',');
        if (assignments) db.prepare(`UPDATE ${table} SET ${assignments} WHERE id=?`).run(...cols.filter((c) => c !== 'id').map((c) => item.row![c]) as any[], id as any);
        replaced++;
      }
      conflictDetails.push({ table, id, action });
      continue;
    }
    if (mode === 'merge') {
      const cols = Object.keys(item.row);
      const placeholders = cols.map(() => '?').join(',');
      db.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${placeholders})`).run(...cols.map((c) => item.row![c]) as any[]);
      inserted++;
    }
  }
  const rebuiltFts = mode === 'merge';
  if (rebuiltFts) rebuildFts(db);
  return { mode, on_conflict: onConflict, seen, inserted, conflicts, replaced, rebuilt_fts: rebuiltFts, conflict_details: conflictDetails };
}
