import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadWorkspaceServicesConfig } from '../src/config.js';
import * as dockerComposeModule from '../src/core/docker-compose.js';
import {
  COMPOSE_FILE_CANDIDATES,
  composeExecutor,
  discoverComposeServices,
  findComposeFile,
  getComposeServiceLogs,
  getComposeServicesStatus,
  parseComposePsOutput,
  restartComposeService,
  runDockerCompose,
  startComposeService,
  stopComposeService,
} from '../src/core/docker-compose.js';
import { getServiceLogs, getServicesStatus, restartService, startService, stopService } from '../src/core/manager.js';

async function createTempDir(prefix = 'pi-compose-test-'): Promise<string> {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('Docker Compose autodetection & discovery (MINI-002)', () => {
  it('identifies standard compose files in priority order', async () => {
    const cwd = await createTempDir();
    expect(findComposeFile(cwd)).toBeNull();

    // Create docker-compose.yml
    await writeFile(join(cwd, 'docker-compose.yml'), 'services: {}\n');
    expect(findComposeFile(cwd)).toBe(join(cwd, 'docker-compose.yml'));

    // Create docker-compose.yaml (higher priority than .yml)
    await writeFile(join(cwd, 'docker-compose.yaml'), 'services: {}\n');
    expect(findComposeFile(cwd)).toBe(join(cwd, 'docker-compose.yaml'));

    // Create compose.yml (higher priority than docker-compose.*)
    await writeFile(join(cwd, 'compose.yml'), 'services: {}\n');
    expect(findComposeFile(cwd)).toBe(join(cwd, 'compose.yml'));

    // Create compose.yaml (highest priority)
    await writeFile(join(cwd, 'compose.yaml'), 'services: {}\n');
    expect(findComposeFile(cwd)).toBe(join(cwd, 'compose.yaml'));
  });

  it('discovers services using docker compose config --services without npm YAML parsers', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), [
      'services:',
      '  web:',
      '    image: nginx:alpine',
      '  db:',
      '    image: postgres:15',
      '  redis:',
      '    image: redis:alpine',
    ].join('\n'), 'utf8');

    const services = await discoverComposeServices(cwd, join(cwd, 'compose.yaml'));
    expect(services.sort()).toEqual(['db', 'redis', 'web']);
  });

  it('autodetects compose file when .pi/workspace-services.json is absent', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), [
      'services:',
      '  api:',
      '    image: node:20',
      '  worker:',
      '    image: python:3.11',
    ].join('\n'), 'utf8');

    const config = await loadWorkspaceServicesConfig(cwd);
    expect(config.exists).toBe(true);
    expect(Object.keys(config.services).sort()).toEqual(['api', 'worker']);
    expect(config.services.api).toMatchObject({
      name: 'api',
      type: 'compose',
      relativePath: 'compose.yaml',
      cwd,
      command: 'docker compose up -d api',
      envFile: false,
    });
    expect(config.services.worker).toMatchObject({
      name: 'worker',
      type: 'compose',
      relativePath: 'compose.yaml',
      cwd,
      command: 'docker compose up -d worker',
      envFile: false,
    });
  });

  it('merges compose services and host services, with JSON config taking precedence on collisions', async () => {
    const cwd = await createTempDir();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await mkdir(join(cwd, 'api'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      services: {
        api: { type: 'node', path: 'api', command: 'npm start', env_file: false },
        hostsvc: { type: 'node', path: 'api', command: 'node host.js', env_file: false },
      },
    }), 'utf8');

    await writeFile(join(cwd, 'compose.yaml'), [
      'services:',
      '  api:', // collision!
      '    image: node:20',
      '  postgres:',
      '    image: postgres:15',
    ].join('\n'), 'utf8');

    const config = await loadWorkspaceServicesConfig(cwd);
    expect(config.exists).toBe(true);
    // api should retain explicit host config
    expect(config.services.api.type).toBe('node');
    expect(config.services.api.command).toBe('npm start');
    // hostsvc preserved
    expect(config.services.hostsvc.type).toBe('node');
    // postgres added as compose
    expect(config.services.postgres.type).toBe('compose');
  });

  it('handles invalid compose syntax gracefully without throwing uncaught exceptions', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), 'invalid: [yaml: broken syntax\n', 'utf8');

    const services = await discoverComposeServices(cwd, join(cwd, 'compose.yaml'));
    expect(services).toEqual([]);

    const config = await loadWorkspaceServicesConfig(cwd);
    expect(config.exists).toBe(true);
    expect(config.services).toEqual({});
  });
});

