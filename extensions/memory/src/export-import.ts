import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';
import type { MemoryExportMode, MemoryImportConflictPolicy, MemoryImportMode, ResolvedContext } from './types.js';
import { getMeta, SCHEMA_VERSION } from './migrations.js';
import { nowIso, sha256 } from './utils.js';

const BACKUP_FORMAT = 'pi-memory-backup';
const BACKUP_VERSION = 2;
const TABLES = ['memories', 'memory_sessions', 'memory_session_prompts', 'memory_links', 'memory_entities'] as const;
const GIT_MEMORY_KINDS = new Set(['commit_record', 'changelog_entry', 'release_record']);
type TableName = typeof TABLES[number];
type BackupRecord = { type: TableName; id: string; hash: string; row: Record<string, unknown> };
type BackupItem = { type: string; format?: string; version?: number; schema_version?: number; row?: Record<string, unknown> };
type ExportMemoryInput = { path?: string; format?: 'jsonl' | 'sqlite'; mode?: MemoryExportMode; include_archived?: boolean; include_sessions?: boolean; include_git?: boolean; context?: ResolvedContext };

const IMPORT_TABLE_ORDER: Record<TableName, number> = {
  memories: 0,
  memory_sessions: 1,
  memory_entities: 2,
  memory_links: 3,
  memory_session_prompts: 4,
};

function shouldIncludeGit(input: { include_git?: boolean; context?: ResolvedContext }): boolean {
  if (typeof input.include_git === 'boolean') return input.include_git;
  const git = input.context?.config?.git;
  return git?.enabled === true && git.sync.export === true;
}

function isGitMemoryRow(row: Record<string, unknown>): boolean {
  return GIT_MEMORY_KINDS.has(String(row.kind ?? ''));
}

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
  input: { include_archived?: boolean; include_sessions?: boolean; include_git?: boolean; context?: ResolvedContext },
): Record<string, unknown>[] {
  const scoped = contextWhere(input.context, table);
  if (table === 'memories') {
    const statusWhere = input.include_archived === false ? ' AND status = \'active\'' : '';
    const gitWhere = shouldIncludeGit(input) ? '' : ` AND kind NOT IN (${Array.from(GIT_MEMORY_KINDS).map(() => '?').join(',')})`;
    return db.prepare(`SELECT * FROM memories WHERE ${scoped.sql}${statusWhere}${gitWhere} ORDER BY id`).all(...scoped.args as any[], ...(shouldIncludeGit(input) ? [] : Array.from(GIT_MEMORY_KINDS)) as any[]) as Record<string, unknown>[];
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
    const gitWhere = shouldIncludeGit(input) ? '' : ` AND from_mem.kind NOT IN (${Array.from(GIT_MEMORY_KINDS).map(() => '?').join(',')}) AND to_mem.kind NOT IN (${Array.from(GIT_MEMORY_KINDS).map(() => '?').join(',')})`;
    const gitArgs = shouldIncludeGit(input) ? [] : [...Array.from(GIT_MEMORY_KINDS), ...Array.from(GIT_MEMORY_KINDS)];
    return db.prepare(`SELECT l.* FROM memory_links l JOIN memories from_mem ON from_mem.id = l.from_memory_id JOIN memories to_mem ON to_mem.id = l.to_memory_id WHERE ${fromScoped.sql} AND ${toScoped.sql}${gitWhere} ORDER BY l.id`).all(...args, ...gitArgs as any[]) as Record<string, unknown>[];
  }
  const memoryScoped = contextWhere(input.context, 'm');
  const gitWhere = shouldIncludeGit(input) ? '' : ` AND m.kind NOT IN (${Array.from(GIT_MEMORY_KINDS).map(() => '?').join(',')})`;
  return db.prepare(`SELECT e.* FROM memory_entities e JOIN memories m ON m.id = e.memory_id WHERE ${memoryScoped.sql}${gitWhere} ORDER BY e.id`).all(...memoryScoped.args as any[], ...(shouldIncludeGit(input) ? [] : Array.from(GIT_MEMORY_KINDS)) as any[]) as Record<string, unknown>[];
}

function backupRecordKey(record: Pick<BackupRecord, 'type' | 'id'>): string {
  return `${record.type}:${record.id}`;
}

