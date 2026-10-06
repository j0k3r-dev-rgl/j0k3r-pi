import type { Scope } from '../types.ts';
import type { E5Client } from '../client/e5-client.ts';

export interface OperationContext {
  sessionId: string;
  scope: Scope;
  scopeKey: string;
  isChild: boolean;
  invokingParentSessionId?: string | null;
  invocationId?: string | null;
  signal: AbortSignal;
  assertActive: () => void;
  dbPath: string;
  client?: E5Client;
}