describe('Project-relative Compose configuration', () => {
  async function configuredComposeWorkspace(): Promise<string> {
    const cwd = await createTempDir();
    await mkdir(join(cwd, '.pi'));
    await mkdir(join(cwd, 'infra'));
    await writeFile(join(cwd, 'infra', 'development.yml'), 'services:\n  web:\n    image: nginx\n');
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      compose_file: 'infra/development.yml',
      services: {},
    }));
    return cwd;
  }

  it('uses the configured relative file instead of a standard file in the root', async () => {
    const cwd = await configuredComposeWorkspace();
    const composeFile = join(cwd, 'infra', 'development.yml');
    await writeFile(join(cwd, 'compose.yaml'), 'services: {}\n');
    const runSpy = vi.spyOn(composeExecutor, 'run').mockResolvedValue({ stdout: 'web\n', stderr: '', exitCode: 0 });
    try {
      const config = await loadWorkspaceServicesConfig(cwd);
      expect(config).toMatchObject({ exists: true, composeFile });
      expect(config.services.web).toMatchObject({
        type: 'compose', relativePath: 'infra/development.yml', cwd, composeFile,
      });
      expect(runSpy).toHaveBeenCalledWith(cwd, ['config', '--services'], expect.objectContaining({ composeFile }));
    } finally {
      runSpy.mockRestore();
    }
  });

  it('passes the configured file to explicitly declared Compose services', async () => {
    const cwd = await configuredComposeWorkspace();
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      compose_file: 'infra/development.yml',
      services: { web: { type: 'compose', path: '.', command: 'docker compose up -d web', env_file: false } },
    }));
    const runSpy = vi.spyOn(composeExecutor, 'run').mockResolvedValue({ stdout: 'web\n', stderr: '', exitCode: 0 });
    try {
      const config = await loadWorkspaceServicesConfig(cwd);
      expect(config.services.web).toMatchObject({ relativePath: '.', composeFile: join(cwd, 'infra', 'development.yml') });
    } finally {
      runSpy.mockRestore();
    }
  });

  it.each([
    ['start', 'all', ['up', '-d']],
    ['start', 'compose', ['up', '-d']],
    ['stop', 'all', ['stop']],
    ['stop', 'compose', ['stop']],
    ['restart', 'all', ['restart']],
    ['restart', 'compose', ['restart']],
    ['start', 'web', ['up', '-d', 'web']],
    ['stop', 'web', ['stop', 'web']],
    ['restart', 'web', ['restart', 'web']],
  ] as const)('uses the configured file for %s target %s', async (action, target, args) => {
    const cwd = await configuredComposeWorkspace();
    const runSpy = vi.spyOn(composeExecutor, 'run').mockImplementation(async (_cwd, command) => ({
      stdout: command[0] === 'config' ? 'web\n' : '', stderr: '', exitCode: 0,
    }));
    try {
      const operations = { start: startService, stop: stopService, restart: restartService };
      const outcome = await operations[action](cwd, target);
      expect(outcome.ok).toBe(true);
      expect(runSpy).toHaveBeenCalledWith(cwd, args, expect.objectContaining({ composeFile: join(cwd, 'infra', 'development.yml') }));
    } finally {
      runSpy.mockRestore();
    }
  });

  it('uses the configured file for status and logs', async () => {
    const cwd = await configuredComposeWorkspace();
    const composeFile = join(cwd, 'infra', 'development.yml');
    const runSpy = vi.spyOn(composeExecutor, 'run').mockImplementation(async (_cwd, args) => ({
      stdout: args[0] === 'config' ? 'web\n' : args[0] === 'ps'
        ? JSON.stringify([{ ID: 'web1', Name: 'web', Service: 'web', State: 'running' }]) : 'ready\n',
      stderr: '', exitCode: 0,
    }));
    try {
      const status = await getServicesStatus(cwd);
      expect(status.services[0]).toMatchObject({ name: 'web', status: 'running' });
      expect(runSpy).toHaveBeenCalledWith(cwd, ['ps', '--all', '--format', 'json'], expect.objectContaining({ composeFile }));
      const logs = await getServiceLogs(cwd, 'web', { lines: 5 });
      expect(logs.ok).toBe(true);
      expect(runSpy).toHaveBeenCalledWith(cwd, ['logs', '--no-color', '--tail', '5', 'web'], expect.objectContaining({ composeFile }));
    } finally {
      runSpy.mockRestore();
    }
  });

  it.each([null, '', '   ', false, 42, '/tmp/compose.yaml', '../compose.yaml', 'infra/missing.yml', 'infra'])
    ('rejects invalid compose_file %j before running Docker', async (compose_file) => {
      const cwd = await configuredComposeWorkspace();
      await writeFile(join(cwd, 'compose.yaml'), 'services: {}\n');
      await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({ compose_file, services: {} }));
      const runSpy = vi.spyOn(composeExecutor, 'run').mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
      try {
        await expect(loadWorkspaceServicesConfig(cwd)).rejects.toThrow(/compose_file/i);
        expect(runSpy).not.toHaveBeenCalled();
      } finally {
        runSpy.mockRestore();
      }
    });

  it('rejects a configured file symlink escaping the project', async () => {
    const cwd = await configuredComposeWorkspace();
    const outside = await createTempDir();
    await writeFile(join(outside, 'compose.yml'), 'services: {}\n');
    await symlink(join(outside, 'compose.yml'), join(cwd, 'infra', 'linked.yml'));
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({ compose_file: 'infra/linked.yml', services: {} }));
    const runSpy = vi.spyOn(composeExecutor, 'run').mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    try {
      await expect(loadWorkspaceServicesConfig(cwd)).rejects.toThrow(/compose_file.*workspace boundary/i);
      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      runSpy.mockRestore();
    }
  });
});