function readBackupItems(inputPath: string): BackupItem[] {
  const lines = fs.readFileSync(inputPath, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.map((line, index) => {
    try { return JSON.parse(line) as BackupItem; }
    catch (error) { throw new Error(`Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
  });
}

function validateBackupMeta(items: BackupItem): BackupItem;
function validateBackupMeta(items: BackupItem[]): BackupItem;
function validateBackupMeta(items: BackupItem | BackupItem[]): BackupItem {
  const allItems = Array.isArray(items) ? items : [items];
  const meta = allItems.find((item) => item.type === 'meta');
  if (!meta) throw new Error('Invalid memory backup: missing meta record.');
  if (meta.format !== BACKUP_FORMAT || meta.version !== BACKUP_VERSION) throw new Error(`Invalid memory backup: expected ${BACKUP_FORMAT} v${BACKUP_VERSION}.`);
  if (typeof meta.schema_version !== 'number') throw new Error('Invalid memory backup: missing schema_version.');
  if (meta.schema_version > SCHEMA_VERSION) throw new Error(`Unsupported schema_version ${meta.schema_version}; current schema_version is ${SCHEMA_VERSION}.`);
  return meta;
}

function buildBackupRecords(db: Db, input: ExportMemoryInput): BackupRecord[] {
  const records: BackupRecord[] = [];
  for (const table of TABLES) {
    const rows = exportRows(db, table, input);
    for (const row of rows) {
      const id = String(row.id ?? '');
      if (!id) continue;
      records.push({ type: table, id, hash: rowHash(table, row), row });
    }
  }
  return records;
}

function readExistingBackupRecords(outPath: string): BackupRecord[] {
  if (!fs.existsSync(outPath)) return [];
  const items = readBackupItems(outPath);
  validateBackupMeta(items);
  return items
    .filter((item): item is BackupItem & { type: TableName; row: Record<string, unknown> } => TABLES.includes(item.type as TableName) && !!item.row?.id)
    .map((item) => {
      const id = String(item.row.id);
      return { type: item.type, id, hash: rowHash(item.type, item.row), row: item.row };
    });
}

function mergeBackupRecords(currentRecords: BackupRecord[], existingRecords: BackupRecord[]): BackupRecord[] {
  const merged = new Map<string, BackupRecord>();
  for (const record of existingRecords) merged.set(backupRecordKey(record), record);
  for (const record of currentRecords) merged.set(backupRecordKey(record), record);
  return Array.from(merged.values());
}

export function exportMemory(db: Db, input: ExportMemoryInput = {}) {
  const outPath = input.path ?? path.resolve(process.cwd(), '.pi', 'mempry-backups', 'memory-backup.jsonl');
  const mode = input.mode ?? input.context?.config?.backups.mode ?? 'mirror';
  if (input.format === 'sqlite') throw new Error('sqlite export is reserved for future implementation; use jsonl.');
  fs.mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
  const currentRecords = buildBackupRecords(db, input);
  const records = mode === 'merge'
    ? mergeBackupRecords(currentRecords, readExistingBackupRecords(outPath))
    : currentRecords;
  records.sort((a, b) => backupRecordKey(a).localeCompare(backupRecordKey(b)));
  const isMirror = mode === 'mirror';
  const manifest = records.reduce((acc, record) => {
    (acc.rows[record.type] ??= {})[record.id] = record.hash;
    return acc;
  }, { mirror: isMirror, mode, rows: {} as Record<TableName, Record<string, string>> });
  const includeSessions = input.include_sessions === true;
  const includeGit = shouldIncludeGit(input);
  const lines = [
    JSON.stringify({
      type: 'meta',
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      schema_version: SCHEMA_VERSION,
      brain_id: getMeta(db, 'brain_id'),
      exported_at: nowIso(),
      includes_sessions: includeSessions,
      includes_git: includeGit,
      mirror: isMirror,
      mode,
    }),
    JSON.stringify({ type: 'manifest', ...manifest }),
    ...records.map((record) => JSON.stringify(record)),
  ];
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  return { path: outPath, rows: records.length, mirror: isMirror, mode, format: BACKUP_FORMAT, version: BACKUP_VERSION, includes_git: includeGit };
}

function rebuildFts(db: Db): void {
  for (const table of ['memories_fts', 'memory_sessions_fts', 'memory_session_prompts_fts']) {
    try { db.prepare(`INSERT INTO ${table}(${table}) VALUES('rebuild')`).run(); } catch {}
  }
}

export function importMemory(db: Db, input: { path: string; mode?: MemoryImportMode; on_conflict?: MemoryImportConflictPolicy; include_git?: boolean }) {
  const mode = input.mode ?? 'dry_run';
  const onConflict = input.on_conflict ?? 'mark_conflict';
  const includeGit = input.include_git === true;
  const items = readBackupItems(input.path);
  validateBackupMeta(items);

  const gitMemoryIds = new Set(items
    .filter((item) => item.type === 'memories' && item.row?.id && isGitMemoryRow(item.row))
    .map((item) => String(item.row!.id)));

  const rowItems = items
    .filter((item): item is { type: TableName; row: Record<string, unknown> } => TABLES.includes(item.type as TableName) && !!item.row?.id)
    .sort((a, b) => {
      const tableOrder = IMPORT_TABLE_ORDER[a.type] - IMPORT_TABLE_ORDER[b.type];
      if (tableOrder !== 0) return tableOrder;
      return String(a.row.id).localeCompare(String(b.row.id));
    });

  let seen = 0, inserted = 0, wouldInsert = 0, conflicts = 0, replaced = 0, skippedGit = 0;
  const seenByTable: Record<string, number> = {};
  const insertedByTable: Record<string, number> = {};
  const conflictDetails: Array<{ table: string; id: unknown; action: string }> = [];
  for (const item of rowItems) {
    seen++;
    seenByTable[item.type] = (seenByTable[item.type] ?? 0) + 1;
    const skipGit = includeGit === false && (
      (item.type === 'memories' && isGitMemoryRow(item.row))
      || (item.type === 'memory_links' && (gitMemoryIds.has(String(item.row.from_memory_id ?? '')) || gitMemoryIds.has(String(item.row.to_memory_id ?? ''))))
      || (item.type === 'memory_entities' && gitMemoryIds.has(String(item.row.memory_id ?? '')))
    );
    if (skipGit) {
      skippedGit++;
      continue;
    }
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
    wouldInsert++;
    if (mode === 'merge') {
      const cols = Object.keys(item.row);
      const placeholders = cols.map(() => '?').join(',');
      db.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${placeholders})`).run(...cols.map((c) => item.row![c]) as any[]);
      inserted++;
      insertedByTable[table] = (insertedByTable[table] ?? 0) + 1;
    }
  }
  const rebuiltFts = mode === 'merge';
  if (rebuiltFts) rebuildFts(db);
  return { mode, on_conflict: onConflict, seen, inserted, would_insert: wouldInsert, conflicts, replaced, skipped_git: skippedGit, includes_git: includeGit, seen_by_table: seenByTable, inserted_by_table: insertedByTable, rebuilt_fts: rebuiltFts, conflict_details: conflictDetails };
}
