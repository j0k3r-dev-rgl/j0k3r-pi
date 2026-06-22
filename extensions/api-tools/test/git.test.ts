import { describe, expect, it } from 'vitest';
import { createApiJsonGitInspector } from '../src/git.js';

describe('createApiJsonGitInspector', () => {
  it('classifies ignored api.json files', async () => {
    const inspector = createApiJsonGitInspector({
      runCommand: async (command) => {
        if (command[1] === 'ls-files') return { exitCode: 1, stdout: '', stderr: '' };
        if (command[1] === 'check-ignore') return { exitCode: 0, stdout: '.pi/api.json\n', stderr: '' };
        throw new Error(`unexpected command: ${command.join(' ')}`);
      },
    });

    await expect(inspector.inspectApiJson({ cwd: '/tmp/project' })).resolves.toEqual({ state: 'ignored' });
  });

  it('classifies unignored untracked api.json files', async () => {
    const inspector = createApiJsonGitInspector({
      runCommand: async (command) => {
        if (command[1] === 'ls-files') return { exitCode: 1, stdout: '', stderr: '' };
        if (command[1] === 'check-ignore') return { exitCode: 1, stdout: '', stderr: '' };
        throw new Error(`unexpected command: ${command.join(' ')}`);
      },
    });

    await expect(inspector.inspectApiJson({ cwd: '/tmp/project' })).resolves.toEqual({ state: 'unignored_untracked' });
  });

  it('classifies tracked api.json files', async () => {
    const inspector = createApiJsonGitInspector({
      runCommand: async (command) => {
        if (command[1] === 'ls-files') return { exitCode: 0, stdout: '.pi/api.json\n', stderr: '' };
        throw new Error(`unexpected command: ${command.join(' ')}`);
      },
    });

    await expect(inspector.inspectApiJson({ cwd: '/tmp/project' })).resolves.toEqual({ state: 'tracked' });
  });

  it('returns unknown when git evidence is unavailable', async () => {
    const inspector = createApiJsonGitInspector({
      runCommand: async () => {
        throw new Error('git not available');
      },
    });

    await expect(inspector.inspectApiJson({ cwd: '/tmp/project' })).resolves.toEqual({ state: 'unknown' });
  });
});
