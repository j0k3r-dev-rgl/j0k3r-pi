export type WorkspaceServiceType = 'node' | 'spring';

export interface WorkspaceServiceDefinition {
  name: string;
  type: WorkspaceServiceType;
  relativePath: string;
  cwd: string;
  command: string;
  envFile: boolean;
  envFilePath: string;
  logPath: string;
}

export interface WorkspacePathSecurityContext {
  workspaceRoot: string;
  workspaceRealRoot: string;
}

export interface WorkspaceServicesConfig extends WorkspacePathSecurityContext {
  exists: boolean;
  configPath: string;
  runtimeDir: string;
  logsDir: string;
  statePath: string;
  lastGoodStatePath: string;
  ownerPath: string;
  quarantineDir: string;
  runnerPath: string;
  services: Record<string, WorkspaceServiceDefinition>;
}

export interface ManagedProcessIdentityV1 {
  pid: number;
  processGroupId: number;
  sessionId: number;
  bootId: string;
  startTimeTicks: string;
  cmdlineSha256: string;
  cwdRelative: string;
  cwdDevice: string;
  cwdInode: string;
  serviceCommandSha256: string;
}

export type RuntimePhase = 'starting' | 'running' | 'stopping' | 'recovery_required';

export interface RuntimeServiceStateV1 {
  phase: RuntimePhase;
  operationId: string;
  identity?: ManagedProcessIdentityV1;
  startedAt?: string;
  updatedAt: string;
}

export interface RuntimeStateV1 {
  schemaVersion: 1;
  generation: number;
  workspaceId: string;
  services: Record<string, RuntimeServiceStateV1>;
}

export type WorkspaceServiceStatus =
  | 'started'
  | 'already_running'
  | 'stopped'
  | 'not_running'
  | 'running'
  | 'identity_mismatch'
  | 'busy'
  | 'cancelled'
  | 'timeout'
  | 'state_recovered'
  | 'recovery_required'
  | 'trust_required'
  | 'failed';

export interface WorkspaceServiceTruncation {
  returned: number;
  total?: number;
  hasMore: boolean;
  continuation?: string;
}

export interface WorkspaceServiceOutcome<T = Record<string, unknown>> {
  ok: boolean;
  status: WorkspaceServiceStatus;
  summary: string;
  nextAction?: string;
  data: T;
  truncation?: WorkspaceServiceTruncation;
}

export interface ServiceStatus {
  name: string;
  type: WorkspaceServiceType;
  path: string;
  command: string;
  env_file: boolean;
  status: 'running' | 'stopped' | 'stale' | 'identity_mismatch' | 'recovery_required';
  pid?: number;
  started_at?: string;
  log_path: string;
}

export interface ServiceListEntry {
  name: string;
  type: WorkspaceServiceType;
  path: string;
  command: string;
  env_file: boolean;
  env_file_present: boolean;
  log_path: string;
}

export interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  details: WorkspaceServiceOutcome;
}
