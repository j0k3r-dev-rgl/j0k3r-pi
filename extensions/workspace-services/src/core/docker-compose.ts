import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { boundDiagnosticText, redactStructured, sliceUtf8BufferTail } from '../security.js';
import type { WorkspaceServiceOutcome } from '../types.js';

export const COMPOSE_FILE_CANDIDATES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
] as const;

export interface DockerComposeRunOptions {
  composeFile?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxCaptureBytes?: number;
}

export interface DockerComposeRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export const composeProcessSpawner = {
  spawn,
};

export interface ComposeContainerInfo {
  id: string;
  name: string;
  service: string;
  state: string;
  health?: string;
  exitCode?: number;
  ports?: string;
  raw?: Record<string, unknown>;
}

export function findComposeFile(cwd: string): string | null {
  for (const candidate of COMPOSE_FILE_CANDIDATES) {
    const fullPath = join(cwd, candidate);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

export function runDockerCompose(
  cwd: string,
  args: string[],
  options: DockerComposeRunOptions = {},
): Promise<DockerComposeRunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('Operation aborted'));
      return;
    }

    const composeArgs = ['compose'];
    if (options.composeFile) {
      composeArgs.push('-f', options.composeFile);
    }
    composeArgs.push(...args);

    let child: import('node:child_process').ChildProcess;
    try {
      child = composeProcessSpawner.spawn('docker', composeArgs, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        reject(new Error('Docker CLI ("docker") is not installed or not in PATH.'));
      } else {
        reject(err);
      }
      return;
    }

    const captureLimit = typeof options.maxCaptureBytes === 'number' && options.maxCaptureBytes > 0
      ? Math.floor(options.maxCaptureBytes)
      : undefined;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    const appendChunk = (chunks: Buffer[], currentBytes: number, chunk: Buffer | string, limit?: number): { bytes: number; truncated: boolean } => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      if (buf.length === 0) return { bytes: currentBytes, truncated: false };
      chunks.push(buf);
      let nextBytes = currentBytes + buf.length;
      if (!limit || nextBytes <= limit) return { bytes: nextBytes, truncated: false };
      let overflow = nextBytes - limit;
      while (overflow > 0 && chunks.length > 0) {
        const first = chunks[0]!;
        if (first.length <= overflow) {
          overflow -= first.length;
          nextBytes -= first.length;
          chunks.shift();
        } else {
          chunks[0] = first.subarray(overflow);
          nextBytes -= overflow;
          overflow = 0;
        }
      }
      return { bytes: nextBytes, truncated: true };
    };

    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const killProcess = () => {
      try {
        if (child.pid) {
          child.kill('SIGTERM');
          setTimeout(() => {
            try {
              if (child.pid) child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }, 1000).unref();
        }
      } catch {
        // ignore
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      killProcess();
      reject(new Error('Operation aborted'));
    };

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        killProcess();
        reject(new Error(`Docker compose command timed out after ${options.timeoutMs}ms.`));
      }, options.timeoutMs);
    }

    child.stdout?.on('data', (chunk) => {
      const next = appendChunk(stdoutChunks, stdoutBytes, chunk, captureLimit);
      stdoutBytes = next.bytes;
      if (next.truncated) stdoutTruncated = true;
    });

    child.stderr?.on('data', (chunk) => {
      const next = appendChunk(stderrChunks, stderrBytes, chunk, captureLimit);
      stderrBytes = next.bytes;
      if (next.truncated) stderrTruncated = true;
    });

    child.on('error', (err: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err?.code === 'ENOENT') {
        reject(new Error('Docker CLI ("docker") is not installed or not in PATH.'));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      const rawStdout = Buffer.concat(stdoutChunks);
      const rawStderr = Buffer.concat(stderrChunks);
      const safeStdout = stdoutTruncated && captureLimit ? sliceUtf8BufferTail(rawStdout, captureLimit) : rawStdout;
      const safeStderr = stderrTruncated && captureLimit ? sliceUtf8BufferTail(rawStderr, captureLimit) : rawStderr;
      resolve({
        stdout: safeStdout.toString('utf8'),
        stderr: safeStderr.toString('utf8'),
        exitCode: code ?? 0,
        ...(stdoutTruncated ? { stdoutTruncated: true } : {}),
        ...(stderrTruncated ? { stderrTruncated: true } : {}),
      });
    });
  });
}

