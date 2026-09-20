import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  EvaluationRecord,
  TelemetryQueryOptions,
  TelemetryQueryResult,
} from '../types.ts';
import { sanitizeState } from '../security.ts';

type Db = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
  };
  close?(): void;
};

export function resolveTelemetryHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_TYPESAFE_TELEMETRY_HOME) return path.resolve(env.PI_TYPESAFE_TELEMETRY_HOME);
  const xdg = env.XDG_DATA_HOME;
  return xdg ? path.join(xdg, 'pi', 'typesafe') : path.join(os.homedir(), '.local', 'share', 'pi', 'typesafe');
}

export function resolveTelemetryDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_TYPESAFE_TELEMETRY_DB_PATH) return path.resolve(env.PI_TYPESAFE_TELEMETRY_DB_PATH);
  return path.join(resolveTelemetryHome(env), 'telemetry.sqlite');
}

function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      latency_ms INTEGER,
      model TEXT NOT NULL,
      state_json TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      response_json TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      error TEXT,
      shadow_actual_route TEXT,
      shadow_predicted_route TEXT,
      shadow_agreement INTEGER,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_evaluations_created_at ON evaluations(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evaluations_source ON evaluations(source);
    CREATE INDEX IF NOT EXISTS idx_evaluations_session ON evaluations(session_id);
    CREATE INDEX IF NOT EXISTS idx_evaluations_agreement ON evaluations(shadow_agreement);
  `);

  ensureColumn(db, 'evaluations', 'session_id', 'TEXT');
  ensureColumn(db, 'evaluations', 'latency_ms', 'INTEGER');
  ensureColumn(db, 'evaluations', 'input_tokens', 'INTEGER');
  ensureColumn(db, 'evaluations', 'output_tokens', 'INTEGER');
  ensureColumn(db, 'evaluations', 'error', 'TEXT');
  ensureColumn(db, 'evaluations', 'shadow_actual_route', 'TEXT');
  ensureColumn(db, 'evaluations', 'shadow_predicted_route', 'TEXT');
  ensureColumn(db, 'evaluations', 'shadow_agreement', 'INTEGER');
  ensureColumn(db, 'evaluations', 'metadata_json', 'TEXT');
}

export class TelemetryDb {
  private dbInstance: Db | null = null;
  readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || resolveTelemetryDbPath();
    this.initDb();
  }

  private initDb(): void {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try {
        fs.chmodSync(dir, 0o700);
      } catch {}

      this.dbInstance = new DatabaseSync(this.filePath) as unknown as Db;

      try {
        fs.chmodSync(this.filePath, 0o600);
      } catch {}

      this.dbInstance.exec('PRAGMA busy_timeout = 5000;');
      try {
        this.dbInstance.exec('PRAGMA journal_mode = WAL;');
      } catch {}
      try {
        this.dbInstance.exec('PRAGMA synchronous = NORMAL;');
      } catch {}

      ensureSchema(this.dbInstance);
    } catch (err) {
      console.warn(`[typesafe-telemetry] Failed to initialize SQLite database at ${this.filePath}:`, err);
    }
  }

  recordEvaluation(record: EvaluationRecord): void {
    if (!this.dbInstance) {
      this.initDb();
      if (!this.dbInstance) return;
    }

    try {
      // Ensure state and metadata are sanitized before writing to disk
      let cleanStateJson = record.state_json;
      try {
        const parsed = JSON.parse(record.state_json);
        cleanStateJson = JSON.stringify(sanitizeState(parsed));
      } catch {}

      const stmt = this.dbInstance.prepare(`
        INSERT OR REPLACE INTO evaluations (
          id, session_id, source, created_at, latency_ms, model,
          state_json, questions_json, response_json, input_tokens,
          output_tokens, error, shadow_actual_route, shadow_predicted_route,
          shadow_agreement, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        record.id,
        record.session_id ?? null,
        record.source,
        record.created_at || new Date().toISOString(),
        record.latency_ms ?? null,
        record.model,
        cleanStateJson,
        record.questions_json,
        record.response_json ?? null,
        record.input_tokens ?? null,
        record.output_tokens ?? null,
        record.error ?? null,
        record.shadow_actual_route ?? null,
        record.shadow_predicted_route ?? null,
        record.shadow_agreement !== undefined ? record.shadow_agreement : null,
        record.metadata_json ?? null
      );
    } catch (err) {
      console.warn('[typesafe-telemetry] Failed to record evaluation telemetry:', err);
    }
  }

  queryTelemetry(filters: TelemetryQueryOptions = {}): TelemetryQueryResult {
    if (!this.dbInstance) {
      return { total: 0, records: [], limit: 10, offset: 0, has_more: false };
    }

    const limit = Math.max(1, Math.min(filters.limit ?? 10, 50));
    const offset = Math.max(0, filters.offset ?? 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.session_id) {
      conditions.push('session_id = ?');
      params.push(filters.session_id);
    }

    if (filters.source) {
      conditions.push('source = ?');
      params.push(filters.source);
    }

    if (filters.discrepancies_only) {
      conditions.push('shadow_agreement = 0');
    }

    if (filters.since) {
      conditions.push('created_at >= ?');
      params.push(filters.since);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      const countRow = this.dbInstance
        .prepare(`SELECT COUNT(*) as cnt FROM evaluations ${whereClause}`)
        .get(...params) as { cnt: number } | undefined;
      const total = Number(countRow?.cnt || 0);

      const queryParams = [...params, limit, offset];
      const rows = this.dbInstance
        .prepare(`
          SELECT * FROM evaluations
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `)
        .all(...queryParams) as EvaluationRecord[];

      const has_more = offset + rows.length < total;
      const continuation_offset = has_more ? offset + rows.length : undefined;

      return {
        total,
        records: rows,
        limit,
        offset,
        has_more,
        continuation_offset,
      };
    } catch (err) {
      console.warn('[typesafe-telemetry] Query failed:', err);
      return { total: 0, records: [], limit, offset, has_more: false };
    }
  }

  pruneExpiredTelemetry(maxAgeDays = 90): number {
    if (!this.dbInstance) return 0;
    try {
      const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
      const countRow = this.dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM evaluations WHERE created_at < ?')
        .get(cutoff) as { cnt: number } | undefined;
      const toDelete = Number(countRow?.cnt || 0);

      if (toDelete > 0) {
        this.dbInstance.prepare('DELETE FROM evaluations WHERE created_at < ?').run(cutoff);
      }
      return toDelete;
    } catch (err) {
      console.warn('[typesafe-telemetry] Pruning failed:', err);
      return 0;
    }
  }

  close(): void {
    if (this.dbInstance) {
      try {
        if (typeof this.dbInstance.close === 'function') {
          this.dbInstance.close();
        }
      } catch {}
      this.dbInstance = null;
    }
  }
}
