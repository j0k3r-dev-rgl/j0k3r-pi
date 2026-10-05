export interface InvocationIdentityV1 {
  version: 1;
  invocationId: string;
  childSessionId: string;
  invokingParentSessionId: string;
  taskId?: string;
  attempt?: number;
}

export interface InvocationOperationV1 {
  readonly identity: Readonly<InvocationIdentityV1>;
  readonly signal: AbortSignal;
  assertActive(): void;
}

export interface InvocationLeaseV1 {
  readonly version: 1;
  readonly identity: Readonly<InvocationIdentityV1>;
  activate(): Promise<void>;
  terminate(outcome: 'completed' | 'cancelled' | 'failed'): Promise<void>;
  perform<T>(
    signal: AbortSignal | undefined,
    operation: (capability: InvocationOperationV1) => Promise<T> | T,
  ): Promise<T>;
}

export interface InvocationBindRequestV1 {
  version: 1;
  identity: InvocationIdentityV1;
  childContext: any;
  accept: (lease: InvocationLeaseV1) => void;
}