export interface ComposeDiscoveryResult {
  services: string[];
  ok: boolean;
  error?: string;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && (error.message === 'Operation aborted' || error.name === 'AbortError');
}

export async function discoverComposeServicesDetailed(
  cwd: string,
  composeFile?: string,
  signal?: AbortSignal,
): Promise<ComposeDiscoveryResult> {
  if (signal?.aborted) throw new Error('Operation aborted');
  try {
    const result = await composeExecutor.run(cwd, ['config', '--services'], { composeFile, timeoutMs: 15_000, signal });
    if (result.exitCode !== 0) {
      const raw = result.stderr.trim() || result.stdout.trim() || `docker compose config --services failed with exit code ${result.exitCode}`;
      return { services: [], ok: false, error: boundDiagnosticText(raw) };
    }
    const services = result.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { services, ok: true };
  } catch (error: any) {
    if (isAbortError(error, signal)) throw error;
    const raw = error instanceof Error ? error.message : String(error);
    return { services: [], ok: false, error: boundDiagnosticText(raw) };
  }
}

export async function discoverComposeServices(cwd: string, composeFile?: string, signal?: AbortSignal): Promise<string[]> {
  const res = await discoverComposeServicesDetailed(cwd, composeFile, signal);
  return res.services;
}

export function parseComposePsOutputStrict(output: string): { containers: ComposeContainerInfo[]; invalid: boolean; error?: string } {
  const trimmed = output.trim();
  if (!trimmed) return { containers: [], invalid: false };

  let records: any[] = [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
        return { containers: [], invalid: true, error: 'Invalid JSON array from docker compose ps.' };
      }
      records = parsed;
    } catch {
      return { containers: [], invalid: true, error: 'Malformed JSON array from docker compose ps.' };
    }
  } else {
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return { containers: [], invalid: true, error: 'Malformed record in docker compose ps output.' };
        }
        records.push(item);
      } catch {
        return { containers: [], invalid: true, error: 'Malformed JSON output from docker compose ps.' };
      }
    }
  }

  const containers = records.map((r) => {
    const id = String(r.ID ?? r.Id ?? '');
    const name = String(r.Name ?? '');
    const service = String(r.Service ?? name);
    const state = String(r.State ?? '').toLowerCase();

    let health: string | undefined = r.Health ? String(r.Health).toLowerCase() : undefined;
    if (!health && typeof r.Status === 'string') {
      const match = r.Status.match(/\((healthy|unhealthy|starting)\)/i);
      if (match) health = match[1].toLowerCase();
    }

    let exitCode: number | undefined;
    if (typeof r.ExitCode === 'number') exitCode = r.ExitCode;

    let ports: string | undefined;
    if (Array.isArray(r.Publishers) && r.Publishers.length > 0) {
      ports = r.Publishers
        .map((p: any) => `${p.PublishedPort || p.TargetPort}->${p.TargetPort}/${p.Protocol || 'tcp'}`)
        .join(', ');
    } else if (typeof r.Ports === 'string' && r.Ports.length > 0) {
      ports = r.Ports;
    }

    return {
      id,
      name,
      service,
      state,
      health,
      exitCode,
      ports,
      raw: r,
    };
  });

  return { containers, invalid: false };
}

