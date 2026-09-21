import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
}

export interface DockerComposeRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

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
      child = spawn('docker', composeArgs, {
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

    let stdout = '';
    let stderr = '';
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
      stdout += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
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
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });
  });
}

export async function discoverComposeServices(cwd: string, composeFile?: string): Promise<string[]> {
  try {
    const result = await composeExecutor.run(cwd, ['config', '--services'], { composeFile, timeoutMs: 15_000 });
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
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
): Promise<ComposeContainerInfo[]> {
  const args = ['ps', '--all', '--format', 'json'];
  if (serviceName) args.push(serviceName);
  const result = await composeExecutor.run(cwd, args, { composeFile, timeoutMs: 15_000 });
  if (result.exitCode !== 0) {
    return [];
  }
  return parseComposePsOutput(result.stdout);
}

export async function getComposeServiceLogs(
  cwd: string,
  serviceName: string,
  options: { lines?: number; composeFile?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const lines = options.lines ?? 100;
  const args = ['logs', '--no-color', '--tail', String(lines), serviceName];
  const result = await composeExecutor.run(cwd, args, {
    composeFile: options.composeFile,
    timeoutMs: options.timeoutMs ?? 15_000,
    signal: options.signal,
  });
  if (result.exitCode !== 0 && !result.stdout) {
    throw new Error(result.stderr.trim() || `docker compose logs failed with exit code ${result.exitCode}`);
  }
  return result.stdout || result.stderr;
}

export async function startComposeService(
  cwd: string,
  serviceName?: string,
  options: { composeFile?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<WorkspaceServiceOutcome> {
  const isFullStack = !serviceName || serviceName === 'all' || serviceName === 'compose';
  const targetLabel = isFullStack ? 'all' : serviceName;

  try {
    if (!isFullStack) {
      const existing = await composeExecutor.getServicesStatus(cwd, options.composeFile, serviceName).catch(() => []);
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
    const result = await composeExecutor.run(cwd, args, options);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        status: 'failed',
        summary: `docker compose up failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
        nextAction: 'Ensure Docker daemon is running and compose configuration is valid.',
        data: { service: targetLabel, stderr: result.stderr, exitCode: result.exitCode },
      };
    }

    const summary = isFullStack ? 'Docker Compose stack started.' : `${serviceName} started.`;
    return {
      ok: true,
      status: 'started',
      summary,
      data: { service: targetLabel },
    };
  } catch (error: any) {
    if (options.signal?.aborted || error.message === 'Operation aborted') {
      return {
        ok: false,
        status: 'cancelled',
        summary: `${targetLabel} start was cancelled before completion.`,
        nextAction: 'Retry the start request when ready.',
        data: { service: targetLabel },
      };
    }
    if (error.message?.includes('timed out')) {
      return {
        ok: false,
        status: 'timeout',
        summary: `${targetLabel} start timed out after ${options.timeoutMs}ms.`,
        nextAction: 'Check Docker daemon status and container startup logs.',
        data: { service: targetLabel, timeoutMs: options.timeoutMs },
      };
    }
    return {
      ok: false,
      status: 'failed',
      summary: `Failed to start ${targetLabel}: ${error.message}`,
      nextAction: 'Ensure Docker daemon is running and compose configuration is valid.',
      data: { service: targetLabel, error: error.message },
    };
  }
}

export async function stopComposeService(
  cwd: string,
  serviceName?: string,
  options: { composeFile?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<WorkspaceServiceOutcome> {
  const isFullStack = !serviceName || serviceName === 'all' || serviceName === 'compose';
  const targetLabel = isFullStack ? 'all' : serviceName;

  try {
    const args = isFullStack ? ['stop'] : ['stop', serviceName];
    const result = await composeExecutor.run(cwd, args, options);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        status: 'failed',
        summary: `docker compose stop failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
        nextAction: 'Ensure Docker daemon is running and containers are accessible.',
        data: { service: targetLabel, stderr: result.stderr, exitCode: result.exitCode },
      };
    }

    const summary = isFullStack ? 'Docker Compose stack stopped.' : `${serviceName} stopped.`;
    return {
      ok: true,
      status: 'stopped',
      summary,
      data: { service: targetLabel },
    };
  } catch (error: any) {
    if (options.signal?.aborted || error.message === 'Operation aborted') {
      return {
        ok: false,
        status: 'cancelled',
        summary: `${targetLabel} stop was cancelled before completion.`,
        nextAction: 'Retry the stop request when ready.',
        data: { service: targetLabel },
      };
    }
    if (error.message?.includes('timed out')) {
      return {
        ok: false,
        status: 'timeout',
        summary: `${targetLabel} stop timed out after ${options.timeoutMs}ms.`,
        nextAction: 'Inspect Docker container status and retry.',
        data: { service: targetLabel, timeoutMs: options.timeoutMs },
      };
    }
    return {
      ok: false,
      status: 'failed',
      summary: `Failed to stop ${targetLabel}: ${error.message}`,
      nextAction: 'Ensure Docker daemon is running and containers are accessible.',
      data: { service: targetLabel, error: error.message },
    };
  }
}

export async function restartComposeService(
  cwd: string,
  serviceName?: string,
  options: { composeFile?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<WorkspaceServiceOutcome> {
  const isFullStack = !serviceName || serviceName === 'all' || serviceName === 'compose';
  const targetLabel = isFullStack ? 'all' : serviceName;

  try {
    const args = isFullStack ? ['restart'] : ['restart', serviceName];
    const result = await composeExecutor.run(cwd, args, options);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        status: 'failed',
        summary: `docker compose restart failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
        nextAction: 'Ensure Docker daemon is running and containers are accessible.',
        data: { service: targetLabel, stderr: result.stderr, exitCode: result.exitCode },
      };
    }

    const summary = isFullStack ? 'Docker Compose stack restarted.' : `${serviceName} restarted.`;
    return {
      ok: true,
      status: 'started',
      summary,
      data: { service: targetLabel },
    };
  } catch (error: any) {
    if (options.signal?.aborted || error.message === 'Operation aborted') {
      return {
        ok: false,
        status: 'cancelled',
        summary: `${targetLabel} restart was cancelled before completion.`,
        nextAction: 'Retry the restart request when ready.',
        data: { service: targetLabel },
      };
    }
    if (error.message?.includes('timed out')) {
      return {
        ok: false,
        status: 'timeout',
        summary: `${targetLabel} restart timed out after ${options.timeoutMs}ms.`,
        nextAction: 'Inspect Docker container status and retry.',
        data: { service: targetLabel, timeoutMs: options.timeoutMs },
      };
    }
    return {
      ok: false,
      status: 'failed',
      summary: `Failed to restart ${targetLabel}: ${error.message}`,
      nextAction: 'Ensure Docker daemon is running and containers are accessible.',
      data: { service: targetLabel, error: error.message },
    };
  }
}

export const composeExecutor = {
  run: runDockerCompose,
  getServicesStatus: getComposeServicesStatus,
  getServiceLogs: getComposeServiceLogs,
};
