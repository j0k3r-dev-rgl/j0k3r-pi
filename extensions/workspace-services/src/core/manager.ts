import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFile, open, readFile, writeFile } from 'node:fs/promises';
import type { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureRuntimeDirs, ensureRuntimeGitignore, loadServiceEnv, loadWorkspaceServicesConfig } from '../config.js';
import {
  getComposeServiceLogsDetailed,
  getComposeServicesStatus,
  restartComposeService,
  startComposeService,
  stopComposeService,
} from './docker-compose.js';
import { boundDiagnosticText, pathExists, redactStructured, redactText, sliceUtf8BufferTail } from '../security.js';
import type {
  ManagedProcessIdentityV1,
  RuntimeServiceStateV1,
  ServiceListEntry,
  ServiceStatus,
  WorkspaceServiceDefinition,
  WorkspaceServiceOutcome,
  WorkspaceServicesConfig,
} from '../types.js';
import { commitRuntimeState, initializeLastGoodState, openRuntimeState } from './state.js';
import { confirmGroupAbsent, captureManagedIdentity, processStillRunning, validateManagedIdentity } from './process-identity.js';
import { withLifecycleTransaction } from './transaction.js';

const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const START_HEALTH_DELAY_MS = 120;
const DEFAULT_LOG_LINES = 100;
const MAX_LOG_LINES = 2000;
const DEFAULT_LOG_BYTES = 50 * 1024;
const MAX_LOG_BYTES = 200 * 1024;
const DEFAULT_TRANSACTION_DEADLINE_MS = 10_000;
const MAX_RUNNER_PAYLOAD_BYTES = 256 * 1024;
const RUNNER_PAYLOAD_WRITE_TIMEOUT_MS = 5_000;

export interface ListServicesResult {
  configPath: string;
  runtimeDir: string;
  logsDir: string;
  exists: boolean;
  jsonExists: boolean;
  composeFile?: string;
  partial?: boolean;
  warnings?: string[];
  nextAction?: string;
  services: ServiceListEntry[];
}

export interface ServicesStatusResult {
  configPath: string;
  runtimeDir: string;
  logsDir: string;
  statePath: string;
  exists: boolean;
  jsonExists: boolean;
  composeFile?: string;
  partial?: boolean;
  warnings?: string[];
  nextAction?: string;
  services: ServiceStatus[];
}

export interface LogsOptions {
  lines?: number;
  maxBytes?: number;
  offset?: number;
  until?: number;
}

