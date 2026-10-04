import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseErrorMetadata, serializeErrorMetadata } from './error-metadata.js';
import { boundThreadSnapshot } from './thread-view.js';
import type { SubagentTask, SubagentThreadSnapshot } from './types.js';

const require = createRequire(import.meta.url);

type Db = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
};

type DbConstructor = new (file: string) => Db;

function loadDbConstructor(): DbConstructor {
  try {
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync?: DbConstructor };
    if (DatabaseSync) return DatabaseSync;
  } catch {}
  const { Database } = require('bun:sqlite') as { Database?: DbConstructor };
  if (Database) return Database;
  throw new Error('No supported sqlite runtime is available. Expected node:sqlite or bun:sqlite.');
}

export function resolveSubagentsHistoryHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_SUBAGENTS_HISTORY_HOME) return path.resolve(env.PI_SUBAGENTS_HISTORY_HOME);
  const xdg = env.XDG_DATA_HOME;
  return xdg ? path.join(xdg, 'pi', 'subagents') : path.join(os.homedir(), '.local', 'share', 'pi', 'subagents');
}

export function resolveSubagentHistoryDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_SUBAGENTS_HISTORY_DB_PATH) return path.resolve(env.PI_SUBAGENTS_HISTORY_DB_PATH);
  return path.join(resolveSubagentsHistoryHome(env), 'subagents-history.sqlite');
}

function value(text: string | undefined): string | null { return text ?? null; }
function snapshotJson(snapshot: SubagentTask['thread_snapshot']): string | null {
  const bounded = boundThreadSnapshot(snapshot);
  return bounded ? JSON.stringify(bounded) : null;
}
function parseSnapshotJson(text: unknown): SubagentThreadSnapshot | undefined {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  try {
    return boundThreadSnapshot(JSON.parse(text));
  } catch {
    return undefined;
  }
}
type HistoryReadOptions = { includeSnapshots?: boolean };

const SESSION_TASK_METADATA_COLUMNS = `
        id,
        display_name,
        cwd,
        agent,
        mode,
        status,
        task,
        context,
        created_at,
        attempt,
        session_id,
        nested_session_path,
        started_at,
        ended_at,
        last_activity_at,
        last_activity,
        output_preview,
        usage_input,
        usage_output,
        usage_cache_read,
        usage_cache_write,
        usage_cost,
        usage_context_tokens,
        usage_turns,
        model,
        effort,
        model_source,
        effort_source,
        fallback_used,
        error,
        error_metadata_json,
        error_category,
        pi_retry_attempts,
        pending_message_count,
        undelivered_message_count
`;