export function parseComposePsOutput(output: string): ComposeContainerInfo[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  let records: any[] = [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) records = parsed;
    } catch {
      // fallback to line-by-line
    }
  }

  if (records.length === 0) {
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item && typeof item === 'object') {
          records.push(item);
        }
      } catch {
        // ignore unparseable line
      }
    }
  }

  return records.map((r) => {
    const id = String(r.ID ?? r.Id ?? '');
    const name = String(r.Name ?? '');
    const service = String(r.Service ?? name);
    const state = String(r.State ?? '').toLowerCase();

    let health: string | undefined = r.Health ? String(r.Health).toLowerCase() : undefined;
    if (!health && typeof r.Status === 'string') {
      const match = r.Status.match(/\((healthy|unhealthy|starting)\)/i);
      if (match) health = match[1].toLowerCase();
    }

    let exitCode: number | undefined;
    if (typeof r.ExitCode === 'number') exitCode = r.ExitCode;

    let ports: string | undefined;
    if (Array.isArray(r.Publishers) && r.Publishers.length > 0) {
      ports = r.Publishers
        .map((p: any) => `${p.PublishedPort || p.TargetPort}->${p.TargetPort}/${p.Protocol || 'tcp'}`)
        .join(', ');
    } else if (typeof r.Ports === 'string' && r.Ports.length > 0) {
      ports = r.Ports;
    }

    return {
      id,
      name,
      service,
      state,
      health,
      exitCode,
      ports,
      raw: r,
    };
  });
}

export async function getComposeServicesStatus(
  cwd: string,
  composeFile?: string,
  serviceName?: string,
  signal?: AbortSignal,
): Promise<ComposeContainerInfo[]> {
  if (signal?.aborted) throw new Error('Operation aborted');
  const args = ['ps', '--all', '--format', 'json'];
  if (serviceName) args.push(serviceName);
  const result = await composeExecutor.run(cwd, args, { composeFile, timeoutMs: 15_000, signal });
  if (result.exitCode !== 0) {
    const raw = result.stderr.trim() || result.stdout.trim() || `docker compose ps failed with exit code ${result.exitCode}`;
    throw new Error(boundDiagnosticText(raw));
  }
  const parsed = parseComposePsOutputStrict(result.stdout);
  if (parsed.invalid) {
    throw new Error(boundDiagnosticText(parsed.error || 'Malformed docker compose ps output.'));
  }
  return parsed.containers;
}

