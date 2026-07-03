import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, appendFile, open, readFile, stat, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ensureRuntimeDirs,
  ensureRuntimeGitignore,
  loadServiceEnv,
  loadWorkspaceServicesConfig,
  pathExists,
} from './config.js';
import { readRuntimeState, writeRuntimeState } from './state.js';
import type {
  LogsResult,
  RuntimeServiceState,
  RuntimeState,
  ServiceListEntry,
  ServiceStatus,
  StartServiceResult,
  StopServiceResult,
  WorkspaceServiceDefinition,
  WorkspaceServicesConfig,
} from './types.js';

const DEFAULT_STOP_TIMEOUT_MS = 5000;
const START_HEALTH_DELAY_MS = 80;
const DEFAULT_LOG_LINES = 200;
const MAX_LOG_LINES = 2000;
const DEFAULT_LOG_BYTES = 50 * 1024;
const MAX_LOG_BYTES = 200 * 1024;

export interface ListServicesResult {
  configPath: string;
  runtimeDir: string;
  logsDir: string;
  exists: boolean;
  services: ServiceListEntry[];
}

export interface ServicesStatusResult {
  configPath: string;
  statePath: string;
  services: ServiceStatus[];
}

export interface LogsOptions {
  lines?: number;
  maxBytes?: number;
}

export interface StartOptions {
  truncateLog?: boolean;
}

export interface StopOptions {
  timeoutMs?: number;
}

function requireConfig(config: WorkspaceServicesConfig): void {
  if (!config.exists) {
    throw new Error(`Workspace services config not found at ${config.configPath}. Create .pi/workspace-services.json with explicit services.`);
  }
}

function getService(config: WorkspaceServicesConfig, serviceName: string): WorkspaceServiceDefinition {
  requireConfig(config);
  const service = config.services[serviceName];
  if (!service) {
    const known = Object.keys(config.services).sort().join(', ') || '(none)';
    throw new Error(`Service "${serviceName}" is not configured. Configured services: ${known}.`);
  }
  return service;
}

async function canAccess(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

async function waitUntilStopped(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isPidAlive(pid)) return true;
    await delay(100);
  }
  return !isPidAlive(pid);
}

function killPidOrGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch (groupError: any) {
    if (groupError?.code !== 'ESRCH') {
      try {
        process.kill(pid, signal);
      } catch {
        // ignore fallback failures; caller checks liveness
      }
      return;
    }
  }

  try {
    process.kill(pid, signal);
  } catch {
    // ignore; caller checks liveness
  }
}

async function stopPid(pid: number, timeoutMs: number): Promise<void> {
  if (!isPidAlive(pid)) return;
  killPidOrGroup(pid, 'SIGTERM');
  if (await waitUntilStopped(pid, timeoutMs)) return;
  killPidOrGroup(pid, 'SIGKILL');
  await waitUntilStopped(pid, 1000);
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function writeStartHeader(service: WorkspaceServiceDefinition, action: 'start' | 'restart'): Promise<void> {
  const header = [
    `[workspace-services] ${new Date().toISOString()} ${action} service=${service.name}`,
    `[workspace-services] cwd=${service.cwd}`,
    `[workspace-services] command=${service.command}`,
    `[workspace-services] env_file=${service.envFile ? 'loaded' : 'disabled'}`,
    '',
  ].join('\n');
  await appendFile(service.logPath, header, 'utf8');
}

async function readTail(path: string, maxBytes: number): Promise<{ text: string; bytesRead: number; totalBytes: number; truncated: boolean }> {
  const fileStat = await stat(path);
  const totalBytes = fileStat.size;
  const bytesToRead = Math.min(totalBytes, maxBytes);
  const offset = Math.max(0, totalBytes - bytesToRead);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offset);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (offset > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline >= 0) text = text.slice(firstNewline + 1);
      text = `[log truncated: showing last ${bytesRead} of ${totalBytes} bytes]\n${text}`;
    }
    return { text, bytesRead, totalBytes, truncated: offset > 0 };
  } finally {
    await handle.close();
  }
}

