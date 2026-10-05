import { DEFAULT_DB_PATH, INVOCATION_BIND_CHANNEL } from './config.ts';
import { withDatabase } from './storage/db.ts';
import { initSchema } from './storage/schema.ts';
import { activateSession, closeSession } from './storage/session-store.ts';
import { resolveScope, encodeScope } from './identity.ts';
import { InvocationLease } from './lease.ts';
import type { InvocationBindRequestV1, InvocationLeaseV1 } from './protocol.ts';

export class MemoryLifecycle {
  readonly dbPath: string;
  private activeNormalSessionId: string | null = null;
  private boundLease: InvocationLeaseV1 | null = null;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
  }

  async handleMessageStart(event: any, ctx: any): Promise<void> {
    if (event?.message?.role !== 'user') {
      return;
    }

    const sessionId = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return;
    }

    if (this.activeNormalSessionId === sessionId) {
      return;
    }

    const trusted = ctx?.isProjectTrusted ? ctx.isProjectTrusted() : true;
    const cwd = ctx?.cwd ?? process.cwd();
    const scope = resolveScope(cwd, { isProjectTrusted: () => trusted });
    const scopeKey = encodeScope(scope);

    withDatabase(this.dbPath, (db) => {
      initSchema(db);
      activateSession(db, sessionId, scopeKey, 'normal');
    });

    this.activeNormalSessionId = sessionId;
  }

  async handleSessionShutdown(reason: string, sessionId?: string): Promise<void> {
    if (reason === 'reload') {
      // Reload does not close parent session or touch DB
      return;
    }

    const targetSessionId = sessionId ?? this.activeNormalSessionId;
    if (targetSessionId && targetSessionId === this.activeNormalSessionId) {
      withDatabase(this.dbPath, (db) => {
        closeSession(db, targetSessionId);
      });
      this.activeNormalSessionId = null;
    }
  }

  async handleActivity(_message: string): Promise<void> {
    // Activity messages ('prompt prepared', 'nested session ready') do not activate memory session
  }

  bindChildInvocation(request: InvocationBindRequestV1): InvocationLeaseV1 {
    if (request.version !== 1) {
      throw new Error(`Unsupported invocation bind version: ${request.version}`);
    }

    if (this.boundLease) {
      throw new Error('Memory runtime already bound to an invocation');
    }

    const lease = new InvocationLease(request.identity, this.dbPath, request.childContext);
    this.boundLease = lease;
    request.accept(lease);
    return lease;
  }

  registerPublicEvents(pi: any): () => void {
    const unsubs: Array<() => void> = [];

    // Message start for normal session activation
    unsubs.push(
      pi.on('message_start', async (event: any, ctx: any) => {
        await this.handleMessageStart(event, ctx);
      })
    );

    // Normal session shutdown
    unsubs.push(
      pi.on('session_shutdown', async (event: any, ctx: any) => {
        const sessionId = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
        await this.handleSessionShutdown(event?.reason ?? 'quit', sessionId);
      })
    );

    // Listen for child invocation bind request on pi.events
    if (pi?.events?.on) {
      const unsubBind = pi.events.on(INVOCATION_BIND_CHANNEL, (request: any) => {
        if (request?.version === 1 && typeof request?.accept === 'function') {
          this.bindChildInvocation(request);
        }
      });
      unsubs.push(unsubBind);
    }

    return () => {
      for (const u of unsubs) {
        try { u(); } catch {}
      }
    };
  }
}
