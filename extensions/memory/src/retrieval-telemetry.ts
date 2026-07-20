import type { Db } from './db.js';
import type { ResolvedContext, RetrievalErrorCategory, RetrievalOperation, RetrievalTelemetryEvent, RetrievalTriggerCategory } from './types.js';

function classifyOriginError(error: unknown): RetrievalErrorCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('validation') || message.includes('invalid') || message.includes('required')) return 'validation';
  if (message.includes('sqlite') || message.includes('database') || message.includes('no such table')) return 'db_error';
  if (message && error instanceof Error) return 'internal';
  return 'unknown';
}

function pruneTelemetry(db: Db, retentionDays: number, now: Date): void {
  const cutoff = new Date(now.getTime() - (retentionDays * 86_400_000)).toISOString();
  db.prepare('DELETE FROM retrieval_telemetry WHERE timestamp < ?').run(cutoff);
}

function writeTelemetry(db: Db, event: RetrievalTelemetryEvent): void {
  db.prepare(`INSERT INTO retrieval_telemetry(
    id,timestamp,operation,trigger_category,project_id,session_id,result_memory_ids,result_ranks,result_count,latency_ms,success,error_category
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `telemetry_${event.operation}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    event.timestamp,
    event.operation,
    event.trigger_category,
    event.project_id,
    event.session_id,
    JSON.stringify(event.result_memory_ids),
    JSON.stringify(event.result_ranks),
    event.result_count,
    event.latency_ms,
    event.success ? 1 : 0,
    event.error_category,
  );
}

function telemetryEnabled(context: ResolvedContext): boolean {
  return context.config?.telemetry?.retrieval.enabled === true;
}

export function observeRetrieval<T extends { id: string }[]>(
  db: Db,
  context: ResolvedContext,
  descriptor: {
    operation: RetrievalOperation;
    trigger_category: RetrievalTriggerCategory;
    session_id?: string | null;
    now?: () => Date;
    monotonicNowMs?: () => number;
  },
  operation: () => T,
): T {
  const nowFn = descriptor.now ?? (() => new Date());
  const monotonicNowMs = descriptor.monotonicNowMs ?? (() => Date.now());
  const startedMs = monotonicNowMs();

  let results: T | undefined;
  let originError: unknown;
  try {
    results = operation();
    return results;
  } catch (error) {
    originError = error;
    throw error;
  } finally {
    if (!telemetryEnabled(context)) {
      // no-op when telemetry is disabled
    } else try {
      const now = nowFn();
      const rows = results ?? ([] as unknown as T);
      const event: RetrievalTelemetryEvent = {
        timestamp: now.toISOString(),
        operation: descriptor.operation,
        trigger_category: descriptor.trigger_category,
        project_id: context.project_id,
        session_id: descriptor.session_id ?? null,
        result_memory_ids: rows.map((row) => row.id),
        result_ranks: rows.map((_, index) => index),
        result_count: rows.length,
        latency_ms: Math.max(0, Math.round(monotonicNowMs() - startedMs)),
        success: originError === undefined,
        error_category: originError === undefined ? 'none' : classifyOriginError(originError),
      };
      db.exec('BEGIN');
      try {
        pruneTelemetry(db, context.config?.telemetry?.retrieval.retention_days ?? 30, now);
        writeTelemetry(db, event);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } catch {
      // telemetry is best-effort only
    }
  }
}