export async function getComposeServiceLogsDetailed(
  cwd: string,
  serviceName: string,
  options: { lines?: number; maxBytes?: number; composeFile?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ text: string; captureTruncated: boolean }> {
  if (options.signal?.aborted) throw new Error('Operation aborted');
  const lines = options.lines ?? 100;
  const maxCaptureBytes = typeof options.maxBytes === 'number' && options.maxBytes > 0
    ? Math.max(options.maxBytes + 64, 4096)
    : undefined;
  const args = ['logs', '--no-color', '--tail', String(lines), serviceName];
  const result = await composeExecutor.run(cwd, args, {
    composeFile: options.composeFile,
    timeoutMs: options.timeoutMs ?? 15_000,
    signal: options.signal,
    maxCaptureBytes,
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `docker compose logs failed with exit code ${result.exitCode}`;
    throw new Error(boundDiagnosticText(detail));
  }
  return {
    text: result.stdout || result.stderr,
    captureTruncated: Boolean(result.stdoutTruncated || result.stderrTruncated),
  };
}

export async function getComposeServiceLogs(
  cwd: string,
  serviceName: string,
  options: { lines?: number; maxBytes?: number; composeFile?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const detailed = await getComposeServiceLogsDetailed(cwd, serviceName, options);
  return detailed.text;
}

export async function startComposeService(
  cwd: string,
  serviceName?: string,
  options: { composeFile?: string; timeoutMs?: number; signal?: AbortSignal; secrets?: string[] } = {},
): Promise<WorkspaceServiceOutcome> {
  const isFullStack = !serviceName || serviceName === 'all' || serviceName === 'compose';
  const targetLabel = isFullStack ? 'all' : serviceName;
  const { secrets = [], ...runOptions } = options;

  try {
    if (options.signal?.aborted) throw new Error('Operation aborted');
    if (!isFullStack) {
      let existing: ComposeContainerInfo[] = [];
      try {
        existing = await composeExecutor.getServicesStatus(cwd, options.composeFile, serviceName, options.signal);
      } catch (err) {
        if (isAbortError(err, options.signal)) throw err;
        existing = [];
      }
      const matched = existing.find((c) => c.service === serviceName || c.name === serviceName);
      if (matched && matched.state === 'running') {
        return {
          ok: true,
          status: 'already_running',
          summary: `${serviceName} is already running.`,
          data: { service: serviceName, containerId: matched.id },
        };
      }
    }

    const args = isFullStack ? ['up', '-d'] : ['up', '-d', serviceName];
    const result = await composeExecutor.run(cwd, args, runOptions);
    if (result.exitCode !== 0) {
      const boundedStderr = boundDiagnosticText(result.stderr, secrets);
      const summaryDetail = boundDiagnosticText(result.stderr.trim(), secrets) || `exit code ${result.exitCode}`;
      return redactStructured({
        ok: false,
        status: 'failed',
        summary: `docker compose up failed: ${summaryDetail}`,
        nextAction: 'Ensure Docker daemon is running and compose configuration is valid.',
        data: { service: targetLabel, stderr: boundedStderr, exitCode: result.exitCode },
      }, secrets);
    }

    const summary = isFullStack ? 'Docker Compose stack started.' : `${serviceName} started.`;
    return {
      ok: true,
      status: 'started',
      summary,
      data: { service: targetLabel },
    };
  } catch (error: any) {
    if (isAbortError(error, options.signal)) {
      return redactStructured({
        ok: false,
        status: 'cancelled',
        summary: `${targetLabel} start was cancelled before completion.`,
        nextAction: 'Retry the start request when ready.',
        data: { service: targetLabel },
      }, secrets);
    }
    const rawError = error instanceof Error ? error.message : String(error);
    if (rawError.includes('timed out')) {
      return redactStructured({
        ok: false,
        status: 'timeout',
        summary: `${targetLabel} start timed out after ${options.timeoutMs}ms.`,
        nextAction: 'Check Docker daemon status and container startup logs.',
        data: { service: targetLabel, timeoutMs: options.timeoutMs },
      }, secrets);
    }
    const boundedError = boundDiagnosticText(rawError, secrets);
    return redactStructured({
      ok: false,
      status: 'failed',
      summary: `Failed to start ${targetLabel}: ${boundedError}`,
      nextAction: 'Ensure Docker daemon is running and compose configuration is valid.',
      data: { service: targetLabel, error: boundedError },
    }, secrets);
  }
}

export async function stopComposeService(
  cwd: string,
  serviceName?: string,
  options: { composeFile?: string; timeoutMs?: number; signal?: AbortSignal; secrets?: string[] } = {},
): Promise<WorkspaceServiceOutcome> {
  const isFullStack = !serviceName || serviceName === 'all' || serviceName === 'compose';
  const targetLabel = isFullStack ? 'all' : serviceName;
  const { secrets = [], ...runOptions } = options;

  try {
    if (options.signal?.aborted) throw new Error('Operation aborted');
    const args = isFullStack ? ['stop'] : ['stop', serviceName];
    const result = await composeExecutor.run(cwd, args, runOptions);
    if (result.exitCode !== 0) {
      const boundedStderr = boundDiagnosticText(result.stderr, secrets);
      const summaryDetail = boundDiagnosticText(result.stderr.trim(), secrets) || `exit code ${result.exitCode}`;
      return redactStructured({
        ok: false,
        status: 'failed',
        summary: `docker compose stop failed: ${summaryDetail}`,
        nextAction: 'Ensure Docker daemon is running and containers are accessible.',
        data: { service: targetLabel, stderr: boundedStderr, exitCode: result.exitCode },
      }, secrets);
    }

    const summary = isFullStack ? 'Docker Compose stack stopped.' : `${serviceName} stopped.`;
    return {
      ok: true,
      status: 'stopped',
      summary,
      data: { service: targetLabel },
    };
  } catch (error: any) {
    if (isAbortError(error, options.signal)) {
      return redactStructured({
        ok: false,
        status: 'cancelled',
        summary: `${targetLabel} stop was cancelled before completion.`,
        nextAction: 'Retry the stop request when ready.',
        data: { service: targetLabel },
      }, secrets);
    }
    const rawError = error instanceof Error ? error.message : String(error);
    if (rawError.includes('timed out')) {
      return redactStructured({
        ok: false,
        status: 'timeout',
        summary: `${targetLabel} stop timed out after ${options.timeoutMs}ms.`,
        nextAction: 'Inspect Docker container status and retry.',
        data: { service: targetLabel, timeoutMs: options.timeoutMs },
      }, secrets);
    }
    const boundedError = boundDiagnosticText(rawError, secrets);
    return redactStructured({
      ok: false,
      status: 'failed',
      summary: `Failed to stop ${targetLabel}: ${boundedError}`,
      nextAction: 'Ensure Docker daemon is running and containers are accessible.',
      data: { service: targetLabel, error: boundedError },
    }, secrets);
  }
}

export async function restartComposeService(
  cwd: string,
  serviceName?: string,
  options: { composeFile?: string; timeoutMs?: number; signal?: AbortSignal; secrets?: string[] } = {},
): Promise<WorkspaceServiceOutcome> {
  const isFullStack = !serviceName || serviceName === 'all' || serviceName === 'compose';
  const targetLabel = isFullStack ? 'all' : serviceName;
  const { secrets = [], ...runOptions } = options;

  try {
    if (options.signal?.aborted) throw new Error('Operation aborted');
    const args = isFullStack ? ['restart'] : ['restart', serviceName];
    const result = await composeExecutor.run(cwd, args, runOptions);
    if (result.exitCode !== 0) {
      const boundedStderr = boundDiagnosticText(result.stderr, secrets);
      const summaryDetail = boundDiagnosticText(result.stderr.trim(), secrets) || `exit code ${result.exitCode}`;
      return redactStructured({
        ok: false,
        status: 'failed',
        summary: `docker compose restart failed: ${summaryDetail}`,
        nextAction: 'Ensure Docker daemon is running and containers are accessible.',
        data: { service: targetLabel, stderr: boundedStderr, exitCode: result.exitCode },
      }, secrets);
    }

    const summary = isFullStack ? 'Docker Compose stack restarted.' : `${serviceName} restarted.`;
    return {
      ok: true,
      status: 'started',
      summary,
      data: { service: targetLabel },
    };
  } catch (error: any) {
    if (isAbortError(error, options.signal)) {
      return redactStructured({
        ok: false,
        status: 'cancelled',
        summary: `${targetLabel} restart was cancelled before completion.`,
        nextAction: 'Retry the restart request when ready.',
        data: { service: targetLabel },
      }, secrets);
    }
    const rawError = error instanceof Error ? error.message : String(error);
    if (rawError.includes('timed out')) {
      return redactStructured({
        ok: false,
        status: 'timeout',
        summary: `${targetLabel} restart timed out after ${options.timeoutMs}ms.`,
        nextAction: 'Inspect Docker container status and retry.',
        data: { service: targetLabel, timeoutMs: options.timeoutMs },
      }, secrets);
    }
    const boundedError = boundDiagnosticText(rawError, secrets);
    return redactStructured({
      ok: false,
      status: 'failed',
      summary: `Failed to restart ${targetLabel}: ${boundedError}`,
      nextAction: 'Ensure Docker daemon is running and containers are accessible.',
      data: { service: targetLabel, error: boundedError },
    }, secrets);
  }
}

export const composeExecutor = {
  run: runDockerCompose,
  getServicesStatus: getComposeServicesStatus,
  getServiceLogs: getComposeServiceLogs,
};
