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

export interface WorkspaceServicesConfig {
  exists: boolean;
  workspaceRoot: string;
  configPath: string;
  runtimeDir: string;
  logsDir: string;
  statePath: string;
  services: Record<string, WorkspaceServiceDefinition>;
}

export interface RuntimeServiceState {
  name: string;
  type: WorkspaceServiceType;
  pid: number;
  command: string;
  cwd: string;
  logPath: string;
  envFile: boolean;
  startedAt: string;
}

export interface RuntimeState {
  services: Record<string, RuntimeServiceState>;
}

export type ServiceRuntimeStatus = 'running' | 'stopped' | 'stale';

export interface ServiceStatus {
  name: string;
  type: WorkspaceServiceType;
  path: string;
  command: string;
  env_file: boolean;
  status: ServiceRuntimeStatus;
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

export interface StartServiceResult {
  service: string;
  status: 'started' | 'already_running';
  pid: number;
  command: string;
  cwd: string;
  logPath: string;
  startedAt: string;
}

export interface StopServiceResult {
  service: string;
  status: 'stopped' | 'not_running';
  pid?: number;
}

export interface LogsResult {
  service: string;
  logPath: string;
  text: string;
  truncated: boolean;
  bytesRead: number;
  totalBytes: number;
  lines: number;
}
