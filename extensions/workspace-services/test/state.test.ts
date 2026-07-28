import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { mkdir, open as openFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadWorkspaceServicesConfig } from '../src/config.js';
import { LAST_GOOD_STATE_RELATIVE_PATH, RUNTIME_RELATIVE_DIR, STATE_RELATIVE_PATH } from '../src/config.js';
import { commitRuntimeState, openRuntimeState } from '../src/core/state.js';
import { assertPinnedLeafIdentity, closePinnedDirectory, pinRelativeWorkspaceDirectory, readPinnedTextFile, writePinnedTextFileAtomically } from '../src/security.js';
import { withLifecycleTransaction } from '../src/core/transaction.js';

const execFileAsync = promisify(execFile);

async function workspace(): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-workspace-services-state-'));
  await mkdir(join(cwd, '.pi'), { recursive: true });
  await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({ services: {} }), 'utf8');
  return cwd;
}

async function createFifo(path: string): Promise<void> {
  await execFileAsync('mkfifo', [path]);
}

async function expectRejectsWithin<T>(promise: Promise<T>, timeoutMs: number, release?: () => Promise<void>): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => {
          throw new Error('expected rejection');
        },
        (error) => error,
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`operation did not reject within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (release) await release().catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('workspace service state and transactions', () => {
  it('recovers from an invalid primary state using the last-known-good record', async () => {
    const cwd = await workspace();
    const config = await loadWorkspaceServicesConfig(cwd);
    const initial = await openRuntimeState(config);
    await commitRuntimeState(config, initial.state, {
      ...initial.state,
      services: {
        svc: {
          phase: 'running',
          operationId: 'op1',
          updatedAt: new Date().toISOString(),
          identity: {
            pid: 123,
            processGroupId: 123,
            sessionId: 123,
            bootId: 'boot-id',
            startTimeTicks: '1',
            cmdlineSha256: 'a'.repeat(64),
            cwdRelative: 'svc',
            cwdDevice: '1',
            cwdInode: '1',
            serviceCommandSha256: 'b'.repeat(64),
          },
        },
      },
    });
    await writeFile(config.statePath, '{not-json', 'utf8');
    const recovered = await openRuntimeState(config);
    expect(recovered.recovered).toBe(true);
    expect(recovered.state.services.svc?.phase).toBe('running');
  });

  it('fails closed when no valid recovery record exists', async () => {
    const cwd = await workspace();
    const config = await loadWorkspaceServicesConfig(cwd);
    await mkdir(config.runtimeDir, { recursive: true });
    await writeFile(config.statePath, '{bad', 'utf8');
    await writeFile(config.lastGoodStatePath, '{bad', 'utf8');
    await expect(openRuntimeState(config)).rejects.toThrow(/recovery required/i);
  });

  it('rejects invalid service keys and incomplete managed identities', async () => {
    const cwd = await workspace();
    const config = await loadWorkspaceServicesConfig(cwd);
    await mkdir(config.runtimeDir, { recursive: true });
    await writeFile(config.statePath, JSON.stringify({
      schemaVersion: 1,
      generation: 1,
      workspaceId: '.',
      services: {
        '../bad': {
          phase: 'running',
          operationId: 'op1',
          updatedAt: new Date().toISOString(),
          identity: { pid: 123 },
        },
      },
    }), 'utf8');
    await writeFile(config.lastGoodStatePath, JSON.stringify({ schemaVersion: 1, generation: 0, workspaceId: '.', services: {} }), 'utf8');
    const recovered = await openRuntimeState(config);
    expect(recovered.recovered).toBe(true);
    expect(recovered.state.services).toEqual({});
  });

  it('rejects symlinked runtime state leaves and recovers only from the validated last-known-good file', async () => {
    const cwd = await workspace();
    const config = await loadWorkspaceServicesConfig(cwd);
    const runtimeDir = join(cwd, RUNTIME_RELATIVE_DIR);
    await mkdir(runtimeDir, { recursive: true });
    const linkedState = join(runtimeDir, 'linked-state.json');
    await writeFile(linkedState, JSON.stringify({ schemaVersion: 1, generation: 9, workspaceId: '.', services: {} }), 'utf8');
    await writeFile(join(cwd, LAST_GOOD_STATE_RELATIVE_PATH), JSON.stringify({ schemaVersion: 1, generation: 1, workspaceId: '.', services: {} }), 'utf8');
    await import('node:fs/promises').then((fs) => fs.symlink(linkedState, join(cwd, STATE_RELATIVE_PATH)));

    const recovered = await openRuntimeState(config);
    expect(recovered.recovered).toBe(true);
    expect(recovered.source).toBe('last-good');
  });

  it('rejects runtime directories that are swapped to symlinks before state operations begin', async () => {
    const cwd = await workspace();
    const outside = await workspace();
    const config = await loadWorkspaceServicesConfig(cwd);
    await mkdir(join(outside, 'runtime-target'), { recursive: true });
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await import('node:fs/promises').then((fs) => fs.symlink(join(outside, 'runtime-target'), join(cwd, '.pi', 'workspace-services')));
    await expect(openRuntimeState(config)).rejects.toThrow(/symbolic link|workspace services runtime directory|too many symbolic links|not a directory/i);
  });

  it('keeps runtime recovery and commit operations rooted under the pinned runtime directory even if path fields are tampered', async () => {
    const cwd = await workspace();
    const config = await loadWorkspaceServicesConfig(cwd);
    const outside = await workspace();
    config.runtimeDir = outside;
    config.statePath = join(outside, 'state.json');
    config.lastGoodStatePath = join(outside, 'state.last-good.json');
    config.quarantineDir = join(outside, 'quarantine');

    const initial = await openRuntimeState(config);
    const committed = await commitRuntimeState(config, initial.state, {
      ...initial.state,
      services: {
        svc: {
          phase: 'starting',
          operationId: 'op1',
          updatedAt: new Date().toISOString(),
        },
      },
    });

    expect(committed.services.svc?.phase).toBe('starting');
    const canonicalState = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(cwd, STATE_RELATIVE_PATH), 'utf8')));
    const canonicalLastGood = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(cwd, LAST_GOOD_STATE_RELATIVE_PATH), 'utf8')));
    expect(canonicalState.services.svc?.phase).toBe('starting');
    expect(canonicalLastGood.services.svc?.phase).toBe('starting');
    await expect(import('node:fs/promises').then((fs) => fs.access(join(outside, 'state.json')))).rejects.toThrow();
  });

  it('rejects a FIFO runtime-state leaf before use', async () => {
    const cwd = await workspace();
    const config = await loadWorkspaceServicesConfig(cwd);
    await mkdir(config.runtimeDir, { recursive: true });
    const fifoPath = join(cwd, STATE_RELATIVE_PATH);
    await createFifo(fifoPath);
    const runtimeDir = await pinRelativeWorkspaceDirectory(config.workspaceRealRoot, RUNTIME_RELATIVE_DIR, 'Workspace Services runtime directory', false);
    try {
      const error = await expectRejectsWithin(
        readPinnedTextFile(runtimeDir, 'state.json', 1024 * 1024, 'runtime state'),
        1000,
        async () => {
          const writer = await openFile(fifoPath, 'w');
          await writer.close();
        },
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/regular file/i);
    } finally {
      await closePinnedDirectory(runtimeDir);
    }
  });

  it('rejects a Unix-socket runtime-state leaf before use', async () => {
    const cwd = await workspace();
    const config = await loadWorkspaceServicesConfig(cwd);
    await mkdir(config.runtimeDir, { recursive: true });
    const socketPath = join(cwd, STATE_RELATIVE_PATH);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });
    const runtimeDir = await pinRelativeWorkspaceDirectory(config.workspaceRealRoot, RUNTIME_RELATIVE_DIR, 'Workspace Services runtime directory', false);
    try {
      const error = await expectRejectsWithin(readPinnedTextFile(runtimeDir, 'state.json', 1024 * 1024, 'runtime state'), 1000);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/regular file/i);
    } finally {
      await closePinnedDirectory(runtimeDir);
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('rejects regular-file replacement of an opened temp leaf before rename', async () => {
    const cwd = await workspace();
    const config = await loadWorkspaceServicesConfig(cwd);
    await mkdir(config.runtimeDir, { recursive: true });
    const runtimeDir = await pinRelativeWorkspaceDirectory(config.workspaceRealRoot, RUNTIME_RELATIVE_DIR, 'Workspace Services runtime directory', false);
    const tempLeaf = 'state.json.temp-regular';
    const tempPath = join(runtimeDir.procPath, tempLeaf);
    const actualTempPath = join(runtimeDir.realPath, tempLeaf);
    const backupPath = join(runtimeDir.realPath, `${tempLeaf}.backup`);
    const handle = await openFile(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile('owned', 'utf8');
      await handle.sync();
      await rename(tempPath, backupPath);
      await writeFile(actualTempPath, 'replacement', 'utf8');
      await expect(assertPinnedLeafIdentity(runtimeDir, tempLeaf, handle, 'temp leaf')).rejects.toThrow(/changed|regular file/i);
    } finally {
      await handle.close();
      await closePinnedDirectory(runtimeDir);
    }
  });

  it('rejects special-file replacement of an opened temp leaf before rename', async () => {
    const cwd = await workspace();
    const config = await loadWorkspaceServicesConfig(cwd);
    await mkdir(config.runtimeDir, { recursive: true });
    const runtimeDir = await pinRelativeWorkspaceDirectory(config.workspaceRealRoot, RUNTIME_RELATIVE_DIR, 'Workspace Services runtime directory', false);
    const tempLeaf = 'state.json.temp-special';
    const tempPath = join(runtimeDir.procPath, tempLeaf);
    const actualTempPath = join(runtimeDir.realPath, tempLeaf);
    const backupPath = join(runtimeDir.realPath, `${tempLeaf}.backup`);
    const handle = await openFile(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile('owned', 'utf8');
      await handle.sync();
      await rename(tempPath, backupPath);
      await createFifo(actualTempPath);
      await expect(assertPinnedLeafIdentity(runtimeDir, tempLeaf, handle, 'temp leaf')).rejects.toThrow(/regular file/i);
    } finally {
      await handle.close();
      await closePinnedDirectory(runtimeDir);
    }
  });

  it('accepts only the still-matching transaction temp leaf', async () => {
    const cwd = await workspace();
    const config = await loadWorkspaceServicesConfig(cwd);
    await mkdir(config.runtimeDir, { recursive: true });
    const runtimeDir = await pinRelativeWorkspaceDirectory(config.workspaceRealRoot, RUNTIME_RELATIVE_DIR, 'Workspace Services runtime directory', false);
    try {
      await writePinnedTextFileAtomically(runtimeDir, 'state.json', '{"ok":true}\n');
      expect(await readPinnedTextFile(runtimeDir, 'state.json', 1024 * 1024, 'runtime state')).toBe('{"ok":true}\n');
    } finally {
      await closePinnedDirectory(runtimeDir);
    }
  });

  it('serializes concurrent transactions', async () => {
    const first = withLifecycleTransaction('/tmp/workspace-state.json', { deadlineMs: 1000, ownerPath: undefined }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return 'first';
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const secondStarted = Date.now();
    const second = withLifecycleTransaction('/tmp/workspace-state.json', { deadlineMs: 1000, ownerPath: undefined }, async () => 'second');
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe('first');
    expect(secondResult).toBe('second');
    expect(Date.now() - secondStarted).toBeGreaterThanOrEqual(100);
  });

  it('serializes transactions across separate OS processes', async () => {
    const statePath = `/tmp/workspace-state-cross-process-${Date.now()}-${process.pid}.json`;
    const readyFile = join(tmpdir(), `pi-workspace-services-ready-${Date.now()}.txt`);
    const childCode = `
      import { createHash } from 'node:crypto';
      import { writeFile } from 'node:fs/promises';
      import net from 'node:net';
      const leaseName = String.fromCharCode(0) + 'pi-workspace-services-' + createHash('sha256').update(${JSON.stringify(statePath)}).digest('hex');
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ path: leaseName, exclusive: true }, () => resolve());
      });
      await writeFile(${JSON.stringify(readyFile)}, 'ready', 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 250));
      await new Promise((resolve) => server.close(() => resolve()));
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], { stdio: 'ignore' });
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      ready = await import('node:fs/promises').then((fs) => fs.access(readyFile).then(() => true).catch(() => false));
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(ready).toBe(true);
    const started = Date.now();
    await withLifecycleTransaction(statePath, { deadlineMs: 2000 }, async () => undefined);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('exit', () => resolve(undefined)));
    }
  }, 10000);
});
