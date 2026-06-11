export type MemoryScope = 'general' | 'project' | 'global';
export type MemoryStatus = 'active' | 'archived' | 'superseded';
export type SyncStatus = 'local' | 'pending' | 'synced' | 'conflict';

export const MEMORY_KINDS = [
  'preference','decision','architecture','architectural_decision','command','constraint','workflow','note','learning','session_summary','prompt','bug','todo','progress','api','dependency','project_profile'
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

export interface ProjectSessionEndConfig {
  semantic: boolean;
}

export interface ProjectImportConfig {
  mode?: MemoryImportMode;
  on_conflict?: MemoryImportConflictPolicy;
}

export interface ProjectBackupsConfig {
  path?: string;
  include_prompts: boolean;
}

export interface ProjectMemoryConfig {
  project_name?: string;
  aliases?: string[];
  default_scope?: MemoryScope;
  session_end: ProjectSessionEndConfig;
  import: ProjectImportConfig;
  backups: ProjectBackupsConfig;
  cloud: ProjectCloudConfig;
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

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}
