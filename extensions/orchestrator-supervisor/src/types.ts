export type CandidateId = string;
// Retained alias: candidate IDs are now any `<provider>/<modelId>` route, where the
// model id itself may contain slashes (for example `cliproxyapi/main/gpt-6.1-sol`).
export type ModelCandidateId = CandidateId;

export type CandidateSource = 'account' | 'registered';
export type QuotaProtocol = 'wham' | 'gemini' | 'none';

export interface ModelCandidate {
  id: CandidateId;
  source: CandidateSource;
  quotaProtocol: QuotaProtocol;
  /** Account routes only: CLIProxyAPI credential prefix. */
  prefix?: string;
  /** Account routes only: verified quota protocol family. */
  family?: 'codex' | 'gemini';
  modelSlug: string;
  provider: string;
  reasoningEffort: 'high';
  /** Known-safe context ceiling; omitted means fall back to the reported window. */
  contextWindowCap?: number;
  /**
   * Public-host-proven effort levels for this concrete model (`supportedModelEfforts`),
   * enriched by the panel host from the actual registry model. Absent or empty means the
   * capability is unknown: the effort picker then offers Default only, never an invented
   * level.
   */
  supportedEfforts?: import('./model-effort.ts').ModelEffort[];
}

export interface RegisteredModel {
  provider: string;
  id: string;
  contextWindow?: number;
}

export interface WhamWindowUsage {
  limit_window_seconds: number;
  used_percent: number;
  reset_at: number;
}

export interface WhamQuotaResult {
  primary_window: WhamWindowUsage;
  secondary_window: WhamWindowUsage;
  allowed: boolean;
  limit_reached: boolean;
  cachedAt: number;
}

export interface GeminiBucketUsage {
  window?: string;
  remainingFraction: number;
  resetTime?: string;
}

export interface GeminiQuotaResult {
  buckets: GeminiBucketUsage[];
  cachedAt: number;
}

export interface CandidateQuotaStatus {
  candidateId: CandidateId;
  isEligible: boolean;
  reason: string;
  whamUsage?: WhamQuotaResult;
  geminiUsage?: GeminiQuotaResult;
  cooldownUntil?: number;
  isUnknown?: boolean;
}

export interface LockPayload {
  pid: number;
  startTimeTicks: number;
  bootId: string;
  cmdline: string;
  sessionId: string;
  flowIdentity: string;
  createdAt: number;
}

export type JournalToolStatus = 'pending' | 'settled' | 'uncertain';

export interface JournalEntry {
  toolCallId: string;
  parentToolCallId?: string;
  sessionId: string;
  turnIndex: number;
  toolName: string;
  argsHash: string;
  argsSummary: string;
  isMutating: boolean;
  status: JournalToolStatus;
  startedAt: number;
  finishedAt?: number;
  isError?: boolean;
  resultHash?: string;
  partialSideEffectSuspected?: boolean;
  operationKind?: 'git_commit' | 'git_push' | 'file_mutation' | 'bash' | 'other';
}

/**
 * A genuine safety stop. It is never a user preference: the supervisor refuses its own
 * automatic and manual rotation while one of these is recorded, and only an explicit
 * human decision (switching the master configuration off and on) clears it.
 */
export type SupervisorSafetyFaultKind = 'credentials' | 'handover' | 'wal';

export interface SupervisorSafetyFault {
  kind: SupervisorSafetyFaultKind;
  /** Short human-readable cause; never a credential, token or response body. */
  message: string;
  at: number;
}

export interface SupervisorState {
  flowIdentity: string;
  sessionId: string;
  activeModel: CandidateId;
  status: 'active' | 'idle' | 'stopped';
  /** Set when a safety fence halted the runtime; absent in normal operation. */
  safetyFault?: SupervisorSafetyFault;
  activeGeneration: number;
  lastCheckpointMemoryId?: number;
  rotationHandoverToken?: string;
  lastInternalAbort?: {
    reason: string;
    generation: number;
    timestamp: number;
  };
  referencedArtifacts?: string[];
  authorizedContinuation?: {
    nextPermittedAction: string;
    authorizedScope: string;
    changeSlug?: string;
    step: string;
  };
  owedProviderTurn?: boolean;
  pendingTaskDeliveries?: string[];
  pendingJobDeliveries?: string[];
  uncertainMutationsCount: number;
  updatedAt: number;
}
