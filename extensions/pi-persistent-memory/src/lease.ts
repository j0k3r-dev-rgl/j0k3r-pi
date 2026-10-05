import type {
  InvocationIdentityV1,
  InvocationLeaseV1,
  InvocationOperationV1,
} from './protocol.ts';
import { withDatabase } from './storage/db.ts';
import { initSchema } from './storage/schema.ts';
import { activateSession, cleanupTerminalChildSession } from './storage/session-store.ts';
import { resolveScope, encodeScope } from './identity.ts';
import { ActivationDiagnostics } from './diagnostics/activation.ts';
import type { E5Client } from './client/e5-client.ts';

export class InvocationLease implements InvocationLeaseV1 {
  readonly version = 1 as const;
  readonly identity: Readonly<InvocationIdentityV1>;
  readonly dbPath: string;
  readonly childContext: any;
  readonly client?: E5Client;

  private state: 'bound' | 'activating' | 'active' | 'closing' | 'closed' | 'failed' = 'bound';
  private abortController = new AbortController();
  private inFlight = new Set<Promise<any>>();
  private activationPromise?: Promise<void>;
  private terminationPromise?: Promise<void>;
  private activeDiagnostics: ActivationDiagnostics | null = null;

  constructor(
    identity: InvocationIdentityV1,
    dbPath: string,
    childContext: any,
    options?: { client?: E5Client },
  ) {
    this.identity = Object.freeze({ ...identity });
    this.dbPath = dbPath;
    this.childContext = childContext;
    this.client = options?.client;
  }

  async activate(): Promise<void> {
    if (this.state === 'active' || this.state === 'closing' || this.state === 'closed') {
      return;
    }
    if (this.state === 'failed') {
      throw new Error('lease_activation_failed: Lease is in failed state');
    }
    if (this.activationPromise) {
      return this.activationPromise;
    }

    this.state = 'activating';
    this.activationPromise = (async () => {
      try {
        const trusted = this.childContext?.isProjectTrusted
          ? this.childContext.isProjectTrusted()
          : true;

        if (!trusted) {
          this.state = 'failed';
          throw new Error('project_not_trusted: Project folder is not trusted');
        }

        const cwd = this.childContext?.cwd ?? process.cwd();
        const scope = resolveScope(cwd, { isProjectTrusted: () => trusted });
        const scopeKey = encodeScope(scope);

        withDatabase(this.dbPath, (db) => {
          initSchema(db);
          activateSession(db, this.identity.childSessionId, scopeKey, 'child');
        });

        this.state = 'active';

        // Detached nonblocking activation diagnostics
        this.activeDiagnostics = new ActivationDiagnostics(this.dbPath, this.client);
        this.activeDiagnostics.start(scopeKey, this.identity.childSessionId, this.childContext);
      } catch (error) {
        this.state = 'failed';
        throw error;
      }
    })();

    return this.activationPromise;
  }

  async terminate(outcome: 'completed' | 'cancelled' | 'failed'): Promise<void> {
    if (this.terminationPromise) {
      return this.terminationPromise;
    }

    this.activeDiagnostics?.cancel();
    this.activeDiagnostics = null;

    this.state = 'closing';
    this.abortController.abort(new Error(`invocation_terminated: outcome ${outcome}`));

    this.terminationPromise = (async () => {
      // Settle activation if it was started
      if (this.activationPromise) {
        try {
          await this.activationPromise;
        } catch {}
      }

      // Wait for all in-flight operations
      await Promise.allSettled(Array.from(this.inFlight));

      // Clean up child session in DB if it was activated
      try {
        withDatabase(this.dbPath, (db) => {
          cleanupTerminalChildSession(db, this.identity.childSessionId);
        });
      } catch (err) {
        this.state = 'closed';
        throw err;
      }

      this.state = 'closed';
    })();

    return this.terminationPromise;
  }

  async perform<T>(
    signal: AbortSignal | undefined,
    operation: (capability: InvocationOperationV1) => Promise<T> | T,
  ): Promise<T> {
    if (this.state !== 'active') {
      throw new Error(`invocation_terminated: Lease is in state ${this.state}`);
    }

    const combinedSignal = signal
      ? AbortSignal.any([signal, this.abortController.signal])
      : this.abortController.signal;

    if (combinedSignal.aborted) {
      throw new Error('invocation_aborted');
    }

    const capability: InvocationOperationV1 = {
      identity: this.identity,
      signal: combinedSignal,
      assertActive: () => {
        if (this.state !== 'active' || combinedSignal.aborted) {
          throw new Error('invocation_terminated: Operation is no longer active');
        }
      },
    };

    let opPromise: Promise<T>;
    try {
      opPromise = (async () => operation(capability))();
    } catch (err) {
      return Promise.reject(err);
    }

    this.inFlight.add(opPromise);
    try {
      return await opPromise;
    } finally {
      this.inFlight.delete(opPromise);
    }
  }
}
