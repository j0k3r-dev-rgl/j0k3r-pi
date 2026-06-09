import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { SubagentTask } from './types.js';

const require = createRequire(import.meta.url);

type Db = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
};

function dbPath(cwd: string): string {
  return path.join(cwd, '.pi', 'subagents-history.sqlite');
}

function value(text: string | undefined): string | null { return text ?? null; }
function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!rows.some((row) => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export class SubagentHistoryStore {
  private dbs = new Map<string, Db>();

  private db(cwd: string): Db {
    const file = dbPath(cwd);
    const existing = this.dbs.get(file);
    if (existing) return existing;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(path.dirname(file), 0o700); } catch {}
    const { DatabaseSync } = require('node:sqlite') as any;
    const db = new DatabaseSync(file) as Db;
    try { fs.chmodSync(file, 0o600); } catch {}
    db.exec(`
      CREATE TABLE IF NOT EXISTS subagent_tasks (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        agent TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        task TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        last_activity_at TEXT,
        last_activity TEXT,
        output_preview TEXT,
        prompt TEXT,
        transcript TEXT,
        usage_input INTEGER,
        usage_output INTEGER,
        usage_cache_read INTEGER,
        usage_cache_write INTEGER,
        usage_cost REAL,
        usage_context_tokens INTEGER,
        usage_turns INTEGER,
        model TEXT,
        effort TEXT,
        fallback_used INTEGER,
        error TEXT,
        result TEXT
      );
      CREATE TABLE IF NOT EXISTS subagent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        activity TEXT NOT NULL,
        output_preview TEXT,
        FOREIGN KEY(task_id) REFERENCES subagent_tasks(id)
      );
      CREATE INDEX IF NOT EXISTS idx_subagent_tasks_created ON subagent_tasks(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_subagent_events_task ON subagent_events(task_id, created_at);
    `);
    ensureColumn(db, 'subagent_tasks', 'prompt', 'TEXT');
    ensureColumn(db, 'subagent_tasks', 'transcript', 'TEXT');
    ensureColumn(db, 'subagent_tasks', 'usage_input', 'INTEGER');
    ensureColumn(db, 'subagent_tasks', 'usage_output', 'INTEGER');
    ensureColumn(db, 'subagent_tasks', 'usage_cache_read', 'INTEGER');
    ensureColumn(db, 'subagent_tasks', 'usage_cache_write', 'INTEGER');
    ensureColumn(db, 'subagent_tasks', 'usage_cost', 'REAL');
    ensureColumn(db, 'subagent_tasks', 'usage_context_tokens', 'INTEGER');
    ensureColumn(db, 'subagent_tasks', 'usage_turns', 'INTEGER');
    ensureColumn(db, 'subagent_tasks', 'effort', 'TEXT');
    this.dbs.set(file, db);
    return db;
  }

  upsertTask(cwd: string, task: SubagentTask): void {
    this.db(cwd).prepare(`
      INSERT INTO subagent_tasks (
        id, cwd, agent, mode, status, task, context, created_at, started_at, ended_at,
        last_activity_at, last_activity, output_preview, prompt, transcript,
        usage_input, usage_output, usage_cache_read, usage_cache_write, usage_cost, usage_context_tokens, usage_turns,
        model, effort, fallback_used, error, result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status,
        started_at=excluded.started_at,
        ended_at=excluded.ended_at,
        last_activity_at=excluded.last_activity_at,
        last_activity=excluded.last_activity,
        output_preview=excluded.output_preview,
        prompt=excluded.prompt,
        transcript=excluded.transcript,
        usage_input=excluded.usage_input,
        usage_output=excluded.usage_output,
        usage_cache_read=excluded.usage_cache_read,
        usage_cache_write=excluded.usage_cache_write,
        usage_cost=excluded.usage_cost,
        usage_context_tokens=excluded.usage_context_tokens,
        usage_turns=excluded.usage_turns,
        model=excluded.model,
        effort=excluded.effort,
        fallback_used=excluded.fallback_used,
        error=excluded.error,
        result=excluded.result
    `).run(
      task.id,
      cwd,
      task.agent,
      task.mode,
      task.status,
      task.task,
      value(task.context),
      task.created_at,
      value(task.started_at),
      value(task.ended_at),
      value(task.last_activity_at),
      value(task.last_activity),
      value(task.output_preview),
      value(task.prompt),
      value(task.transcript),
      task.usage?.input ?? null,
      task.usage?.output ?? null,
      task.usage?.cacheRead ?? null,
      task.usage?.cacheWrite ?? null,
      task.usage?.cost ?? null,
      task.usage?.contextTokens ?? null,
      task.usage?.turns ?? null,
      value(task.model),
      value(task.effort),
      task.fallback_used === undefined ? null : task.fallback_used ? 1 : 0,
      value(task.error),
      value(task.result),
    );
  }

  addEvent(cwd: string, task: SubagentTask, activity: string): void {
    this.db(cwd).prepare(`
      INSERT INTO subagent_events (task_id, cwd, created_at, status, activity, output_preview)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(task.id, cwd, task.last_activity_at ?? new Date().toISOString(), task.status, activity, value(task.output_preview));
  }

  getTask(cwd: string, id: string): SubagentTask | undefined {
    const rows = this.db(cwd).prepare(`
      SELECT * FROM subagent_tasks WHERE cwd = ? AND id = ? LIMIT 1
    `).all(cwd, id);
    return rows.length ? rowToTask(rows[0]) : undefined;
  }

  listTasks(cwd: string, limit = 100): SubagentTask[] {
    return this.db(cwd).prepare(`
      SELECT * FROM subagent_tasks WHERE cwd = ? ORDER BY created_at DESC LIMIT ?
    `).all(cwd, limit).map(rowToTask);
  }
}

function rowToTask(row: any): SubagentTask {
  return {
    id: row.id,
    agent: row.agent,
    mode: row.mode,
    status: row.status,
    task: row.task,
    context: row.context ?? undefined,
    created_at: row.created_at,
    started_at: row.started_at ?? undefined,
    ended_at: row.ended_at ?? undefined,
    last_activity_at: row.last_activity_at ?? undefined,
    last_activity: row.last_activity ?? undefined,
    output_preview: row.output_preview ?? undefined,
    prompt: row.prompt ?? undefined,
    transcript: row.transcript ?? undefined,
    usage: row.usage_input === null && row.usage_output === null && row.usage_cache_read === null && row.usage_cache_write === null && row.usage_cost === null && row.usage_context_tokens === null && row.usage_turns === null ? undefined : {
      input: row.usage_input ?? 0,
      output: row.usage_output ?? 0,
      cacheRead: row.usage_cache_read ?? 0,
      cacheWrite: row.usage_cache_write ?? 0,
      cost: row.usage_cost ?? 0,
      contextTokens: row.usage_context_tokens ?? 0,
      turns: row.usage_turns ?? 0,
    },
    model: row.model ?? undefined,
    effort: row.effort ?? undefined,
    fallback_used: row.fallback_used === null || row.fallback_used === undefined ? undefined : Boolean(row.fallback_used),
    error: row.error ?? undefined,
    result: row.result ?? undefined,
  };
}
