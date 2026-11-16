import { mkdtempSync } from 'node:fs';
import { mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { Writable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { getServiceLogs, getServicesStatus, hostProcessAdapter, listServices, restartService, startService, stopService } from '../src/core/manager.js';

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
    const flagPath = join(cwd, 'svc', 'started.flag');
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      services: {
        svc: {
          type: 'node',
          path: 'svc',
          command: `node -e "import('node:fs').then(fs => { fs.writeFileSync('${flagPath}', '1'); setInterval(() => {}, 1000); })"`,
          env_file: false,
        },
      },
    }), 'utf8');

    const controller = new AbortController();
    const startPromise = startService(cwd, 'svc', { signal: controller.signal });

    for (let i = 0; i < 200; i++) {
      try {
        await readFile(flagPath);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    controller.abort();

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
    const validSha = 'a'.repeat(64);
    await writeFile(join(cwd, '.pi', 'workspace-services', 'state.json'), JSON.stringify({ schemaVersion: 1, generation: 1, workspaceId: '.', services: { svc: { phase: 'running', operationId: 'op', identity: { pid: 999999, processGroupId: 999999, sessionId: 999999, bootId: 'x', startTimeTicks: '1', cmdlineSha256: validSha, cwdRelative: 'svc', cwdDevice: '1', cwdInode: '1', serviceCommandSha256: validSha }, updatedAt: new Date().toISOString() } } }), 'utf8');
    const status = await getServicesStatus(cwd);
    expect(status.services.find((service) => service.name === 'svc')?.status).toBe('stale');
  });

  it('returns a timeout outcome when startup exceeds timeoutMs and does not leave starting state', async () => {
    const cwd = await configuredWorkspace();
    // Use an impossibly low timeoutMs (100ms) where spawn/health check cannot complete in time
    const outcome = await startService(cwd, 'svc', { timeoutMs: 100 });
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe('timeout');
    expect(outcome.summary).toContain('timed out');
    const status = await getServicesStatus(cwd);
    // Service state should be stopped, not starting
    expect(status.services.find((service) => service.name === 'svc')?.status).toBe('stopped');
  });

  it('cleans up starting state when service fails immediately', async () => {
    const cwd = await configuredWorkspace('node -e "process.exit(1)"');
    await expect(startService(cwd, 'svc')).rejects.toThrow(/exited immediately/);
    const rawState = JSON.parse(await readFile(join(cwd, '.pi', 'workspace-services', 'state.json'), 'utf8'));
    expect(rawState.services.svc).toBeUndefined();
  });
});

