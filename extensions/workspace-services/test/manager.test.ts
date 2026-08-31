import { mkdtempSync } from 'node:fs';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { Writable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getServiceLogs, getServicesStatus, listServices, restartService, startService, stopService } from '../src/core/manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(__dirname, '../src/core/service-runner.mjs');

async function configuredWorkspace(command = 'node runner.mjs'): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-workspace-services-'));
  await mkdir(join(cwd, '.pi'), { recursive: true });
  await mkdir(join(cwd, 'svc'), { recursive: true });
  await writeFile(join(cwd, 'svc', '.env'), 'MESSAGE=from-env\nTOKEN=super-secret\n', 'utf8');
  await writeFile(join(cwd, 'svc', 'runner.mjs'), [
    "console.log(`boot:${process.env.MESSAGE ?? 'missing'} token:${process.env.TOKEN ?? 'missing'}`);",
    "setInterval(() => console.log(`tick:${process.env.MESSAGE ?? 'missing'} token:${process.env.TOKEN ?? 'missing'}`), 50);",
  ].join('\n'), 'utf8');
  await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
    services: {
      svc: { type: 'node', path: 'svc', command, env_file: true },
    },
  }), 'utf8');
  return cwd;
}

describe('workspace service manager', () => {
  it('lists only services from the manual config', async () => {
    const cwd = await configuredWorkspace();
    const result = await listServices(cwd);
    expect(result.services).toHaveLength(1);
    expect(result.services[0]).toMatchObject({ name: 'svc', type: 'node', path: 'svc', env_file: true });
  });

  it('starts, reports status, tails redacted logs, and stops a configured service', async () => {
    const cwd = await configuredWorkspace();
    const started = await startService(cwd, 'svc');
    expect(started.status).toBe('started');
    await new Promise((resolve) => setTimeout(resolve, 220));
    const status = await getServicesStatus(cwd);
    expect(status.services.find((service) => service.name === 'svc')).toMatchObject({ name: 'svc', status: 'running' });
    const logs = await getServiceLogs(cwd, 'svc', { lines: 20 });
    expect(String((logs.data as any).text)).toContain('boot:[REDACTED]');
    expect(String((logs.data as any).text)).toContain('[REDACTED]');
    expect(String((logs.data as any).text)).not.toContain('super-secret');
    const stopped = await stopService(cwd, 'svc');
    expect(stopped.status).toBe('stopped');
  });

  it('defaults to the latest 100 log lines and supports older offset ranges', async () => {
    const cwd = await configuredWorkspace();
    const logDir = join(cwd, '.pi', 'workspace-services', 'logs');
    await mkdir(logDir, { recursive: true });
    await writeFile(join(logDir, 'svc.log'), Array.from({ length: 150 }, (_, index) => `line-${index + 1}`).join('\n') + '\n', 'utf8');

    const latest = await getServiceLogs(cwd, 'svc');
    const latestText = String((latest.data as any).text);
    expect(latestText).toContain('line-51');
    expect(latestText).toContain('line-150');
    expect(latestText).not.toContain('line-50\n');
    expect((latest.data as any).lines).toBe(100);

    const previous = await getServiceLogs(cwd, 'svc', { offset: 100, until: 150 });
    const previousText = String((previous.data as any).text);
    expect(previousText).toContain('line-1');
    expect(previousText).toContain('line-50');
    expect(previousText).not.toContain('line-51');
    expect((previous.data as any).lines).toBe(50);
  });

  it('does not persist env secrets in runtime artifacts and re-redacts existing log content when reading logs', async () => {
    const cwd = await configuredWorkspace();
    const started = await startService(cwd, 'svc');
    expect(started.status).toBe('started');
    const runtimeDir = join(cwd, '.pi', 'workspace-services');
    const artifactNames = await readdir(runtimeDir);
    expect(artifactNames.filter((name) => name.includes('runner'))).toHaveLength(0);
    await writeFile(join(runtimeDir, 'logs', 'svc.log'), 'manual super-secret token\n', { flag: 'a' });
    const logs = await getServiceLogs(cwd, 'svc', { lines: 20 });
    expect(String((logs.data as any).text)).toContain('[REDACTED]');
    expect(String((logs.data as any).text)).not.toContain('super-secret');
    await stopService(cwd, 'svc');
  });

  it('uses a one-use pipe handoff instead of runner env or argv payload transport', async () => {
    const cwd = await configuredWorkspace();
    const started = await startService(cwd, 'svc');
    expect(started.status).toBe('started');
    const runnerPid = Number((started.data as any).pid);
    const runnerEnv = await readFile(`/proc/${runnerPid}/environ`, 'utf8');
    const runnerArgv = await readFile(`/proc/${runnerPid}/cmdline`, 'utf8');
    expect(runnerEnv).not.toContain('PI_WS_RUNNER_PAYLOAD');
    expect(runnerEnv).not.toContain('super-secret');
    expect(runnerArgv).not.toContain('super-secret');
    expect(runnerArgv).not.toContain('from-env');
    await stopService(cwd, 'svc');
  });

  it('fails closed when the runner pipe payload is missing, malformed, or oversized', async () => {
    const tempRoot = await realpath(mkdtempSync(join(tmpdir(), 'pi-workspace-services-runner-')));
    const logPath = join(tempRoot, 'svc.log');

    const runRunner = async (payload: string | null): Promise<number | null> => {
      const child = spawn(process.execPath, [runnerPath], {
        cwd: tempRoot,
        stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
      });
      const handoff = child.stdio[3] as Writable | undefined;
      if (!handoff) throw new Error('runner handoff pipe unavailable in test');
      handoff.on('error', () => undefined);
      await new Promise<void>((resolve) => {
        if (payload === null) {
          handoff.end(resolve);
        } else {
          handoff.end(payload, resolve);
        }
      });
      return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
    };

    await expect(runRunner(null)).resolves.not.toBe(0);
    await expect(runRunner('{not-json')).resolves.not.toBe(0);
    await expect(runRunner(JSON.stringify({ cwd: tempRoot, command: 'node -e "setInterval(() => {}, 1000)"', logPath, env: {}, secrets: ['x'.repeat(300000)] }))).resolves.not.toBe(0);
  });

  it('proves the managed child does not inherit the runner handoff fd 3', async () => {
    const cwd = await configuredWorkspace('node fd-check.mjs');
    await writeFile(join(cwd, 'svc', 'fd-check.mjs'), [
      "import { readlinkSync } from 'node:fs';",
      "let fd3Target = 'missing';",
      "try { fd3Target = readlinkSync('/proc/self/fd/3'); } catch (error) { fd3Target = `error:${error.code ?? 'unknown'}`; }",
      "console.log(`fd3_target:${fd3Target}`);",
      'setInterval(() => {}, 1000);',
    ].join('\n'), 'utf8');

    const started = await startService(cwd, 'svc');
    expect(started.status).toBe('started');
    await new Promise((resolve) => setTimeout(resolve, 220));

    const logs = await getServiceLogs(cwd, 'svc', { lines: 20 });
    const text = String((logs.data as any).text);
    expect(text).toContain('fd3_target:');
    expect(text).not.toContain('fd3_target:pipe:[');

    await stopService(cwd, 'svc');
  });

  it('returns a cancelled outcome but reconciles running state when cancellation arrives after spawn', async () => {
    const cwd = await configuredWorkspace();
    const controller = new AbortController();
    const startPromise = startService(cwd, 'svc', { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const outcome = await startPromise;
    expect(outcome.status).toBe('cancelled');
    expect(outcome.ok).toBe(false);
    const status = await getServicesStatus(cwd);
    expect(status.services.find((service) => service.name === 'svc')?.status).toBe('running');
    await stopService(cwd, 'svc');
  });

  it('restarts a running service and truncates its log before starting again', async () => {
    const cwd = await configuredWorkspace();
    const started = await startService(cwd, 'svc');
    await new Promise((resolve) => setTimeout(resolve, 120));
    const logPath = join(cwd, '.pi', 'workspace-services', 'logs', 'svc.log');
    await writeFile(logPath, 'OLD LOG\n', { flag: 'a' });
    const restarted = await restartService(cwd, 'svc');
    expect(restarted.status).toBe('started');
    expect((restarted.data as any).pid).not.toBe((started.data as any).pid);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await stopService(cwd, 'svc');
    const log = await readFile(logPath, 'utf8');
    expect(log).not.toContain('OLD LOG');
    expect(log).toContain('boot:[REDACTED]');
  });

  it('reconciles stale status before returning the snapshot', async () => {
    const cwd = await configuredWorkspace('node -e "process.exit(0)"');
    await startService(cwd, 'svc').catch(() => undefined);
    await writeFile(join(cwd, '.pi', 'workspace-services', 'state.json'), JSON.stringify({ schemaVersion: 1, generation: 1, workspaceId: '.', services: { svc: { phase: 'running', operationId: 'op', identity: { pid: 999999, processGroupId: 999999, sessionId: 999999, bootId: 'x', startTimeTicks: '1', cmdlineSha256: 'x', cwdRelative: 'svc', cwdDevice: '1', cwdInode: '1', serviceCommandSha256: 'x' }, updatedAt: new Date().toISOString() } } }), 'utf8');
    const status = await getServicesStatus(cwd);
    expect(status.services.find((service) => service.name === 'svc')?.status).toBe('stale');
  });
});
