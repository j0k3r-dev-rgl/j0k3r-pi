import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ApiJsonGitInspector } from './types.js';

const execFileAsync = promisify(execFile);
const API_JSON_RELATIVE_PATH = '.pi/api.json';

export interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type GitCommandRunner = (command: string[], options: { cwd: string }) => Promise<GitCommandResult>;

export interface GitFileInspector {
  inspectFile(input: { cwd: string; relativePath: string }): Promise<'ignored' | 'unignored_untracked' | 'tracked' | 'unknown'>;
}

async function defaultRunCommand(command: string[], options: { cwd: string }): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command[0]!, command.slice(1), { cwd: options.cwd, encoding: 'utf8' });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const withStatus = error as { stdout?: string; stderr?: string; code?: unknown };
    if (typeof withStatus.code === 'number') {
      return { exitCode: withStatus.code, stdout: withStatus.stdout ?? '', stderr: withStatus.stderr ?? '' };
    }
    throw error;
  }
}

export function createGitFileInspector(options: { runCommand?: GitCommandRunner } = {}): GitFileInspector {
  const runCommand = options.runCommand ?? defaultRunCommand;

  return {
    async inspectFile({ cwd, relativePath }: { cwd: string; relativePath: string }) {
      try {
        const tracked = await runCommand(['git', 'ls-files', '--error-unmatch', relativePath], { cwd });
        if (tracked.exitCode === 0) return 'tracked';

        const ignored = await runCommand(['git', 'check-ignore', relativePath], { cwd });
        if (ignored.exitCode === 0) return 'ignored';
        if (ignored.exitCode === 1) return 'unignored_untracked';
        return 'unknown';
      } catch {
        return 'unknown';
      }
    },
  };
}

export function createApiJsonGitInspector(options: { runCommand?: GitCommandRunner } = {}): ApiJsonGitInspector {
  const fileInspector = createGitFileInspector(options);

  return {
    async inspectApiJson({ cwd }) {
      const state = await fileInspector.inspectFile({ cwd, relativePath: API_JSON_RELATIVE_PATH });
      return { state };
    },
  };
}