describe('Per-service container status & isolated logs (MINI-003)', () => {
  it('parses NDJSON output from docker compose ps accurately', () => {
    const ndjson = [
      '{"ID":"c1a2b3","Name":"proj-web-1","Service":"web","State":"running","Health":"healthy","ExitCode":0,"Publishers":[{"URL":"","TargetPort":80,"PublishedPort":8080,"Protocol":"tcp"}]}',
      '{"ID":"d4e5f6","Name":"proj-db-1","Service":"db","State":"exited","Health":"","ExitCode":137,"Publishers":null}',
    ].join('\n');

    const parsed = parseComposePsOutput(ndjson);
    expect(parsed).toHaveLength(2);

    expect(parsed[0]).toEqual({
      id: 'c1a2b3',
      name: 'proj-web-1',
      service: 'web',
      state: 'running',
      health: 'healthy',
      exitCode: 0,
      ports: '8080->80/tcp',
      raw: expect.any(Object),
    });

    expect(parsed[1]).toEqual({
      id: 'd4e5f6',
      name: 'proj-db-1',
      service: 'db',
      state: 'exited',
      health: undefined,
      exitCode: 137,
      ports: undefined,
      raw: expect.any(Object),
    });
  });

  it('parses JSON array output from docker compose ps', () => {
    const jsonArray = JSON.stringify([
      {
        ID: 'aabbcc',
        Name: 'app-redis-1',
        Service: 'redis',
        State: 'running',
        Status: 'Up 10 hours (healthy)',
        ExitCode: 0,
        Ports: '6379/tcp',
      },
    ]);

    const parsed = parseComposePsOutput(jsonArray);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: 'aabbcc',
      service: 'redis',
      state: 'running',
      health: 'healthy',
      ports: '6379/tcp',
    });
  });

  it('maps compose container state to ServiceStatus in getServicesStatus', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), [
      'services:',
      '  web:',
      '    image: nginx:alpine',
      '  db:',
      '    image: postgres:15',
    ].join('\n'), 'utf8');

    // Spy on getComposeServicesStatus
    const statusSpy = vi.spyOn(dockerComposeModule, 'getComposeServicesStatus').mockResolvedValueOnce([
      { id: '112233', name: 'proj-web-1', service: 'web', state: 'running', health: 'healthy', ports: '80->80/tcp' },
      { id: '445566', name: 'proj-db-1', service: 'db', state: 'exited', exitCode: 0 },
    ]);

    const statusResult = await getServicesStatus(cwd);
    expect(statusResult.exists).toBe(true);
    expect(statusResult.services).toHaveLength(2);

    const webStatus = statusResult.services.find((s) => s.name === 'web');
    expect(webStatus).toMatchObject({
      name: 'web',
      type: 'compose',
      status: 'running',
      container_id: '112233',
      health: 'healthy',
      ports: '80->80/tcp',
    });

    const dbStatus = statusResult.services.find((s) => s.name === 'db');
    expect(dbStatus).toMatchObject({
      name: 'db',
      type: 'compose',
      status: 'stopped',
      container_id: '445566',
      exit_code: 0,
    });

    statusSpy.mockRestore();
  });

  it('isolates logs per service and mirrors output to config.logsDir/${serviceName}.log', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), [
      'services:',
      '  web:',
      '    image: nginx:alpine',
    ].join('\n'), 'utf8');

    const runSpy = vi.spyOn(composeExecutor, 'run').mockImplementation(async (_cwd, args) => {
      if (args[0] === 'logs') {
        return {
          stdout: '2026-09-20T00:00:00Z [INFO] GET / HTTP/1.1 200\n2026-09-20T00:00:01Z [INFO] GET /favicon.ico 404\n',
          stderr: '',
          exitCode: 0,
        };
      }
      return { stdout: 'web\n', stderr: '', exitCode: 0 };
    });

    const outcome = await getServiceLogs(cwd, 'web', { lines: 50 });
    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe('running');
    expect(outcome.summary).toContain('Retrieved bounded logs for web');
    expect((outcome.data as any).lines).toBe(2);
    expect((outcome.data as any).text).toContain('GET / HTTP/1.1 200');

    // Verify mirrored file
    const logFilePath = join(cwd, '.pi', 'workspace-services', 'logs', 'web.log');
    const mirroredContent = await readFile(logFilePath, 'utf8');
    expect(mirroredContent).toContain('GET / HTTP/1.1 200');

    runSpy.mockRestore();
  });
});

