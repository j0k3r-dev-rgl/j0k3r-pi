export type ModelCandidateId =
  | 'cliproxyapi/main/gpt-6.1-sol'
  | 'cliproxyapi/second/gpt-6.1-sol'
  | 'cliproxyapi/j0k3r/gemini-3.8-flash-high';

export interface ModelCandidate {
  id: ModelCandidateId;
  prefix: 'main' | 'second' | 'j0k3r';
  modelSlug: string;
  provider: string;
  reasoningEffort: 'high';
  contextWindowCap: number;
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
  candidateId: ModelCandidateId;
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

export interface SupervisorState {
  flowIdentity: string;
  sessionId: string;
  activeModel: ModelCandidateId;
  status: 'active' | 'paused' | 'cancelled' | 'rotating' | 'idle' | 'stopped';
  userPaused: boolean;
  userCancelled: boolean;
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
  uncertainMutationsCount: number;
  updatedAt: number;
}

export interface ReloadGuardQuery {
  cwd: string;
  defer: (reason: string) => void;
}
