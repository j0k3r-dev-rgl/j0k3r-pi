import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getServiceLogs,
  getServicesStatus,
  listServices,
  restartService,
  startService,
  stopService,
} from '../src/manager.js';

async function configuredWorkspace(): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-workspace-services-'));
  await mkdir(join(cwd, '.pi'), { recursive: true });
  await mkdir(join(cwd, 'svc'), { recursive: true });
  await writeFile(join(cwd, 'svc', '.env'), 'MESSAGE=from-env\n', 'utf8');
  await writeFile(join(cwd, 'svc', 'runner.mjs'), [
    "console.log(`boot:${process.env.MESSAGE ?? 'missing'}`);",
    "setInterval(() => console.log(`tick:${process.env.MESSAGE ?? 'missing'}`), 50);",
  ].join('\n'), 'utf8');
  await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
    services: {
      svc: {
        type: 'node',
        path: 'svc',
        command: 'node runner.mjs',
        env_file: true,
      },
    },
  }), 'utf8');
  return cwd;
}

describe('workspace service manager', () => {
  it('lists only services from the manual config', async () => {
    const cwd = await configuredWorkspace();

    const result = await listServices(cwd);

    expect(result.services).toHaveLength(1);
    expect(result.services[0]).toMatchObject({
      name: 'svc',
      type: 'node',
      path: 'svc',
      command: 'node runner.mjs',
      env_file: true,
      env_file_present: true,
    });
  });

  it('starts, reports status, tails logs, and stops a configured service', async () => {
    const cwd = await configuredWorkspace();

    const started = await startService(cwd, 'svc');
    expect(started.status).toBe('started');
    expect(started.pid).toEqual(expect.any(Number));
    expect(started.logPath).toBe(join(cwd, '.pi', 'workspace-services', 'logs', 'svc.log'));

    await new Promise((resolve) => setTimeout(resolve, 180));

    const status = await getServicesStatus(cwd);
    expect(status.services.find((service) => service.name === 'svc')).toMatchObject({
      name: 'svc',
      status: 'running',
      pid: started.pid,
    });

    const logs = await getServiceLogs(cwd, 'svc', { lines: 20 });
    expect(logs.text).toContain('boot:from-env');
    expect(logs.text).not.toContain('MESSAGE=from-env');

    const stopped = await stopService(cwd, 'svc');
    expect(stopped.status).toBe('stopped');
  });

  it('restarts a service and truncates its log before starting again', async () => {
    const cwd = await configuredWorkspace();
    await startService(cwd, 'svc');
    await new Promise((resolve) => setTimeout(resolve, 120));
    await stopService(cwd, 'svc');
    const logPath = join(cwd, '.pi', 'workspace-services', 'logs', 'svc.log');
    await writeFile(logPath, 'OLD LOG\n', { flag: 'a' });

    const restarted = await restartService(cwd, 'svc');
    expect(restarted.status).toBe('started');
    await new Promise((resolve) => setTimeout(resolve, 120));
    await stopService(cwd, 'svc');

    const log = await readFile(logPath, 'utf8');
    expect(log).not.toContain('OLD LOG');
    expect(log).toContain('boot:from-env');
  });
});
