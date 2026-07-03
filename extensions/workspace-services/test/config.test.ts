import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ensureRuntimeGitignore, loadWorkspaceServicesConfig, parseEnvFile } from '../src/config.js';

async function workspace(): Promise<string> {
  return mkdtempSync(join(tmpdir(), 'pi-workspace-services-'));
}

describe('workspace services config', () => {
  it('loads only manually configured services and resolves safe paths', async () => {
    const cwd = await workspace();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await mkdir(join(cwd, 'front'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      services: {
        front: {
          type: 'node',
          path: 'front',
          command: 'npm run dev',
          env_file: true,
        },
      },
    }), 'utf8');

    const config = await loadWorkspaceServicesConfig(cwd);

    expect(config.exists).toBe(true);
    expect(config.services.front).toMatchObject({
      name: 'front',
      type: 'node',
      relativePath: 'front',
      command: 'npm run dev',
      envFile: true,
    });
    expect(config.services.front.cwd).toBe(join(cwd, 'front'));
  });

  it('rejects service keys that cannot be used as log file names', async () => {
    const cwd = await workspace();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      services: {
        '../bad': {
          type: 'node',
          path: 'front',
          command: 'npm run dev',
          env_file: false,
        },
      },
    }), 'utf8');

    await expect(loadWorkspaceServicesConfig(cwd)).rejects.toThrow(/invalid service name/i);
  });

  it('rejects service paths that escape the workspace', async () => {
    const cwd = await workspace();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
      services: {
        front: {
          type: 'node',
          path: '../front',
          command: 'npm run dev',
          env_file: false,
        },
      },
    }), 'utf8');

    await expect(loadWorkspaceServicesConfig(cwd)).rejects.toThrow(/escapes workspace/i);
  });

  it('parses env files without exposing comments or quoted wrappers', async () => {
    const cwd = await workspace();
    const envPath = join(cwd, '.env');
    await writeFile(envPath, [
      '# comment',
      'PLAIN=value',
      'DOUBLE="hello world"',
      "SINGLE='secret value'",
      'export EXPORTED=yes',
      'EMPTY=',
      '',
    ].join('\n'), 'utf8');

    await expect(parseEnvFile(envPath)).resolves.toEqual({
      PLAIN: 'value',
      DOUBLE: 'hello world',
      SINGLE: 'secret value',
      EXPORTED: 'yes',
      EMPTY: '',
    });
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