export interface StartOptions {
  truncateLog?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface StopOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function requireConfig(config: WorkspaceServicesConfig): void {
  if (!config.exists) throw new Error(`Workspace services config not found at ${config.configPath}. Create .pi/workspace-services.json or provide a Docker Compose file.`);
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

function stateEntry(phase: RuntimeServiceStateV1['phase'], operationId: string, identity?: ManagedProcessIdentityV1): RuntimeServiceStateV1 {
  return { phase, operationId, identity, startedAt: phase === 'running' ? new Date().toISOString() : undefined, updatedAt: new Date().toISOString() };
}

async function writeLogHeader(service: WorkspaceServiceDefinition, action: 'start' | 'restart'): Promise<void> {
  await appendFile(service.logPath, [
    `[workspace-services] ${new Date().toISOString()} ${action} service=${service.name}`,
    `[workspace-services] cwd=${service.cwd}`,
    `[workspace-services] command=${service.command}`,
    `[workspace-services] env_file=${service.envFile ? 'loaded' : 'disabled'}`,
    '',
  ].join('\n'), 'utf8');
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

function toServiceStatus(service: WorkspaceServiceDefinition, runtime?: RuntimeServiceStateV1): ServiceStatus {
  if (!runtime) {
    return { name: service.name, type: service.type, path: service.relativePath, command: service.command, env_file: service.envFile, status: 'stopped', log_path: service.logPath };
  }
  if (runtime.phase === 'recovery_required') {
    return { name: service.name, type: service.type, path: service.relativePath, command: service.command, env_file: service.envFile, status: 'recovery_required', pid: runtime.identity?.pid, started_at: runtime.startedAt, log_path: service.logPath };
  }
  if (runtime.identity?.pid) {
    return { name: service.name, type: service.type, path: service.relativePath, command: service.command, env_file: service.envFile, status: 'running', pid: runtime.identity.pid, started_at: runtime.startedAt, log_path: service.logPath };
  }
  return { name: service.name, type: service.type, path: service.relativePath, command: service.command, env_file: service.envFile, status: 'stale', started_at: runtime.startedAt, log_path: service.logPath };
}

function staleOrMismatchStatus(service: WorkspaceServiceDefinition, runtime: RuntimeServiceStateV1, reason: string): ServiceStatus {
  const stale = reason.includes('ENOENT') || reason.includes('no such file') || reason.includes('boot id');
  return { name: service.name, type: service.type, path: service.relativePath, command: service.command, env_file: service.envFile, status: stale ? 'stale' : 'identity_mismatch', pid: runtime.identity?.pid, started_at: runtime.startedAt, log_path: service.logPath };
}

async function readTail(path: string, maxBytes: number): Promise<{ text: string; bytesRead: number; totalBytes: number; truncated: boolean }> {
  const handle = await open(path, 'r');
  try {
    const fileStat = await handle.stat();
    const totalBytes = fileStat.size;
    const bytesToRead = Math.min(totalBytes, maxBytes);
    const offset = Math.max(0, totalBytes - bytesToRead);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offset);
    let start = 0;
    if (offset > 0) {
      while (start < bytesRead && (buffer[start]! & 0b1100_0000) === 0b1000_0000) {
        start += 1;
      }
    }
    let text = buffer.subarray(start, bytesRead).toString('utf8');
    if (offset > 0) {
      const idx = text.indexOf('\n');
      if (idx >= 0) text = text.slice(idx + 1);
    }
    return { text, bytesRead, totalBytes, truncated: offset > 0 };
  } finally {
    await handle.close();
  }
}

function boundLogTail(lines: string[], maxBytes: number): { lines: string[]; text: string; byteTruncated: boolean } {
  if (lines.length === 0) return { lines: [], text: '', byteTruncated: false };
  const joined = lines.join('\n');
  if (Buffer.byteLength(joined, 'utf8') <= maxBytes) {
    return { lines, text: joined, byteTruncated: false };
  }
  const kept = [...lines];
  while (kept.length > 1 && Buffer.byteLength(kept.join('\n'), 'utf8') > maxBytes) {
    kept.shift();
  }
  if (kept.length === 1 && Buffer.byteLength(kept[0]!, 'utf8') > maxBytes) {
    const sliced = sliceUtf8BufferTail(Buffer.from(kept[0]!, 'utf8'), maxBytes).toString('utf8');
    const resultLines = sliced.length > 0 ? [sliced] : [];
    return { lines: resultLines, text: sliced, byteTruncated: true };
  }
  return { lines: kept, text: kept.join('\n'), byteTruncated: true };
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && (error.message === 'Operation aborted' || error.name === 'AbortError');
}

async function knownSecretsBestEffort(service: WorkspaceServiceDefinition, config: WorkspaceServicesConfig): Promise<string[]> {
  if (!service.envFile) return [];
  try {
    const envValues = await loadServiceEnv(service, config.workspaceRealRoot);
    return Object.values(envValues).filter((value) => value.length > 0);
  } catch {
    return [];
  }
}

async function knownStackSecretsBestEffort(config: WorkspaceServicesConfig): Promise<string[]> {
  const secretSet = new Set<string>();
  for (const service of Object.values(config.services)) {
    if (!service.envFile) continue;
    const values = await knownSecretsBestEffort(service, config);
    for (const value of values) secretSet.add(value);
  }
  return [...secretSet];
}

function writeRunnerPayload(
  child: import('node:child_process').ChildProcess,
  target: Writable,
  payload: string,
  signal?: AbortSignal,
  timeoutMs = RUNNER_PAYLOAD_WRITE_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (target.destroyed || !target.writable || ('writableEnded' in target && (target as any).writableEnded)) {
      reject(new Error('Runner handoff pipe is closed or unavailable'));
      return;
    }
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      target.off('error', onError);
      target.off('finish', onFinish);
      target.off('close', onClose);
      child.off('error', onChildError);
      child.off('exit', onChildExit);
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    const onError = (error: Error) => finish(error);
    const onFinish = () => finish();
    const onClose = () => {
      finish(new Error('Runner handoff pipe closed before payload transfer completed'));
    };
    const onChildError = (error: Error) => finish(error);
    const onChildExit = (code: number | null, sig: string | null) => {
      finish(new Error(`Runner process exited prematurely with code ${code ?? 'null'} signal ${sig ?? 'null'}`));
    };
    const onAbort = () => {
      target.destroy(new Error('Operation aborted'));
      finish(new Error('Operation aborted'));
    };

    timer = setTimeout(() => {
      target.destroy(new Error('Runner payload write timed out'));
      finish(new Error('Runner payload write timed out'));
    }, timeoutMs);

    target.once('error', onError);
    target.once('finish', onFinish);
    target.once('close', onClose);
    child.once('error', onChildError);
    child.once('exit', onChildExit);
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      target.end(payload);
    } catch (err: any) {
      finish(err);
    }
  });
}

async function spawnRunner(config: WorkspaceServicesConfig, service: WorkspaceServiceDefinition, truncateLog: boolean, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) throw new Error('Operation aborted');
  const envFileValues = await loadServiceEnv(service, config.workspaceRealRoot);
  const secrets = Object.values(envFileValues).filter((value) => value.length > 0);
  if (signal?.aborted) throw new Error('Operation aborted');
  if (truncateLog) await writeFile(service.logPath, '', 'utf8');
  else await appendFile(service.logPath, '', 'utf8');
  await writeLogHeader(service, truncateLog ? 'restart' : 'start');

  const payload = JSON.stringify({ cwd: service.cwd, command: service.command, logPath: service.logPath, env: envFileValues, secrets });
  if (Buffer.byteLength(payload, 'utf8') > MAX_RUNNER_PAYLOAD_BYTES) {
    throw new Error(`Failed to start service "${service.name}": runner payload exceeded ${MAX_RUNNER_PAYLOAD_BYTES} bytes.`);
  }
  const child = spawn(process.execPath, [config.runnerPath], {
    cwd: config.workspaceRoot,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    env: process.env,
  });
  child.unref();
  if (!child.pid) throw new Error(`Failed to start service "${service.name}": process pid was not available.`);
  const handoff = child.stdio[3];
  if (!handoff) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { process.kill(child.pid, 'SIGKILL'); } catch { /* ignore */ } }
    throw new Error(`Failed to start service "${service.name}": runner handoff pipe was unavailable.`);
  }
  handoff.on('error', () => undefined);
  try {
    await writeRunnerPayload(child, handoff as Writable, payload, signal);
    await delay(START_HEALTH_DELAY_MS * 2);
  } catch (error) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { process.kill(child.pid, 'SIGKILL'); } catch { /* ignore */ } }
    throw error;
  }
  if (!(await hostProcessAdapter.processStillRunning(child.pid))) throw new Error(`Service "${service.name}" exited immediately. Check logs at ${service.logPath}.`);
  return child.pid;
}

