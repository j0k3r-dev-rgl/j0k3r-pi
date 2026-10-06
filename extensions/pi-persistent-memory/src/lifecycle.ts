import { DEFAULT_DB_PATH, INVOCATION_BIND_CHANNEL } from './config.ts';
import { withDatabase } from './storage/db.ts';
import { initSchema } from './storage/schema.ts';
import { activateSession, closeSession } from './storage/session-store.ts';
import { resolveScope, encodeScope } from './identity.ts';
import { InvocationLease } from './lease.ts';
import { ActivationDiagnostics } from './diagnostics/activation.ts';
import { E5Client } from './client/e5-client.ts';
import type { InvocationBindRequestV1, InvocationLeaseV1 } from './protocol.ts';
import type { Scope } from './types.ts';
import type { OperationContext } from './tools/types.ts';

export interface MemoryLifecycleOptions {
  client?: E5Client;
}

interface NormalGeneration {
  generationId: number;
  sessionId: string;
  scope: Scope;
  scopeKey: string;
  abortController: AbortController;
}

export class MemoryLifecycle {
  readonly dbPath: string;
  readonly client?: E5Client;
  private activeNormalSessionId: string | null = null;
  private boundLease: InvocationLeaseV1 | null = null;
  private activeDiagnostics: ActivationDiagnostics | null = null;
  private normalGeneration: NormalGeneration | null = null;
  private generationCounter = 0;

  constructor(dbPath: string = DEFAULT_DB_PATH, options?: MemoryLifecycleOptions) {
    this.dbPath = dbPath;
    this.client = options?.client;
  }

  async handleMessageStart(event: any, ctx: any): Promise<void> {
    if (event?.message?.role !== 'user') {
      return;
    }

    const sessionId = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return;
    }

    if (this.activeNormalSessionId === sessionId && this.normalGeneration) {
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

    // Abort prior normal generation if any
    if (this.normalGeneration) {
      try {
        this.normalGeneration.abortController.abort(new Error('session_replaced'));
      } catch {}
    }

    this.generationCounter++;
    this.normalGeneration = {
      generationId: this.generationCounter,
      sessionId,
      scope,
      scopeKey,
      abortController: new AbortController(),
    };

    // Detached nonblocking activation diagnostics
    this.activeDiagnostics?.cancel();
    const diag = new ActivationDiagnostics(this.dbPath, this.client);
    this.activeDiagnostics = diag;
    diag.start(scopeKey, sessionId, ctx);
  }

  async handleSessionShutdown(reason: string, sessionId?: string): Promise<void> {
    this.activeDiagnostics?.cancel();
    this.activeDiagnostics = null;

    if (this.normalGeneration) {
      try {
        this.normalGeneration.abortController.abort(new Error(`session_shutdown: ${reason}`));
      } catch {}
      this.normalGeneration = null;
    }

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

    const lease = new InvocationLease(request.identity, this.dbPath, request.childContext, { client: this.client });
    this.boundLease = lease;
    request.accept(lease);
    return lease;
  }

  async performOperation<T>(
    signal: AbortSignal | undefined,
    ctx: any,
    operation: (opCtx: OperationContext) => Promise<T>,
  ): Promise<T> {
    // 1. If bound to child invocation, tools execute via captured lease
    if (this.boundLease) {
      const lease = this.boundLease as InvocationLease;
      return lease.perform(signal, async (capability) => {
        const trusted = lease.childContext?.isProjectTrusted
          ? lease.childContext.isProjectTrusted()
          : true;
        const cwd = lease.childContext?.cwd ?? process.cwd();
        const scope = resolveScope(cwd, { isProjectTrusted: () => trusted });
        const scopeKey = encodeScope(scope);

        const opCtx: OperationContext = {
          sessionId: capability.identity.childSessionId,
          scope,
          scopeKey,
          isChild: true,
          invokingParentSessionId: capability.identity.invokingParentSessionId,
          invocationId: capability.identity.invocationId,
          signal: capability.signal,
          assertActive: capability.assertActive,
          dbPath: this.dbPath,
          client: this.client,
        };
        return operation(opCtx);
      });
    }

    // 2. Normal runtime tools require successful first-message activation
    if (!this.normalGeneration) {
      throw new Error('session_not_active: Memory session is not active (waiting for first user message)');
    }

    const gen = this.normalGeneration;
    const combinedSignal = signal
      ? AbortSignal.any([signal, gen.abortController.signal])
      : gen.abortController.signal;

    if (combinedSignal.aborted) {
      throw new Error('operation_aborted');
    }

    const assertActive = () => {
      if (this.normalGeneration !== gen || combinedSignal.aborted) {
        throw new Error('operation_terminated: Normal session generation is no longer active');
      }
    };

    assertActive();

    const opCtx: OperationContext = {
      sessionId: gen.sessionId,
      scope: gen.scope,
      scopeKey: gen.scopeKey,
      isChild: false,
      signal: combinedSignal,
      assertActive,
      dbPath: this.dbPath,
      client: this.client,
    };

    return operation(opCtx);
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
