export type SyncStatus = 'UP-TO-DATE' | 'BEHIND' | 'AHEAD' | 'DIVERGED' | 'UNTRACKED';

export interface CurrentBranchStatus {
  branch: string;
  upstream?: string;
  syncStatus: SyncStatus;
  ahead: number;
  behind: number;
  incomingCommits: string[];
}

export interface LocalBranchStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  syncStatus: SyncStatus;
}

export interface WorkingTreeStatus {
  isClean: boolean;
  modifiedCount: number;
  untrackedCount: number;
  stagedCount: number;
  summaryLines: string[];
}

export interface GitSyncDiagnostic {
  timestamp: number;
  fetchSuccess: boolean;
  fetchError?: string;
  currentBranch: CurrentBranchStatus;
  otherLocalBranches: LocalBranchStatus[];
  remoteBranches: string[];
  remoteOnlyBranches: string[];
  activeCollaboratorBranches: string[];
  workingTree: WorkingTreeStatus;
  isBranchPolicyCompliant: boolean;
  branchPolicyWarning?: string;
  requiresDecision: boolean;
  formattedReport: string;
}

export type ExecFunction = (
  cmd: string,
  args: string[],
  options?: { cwd?: string; timeout?: number }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