function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (!columns.some((row) => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function configureHistoryDb(db: Db): void {
  db.exec('PRAGMA busy_timeout = 2000');
  try { db.exec('PRAGMA journal_mode = WAL'); } catch {}
  try { db.exec('PRAGMA synchronous = NORMAL'); } catch {}
}

function ensureAttemptColumns(db: Db): void {
  ensureColumn(db, 'subagent_task_attempts', 'display_name', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'cwd', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'agent', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'mode', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'status', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'task', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'context', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'created_at', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'session_id', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'nested_session_path', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'started_at', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'ended_at', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'last_activity_at', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'last_activity', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'output_preview', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'prompt', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'continuation_prompt', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'system_prompt', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'transcript', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'usage_input', 'INTEGER');
  ensureColumn(db, 'subagent_task_attempts', 'usage_output', 'INTEGER');
  ensureColumn(db, 'subagent_task_attempts', 'usage_cache_read', 'INTEGER');
  ensureColumn(db, 'subagent_task_attempts', 'usage_cache_write', 'INTEGER');
  ensureColumn(db, 'subagent_task_attempts', 'usage_cost', 'REAL');
  ensureColumn(db, 'subagent_task_attempts', 'usage_context_tokens', 'INTEGER');
  ensureColumn(db, 'subagent_task_attempts', 'usage_turns', 'INTEGER');
  ensureColumn(db, 'subagent_task_attempts', 'model', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'effort', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'model_source', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'effort_source', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'fallback_used', 'INTEGER');
  ensureColumn(db, 'subagent_task_attempts', 'error', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'error_metadata_json', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'error_category', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'result', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'thread_snapshot_json', 'TEXT');
  ensureColumn(db, 'subagent_task_attempts', 'pi_retry_attempts', 'INTEGER');
  ensureColumn(db, 'subagent_task_attempts', 'pending_message_count', 'INTEGER');
  ensureColumn(db, 'subagent_task_attempts', 'undelivered_message_count', 'INTEGER');
}

function upsertTaskRecord(db: Db, table: 'subagent_tasks' | 'subagent_task_attempts', cwd: string, task: SubagentTask): void {
  let errorMetadataJson: string | null = null;
  let errorCategory: string | null = null;
  if (task.error_metadata !== undefined) {
    try {
      errorMetadataJson = serializeErrorMetadata(task.error_metadata);
      errorCategory = parseErrorMetadata(errorMetadataJson)?.category ?? null;
    } catch {
      errorMetadataJson = null;
      errorCategory = null;
    }
  }

  const columns = table === 'subagent_tasks'
    ? 'id, display_name, cwd, agent, mode, status, task, context, created_at, attempt, session_id, nested_session_path, started_at, ended_at, last_activity_at, last_activity, output_preview, prompt, continuation_prompt, system_prompt, transcript, usage_input, usage_output, usage_cache_read, usage_cache_write, usage_cost, usage_context_tokens, usage_turns, model, effort, model_source, effort_source, fallback_used, error, error_metadata_json, error_category, result, thread_snapshot_json, pi_retry_attempts, pending_message_count, undelivered_message_count'
    : 'task_id, attempt, display_name, cwd, agent, mode, status, task, context, created_at, session_id, nested_session_path, started_at, ended_at, last_activity_at, last_activity, output_preview, prompt, continuation_prompt, system_prompt, transcript, usage_input, usage_output, usage_cache_read, usage_cache_write, usage_cost, usage_context_tokens, usage_turns, model, effort, model_source, effort_source, fallback_used, error, error_metadata_json, error_category, result, thread_snapshot_json, pi_retry_attempts, pending_message_count, undelivered_message_count';
  const placeholders = new Array(columns.split(',').length).fill('?').join(', ');
  const update = table === 'subagent_tasks'
    ? `display_name=excluded.display_name,
        status=excluded.status,
        attempt=excluded.attempt,
        session_id=excluded.session_id,
        nested_session_path=excluded.nested_session_path,
        started_at=excluded.started_at,
        ended_at=excluded.ended_at,
        last_activity_at=excluded.last_activity_at,
        last_activity=excluded.last_activity,
        output_preview=excluded.output_preview,
        prompt=excluded.prompt,
        continuation_prompt=excluded.continuation_prompt,
        system_prompt=excluded.system_prompt,
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
        model_source=excluded.model_source,
        effort_source=excluded.effort_source,
        fallback_used=excluded.fallback_used,
        error=excluded.error,
        error_metadata_json=excluded.error_metadata_json,
        error_category=excluded.error_category,
        result=excluded.result,
        thread_snapshot_json=excluded.thread_snapshot_json,
        pi_retry_attempts=excluded.pi_retry_attempts,
        pending_message_count=excluded.pending_message_count,
        undelivered_message_count=excluded.undelivered_message_count`
    : `display_name=excluded.display_name,
        status=excluded.status,
        session_id=excluded.session_id,
        nested_session_path=excluded.nested_session_path,
        started_at=excluded.started_at,
        ended_at=excluded.ended_at,
        last_activity_at=excluded.last_activity_at,
        last_activity=excluded.last_activity,
        output_preview=excluded.output_preview,
        prompt=excluded.prompt,
        continuation_prompt=excluded.continuation_prompt,
        system_prompt=excluded.system_prompt,
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
        model_source=excluded.model_source,
        effort_source=excluded.effort_source,
        fallback_used=excluded.fallback_used,
        error=excluded.error,
        error_metadata_json=excluded.error_metadata_json,
        error_category=excluded.error_category,
        result=excluded.result,
        thread_snapshot_json=excluded.thread_snapshot_json,
        pi_retry_attempts=excluded.pi_retry_attempts,
        pending_message_count=excluded.pending_message_count,
        undelivered_message_count=excluded.undelivered_message_count`;
  const identity = table === 'subagent_tasks' ? 'id' : 'task_id, attempt';

  db.prepare(`
    INSERT INTO ${table} (${columns}) VALUES (${placeholders})
    ON CONFLICT(${identity}) DO UPDATE SET ${update}
  `).run(
    ...(table === 'subagent_tasks' ? [task.id] : [task.id, task.attempt ?? 1]),
    value(task.display_name),
    cwd,
    task.agent,
    task.mode,
    task.status,
    task.task,
    value(task.context),
    task.created_at,
    ...(table === 'subagent_tasks' ? [task.attempt ?? 1] : []),
    value(task.session_id),
    value(task.nested_session_path),
    value(task.started_at),
    value(task.ended_at),
    value(task.last_activity_at),
    value(task.last_activity),
    value(task.output_preview),
    value(task.prompt),
    value(task.continuation_prompt),
    value(task.system_prompt),
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
    value(task.model_source),
    value(task.effort_source),
    task.fallback_used === undefined ? null : task.fallback_used ? 1 : 0,
    value(task.error),
    errorMetadataJson,
    errorCategory,
    value(task.result),
    snapshotJson(task.thread_snapshot),
    task.pi_retry_attempts ?? null,
    task.pending_message_count ?? null,
    task.undelivered_message_count ?? null,
  );
}

export class SubagentHistoryStore {
  private dbs = new Map<string, Db>();

  private db(_cwd: string): Db {
    const file = resolveSubagentHistoryDbPath();
    const existing = this.dbs.get(file);
    if (existing) return existing;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(path.dirname(file), 0o700); } catch {}
    const Database = loadDbConstructor();
    const db = new Database(file) as Db;
    try { fs.chmodSync(file, 0o600); } catch {}
    configureHistoryDb(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS subagent_tasks (
        id TEXT PRIMARY KEY,
        display_name TEXT,
        cwd TEXT NOT NULL,
        agent TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        task TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL,
        attempt INTEGER,
        session_id TEXT,
        nested_session_path TEXT,
        started_at TEXT,
        ended_at TEXT,
        last_activity_at TEXT,
        last_activity TEXT,
        output_preview TEXT,
        prompt TEXT,
        continuation_prompt TEXT,
        system_prompt TEXT,
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
        model_source TEXT,
        effort_source TEXT,
        fallback_used INTEGER,
        error TEXT,
        error_metadata_json TEXT,
        error_category TEXT,
        result TEXT,
        thread_snapshot_json TEXT,
        pi_retry_attempts INTEGER,
        pending_message_count INTEGER,
        undelivered_message_count INTEGER
      );
      CREATE TABLE IF NOT EXISTS subagent_task_attempts (
        task_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        display_name TEXT,
        cwd TEXT NOT NULL,
        agent TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        task TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL,
        session_id TEXT,
        nested_session_path TEXT,
        started_at TEXT,
        ended_at TEXT,
        last_activity_at TEXT,
        last_activity TEXT,
        output_preview TEXT,
        prompt TEXT,
        continuation_prompt TEXT,
        system_prompt TEXT,
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
        model_source TEXT,
        effort_source TEXT,
        fallback_used INTEGER,
        error TEXT,
        error_metadata_json TEXT,
        error_category TEXT,
        result TEXT,
        thread_snapshot_json TEXT,
        pi_retry_attempts INTEGER,
        pending_message_count INTEGER,
        undelivered_message_count INTEGER,
        PRIMARY KEY (task_id, attempt)
      );
      CREATE TABLE IF NOT EXISTS subagent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        attempt INTEGER,
        cwd TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        activity TEXT NOT NULL,
        output_preview TEXT,
        FOREIGN KEY(task_id) REFERENCES subagent_tasks(id)
      );
      CREATE INDEX IF NOT EXISTS idx_subagent_tasks_created ON subagent_tasks(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_subagent_events_task ON subagent_events(task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_subagent_attempts_task ON subagent_task_attempts(task_id, attempt);
    `);
    ensureColumn(db, 'subagent_tasks', 'display_name', 'TEXT');
    ensureColumn(db, 'subagent_tasks', 'attempt', 'INTEGER');
    ensureColumn(db, 'subagent_tasks', 'nested_session_path', 'TEXT');
    ensureColumn(db, 'subagent_tasks', 'continuation_prompt', 'TEXT');
    ensureColumn(db, 'subagent_tasks', 'system_prompt', 'TEXT');
    ensureColumn(db, 'subagent_tasks', 'error_metadata_json', 'TEXT');
    ensureColumn(db, 'subagent_tasks', 'error_category', 'TEXT');
    ensureColumn(db, 'subagent_tasks', 'pi_retry_attempts', 'INTEGER');
    ensureColumn(db, 'subagent_tasks', 'pending_message_count', 'INTEGER');
    ensureColumn(db, 'subagent_tasks', 'undelivered_message_count', 'INTEGER');
    ensureAttemptColumns(db);
    ensureColumn(db, 'subagent_events', 'attempt', 'INTEGER');
    this.dbs.set(file, db);
    return db;
  }

  upsertTask(cwd: string, task: SubagentTask): void {
    const db = this.db(cwd);
    upsertTaskRecord(db, 'subagent_tasks', cwd, task);
    upsertTaskRecord(db, 'subagent_task_attempts', cwd, { ...task, attempt: task.attempt ?? 1 });
  }

  addEvent(cwd: string, task: SubagentTask, activity: string): void {
    this.db(cwd).prepare(`
      INSERT INTO subagent_events (task_id, attempt, cwd, created_at, status, activity, output_preview)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(task.id, task.attempt ?? 1, cwd, task.last_activity_at ?? new Date().toISOString(), task.status, activity, value(task.output_preview));
  }

  getTask(cwd: string, id: string, options: HistoryReadOptions = {}): SubagentTask | undefined {
    const rows = this.db(cwd).prepare(`
      SELECT * FROM subagent_tasks WHERE cwd = ? AND id = ? LIMIT 1
    `).all(cwd, id);
    return rows.length ? rowToTask(rows[0], options) : undefined;
  }

  listTasks(cwd: string, limit = 100, options: HistoryReadOptions = {}): SubagentTask[] {
    return this.db(cwd).prepare(`
      SELECT * FROM subagent_tasks WHERE cwd = ?
      ORDER BY COALESCE(last_activity_at, started_at, created_at) DESC, created_at DESC, id DESC
      LIMIT ?
    `).all(cwd, limit).map((row) => rowToTask(row, options));
  }

  listSessionTasks(cwd: string, sessionId: string, limit = 100, options: HistoryReadOptions = {}): SubagentTask[] {
    return this.db(cwd).prepare(`
      SELECT * FROM subagent_tasks WHERE cwd = ? AND session_id = ?
      ORDER BY COALESCE(last_activity_at, started_at, created_at) DESC, created_at DESC, id DESC
      LIMIT ?
    `).all(cwd, sessionId, limit).map((row) => rowToTask(row, options));
  }

  listSessionTaskMetadata(cwd: string, sessionId: string, limit = 100): SubagentTask[] {
    return this.db(cwd).prepare(`
      SELECT ${SESSION_TASK_METADATA_COLUMNS}
      FROM subagent_tasks WHERE cwd = ? AND session_id = ?
      ORDER BY COALESCE(last_activity_at, started_at, created_at) DESC, created_at DESC, id DESC
      LIMIT ?
    `).all(cwd, sessionId, limit).map((row) => rowToTask(row, { includeSnapshots: false }));
  }

  listTasksByStatus(cwd: string, statuses: SubagentTask['status'][], options: HistoryReadOptions = {}): SubagentTask[] {
    if (!statuses.length) return [];
    const placeholders = statuses.map(() => '?').join(', ');
    return this.db(cwd).prepare(`
      SELECT * FROM subagent_tasks WHERE cwd = ? AND status IN (${placeholders})
      ORDER BY COALESCE(last_activity_at, started_at, created_at) DESC, created_at DESC, id DESC
    `).all(cwd, ...statuses).map((row) => rowToTask(row, options));
  }

  listTaskAttempts(cwd: string, taskId: string, options: HistoryReadOptions = {}): SubagentTask[] {
    return this.db(cwd).prepare(`
      SELECT
        task_id AS id,
        display_name,
        cwd,
        agent,
        mode,
        status,
        task,
        context,
        created_at,
        attempt,
        session_id,
        nested_session_path,
        started_at,
        ended_at,
        last_activity_at,
        last_activity,
        output_preview,
        prompt,
        continuation_prompt,
        system_prompt,
        transcript,
        usage_input,
        usage_output,
        usage_cache_read,
        usage_cache_write,
        usage_cost,
        usage_context_tokens,
        usage_turns,
        model,
        effort,
        model_source,
        effort_source,
        fallback_used,
        error,
        error_metadata_json,
        error_category,
        result,
        thread_snapshot_json,
        pi_retry_attempts,
        pending_message_count,
        undelivered_message_count
      FROM subagent_task_attempts
      WHERE cwd = ? AND task_id = ?
      ORDER BY attempt ASC
    `).all(cwd, taskId).map((row) => rowToTask(row, options));
  }
}

function rowToTask(row: any, options: HistoryReadOptions = {}): SubagentTask {
  return {
    id: row.id,
    display_name: row.display_name ?? undefined,
    agent: row.agent,
    mode: row.mode,
    status: row.status,
    task: row.task,
    context: row.context ?? undefined,
    created_at: row.created_at,
    attempt: row.attempt ?? 1,
    session_id: row.session_id ?? undefined,
    nested_session_path: row.nested_session_path ?? undefined,
    started_at: row.started_at ?? undefined,
    ended_at: row.ended_at ?? undefined,
    last_activity_at: row.last_activity_at ?? undefined,
    last_activity: row.last_activity ?? undefined,
    output_preview: row.output_preview ?? undefined,
    prompt: row.prompt ?? undefined,
    continuation_prompt: row.continuation_prompt ?? undefined,
    system_prompt: row.system_prompt ?? undefined,
    transcript: row.transcript ?? undefined,
    usage: row.usage_input == null && row.usage_output == null && row.usage_cache_read == null && row.usage_cache_write == null && row.usage_cost == null && row.usage_context_tokens == null && row.usage_turns == null ? undefined : {
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
    model_source: row.model_source ?? undefined,
    effort_source: row.effort_source ?? undefined,
    fallback_used: row.fallback_used === null || row.fallback_used === undefined ? undefined : Boolean(row.fallback_used),
    error: row.error ?? undefined,
    error_metadata: parseErrorMetadata(row.error_metadata_json),
    result: row.result ?? undefined,
    thread_snapshot: options.includeSnapshots === false ? undefined : parseSnapshotJson(row.thread_snapshot_json),
    pi_retry_attempts: row.pi_retry_attempts ?? undefined,
    pending_message_count: row.pending_message_count === null || row.pending_message_count === undefined ? undefined : row.pending_message_count,
    undelivered_message_count: row.undelivered_message_count === null || row.undelivered_message_count === undefined ? undefined : row.undelivered_message_count,
  };
}
