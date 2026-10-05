import { withDatabase } from '../storage/db.ts';
import { E5Client } from '../client/e5-client.ts';
import type { HealthStatus } from '../client/types.ts';

export interface ActivationDiagnosticsOptions {
  client?: E5Client;
  fallbackNotice?: (message: string) => void;
}

export class ActivationDiagnostics {
  readonly dbPath: string;
  readonly client: E5Client;
  readonly fallbackNotice?: (message: string) => void;

  private abortController = new AbortController();
  private isCancelled = false;

  constructor(
    dbPath: string,
    clientOrOptions?: E5Client | ActivationDiagnosticsOptions,
    options?: ActivationDiagnosticsOptions,
  ) {
    this.dbPath = dbPath;
    if (clientOrOptions && 'baseUrl' in clientOrOptions) {
      this.client = clientOrOptions;
      this.fallbackNotice = options?.fallbackNotice;
    } else {
      const opts = clientOrOptions as ActivationDiagnosticsOptions | undefined;
      this.client = opts?.client ?? new E5Client();
      this.fallbackNotice = opts?.fallbackNotice;
    }
  }

  cancel(): void {
    this.isCancelled = true;
    this.abortController.abort();
  }

  async runDiagnostics(scopeKey: string, _sessionId: string, ctx: any): Promise<void> {
    if (this.isCancelled || this.abortController.signal.aborted) {
      return;
    }

    // Capture notification capability and fallback while context is valid
    const hasUI = ctx?.hasUI !== false;
    const capturedNotify = typeof ctx?.ui?.notify === 'function' ? ctx.ui.notify.bind(ctx.ui) : null;
    const capturedFallback = this.fallbackNotice ?? ((msg: string) => {
      try {
        process.stderr.write(`[memory] ${msg}\n`);
      } catch {}
    });

    let pendingInScope = 0;
    let pendingElsewhere = false;

    // Read pending counts from SQLite in a short transaction
    try {
      withDatabase(this.dbPath, (db) => {
        if (scopeKey === '["global"]') {
          const row = db.prepare(`
            SELECT count(*) as cnt FROM memories
            WHERE deleted_at IS NULL AND indexing_status IN ('pending', 'failed');
          `).get() as { cnt?: number } | undefined;
          pendingInScope = row?.cnt ?? 0;
          pendingElsewhere = false;
        } else {
          const scopeRow = db.prepare(`
            SELECT count(*) as cnt FROM memories
            WHERE scope_key = ? AND deleted_at IS NULL AND indexing_status IN ('pending', 'failed');
          `).get(scopeKey) as { cnt?: number } | undefined;
          pendingInScope = scopeRow?.cnt ?? 0;

          const elsewhereRow = db.prepare(`
            SELECT count(*) as cnt FROM memories
            WHERE scope_key != ? AND deleted_at IS NULL AND indexing_status IN ('pending', 'failed')
            LIMIT 1;
          `).get(scopeKey) as { cnt?: number } | undefined;
          pendingElsewhere = (elsewhereRow?.cnt ?? 0) > 0;
        }
      });
    } catch {
      // If DB read fails, ignore and return
      return;
    }

    if (this.isCancelled || this.abortController.signal.aborted) {
      return;
    }

    // Health probe with owned 3-second deadline
    let health: HealthStatus;
    try {
      health = await this.client.health(this.abortController.signal);
    } catch {
      health = { state: 'unavailable', message: 'Connection failed' };
    }

    if (this.isCancelled || this.abortController.signal.aborted) {
      return;
    }

    // Format concise notice
    let message = '';
    const elsewhereNotice = pendingElsewhere ? ', pending elsewhere' : '';

    if (health.state === 'ready') {
      if (pendingInScope > 0) {
        message = `Memory: ${pendingInScope} pending in scope${elsewhereNotice}. Service ready.`;
      } else if (pendingElsewhere) {
        message = 'Memory: 0 pending in scope (pending elsewhere). Service ready.';
      } else {
        message = 'Memory: 0 pending in scope. Service ready.';
      }
    } else if (health.state === 'not_ready') {
      message = `Memory: E5 service not ready. ${pendingInScope} pending in scope${elsewhereNotice}.`;
    } else if (health.state === 'incompatible') {
      message = `Memory: E5 service incompatible. ${pendingInScope} pending in scope${elsewhereNotice}.`;
    } else {
      message = `Memory: E5 service unavailable. ${pendingInScope} pending in scope${elsewhereNotice}.`;
    }

    // Guard before notifying
    if (this.isCancelled || this.abortController.signal.aborted) {
      return;
    }

    try {
      if (hasUI && capturedNotify) {
        capturedNotify(message);
      } else {
        // Safe bounded noninteractive fallback: e.g. stderr, never stdout corrupting JSON
        capturedFallback(message);
      }
    } catch {
      // Suppress any errors from invalidated UI context
    }
  }

  start(scopeKey: string, sessionId: string, ctx: any): void {
    // Detached, fire-and-forget promise
    this.runDiagnostics(scopeKey, sessionId, ctx).catch(() => {});
  }
}
