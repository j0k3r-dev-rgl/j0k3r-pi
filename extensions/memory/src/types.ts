export type MemoryScope = 'general' | 'project' | 'global';
export type MemoryStatus = 'active' | 'archived' | 'superseded';
export type SyncStatus = 'local' | 'pending' | 'synced' | 'conflict';

export const MEMORY_KINDS = [
  'preference','decision','architecture','architectural_decision','command','constraint','workflow','note','learning','session_summary','prompt','bug','todo','progress','api','dependency','project_profile','commit_record','changelog_entry','release_record','discovery_finding'
] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];

export type OriginType = 'explicit_user' | 'inferred_by_agent' | 'confirmed_by_user' | 'observed_from_code' | 'session_summary';

export interface ProjectCloudConfig {
  enabled: boolean;
  organization_id?: string | null;
  actor_id?: string | null;
  remote_project_id?: string | null;
  url_env: string;
  token_env: string;
}

export type MemoryImportMode = 'merge' | 'dry_run';
export type MemoryImportConflictPolicy = 'keep_local' | 'keep_imported' | 'mark_conflict';
export type MemoryExportMode = 'mirror' | 'merge';

export interface ProjectSessionEndConfig {
  semantic: boolean;
}

export interface ProjectImportConfig {
  mode?: MemoryImportMode;
  on_conflict?: MemoryImportConflictPolicy;
}

export interface ProjectBackupsConfig {
  path?: string;
  include_sessions: boolean;
  mode: MemoryExportMode;
}

export interface ProjectGitSyncConfig {
  cloud: boolean;
  export: boolean;
  import: boolean;
}

export interface ProjectGitConfig {
  enabled: boolean;
  sync: ProjectGitSyncConfig;
}

export interface ProjectRetrievalTelemetryConfig {
  enabled: boolean;
  retention_days: number;
}

export interface ProjectTelemetryConfig {
  retrieval: ProjectRetrievalTelemetryConfig;
}

export interface ProjectMemoryConfig {
  enabled: boolean;
  project_name?: string;
  aliases?: string[];
  default_scope?: MemoryScope;
  debug: boolean;
  session_end: ProjectSessionEndConfig;
  import: ProjectImportConfig;
  backups: ProjectBackupsConfig;
  cloud: ProjectCloudConfig;
  git: ProjectGitConfig;
  telemetry: ProjectTelemetryConfig;
  warnings: string[];
  path?: string;
}

export interface ResolvedContext {
  scope: MemoryScope;
  project_id: string | null;
  project_name: string | null;
  source: string;
  cwd: string;
  git_root?: string;
  config?: ProjectMemoryConfig;
  warnings: string[];
}

export interface AddMemoryInput {
  scope?: MemoryScope;
  kind: MemoryKind;
  title?: string;
  summary?: string;
  content: string;
  tags?: string[];
  origin_type?: OriginType;
  confidence?: number;
  importance?: number;
  metadata_json?: Record<string, unknown>;
}

export interface MemoryRecord {
  id: string;
  user_id: string;
  device_id: string | null;
  scope: MemoryScope;
  project_id: string | null;
  project_name: string | null;
  kind: MemoryKind;
  title: string | null;
  summary: string | null;
  content: string;
  tags: string | null;
  source: string;
  origin_type: string | null;
  confidence: number;
  importance: number;
  status: MemoryStatus;
  version: number;
  sync_status: SyncStatus;
  cloud_sync_id: string | null;
  cloud_synced_at: string | null;
  cloud_revision: string | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  access_count: number;
  metadata_json: string | null;
}

export type MemoryLinkRelation = 'supports' | 'supersedes' | 'contradicts' | 'derived_from' | 'related_to' | 'implements';

export interface MemoryLinkInput {
  from_memory_id: string;
  to_memory_id: string;
  relation_type: MemoryLinkRelation;
  metadata_json?: Record<string, unknown>;
}

export interface MemoryLinkRecord {
  id: string;
  from_memory_id: string;
  to_memory_id: string;
  relation_type: MemoryLinkRelation;
  created_at: string;
  metadata_json: Record<string, unknown>;
}

export type RetrievalOperation = 'search' | 'startup' | 'recall';
export type RetrievalTriggerCategory = 'tool_call' | 'lifecycle' | 'command' | 'evaluation' | 'unknown';
export type RetrievalErrorCategory = 'none' | 'db_error' | 'validation' | 'timeout' | 'internal' | 'unknown';

export interface RetrievalTelemetryEvent {
  timestamp: string;
  operation: RetrievalOperation;
  trigger_category: RetrievalTriggerCategory;
  project_id: string | null;
  session_id: string | null;
  result_memory_ids: string[];
  result_ranks: number[];
  result_count: number;
  latency_ms: number | null;
  success: boolean;
  error_category: RetrievalErrorCategory;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}
