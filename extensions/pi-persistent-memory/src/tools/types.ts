import type { Scope } from '../types.ts';
import type { E5Client } from '../client/e5-client.ts';

export interface OperationContext {
  sessionId: string;
  scope: Scope;
  scopeKey: string;
  isChild: boolean;
  invokingParentSessionId?: string | null;
  invocationId?: string | null;
  /** Working directory of the calling session; DSH sets it, pi leaves it unset. */
  cwd?: string;
  signal: AbortSignal;
  assertActive: () => void;
  dbPath: string;
  client?: E5Client;
}
