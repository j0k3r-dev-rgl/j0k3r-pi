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

export function createApiJsonGitInspector(options: { runCommand?: GitCommandRunner } = {}): ApiJsonGitInspector {
  const runCommand = options.runCommand ?? defaultRunCommand;

  return {
    async inspectApiJson({ cwd }) {
      try {
        const tracked = await runCommand(['git', 'ls-files', '--error-unmatch', API_JSON_RELATIVE_PATH], { cwd });
        if (tracked.exitCode === 0) return { state: 'tracked' };

        const ignored = await runCommand(['git', 'check-ignore', API_JSON_RELATIVE_PATH], { cwd });
        if (ignored.exitCode === 0) return { state: 'ignored' };
        if (ignored.exitCode === 1) return { state: 'unignored_untracked' };
        return { state: 'unknown' };
      } catch {
        return { state: 'unknown' };
      }
    },
  };
}