describe('contracts:mock manager tool contracts', () => {
  async function syntheticWorkspace(envFile = false): Promise<string> {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-ws-mock-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await mkdir(join(cwd, 'svc'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      services: {
        svc: { type: 'node', path: 'svc', command: 'node app.js', env_file: envFile },
      },
    }), 'utf8');
    return cwd;
  }

  it('paginates a 300-line synthetic host log cleanly without overlap, skip, or infinite offset loop', async () => {
    const cwd = await syntheticWorkspace();
    try {
      const logDir = join(cwd, '.pi', 'workspace-services', 'logs');
      await mkdir(logDir, { recursive: true });
      await writeFile(join(logDir, 'svc.log'), Array.from({ length: 300 }, (_, i) => `L${i + 1}`).join('\n') + '\n', 'utf8');

      const page1 = await getServiceLogs(cwd, 'svc', { lines: 100, offset: 0 });
      expect(page1.ok).toBe(true);
      expect(page1.status).toBe('ok');
      expect((page1.data as any).text.split('\n')[0]).toBe('L201');
      expect((page1.data as any).text.split('\n').at(-1)).toBe('L300');
      expect(page1.truncation).toMatchObject({ returned: 100, total: 300, hasMore: true });
      expect(page1.truncation?.continuation).toContain('offset=100');

      const page2 = await getServiceLogs(cwd, 'svc', { lines: 100, offset: 100 });
      expect((page2.data as any).text.split('\n')[0]).toBe('L101');
      expect((page2.data as any).text.split('\n').at(-1)).toBe('L200');
      expect(page2.truncation).toMatchObject({ returned: 100, total: 300, hasMore: true });
      expect(page2.truncation?.continuation).toContain('offset=200');

      const page3 = await getServiceLogs(cwd, 'svc', { lines: 100, offset: 200 });
      expect((page3.data as any).text.split('\n')[0]).toBe('L1');
      expect((page3.data as any).text.split('\n').at(-1)).toBe('L100');
      expect(page3.truncation).toMatchObject({ returned: 100, total: 300, hasMore: false });
      expect(page3.truncation?.continuation).toBeUndefined();

      const outOfRange = await getServiceLogs(cwd, 'svc', { lines: 100, offset: 500 });
      expect(outOfRange.truncation).toMatchObject({ returned: 0, total: 300, hasMore: false });
      expect(outOfRange.truncation?.continuation).toBeUndefined();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('includes blank lines in counts/offsets, omits global total on byte-truncated files, and enforces post-redaction byte bounds', async () => {
    const cwd = await syntheticWorkspace(true);
    try {
      await writeFile(join(cwd, 'svc', '.env'), 'SECRET=synth-secret-val\n', 'utf8');
      const logDir = join(cwd, '.pi', 'workspace-services', 'logs');
      await mkdir(logDir, { recursive: true });

      // Blank lines count consistently
      await writeFile(join(logDir, 'svc.log'), 'a\n\nb\n', 'utf8');
      const blankRes = await getServiceLogs(cwd, 'svc', { lines: 10 });
      expect(blankRes.truncation?.returned).toBe(3);
      expect((blankRes.data as any).lines).toBe(3);
      expect((blankRes.data as any).text).toBe('a\n\nb');

      // Byte-truncated file (> maxBytes) omits global total and suggests max_bytes when below cap
      const largeContent = Array.from({ length: 100 }, (_, i) => `row-${i}-${'z'.repeat(20)}`).join('\n') + '\n';
      await writeFile(join(logDir, 'svc.log'), largeContent, 'utf8');
      const truncRes = await getServiceLogs(cwd, 'svc', { lines: 100, maxBytes: 1024 });
      expect(truncRes.truncation?.total).toBeUndefined();
      expect((truncRes.data as any).inspectedWindowLines).toBeGreaterThan(0);
      expect(truncRes.truncation?.hasMore).toBe(true);
      expect(truncRes.truncation?.continuation).toContain('max_bytes=');

      // Post-redaction expansion stays <= maxBytes and redacts known secrets
      await writeFile(join(cwd, 'svc', '.env'), 'SECRET=ab\n', 'utf8');
      await writeFile(join(logDir, 'svc.log'), Array.from({ length: 120 }, () => 'val=ab').join('\n') + '\n', 'utf8');
      const redactedRes = await getServiceLogs(cwd, 'svc', { lines: 200, maxBytes: 1024 });
      const text = String((redactedRes.data as any).text);
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(1024);
      expect(text).not.toContain('val=ab');
      expect(text).toContain('val=[REDACTED]');

      // UTF-8 oversized single line (> maxBytes) returns valid UTF-8 tail <= maxBytes
      await writeFile(join(logDir, 'svc.log'), '🚀'.repeat(600), 'utf8');
      const bigSingle = await getServiceLogs(cwd, 'svc', { lines: 10, maxBytes: 1024 });
      const bigText = String((bigSingle.data as any).text);
      expect(Buffer.byteLength(bigText, 'utf8')).toBeLessThanOrEqual(1024);
      expect(bigText).not.toContain('\uFFFD');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('supports until ranges, respects lines with until, handles missing log files as status=ok, and stops at max offset/byte limits', async () => {
    const cwd = await syntheticWorkspace();
    try {
      const missing = await getServiceLogs(cwd, 'svc');
      expect(missing.ok).toBe(true);
      expect(missing.status).toBe('ok');
      expect(missing.truncation).toMatchObject({ returned: 0, total: 0, hasMore: false });

      const logDir = join(cwd, '.pi', 'workspace-services', 'logs');
      await mkdir(logDir, { recursive: true });
      await writeFile(join(logDir, 'svc.log'), Array.from({ length: 300 }, (_, i) => `U${i + 1}`).join('\n') + '\n', 'utf8');

      const untilRange = await getServiceLogs(cwd, 'svc', { offset: 100, until: 200 });
      expect(untilRange.truncation?.returned).toBe(100);
      expect((untilRange.data as any).text.split('\n')[0]).toBe('U101');
      expect((untilRange.data as any).text.split('\n').at(-1)).toBe('U200');

      const emptyRange = await getServiceLogs(cwd, 'svc', { offset: 100, until: 100 });
      expect(emptyRange.truncation).toMatchObject({ returned: 0, hasMore: false });

      // Max offset reach
      await writeFile(join(logDir, 'svc.log'), Array.from({ length: 2200 }, (_, i) => `L${i + 1}`).join('\n') + '\n', 'utf8');
      const atMaxOffset = await getServiceLogs(cwd, 'svc', { lines: 100, offset: 2000 });
      expect(atMaxOffset.truncation?.hasMore).toBe(false);
      expect(atMaxOffset.truncation?.continuation).toBeUndefined();
      expect((atMaxOffset.data as any).limitReached).toBeTruthy();

      // Max byte reach (204800)
      await writeFile(join(logDir, 'svc.log'), Array.from({ length: 2500 }, (_, i) => `BIG-${i}-${'m'.repeat(100)}`).join('\n') + '\n', 'utf8');
      const atMaxBytes = await getServiceLogs(cwd, 'svc', { lines: 2000, maxBytes: 204800 });
      expect(atMaxBytes.truncation?.total).toBeUndefined();
      expect(atMaxBytes.truncation?.hasMore).toBe(false);
      expect((atMaxBytes.data as any).limitReached).toContain('204800');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('keeps listServices and getServicesStatus metadata-only without reading .env contents', async () => {
    const cwd = await syntheticWorkspace(true);
    try {
      // No .env file present even though env_file: true -> metadata-only reads must succeed
      const listed = await listServices(cwd);
      expect(listed.services[0]).toMatchObject({ name: 'svc', env_file: true, env_file_present: false });
      const status = await getServicesStatus(cwd);
      expect(status.services[0]).toMatchObject({ name: 'svc', env_file: true, status: 'stopped' });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('prepares runtime dirs and idempotent .gitignore during restart on fresh workspace, and blocks unsafe spawn on failed identity check', async () => {
    const cwd = await syntheticWorkspace(true);
    try {
      await writeFile(join(cwd, 'svc', '.env'), 'SECRET=top-secret-val\n', 'utf8');
      const spawnSpy = vi.spyOn(hostProcessAdapter, 'spawnRunner').mockImplementation(async (_cfg, service, truncateLog) => {
        // Real restart must have ensured logsDir and truncated/prepared log before spawning
        if (truncateLog) await writeFile(service.logPath, 'fresh-header\n', 'utf8');
        return 43210;
      });
      const captureSpy = vi.spyOn(hostProcessAdapter, 'captureManagedIdentity').mockResolvedValue({
        pid: 43210,
        processGroupId: 43210,
        sessionId: 43210,
        bootId: 'boot-1',
        startTimeTicks: '100',
        cmdlineSha256: 'a'.repeat(64),
        cwdRelative: 'svc',
        cwdDevice: '1',
        cwdInode: '1',
        serviceCommandSha256: 'b'.repeat(64),
      });
      const validateSpy = vi.spyOn(hostProcessAdapter, 'validateManagedIdentity').mockResolvedValue({
        ok: false,
        reason: 'identity mismatch (command line)',
      });
      const absentSpy = vi.spyOn(hostProcessAdapter, 'confirmGroupAbsent').mockResolvedValue(true);
      const killSpy = vi.spyOn(hostProcessAdapter, 'kill').mockImplementation(() => true as any);

      try {
        const res1 = await restartService(cwd, 'svc');
        expect(res1.ok).toBe(true);
        expect(res1.status).toBe('started');
        expect(spawnSpy).toHaveBeenCalledTimes(1);

        // Repeat restart: .gitignore entry present exactly once, no ENOENT
        validateSpy.mockResolvedValueOnce({
          ok: true,
          identity: {
            pid: 43210,
            processGroupId: 43210,
            sessionId: 43210,
            bootId: 'boot-1',
            startTimeTicks: '100',
            cmdlineSha256: 'a'.repeat(64),
            cwdRelative: 'svc',
            cwdDevice: '1',
            cwdInode: '1',
            serviceCommandSha256: 'b'.repeat(64),
          },
        });
        const res2 = await restartService(cwd, 'svc');
        expect(res2.ok).toBe(true);
        const gitignore = await readFile(join(cwd, '.gitignore'), 'utf8');
        expect(gitignore.match(/\.pi\/workspace-services\//g)).toHaveLength(1);

        // Failed identity check must prevent replacement spawn and leave log untouched
        await writeFile(join(cwd, '.pi', 'workspace-services', 'logs', 'svc.log'), 'KEEP_THIS_LOG\n', 'utf8');
        validateSpy.mockResolvedValueOnce({ ok: false, reason: 'identity mismatch (command line) with top-secret-val' });
        const spawnCountBefore = spawnSpy.mock.calls.length;
        const mismatchRes = await restartService(cwd, 'svc');
        expect(mismatchRes.ok).toBe(false);
        expect(mismatchRes.status).toBe('identity_mismatch');
        expect(JSON.stringify(mismatchRes)).not.toContain('top-secret-val');
        expect(spawnSpy).toHaveBeenCalledTimes(spawnCountBefore);
        expect(await readFile(join(cwd, '.pi', 'workspace-services', 'logs', 'svc.log'), 'utf8')).toBe('KEEP_THIS_LOG\n');

        // Failed group-absence check must prevent replacement spawn and leave log untouched
        validateSpy.mockResolvedValueOnce({
          ok: true,
          identity: {
            pid: 43210,
            processGroupId: 43210,
            sessionId: 43210,
            bootId: 'boot-1',
            startTimeTicks: '100',
            cmdlineSha256: 'a'.repeat(64),
            cwdRelative: 'svc',
            cwdDevice: '1',
            cwdInode: '1',
            serviceCommandSha256: 'b'.repeat(64),
          },
        });
        absentSpy.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
        const timeoutRes = await restartService(cwd, 'svc');
        expect(timeoutRes.ok).toBe(false);
        expect(timeoutRes.status).toBe('timeout');
        expect(spawnSpy).toHaveBeenCalledTimes(spawnCountBefore);
        expect(await readFile(join(cwd, '.pi', 'workspace-services', 'logs', 'svc.log'), 'utf8')).toBe('KEEP_THIS_LOG\n');
      } finally {
        spawnSpy.mockRestore();
        captureSpy.mockRestore();
        validateSpy.mockRestore();
        absentSpy.mockRestore();
        killSpy.mockRestore();
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
