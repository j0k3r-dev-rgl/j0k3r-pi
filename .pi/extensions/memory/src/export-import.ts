import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';
import { getMeta, SCHEMA_VERSION } from './migrations.js';
import { nowIso } from './utils.js';

const TABLES = ['memories', 'memory_sessions', 'memory_session_prompts', 'memory_links', 'memory_entities'] as const;

export function exportMemory(db: Db, input: { path?: string; format?: 'jsonl' | 'sqlite'; include_archived?: boolean; include_prompts?: boolean } = {}) {
  const outPath = input.path ?? path.resolve(process.cwd(), `pi-memory-export-${Date.now()}.jsonl`);
  if (input.format === 'sqlite') throw new Error('sqlite export is reserved for future implementation; use jsonl.');
  const lines: string[] = [];
  lines.push(JSON.stringify({ type: 'meta', schema_version: SCHEMA_VERSION, brain_id: getMeta(db, 'brain_id'), exported_at: nowIso(), includes_prompts: input.include_prompts === true }));
  let count = 0;
  for (const table of TABLES) {
    if (table === 'memory_session_prompts' && input.include_prompts !== true) continue;
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as any[];
    for (const row of rows) {
      if (table === 'memories' && input.include_archived === false && row.status !== 'active') continue;
      lines.push(JSON.stringify({ type: table, row }));
      count++;
    }
  }
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  return { path: outPath, rows: count };
}

function rebuildFts(db: Db): void {
  for (const table of ['memories_fts', 'memory_sessions_fts', 'memory_session_prompts_fts']) {
    try { db.prepare(`INSERT INTO ${table}(${table}) VALUES('rebuild')`).run(); } catch {}
  }
}

export function importMemory(db: Db, input: { path: string; mode?: 'merge' | 'dry_run'; on_conflict?: 'keep_local' | 'keep_imported' | 'mark_conflict' }) {
  const mode = input.mode ?? 'dry_run';
  const onConflict = input.on_conflict ?? 'mark_conflict';
  const lines = fs.readFileSync(input.path, 'utf8').split(/\r?\n/).filter(Boolean);
  const items = lines.map((line, index) => {
    try { return JSON.parse(line) as { type: string; schema_version?: number; row?: Record<string, unknown> }; }
    catch (error) { throw new Error(`Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
  });
  const meta = items.find((item) => item.type === 'meta');
  if (!meta) throw new Error('Invalid memory import: missing meta record.');
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
      if (mode === 'merge' && onConflict === 'mark_conflict' && 'sync_status' in item.row) { db.prepare(`UPDATE ${table} SET sync_status='conflict' WHERE id=?`).run(id as any); action = 'marked_conflict'; }
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
  return { mode, seen, inserted, conflicts, replaced, rebuilt_fts: rebuiltFts, conflict_details: conflictDetails };
}
