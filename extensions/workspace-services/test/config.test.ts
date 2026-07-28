import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdir, open as openFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ensureRuntimeGitignore, loadServiceEnv, loadWorkspaceServicesConfig, parseEnvFile } from '../src/config.js';

const execFileAsync = promisify(execFile);

async function workspace(): Promise<string> {
  return mkdtempSync(join(tmpdir(), 'pi-workspace-services-'));
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

describe('workspace services config', () => {
  it('loads only manually configured services and resolves safe paths', async () => {
    const cwd = await workspace();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await mkdir(join(cwd, 'front'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      services: {
        front: { type: 'node', path: 'front', command: 'npm run dev', env_file: true },
      },
    }), 'utf8');
    const config = await loadWorkspaceServicesConfig(cwd);
    expect(config.exists).toBe(true);
    expect(config.services.front.cwd).toBe(join(cwd, 'front'));
  });

  it('rejects service keys that cannot be used as log file names', async () => {
    const cwd = await workspace();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      services: {
        '../bad': { type: 'node', path: 'front', command: 'npm run dev', env_file: false },
      },
    }), 'utf8');
    await expect(loadWorkspaceServicesConfig(cwd)).rejects.toThrow(/invalid service name/i);
  });

  it('rejects service paths that escape the real workspace through symlinks', async () => {
    const cwd = await workspace();
    const outside = await workspace();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await mkdir(join(outside, 'real-outside'), { recursive: true });
    await symlink(join(outside, 'real-outside'), join(cwd, 'linked-outside'));
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      services: {
        front: { type: 'node', path: 'linked-outside', command: 'npm run dev', env_file: false },
      },
    }), 'utf8');
    await expect(loadWorkspaceServicesConfig(cwd)).rejects.toThrow(/real workspace boundary/i);
  });

  it('parses bounded env files without exposing comments or quoted wrappers', async () => {
    const cwd = await workspace();
    const envPath = join(cwd, '.env');
    await writeFile(envPath, ['# comment', 'PLAIN=value', 'DOUBLE="hello world"', "SINGLE='secret value'", 'export EXPORTED=yes', 'EMPTY=', ''].join('\n'), 'utf8');
    await expect(parseEnvFile(envPath)).resolves.toEqual({ PLAIN: 'value', DOUBLE: 'hello world', SINGLE: 'secret value', EXPORTED: 'yes', EMPTY: '' });
  });

  it('rejects env files that are swapped to symlinks after service path validation', async () => {
    const cwd = await workspace();
    const outside = await workspace();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await mkdir(join(cwd, 'front'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      services: {
        front: { type: 'node', path: 'front', command: 'npm run dev', env_file: true },
      },
    }), 'utf8');
    await writeFile(join(outside, 'stolen.env'), 'TOKEN=outside\n', 'utf8');
    await symlink(join(outside, 'stolen.env'), join(cwd, 'front', '.env'));
    const config = await loadWorkspaceServicesConfig(cwd);
    await expect(loadServiceEnv(config.services.front, config.workspaceRealRoot)).rejects.toThrow(/regular file|symlink|boundary|no such file/i);
  });

  it('rejects a FIFO .env leaf before any data-bearing open', async () => {
    const cwd = await workspace();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await mkdir(join(cwd, 'front'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      services: {
        front: { type: 'node', path: 'front', command: 'npm run dev', env_file: true },
      },
    }), 'utf8');
    const fifoPath = join(cwd, 'front', '.env');
    await createFifo(fifoPath);
    const config = await loadWorkspaceServicesConfig(cwd);

    const error = await expectRejectsWithin(
      loadServiceEnv(config.services.front, config.workspaceRealRoot),
      1000,
      async () => {
        const writer = await openFile(fifoPath, 'w');
        await writer.close();
      },
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/regular file/i);
  });

  it('ensures runtime service files are ignored without duplicating the entry', async () => {
    const cwd = await workspace();
    await writeFile(join(cwd, '.gitignore'), 'node_modules/\n', 'utf8');
    await ensureRuntimeGitignore(cwd);
    await ensureRuntimeGitignore(cwd);
    const gitignore = await import('node:fs/promises').then((fs) => fs.readFile(join(cwd, '.gitignore'), 'utf8'));
    expect(gitignore.match(/\.pi\/workspace-services\//g)).toHaveLength(1);
  });
});