export const hostProcessAdapter = {
  spawnRunner,
  captureManagedIdentity,
  validateManagedIdentity,
  confirmGroupAbsent,
  processStillRunning,
  kill: (pid: number, sig: NodeJS.Signals) => process.kill(pid, sig),
};

async function stopValidatedIdentity(identity: ManagedProcessIdentityV1, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  try {
    hostProcessAdapter.kill(-identity.processGroupId, 'SIGTERM');
  } catch {
    try {
      hostProcessAdapter.kill(identity.pid, 'SIGTERM');
    } catch {
      return true;
    }
  }
  if (await hostProcessAdapter.confirmGroupAbsent(identity, timeoutMs, signal)) return true;
  try {
    hostProcessAdapter.kill(-identity.processGroupId, 'SIGKILL');
  } catch {
    try {
      hostProcessAdapter.kill(identity.pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
  return hostProcessAdapter.confirmGroupAbsent(identity, 1000, signal);
}

export async function listServices(cwd: string, signal?: AbortSignal): Promise<ListServicesResult> {
  const config = await loadWorkspaceServicesConfig(cwd, { signal });
  const services = await Promise.all(
    Object.values(config.services).map(async (service) => serviceListEntry(service, await pathExists(service.envFilePath))),
  );
  const warnings = config.composeDiscoveryError ? [config.composeDiscoveryError] : undefined;
  const partial = Boolean(config.composeDiscoveryError);
  return {
    configPath: config.configPath,
    runtimeDir: config.runtimeDir,
    logsDir: config.logsDir,
    exists: config.exists,
    jsonExists: Boolean(config.jsonExists),
    ...(config.composeFile ? { composeFile: config.composeFile } : {}),
    ...(partial ? {
      partial: true,
      warnings,
      nextAction: 'Ensure Docker daemon is running and the Compose configuration is valid, then retry.',
    } : {}),
    services: services.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function mapComposeStatus(
  service: WorkspaceServiceDefinition,
  matched: Awaited<ReturnType<typeof getComposeServicesStatus>>[number] | undefined,
  observationFailed: boolean,
): ServiceStatus {
  if (observationFailed) {
    return {
      name: service.name,
      type: service.type,
      path: service.relativePath,
      command: service.command,
      env_file: service.envFile,
      status: 'unknown',
      log_path: service.logPath,
    };
  }
  if (!matched) {
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
  const normalized = matched.state === 'running'
    ? 'running'
    : matched.state === 'exited' || matched.state === 'dead'
      ? 'stopped'
      : 'unknown';
  return {
    name: service.name,
    type: service.type,
    path: service.relativePath,
    command: service.command,
    env_file: service.envFile,
    status: normalized,
    compose_state: matched.state || 'unknown',
    container_id: matched.id,
    health: matched.health,
    exit_code: matched.exitCode,
    ports: matched.ports,
    log_path: service.logPath,
  };
}

export async function getServicesStatus(cwd: string, signal?: AbortSignal): Promise<ServicesStatusResult> {
  const config = await loadWorkspaceServicesConfig(cwd, { signal });
  if (!config.exists) {
    return {
      configPath: config.configPath,
      runtimeDir: config.runtimeDir,
      logsDir: config.logsDir,
      statePath: config.statePath,
      exists: false,
      jsonExists: false,
      services: [],
    };
  }

  const warnings: string[] = [];
  let partial = false;
  if (config.composeDiscoveryError) {
    partial = true;
    warnings.push(config.composeDiscoveryError);
  }

  const composeServices = Object.values(config.services).filter((s) => s.type === 'compose');
  const hostServices = Object.values(config.services).filter((s) => s.type !== 'compose');

  const composeStatuses: ServiceStatus[] = [];
  if (composeServices.length > 0) {
    const composeFiles = [...new Set(composeServices.map((s) => s.composeFile).filter(Boolean))];
    if (composeFiles.length === 0) composeFiles.push(undefined as any);
    for (const compFile of composeFiles) {
      let containers: Awaited<ReturnType<typeof getComposeServicesStatus>> = [];
      let observationFailed = false;
      try {
        containers = await getComposeServicesStatus(config.workspaceRoot, compFile, undefined, signal);
      } catch (error) {
        if (isAbortError(error, signal)) throw error;
        observationFailed = true;
        partial = true;
        const msg = boundDiagnosticText(error instanceof Error ? error.message : String(error));
        if (!warnings.includes(msg)) warnings.push(msg);
      }
      const containerMap = new Map<string, typeof containers[0]>();
      for (const c of containers) {
        containerMap.set(c.service, c);
        containerMap.set(c.name, c);
      }
      for (const service of composeServices.filter((s) => s.composeFile === compFile || (!s.composeFile && !compFile))) {
        const matched = containerMap.get(service.name);
        composeStatuses.push(mapComposeStatus(service, matched, observationFailed));
      }
    }
  }

  const partialFields = partial ? {
    partial: true,
    warnings,
    nextAction: 'Ensure Docker daemon is running and the Compose configuration is valid, then retry.',
  } : {};

  if (hostServices.length === 0) {
    return {
      configPath: config.configPath,
      runtimeDir: config.runtimeDir,
      logsDir: config.logsDir,
      statePath: config.statePath,
      exists: true,
      jsonExists: Boolean(config.jsonExists),
      ...(config.composeFile ? { composeFile: config.composeFile } : {}),
      ...partialFields,
      services: composeStatuses.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  return withLifecycleTransaction(config.statePath, { signal, deadlineMs: DEFAULT_TRANSACTION_DEADLINE_MS, ownerPath: config.ownerPath }, async () => {
    await initializeLastGoodState(config);
    const opened = await openRuntimeState(config);
    const next = { ...opened.state, services: { ...opened.state.services } };
    const statuses: ServiceStatus[] = [];
    let changed = opened.recovered;
    for (const service of hostServices.sort((a, b) => a.name.localeCompare(b.name))) {
      const runtime = next.services[service.name];
      if (!runtime?.identity) {
        statuses.push(toServiceStatus(service, runtime));
        continue;
      }
      const validation = await hostProcessAdapter.validateManagedIdentity(config, runtime.identity, service.command);
      if (!validation.ok) {
        delete next.services[service.name];
        statuses.push(staleOrMismatchStatus(service, runtime, validation.reason));
        changed = true;
      } else {
        next.services[service.name] = { ...runtime, identity: validation.identity, updatedAt: new Date().toISOString() };
        statuses.push(toServiceStatus(service, next.services[service.name]));
      }
    }
    if (changed) await commitRuntimeState(config, opened.state, next);
    const allStatuses = [...statuses, ...composeStatuses].sort((a, b) => a.name.localeCompare(b.name));
    return {
      configPath: config.configPath,
      runtimeDir: config.runtimeDir,
      logsDir: config.logsDir,
      statePath: config.statePath,
      exists: true,
      jsonExists: Boolean(config.jsonExists),
      ...(config.composeFile ? { composeFile: config.composeFile } : {}),
      ...partialFields,
      services: allStatuses,
    };
  });
}

export async function startService(cwd: string, serviceName: string, options: StartOptions = {}): Promise<WorkspaceServiceOutcome> {
  if (options.signal?.aborted) {
    return {
      ok: false,
      status: 'cancelled',
      summary: `${serviceName} start was cancelled before completion.`,
      nextAction: 'Retry the start request when ready.',
      data: { service: serviceName },
    };
  }
  const config = await loadWorkspaceServicesConfig(cwd, { signal: options.signal }).catch((error) => {
    if (isAbortError(error, options.signal)) return null;
    throw error;
  });
  if (!config) {
    return {
      ok: false,
      status: 'cancelled',
      summary: `${serviceName} start was cancelled before completion.`,
      nextAction: 'Retry the start request when ready.',
      data: { service: serviceName },
    };
  }

  if (serviceName === 'all' || serviceName === 'compose') {
    const composeFile = config.composeFile;
    if (!composeFile) throw new Error('No Docker Compose file found. Set compose_file in .pi/workspace-services.json to a project-relative file path, or place a standard Compose file in the workspace root.');
    const secrets = await knownStackSecretsBestEffort(config);
    return redactStructured(await startComposeService(config.workspaceRoot, 'all', {
      composeFile,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      secrets,
    }), secrets);
  }

  const service = getService(config, serviceName);
  if (service.type === 'compose') {
    const secrets = await knownSecretsBestEffort(service, config);
    return redactStructured(await startComposeService(config.workspaceRoot, service.name, {
      composeFile: service.composeFile,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      secrets,
    }), secrets);
  }

  const timeoutMs = clampInteger(options.timeoutMs, DEFAULT_START_TIMEOUT_MS, 100, 300_000);
  await ensureRuntimeDirs(config);
  await ensureRuntimeGitignore(config.workspaceRoot);
  if (!(await pathExists(service.cwd))) throw new Error(`Service "${service.name}" path does not exist: ${service.cwd}`);

  const timeoutController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort(new Error(`Service "${service.name}" start timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  const onExternalAbort = () => {
    timeoutController.abort(options.signal?.reason ?? new Error('Operation aborted'));
  };

  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      timeoutController.abort(options.signal.reason ?? new Error('Operation aborted'));
    } else {
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  let spawnedPid: number | undefined;

  try {
    return await withLifecycleTransaction(
      config.statePath,
      {
        signal: timeoutController.signal,
        deadlineMs: Math.min(timeoutMs, DEFAULT_TRANSACTION_DEADLINE_MS),
        ownerPath: config.ownerPath,
      },
      async () => {
        await initializeLastGoodState(config);
        const opened = await openRuntimeState(config);
        const next = { ...opened.state, services: { ...opened.state.services } };
        const runtime = next.services[service.name];
        if (runtime?.identity) {
          const validation = await hostProcessAdapter.validateManagedIdentity(config, runtime.identity, service.command);
          if (validation.ok) {
            return {
              ok: true,
              status: 'already_running',
              summary: `${service.name} is already running.`,
              data: { service: service.name, pid: validation.identity.pid, logPath: service.logPath, startedAt: runtime.startedAt },
            };
          }
          delete next.services[service.name];
        }

        const operationId = randomUUID();
        next.services[service.name] = stateEntry('starting', operationId);
        const starting = await commitRuntimeState(config, opened.state, next);

        let pid: number;
        try {
          pid = await hostProcessAdapter.spawnRunner(config, service, options.truncateLog ?? false, timeoutController.signal);
          spawnedPid = pid;
        } catch (spawnError) {
          delete starting.services[service.name];
          await commitRuntimeState(config, starting, starting).catch(() => undefined);
          throw spawnError;
        }

        let identity: ManagedProcessIdentityV1;
        try {
          identity = await hostProcessAdapter.captureManagedIdentity(config, pid, service.command);
        } catch (captureError) {
          try { hostProcessAdapter.kill(-pid, 'SIGKILL'); } catch { try { hostProcessAdapter.kill(pid, 'SIGKILL'); } catch { /* ignore */ } }
          delete starting.services[service.name];
          await commitRuntimeState(config, starting, starting).catch(() => undefined);
          throw captureError;
        }

        starting.services[service.name] = { phase: 'running', operationId, identity, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        await commitRuntimeState(config, starting, starting);

        if (timedOut) {
          try { hostProcessAdapter.kill(-pid, 'SIGKILL'); } catch { try { hostProcessAdapter.kill(pid, 'SIGKILL'); } catch { /* ignore */ } }
          delete starting.services[service.name];
          await commitRuntimeState(config, starting, starting).catch(() => undefined);
          return {
            ok: false,
            status: 'timeout',
            summary: `${service.name} start timed out after ${timeoutMs}ms.`,
            nextAction: `Check logs at ${service.logPath} or verify service configuration.`,
            data: { service: service.name, timeoutMs },
          };
        }

        if (options.signal?.aborted) {
          return {
            ok: false,
            status: 'cancelled',
            summary: `${service.name} start was cancelled after the service was spawned; runtime state was reconciled.`,
            nextAction: 'Inspect workspace_services_status or stop the running service if it is no longer needed.',
            data: { service: service.name, pid, logPath: service.logPath, startedAt: starting.services[service.name].startedAt },
          };
        }
        return {
          ok: true,
          status: 'started',
          summary: `${service.name} started.`,
          data: { service: service.name, pid, logPath: service.logPath, startedAt: starting.services[service.name].startedAt },
        };
      },
    );
  } catch (error) {
    if (spawnedPid) {
      try { hostProcessAdapter.kill(-spawnedPid, 'SIGKILL'); } catch { try { hostProcessAdapter.kill(spawnedPid, 'SIGKILL'); } catch { /* ignore */ } }
    }
    const secrets = await knownSecretsBestEffort(service, config);
    if (timedOut || (error instanceof Error && error.message.includes('timed out'))) {
      return redactStructured({
        ok: false,
        status: 'timeout',
        summary: `${service.name} start timed out after ${timeoutMs}ms.`,
        nextAction: `Check logs at ${service.logPath} or verify service configuration.`,
        data: { service: service.name, timeoutMs },
      }, secrets);
    }
    if (error instanceof Error && (error.message === 'Operation aborted' || error.name === 'AbortError' || options.signal?.aborted)) {
      return redactStructured({
        ok: false,
        status: 'cancelled',
        summary: `${service.name} start was cancelled before completion.`,
        nextAction: 'Retry the start request when ready.',
        data: { service: service.name },
      }, secrets);
    }
    if (secrets.length > 0 && error instanceof Error) {
      throw new Error(redactText(error.message, secrets));
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (options.signal) {
      options.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export async function stopService(cwd: string, serviceName: string, options: StopOptions = {}): Promise<WorkspaceServiceOutcome> {
  if (options.signal?.aborted) {
    return {
      ok: false,
      status: 'cancelled',
      summary: `${serviceName} stop was cancelled before completion.`,
      nextAction: 'Retry the stop request when ready.',
      data: { service: serviceName },
    };
  }
  const config = await loadWorkspaceServicesConfig(cwd, { signal: options.signal }).catch((error) => {
    if (isAbortError(error, options.signal)) return null;
    throw error;
  });
  if (!config) {
    return {
      ok: false,
      status: 'cancelled',
      summary: `${serviceName} stop was cancelled before completion.`,
      nextAction: 'Retry the stop request when ready.',
      data: { service: serviceName },
    };
  }

  if (serviceName === 'all' || serviceName === 'compose') {
    const composeFile = config.composeFile;
    if (!composeFile) throw new Error('No Docker Compose file found. Set compose_file in .pi/workspace-services.json to a project-relative file path, or place a standard Compose file in the workspace root.');
    const secrets = await knownStackSecretsBestEffort(config);
    return redactStructured(await stopComposeService(config.workspaceRoot, 'all', {
      composeFile,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      secrets,
    }), secrets);
  }

  const service = getService(config, serviceName);
  if (service.type === 'compose') {
    const secrets = await knownSecretsBestEffort(service, config);
    return redactStructured(await stopComposeService(config.workspaceRoot, service.name, {
      composeFile: service.composeFile,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      secrets,
    }), secrets);
  }

  const timeoutMs = clampInteger(options.timeoutMs, DEFAULT_STOP_TIMEOUT_MS, 500, 30000);

  return withLifecycleTransaction(config.statePath, { signal: options.signal, deadlineMs: DEFAULT_TRANSACTION_DEADLINE_MS, ownerPath: config.ownerPath }, async () => {
    await initializeLastGoodState(config);
    const opened = await openRuntimeState(config);
    const next = { ...opened.state, services: { ...opened.state.services } };
    const runtime = next.services[service.name];
    if (!runtime?.identity) {
      if (runtime) {
        delete next.services[service.name];
        await commitRuntimeState(config, opened.state, next);
      }
      return { ok: true, status: 'not_running', summary: `${service.name} is not running.`, data: { service: service.name } };
    }
    const validation = await hostProcessAdapter.validateManagedIdentity(config, runtime.identity, service.command);
    if (!validation.ok) {
      runtime.phase = 'recovery_required';
      runtime.updatedAt = new Date().toISOString();
      await commitRuntimeState(config, opened.state, next);
      const secrets = await knownSecretsBestEffort(service, config);
      return redactStructured({
        ok: false,
        status: 'identity_mismatch',
        summary: `${service.name} identity mismatch prevented signaling.`,
        nextAction: 'Inspect status and reconcile the runtime state before retrying.',
        data: { service: service.name, pid: runtime.identity.pid, reason: validation.reason },
      }, secrets);
    }
    next.services[service.name] = { ...runtime, phase: 'stopping', identity: validation.identity, updatedAt: new Date().toISOString() };
    const stopping = await commitRuntimeState(config, opened.state, next);
    const stopped = await stopValidatedIdentity(validation.identity, timeoutMs, options.signal);
    if (!stopped) {
      stopping.services[service.name] = { ...stopping.services[service.name], phase: 'recovery_required', updatedAt: new Date().toISOString() };
      await commitRuntimeState(config, stopping, stopping);
      return {
        ok: false,
        status: 'timeout',
        summary: `${service.name} stop could not confirm full process-group termination.`,
        nextAction: 'Review the managed process group and retry after reconciliation.',
        data: { service: service.name, pid: validation.identity.pid },
      };
    }
    delete stopping.services[service.name];
    await commitRuntimeState(config, stopping, stopping);
    return { ok: true, status: 'stopped', summary: `${service.name} stopped.`, data: { service: service.name, pid: validation.identity.pid } };
  });
}

export async function restartService(cwd: string, serviceName: string, options: StopOptions = {}): Promise<WorkspaceServiceOutcome> {
  if (options.signal?.aborted) {
    return {
      ok: false,
      status: 'cancelled',
      summary: `${serviceName} restart was cancelled before completion.`,
      nextAction: 'Retry the restart request when ready.',
      data: { service: serviceName },
    };
  }
  const config = await loadWorkspaceServicesConfig(cwd, { signal: options.signal }).catch((error) => {
    if (isAbortError(error, options.signal)) return null;
    throw error;
  });
  if (!config) {
    return {
      ok: false,
      status: 'cancelled',
      summary: `${serviceName} restart was cancelled before completion.`,
      nextAction: 'Retry the restart request when ready.',
      data: { service: serviceName },
    };
  }

  if (serviceName === 'all' || serviceName === 'compose') {
    const composeFile = config.composeFile;
    if (!composeFile) throw new Error('No Docker Compose file found. Set compose_file in .pi/workspace-services.json to a project-relative file path, or place a standard Compose file in the workspace root.');
    const secrets = await knownStackSecretsBestEffort(config);
    return redactStructured(await restartComposeService(config.workspaceRoot, 'all', {
      composeFile,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      secrets,
    }), secrets);
  }

  const service = getService(config, serviceName);
  if (service.type === 'compose') {
    const secrets = await knownSecretsBestEffort(service, config);
    return redactStructured(await restartComposeService(config.workspaceRoot, service.name, {
      composeFile: service.composeFile,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      secrets,
    }), secrets);
  }

  const timeoutMs = clampInteger(options.timeoutMs, DEFAULT_STOP_TIMEOUT_MS, 500, 30000);
  if (!(await pathExists(service.cwd))) throw new Error(`Service "${service.name}" path does not exist: ${service.cwd}`);
  await ensureRuntimeDirs(config);
  await ensureRuntimeGitignore(config.workspaceRoot);

  try {
    return await withLifecycleTransaction(config.statePath, { signal: options.signal, deadlineMs: DEFAULT_TRANSACTION_DEADLINE_MS, ownerPath: config.ownerPath }, async () => {
    await initializeLastGoodState(config);
    const opened = await openRuntimeState(config);
    const next = { ...opened.state, services: { ...opened.state.services } };
    const runtime = next.services[service.name];
    if (runtime?.identity) {
      const validation = await hostProcessAdapter.validateManagedIdentity(config, runtime.identity, service.command);
      if (!validation.ok) {
        runtime.phase = 'recovery_required';
        await commitRuntimeState(config, opened.state, next);
        const secrets = await knownSecretsBestEffort(service, config);
        return redactStructured({ ok: false, status: 'identity_mismatch', summary: `${service.name} identity mismatch prevented restart.`, nextAction: 'Reconcile the runtime state before retrying.', data: { service: service.name, pid: runtime.identity.pid, reason: validation.reason } }, secrets);
      }
      next.services[service.name] = { ...runtime, phase: 'stopping', identity: validation.identity, updatedAt: new Date().toISOString() };
      const stopping = await commitRuntimeState(config, opened.state, next);
      const stopped = await stopValidatedIdentity(validation.identity, timeoutMs, options.signal);
      if (!stopped) {
        stopping.services[service.name] = { ...stopping.services[service.name], phase: 'recovery_required', updatedAt: new Date().toISOString() };
        await commitRuntimeState(config, stopping, stopping);
        return { ok: false, status: 'timeout', summary: `${service.name} restart stopped before spawn because the prior group could not be proven absent.`, nextAction: 'Inspect the service group and retry after reconciliation.', data: { service: service.name, pid: validation.identity.pid } };
      }
      delete stopping.services[service.name];
      await commitRuntimeState(config, stopping, stopping);
    }

    const refreshed = await openRuntimeState(config);
    const operationId = randomUUID();
    const pending = { ...refreshed.state, services: { ...refreshed.state.services, [service.name]: stateEntry('starting', operationId) } };
    const starting = await commitRuntimeState(config, refreshed.state, pending);
    let pid: number;
    try {
      pid = await hostProcessAdapter.spawnRunner(config, service, true, options.signal);
    } catch (spawnError) {
      delete starting.services[service.name];
      await commitRuntimeState(config, starting, starting).catch(() => undefined);
      throw spawnError;
    }
    let identity: ManagedProcessIdentityV1;
    try {
      identity = await hostProcessAdapter.captureManagedIdentity(config, pid, service.command);
    } catch (captureError) {
      try { hostProcessAdapter.kill(-pid, 'SIGKILL'); } catch { try { hostProcessAdapter.kill(pid, 'SIGKILL'); } catch { /* ignore */ } }
      delete starting.services[service.name];
      await commitRuntimeState(config, starting, starting).catch(() => undefined);
      throw captureError;
    }
    starting.services[service.name] = { phase: 'running', operationId, identity, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await commitRuntimeState(config, starting, starting);
    if (options.signal?.aborted) {
      return {
        ok: false,
        status: 'cancelled',
        summary: `${service.name} restart was cancelled after the replacement service was spawned; runtime state was reconciled.`,
        nextAction: 'Inspect workspace_services_status or stop the running service if it is no longer needed.',
        data: { service: service.name, pid, logPath: service.logPath, startedAt: starting.services[service.name].startedAt },
      };
    }
    return { ok: true, status: 'started', summary: `${service.name} restarted.`, data: { service: service.name, pid, logPath: service.logPath, startedAt: starting.services[service.name].startedAt } };
  });
  } catch (error) {
    const secrets = await knownSecretsBestEffort(service, config);
    if (isAbortError(error, options.signal)) {
      return redactStructured({
        ok: false,
        status: 'cancelled',
        summary: `${service.name} restart was cancelled before completion.`,
        nextAction: 'Retry the restart request when ready.',
        data: { service: service.name },
      }, secrets);
    }
    if (secrets.length > 0 && error instanceof Error) {
      throw new Error(redactText(error.message, secrets));
    }
    throw error;
  }
}

export async function getServiceLogs(cwd: string, serviceName: string, options: LogsOptions = {}): Promise<WorkspaceServiceOutcome> {
  const config = await loadWorkspaceServicesConfig(cwd);
  const service = getService(config, serviceName);

  if (service.type === 'compose') {
    const unsupported: string[] = [];
    if (options.offset !== undefined) unsupported.push('offset');
    if (options.until !== undefined) unsupported.push('until');
    if (unsupported.length > 0) {
      return {
        ok: false,
        status: 'failed',
        summary: `Compose logs for ${service.name} only support a bounded recent window; ${unsupported.join(' and ')} ${unsupported.length > 1 ? 'are' : 'is'} unsupported.`,
        nextAction: `Retry workspace_service_logs for ${service.name} without offset or until (use lines up to ${MAX_LOG_LINES} and max_bytes up to ${MAX_LOG_BYTES}).`,
        data: { service: service.name, scope: 'recent-window-only', unsupportedArguments: unsupported },
      };
    }

    const lines = clampInteger(options.lines, DEFAULT_LOG_LINES, 1, MAX_LOG_LINES);
    const maxBytes = clampInteger(options.maxBytes, DEFAULT_LOG_BYTES, 1024, MAX_LOG_BYTES);
    await ensureRuntimeDirs(config);
    const secrets = service.envFile
      ? Object.values(await loadServiceEnv(service, config.workspaceRealRoot)).filter((value) => value.length > 0)
      : [];

    try {
      const captured = await getComposeServiceLogsDetailed(config.workspaceRoot, service.name, {
        lines,
        maxBytes,
        composeFile: service.composeFile,
      });
      const rawLines = captured.text.split(/\r?\n/);
      if (rawLines.at(-1) === '') rawLines.pop();
      const lineTruncated = rawLines.length > lines;
      const slicedLines = lineTruncated ? rawLines.slice(rawLines.length - lines) : rawLines;
      const redactedLines = slicedLines.map((line) => redactText(line, secrets));
      const bounded = boundLogTail(redactedLines, maxBytes);
      await writeFile(service.logPath, bounded.text, 'utf8').catch(() => undefined);
      const bytesReturned = Buffer.byteLength(bounded.text, 'utf8');
      const anyTruncated = captured.captureTruncated || lineTruncated || bounded.byteTruncated;

      let nextAction: string | undefined;
      let limitReached: string | undefined;
      if (anyTruncated) {
        if (lines < MAX_LOG_LINES || maxBytes < MAX_LOG_BYTES) {
          const nextLines = Math.min(MAX_LOG_LINES, Math.max(lines, Math.min(MAX_LOG_LINES, lines * 2)));
          const nextBytes = Math.min(MAX_LOG_BYTES, Math.max(maxBytes, Math.min(MAX_LOG_BYTES, maxBytes * 2)));
          nextAction = `Recent Compose logs were bounded (lines=${lines}, max_bytes=${maxBytes}). Increase lines (up to ${MAX_LOG_LINES}, e.g. ${nextLines}) or max_bytes (up to ${MAX_LOG_BYTES}, e.g. ${nextBytes}) if a larger recent window is needed.`;
        } else {
          limitReached = `Maximum Compose log retrieval bounds reached (${MAX_LOG_LINES} lines / ${MAX_LOG_BYTES} bytes); older history is not paginated by this tool.`;
        }
      }

      return redactStructured({
        ok: true,
        status: 'ok',
        summary: `Retrieved ${bounded.lines.length} recent log line(s) for ${service.name}.`,
        ...(nextAction ? { nextAction } : {}),
        data: {
          service: service.name,
          logPath: service.logPath,
          scope: 'recent-window-only',
          text: bounded.text,
          lines: bounded.lines.length,
          maxLines: lines,
          maxBytes,
          bytesReturned,
          lineTruncated,
          byteTruncated: bounded.byteTruncated,
          captureTruncated: captured.captureTruncated,
          ...(limitReached ? { limitReached } : {}),
        },
        truncation: {
          returned: bounded.lines.length,
          hasMore: false,
        },
      }, secrets);
    } catch (error: any) {
      const msg = boundDiagnosticText(error instanceof Error ? error.message : String(error), secrets);
      return redactStructured({
        ok: false,
        status: 'failed',
        summary: `Failed to retrieve logs for ${service.name}: ${msg}`,
        nextAction: 'Ensure Docker daemon is running and compose service exists.',
        data: { service: service.name, logPath: service.logPath, text: '', error: msg },
      }, secrets);
    }
  }

  const lines = clampInteger(options.lines, DEFAULT_LOG_LINES, 1, MAX_LOG_LINES);
  const maxBytes = clampInteger(options.maxBytes, DEFAULT_LOG_BYTES, 1024, MAX_LOG_BYTES);
  const offset = clampInteger(options.offset, 0, 0, MAX_LOG_LINES);
  const until = typeof options.until === 'number' && Number.isFinite(options.until)
    ? clampInteger(options.until, offset + lines, offset, offset + MAX_LOG_LINES)
    : undefined;
  if (!(await pathExists(service.logPath))) {
    return {
      ok: true,
      status: 'ok',
      summary: `No log file found for ${service.name} yet.`,
      data: {
        service: service.name,
        logPath: service.logPath,
        text: '',
        lines: 0,
        offset,
        until,
        bytesReturned: 0,
        bytesRead: 0,
        totalBytes: 0,
        liveConsistency: true,
      },
      truncation: { returned: 0, total: 0, hasMore: false },
    };
  }
  const secrets = Object.values(await loadServiceEnv(service, config.workspaceRealRoot)).filter((value) => value.length > 0);
  const tail = await readTail(service.logPath, maxBytes);
  const allLines = tail.text.split(/\r?\n/);
  if (allLines.at(-1) === '') allLines.pop();

  const windowEnd = Math.max(0, allLines.length - offset);
  const requestedSpan = until !== undefined
    ? Math.max(0, Math.min(until - offset, options.lines !== undefined ? lines : MAX_LOG_LINES))
    : lines;
  const windowStart = Math.max(0, windowEnd - requestedSpan);
  const selectedLines = allLines.slice(windowStart, windowEnd);
  const redactedLines = selectedLines.map((line) => redactText(line, secrets));
  const bounded = boundLogTail(redactedLines, maxBytes);
  const returned = bounded.lines.length;
  const bytesReturned = Buffer.byteLength(bounded.text, 'utf8');
  const fullFileInspected = !tail.truncated;

  let hasMore = false;
  let continuation: string | undefined;
  let limitReached: string | undefined;

  if (returned > 0) {
    if (windowStart > 0 && offset < MAX_LOG_LINES) {
      const nextOffset = Math.min(MAX_LOG_LINES, offset + returned);
      const nextWindowEnd = Math.max(0, allLines.length - nextOffset);
      const nextWindowStart = Math.max(0, nextWindowEnd - lines);
      if (nextOffset > offset && nextWindowStart < windowStart) {
        hasMore = true;
        continuation = `Call workspace_service_logs with service=${service.name}, lines=${lines}, and offset=${nextOffset} for older logs.`;
      } else {
        limitReached = `Maximum supported offset (${MAX_LOG_LINES}) reached; older lines exist but no further pagination is available through this tool.`;
      }
    } else if (windowStart > 0 && offset >= MAX_LOG_LINES) {
      limitReached = `Maximum supported offset (${MAX_LOG_LINES}) reached; older lines exist but no further pagination is available through this tool.`;
    } else if (windowStart === 0 && tail.truncated) {
      if (maxBytes < MAX_LOG_BYTES) {
        const nextBytes = Math.min(MAX_LOG_BYTES, maxBytes * 2);
        hasMore = true;
        continuation = `Call workspace_service_logs with service=${service.name}, lines=${lines}, offset=${offset}, and max_bytes=${nextBytes} to inspect older bytes (up to ${MAX_LOG_BYTES}).`;
      } else {
        limitReached = `Older log bytes exist beyond the maximum ${MAX_LOG_BYTES}-byte inspection window; no further retrieval is available through this tool.`;
      }
    }
  } else if (tail.truncated) {
    limitReached = maxBytes < MAX_LOG_BYTES
      ? `Only the newest ${tail.bytesRead} of ${tail.totalBytes} bytes were inspected (max_bytes=${maxBytes}, max ${MAX_LOG_BYTES}); no lines matched this offset within the inspected window.`
      : `Only the newest ${tail.bytesRead} of ${tail.totalBytes} bytes can be inspected at maximum max_bytes=${MAX_LOG_BYTES}; no further retrieval is available through this tool.`;
  }

  return redactStructured({
    ok: true,
    status: 'ok',
    summary: `Retrieved ${returned} log line(s) for ${service.name}.`,
    ...(continuation ? { nextAction: continuation } : {}),
    data: {
      service: service.name,
      logPath: service.logPath,
      text: bounded.text,
      lines: returned,
      offset,
      until,
      bytesReturned,
      bytesRead: tail.bytesRead,
      totalBytes: tail.totalBytes,
      byteTruncated: bounded.byteTruncated,
      inspectedWindowLines: allLines.length,
      fullFileInspected,
      liveConsistency: true,
      ...(limitReached ? { limitReached } : {}),
    },
    truncation: {
      returned,
      ...(fullFileInspected ? { total: allLines.length } : {}),
      hasMore,
      ...(continuation ? { continuation } : {}),
    },
  }, secrets);
}

export async function readConfigText(cwd: string): Promise<string | undefined> {
  const config = await loadWorkspaceServicesConfig(cwd);
  if (!config.exists) return undefined;
  return readFile(config.configPath, 'utf8');
}
