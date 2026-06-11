import { describe, expect, it } from 'vitest';
import { builtInPermissionPolicy } from '../src/defaults.js';
import { analyzeShellCommand } from '../src/shell-analyzer.js';
import type { PermissionPolicyConfig } from '../src/types.js';

function policy(workspaceRoot = '/workspace'): PermissionPolicyConfig {
  return {
    ...structuredClone(builtInPermissionPolicy),
    bypassAll: false,
    workspace: { ...structuredClone(builtInPermissionPolicy.workspace), root: workspaceRoot },
  };
}

describe('shell analyzer', () => {
  it.each([
    {
      command: 'git status',
      expectResult: {
        ok: true,
        normalizedCommand: 'git status',
        commandName: 'git',
        argv: ['status'],
        operators: [],
      },
    },
    {
      command: "printf '%s\\n' 'hello world'",
      expectResult: {
        ok: true,
        normalizedCommand: "printf '%s\\n' 'hello world'",
        commandName: 'printf',
        argv: ['%s\\n', 'hello world'],
        operators: [],
      },
    },
    {
      command: 'FOO=bar npm test',
      expectResult: {
        ok: true,
        normalizedCommand: 'FOO=bar npm test',
        commandName: 'npm',
        argv: ['test'],
        operators: [],
        envAssignments: { FOO: 'bar' },
      },
    },
    {
      command: 'git status && npm test || git diff; git status\ncd packages/app',
      expectResult: {
        ok: true,
        commandName: 'git',
        operators: ['&&', '||', ';', 'newline'],
      },
    },
  ])('analyzes safe-subset command $command', async ({ command, expectResult }) => {
    const result = await analyzeShellCommand({ command, cwd: '/workspace', config: policy() });

    expect(result.ok).toBe(expectResult.ok);
    expect(result.normalizedCommand).toBe(expectResult.normalizedCommand ?? result.normalizedCommand);
    expect(result.segments[0]?.commandName).toBe(expectResult.commandName);
    expect(result.segments[0]?.argv).toEqual(expectResult.argv ?? result.segments[0]?.argv);
    expect(result.segments[0]?.envAssignments).toEqual(expectResult.envAssignments ?? result.segments[0]?.envAssignments ?? {});
    expect(result.operators).toEqual(expectResult.operators);
  });

  it('tracks effective cwd across a safe cd segment', async () => {
    const result = await analyzeShellCommand({ command: 'cd packages/app && npm test', cwd: '/workspace', config: policy() });

    expect(result.ok).toBe(true);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ commandName: 'cd', effectiveCwd: '/workspace', nextCwd: '/workspace/packages/app' });
    expect(result.segments[1]).toMatchObject({ commandName: 'npm', effectiveCwd: '/workspace/packages/app', argv: ['test'] });
  });

  it.each([
    { command: 'git status | cat', unsupported: 'pipe' },
    { command: 'git status &', unsupported: 'background' },
    { command: 'echo $(pwd)', unsupported: 'command_substitution' },
    { command: 'cat <(pwd)', unsupported: 'process_substitution' },
    { command: 'source ./env.sh', unsupported: 'source_script' },
    { command: 'echo *.ts', unsupported: 'glob_expansion' },
    { command: 'echo ~', unsupported: 'tilde_expansion' },
    { command: 'echo $HOME', unsupported: 'parameter_expansion' },
    { command: "echo 'unterminated", unsupported: 'malformed_quote' },
  ])('marks unsupported syntax for $command', async ({ command, unsupported }) => {
    const result = await analyzeShellCommand({ command, cwd: '/workspace', config: policy() });

    expect(result.ok).toBe(false);
    expect(result.unsupported).toContain(unsupported);
    expect(result.effectsComplete).toBe(false);
  });
});