function serviceListEntry(service: WorkspaceServiceDefinition, envFilePresent: boolean): ServiceListEntry {
  return {
    name: service.name,
    type: service.type,
    path: service.relativePath,
    command: service.command,
    env_file: service.envFile,
    env_file_present: envFilePresent,
    log_path: service.logPath,
  };
}

function stateForService(service: WorkspaceServiceDefinition, pid: number, startedAt: string): RuntimeServiceState {
  return {
    name: service.name,
    type: service.type,
    pid,
    command: service.command,
    cwd: service.cwd,
    logPath: service.logPath,
    envFile: service.envFile,
    startedAt,
  };
}

function statusEntry(service: WorkspaceServiceDefinition, state: RuntimeServiceState | undefined): ServiceStatus {
  if (state && isPidAlive(state.pid)) {
    return {
      name: service.name,
      type: service.type,
      path: service.relativePath,
      command: service.command,
      env_file: service.envFile,
      status: 'running',
      pid: state.pid,
      started_at: state.startedAt,
      log_path: service.logPath,
    };
  }

  if (state) {
    return {
      name: service.name,
      type: service.type,
      path: service.relativePath,
      command: service.command,
      env_file: service.envFile,
      status: 'stale',
      pid: state.pid,
      started_at: state.startedAt,
      log_path: service.logPath,
    };
  }

  return {
    name: service.name,
    type: service.type,
    path: service.relativePath,
    command: service.command,
    env_file: service.envFile,
    status: 'stopped',
    log_path: service.logPath,
  };
}

async function cleanupStaleState(config: WorkspaceServicesConfig, state: RuntimeState): Promise<boolean> {
  let changed = false;
  for (const [name, runtime] of Object.entries(state.services)) {
    if (!config.services[name] || !isPidAlive(runtime.pid)) {
      delete state.services[name];
      changed = true;
    }
  }
  if (changed) await writeRuntimeState(config, state);
  return changed;
}

