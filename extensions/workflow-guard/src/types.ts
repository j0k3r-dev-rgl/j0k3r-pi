export type WorkflowKind = 'mini-sdd' | 'formal-sdd' | 'unknown' | 'conflict';
export type WorkflowStatus = 'READY' | 'BLOCKED' | 'FAILED' | 'STALE' | 'CONFLICT' | 'UNKNOWN';
export type Freshness = 'CURRENT' | 'STALE' | 'CONFLICT' | 'UNVERIFIABLE' | 'UNKNOWN';

export interface ArtifactState {
  exists: boolean;
  status: WorkflowStatus;
  blockers: string[];
  warnings: string[];
  sha256?: string;
  ids: string[];
  updated_at?: string;
  verification_result?: string;
}

export interface ExecutionScopeState {
  authority_artifact: string;
  root: string;
  allowed_paths: string[];
  writable_paths: string[];
  allowed_bash: string[];
  tmp_always_allowed: true;
  status: 'READY' | 'BLOCKED';
  blockers: string[];
  warnings: string[];
}

export interface ChangeWorkflowState {
  schema_version: 1;
  kind: 'change-workflow-state';
  slug: string;
  location: 'active';
  workflow: WorkflowKind;
  phase: string;
  status: WorkflowStatus;
  freshness: Freshness;
  artifacts: Record<string, ArtifactState>;
  execution_scope?: ExecutionScopeState;
  next_allowed: string[];
  blockers: string[];
  warnings: string[];
  derived_from: { source: 'markdown-artifacts'; generated_at: string };
}

export interface WorkflowIndex {
  schema_version: 1;
  kind: 'workflow-index';
  generated_at: string;
  active: Record<string, Pick<ChangeWorkflowState, 'workflow' | 'phase' | 'status' | 'freshness'> & { path: string }>;
  warnings: string[];
}

export interface SyncResult {
  states: ChangeWorkflowState[];
  index: WorkflowIndex;
  regenerated_files: string[];
  warnings: string[];
}
