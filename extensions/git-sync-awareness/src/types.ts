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
  baseBranch?: string;
  aheadBase?: number;
  behindBase?: number;
}

export interface WorkingTreeStatus {
  isClean: boolean;
  modifiedCount: number;
  untrackedCount: number;
  stagedCount: number;
  summaryLines: string[];
}

export interface WorktreeEntry {
  path: string;
  head: string;
  branch?: string;
  isCurrent: boolean;
  isMain: boolean;
  detached?: boolean;
  locked?: boolean | string;
  prunable?: boolean | string;
}

export interface WorktreeDiagnostic {
  isMainWorktree: boolean;
  currentWorktreePath: string;
  mainWorktreePath: string;
  worktrees: WorktreeEntry[];
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
  worktree?: WorktreeDiagnostic;
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