export async function listServices(cwd: string): Promise<ListServicesResult> {
  const config = await loadWorkspaceServicesConfig(cwd);
  const services = await Promise.all(
    Object.values(config.services).map(async (service) => serviceListEntry(service, await canAccess(service.envFilePath))),
  );

  return {
    configPath: config.configPath,
    runtimeDir: config.runtimeDir,
    logsDir: config.logsDir,
    exists: config.exists,
    services: services.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getServicesStatus(cwd: string): Promise<ServicesStatusResult> {
  const config = await loadWorkspaceServicesConfig(cwd);
  requireConfig(config);
  const state = await readRuntimeState(config);
  const entries = Object.values(config.services)
    .map((service) => statusEntry(service, state.services[service.name]))
    .sort((a, b) => a.name.localeCompare(b.name));
  await cleanupStaleState(config, state);
  return { configPath: config.configPath, statePath: config.statePath, services: entries };
}

export async function startService(cwd: string, serviceName: string, options: StartOptions = {}): Promise<StartServiceResult> {
  const config = await loadWorkspaceServicesConfig(cwd);
  const service = getService(config, serviceName);
  await ensureRuntimeDirs(config);
  await ensureRuntimeGitignore(config.workspaceRoot);

  if (!(await pathExists(service.cwd))) {
    throw new Error(`Service "${service.name}" path does not exist: ${service.cwd}`);
  }

  const state = await readRuntimeState(config);
  const existing = state.services[service.name];
  if (existing && isPidAlive(existing.pid)) {
    return {
      service: service.name,
      status: 'already_running',
      pid: existing.pid,
      command: existing.command,
      cwd: existing.cwd,
      logPath: existing.logPath,
      startedAt: existing.startedAt,
    };
  }

  if (existing) delete state.services[service.name];

  const envFileValues = await loadServiceEnv(service);
  const env = { ...process.env, ...envFileValues };

  if (options.truncateLog) {
    await writeFile(service.logPath, '', 'utf8');
  } else {
    await appendFile(service.logPath, '', 'utf8');
  }
  await writeStartHeader(service, options.truncateLog ? 'restart' : 'start');

  const output = await open(service.logPath, 'a');
  let pid: number | undefined;
  try {
    const child = spawn(service.command, {
      cwd: service.cwd,
      env,
      shell: true,
      detached: true,
      stdio: ['ignore', output.fd, output.fd],
    });
    pid = child.pid;
    child.unref();
  } finally {
    await output.close();
  }

  if (!pid) throw new Error(`Failed to start service "${service.name}": process pid was not available.`);

  await delay(START_HEALTH_DELAY_MS);
  if (!isPidAlive(pid)) {
    throw new Error(`Service "${service.name}" exited immediately. Check logs at ${service.logPath}.`);
  }

  const startedAt = new Date().toISOString();
  state.services[service.name] = stateForService(service, pid, startedAt);
  await writeRuntimeState(config, state);

  return {
    service: service.name,
    status: 'started',
    pid,
    command: service.command,
    cwd: service.cwd,
    logPath: service.logPath,
    startedAt,
  };
}

export async function stopService(cwd: string, serviceName: string, options: StopOptions = {}): Promise<StopServiceResult> {
  const config = await loadWorkspaceServicesConfig(cwd);
  const service = getService(config, serviceName);
  const state = await readRuntimeState(config);
  const runtime = state.services[service.name];

  if (!runtime || !isPidAlive(runtime.pid)) {
    if (runtime) {
      delete state.services[service.name];
      await writeRuntimeState(config, state);
    }
    return { service: service.name, status: 'not_running', pid: runtime?.pid };
  }

  await stopPid(runtime.pid, clampInteger(options.timeoutMs, DEFAULT_STOP_TIMEOUT_MS, 500, 30000));
  delete state.services[service.name];
  await writeRuntimeState(config, state);
  return { service: service.name, status: 'stopped', pid: runtime.pid };
}

export async function restartService(cwd: string, serviceName: string, options: StopOptions = {}): Promise<StartServiceResult> {
  await stopService(cwd, serviceName, options);
  return startService(cwd, serviceName, { truncateLog: true });
}

export async function getServiceLogs(cwd: string, serviceName: string, options: LogsOptions = {}): Promise<LogsResult> {
  const config = await loadWorkspaceServicesConfig(cwd);
  const service = getService(config, serviceName);
  const lines = clampInteger(options.lines, DEFAULT_LOG_LINES, 1, MAX_LOG_LINES);
  const maxBytes = clampInteger(options.maxBytes, DEFAULT_LOG_BYTES, 1024, MAX_LOG_BYTES);

  if (!(await pathExists(service.logPath))) {
    return {
      service: service.name,
      logPath: service.logPath,
      text: `No log file found for service "${service.name}". Expected: ${service.logPath}`,
      truncated: false,
      bytesRead: 0,
      totalBytes: 0,
      lines: 0,
    };
  }

  const tail = await readTail(service.logPath, maxBytes);
  const allLines = tail.text.split(/\r?\n/);
  const selectedLines = allLines.length > lines ? allLines.slice(-lines) : allLines;
  const text = selectedLines.join('\n');

  return {
    service: service.name,
    logPath: service.logPath,
    text,
    truncated: tail.truncated || allLines.length > lines,
    bytesRead: tail.bytesRead,
    totalBytes: tail.totalBytes,
    lines: selectedLines.filter((line) => line.length > 0).length,
  };
}

export async function readConfigText(cwd: string): Promise<string | undefined> {
  const config = await loadWorkspaceServicesConfig(cwd);
  if (!config.exists) return undefined;
  return readFile(config.configPath, 'utf8');
}