describe('Individual & full-stack container controls (MINI-004)', () => {
  it('starts an individual compose service using docker compose up -d <service>', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n', 'utf8');

    const runSpy = vi.spyOn(composeExecutor, 'run').mockImplementation(async (_cwd, args) => {
      if (args[0] === 'up') {
        return { stdout: 'Container proj-web-1 Started\n', stderr: '', exitCode: 0 };
      }
      return { stdout: 'web\n', stderr: '', exitCode: 0 };
    });

    const outcome = await startService(cwd, 'web');
    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe('started');
    expect(outcome.summary).toBe('web started.');
    expect(runSpy).toHaveBeenCalledWith(
      cwd,
      ['up', '-d', 'web'],
      expect.objectContaining({ composeFile: join(cwd, 'compose.yaml') }),
    );

    runSpy.mockRestore();
  });

  it('stops an individual compose service using docker compose stop <service>', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n', 'utf8');

    const runSpy = vi.spyOn(composeExecutor, 'run').mockImplementation(async (_cwd, args) => {
      if (args[0] === 'stop') {
        return { stdout: 'Container proj-web-1 Stopped\n', stderr: '', exitCode: 0 };
      }
      return { stdout: 'web\n', stderr: '', exitCode: 0 };
    });

    const outcome = await stopService(cwd, 'web');
    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe('stopped');
    expect(outcome.summary).toBe('web stopped.');
    expect(runSpy).toHaveBeenCalledWith(
      cwd,
      ['stop', 'web'],
      expect.objectContaining({ composeFile: join(cwd, 'compose.yaml') }),
    );

    runSpy.mockRestore();
  });

  it('restarts an individual compose service using docker compose restart <service>', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n', 'utf8');

    const runSpy = vi.spyOn(composeExecutor, 'run').mockImplementation(async (_cwd, args) => {
      if (args[0] === 'restart') {
        return { stdout: 'Container proj-web-1 Started\n', stderr: '', exitCode: 0 };
      }
      return { stdout: 'web\n', stderr: '', exitCode: 0 };
    });

    const outcome = await restartService(cwd, 'web');
    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe('started');
    expect(outcome.summary).toBe('web restarted.');
    expect(runSpy).toHaveBeenCalledWith(
      cwd,
      ['restart', 'web'],
      expect.objectContaining({ composeFile: join(cwd, 'compose.yaml') }),
    );

    runSpy.mockRestore();
  });

  it('triggers full-stack commands when target is "all" or "compose"', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n', 'utf8');

    const runSpy = vi.spyOn(composeExecutor, 'run')
      .mockResolvedValue({ stdout: 'Done\n', stderr: '', exitCode: 0 });

    const startAll = await startService(cwd, 'all');
    expect(startAll.ok).toBe(true);
    expect(startAll.summary).toBe('Docker Compose stack started.');
    expect(runSpy).toHaveBeenLastCalledWith(cwd, ['up', '-d'], expect.anything());

    const stopCompose = await stopService(cwd, 'compose');
    expect(stopCompose.ok).toBe(true);
    expect(stopCompose.summary).toBe('Docker Compose stack stopped.');
    expect(runSpy).toHaveBeenLastCalledWith(cwd, ['stop'], expect.anything());

    const restartAll = await restartService(cwd, 'all');
    expect(restartAll.ok).toBe(true);
    expect(restartAll.summary).toBe('Docker Compose stack restarted.');
    expect(runSpy).toHaveBeenLastCalledWith(cwd, ['restart'], expect.anything());

    runSpy.mockRestore();
  });

  it('reports already_running when a compose service is already running on start', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n', 'utf8');

    const statusSpy = vi.spyOn(composeExecutor, 'getServicesStatus').mockResolvedValueOnce([
      { id: 'web123', name: 'proj-web-1', service: 'web', state: 'running' },
    ]);

    const outcome = await startService(cwd, 'web');
    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe('already_running');
    expect(outcome.summary).toBe('web is already running.');
    expect((outcome.data as any).containerId).toBe('web123');

    statusSpy.mockRestore();
  });

  it('handles timeout and abort signals gracefully', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n', 'utf8');

    const controller = new AbortController();
    controller.abort();

    const cancelledOutcome = await startService(cwd, 'web', { signal: controller.signal });
    expect(cancelledOutcome.ok).toBe(false);
    expect(cancelledOutcome.status).toBe('cancelled');
    expect(cancelledOutcome.summary).toContain('cancelled before completion');
  });

  it('handles CLI failure gracefully returning failed outcome', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n', 'utf8');

    const runSpy = vi.spyOn(composeExecutor, 'run').mockImplementation(async (_cwd, args) => {
      if (args[0] === 'up') {
        return { stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock', exitCode: 1 };
      }
      return { stdout: 'web\n', stderr: '', exitCode: 0 };
    });

    const outcome = await startService(cwd, 'web');
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe('failed');
    expect(outcome.summary).toContain('docker compose up failed');
    expect(outcome.nextAction).toContain('Docker daemon');

    runSpy.mockRestore();
  });

  it('handles execution timeout returning timeout outcome', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n', 'utf8');

    const runSpy = vi.spyOn(composeExecutor, 'run').mockImplementation(async (_cwd, args) => {
      if (args[0] === 'up') {
        throw new Error('Docker compose command timed out after 500ms.');
      }
      return { stdout: 'web\n', stderr: '', exitCode: 0 };
    });

    const outcome = await startService(cwd, 'web', { timeoutMs: 500 });
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe('timeout');
    expect(outcome.summary).toContain('timed out');

    runSpy.mockRestore();
  });
});
