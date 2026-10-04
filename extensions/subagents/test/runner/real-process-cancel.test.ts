import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';
import type { SubagentRunner } from '../../src/types.js';

const env = installSubagentTestEnv();

function waitFor(check: () => boolean, timeoutMs = 5_000, intervalMs = 20, label = 'condition'): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function processExists(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('real process cancellation settlement', () => {
  it('waits for real bash cleanup before persisting cancelled', async () => {
    if (process.platform === 'win32') return;
    const marker = `pi-subagent-cancel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents', 'analyst.md'), `---\nname: analyst\ndescription: analyst agent\ntools:\n  - bash\n---\n# Agent\nUse bash when needed.\n`);

    let shellPid: number | undefined;
    let sleepPid: number | undefined;
    let toolEndedAt = 0;
    let settledAt = 0;

    const runner: SubagentRunner = async ({ signal, onActivity }) => {
      onActivity?.({ message: `bash sleep 120 # ${marker}` });
      const child = spawn('bash', ['-lc', 'sleep 120 & wait'], {
        cwd: env.tmp,
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      shellPid = child.pid;
      await waitFor(() => {
        if (!shellPid) return false;
        try {
          const output = execFileSync('ps', ['-o', 'pid=', '--ppid', String(shellPid)], { encoding: 'utf8' }).trim();
          const parsed = Number.parseInt(output.split(/\s+/)[0] ?? '', 10);
          if (!Number.isFinite(parsed)) return false;
          sleepPid = parsed;
          return true;
        } catch {
          return false;
        }
      }, 5_000, 25, 'spawned sleep pid');
      return await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          process.kill(-child.pid!, 'SIGTERM');
        }, { once: true });
        child.once('exit', () => {
          toolEndedAt = Date.now();
          onActivity?.({ message: `tool_execution_end bash ${marker}` });
          settledAt = Date.now();
          onActivity?.({ message: `agent_settled ${marker}` });
          reject(new Error('Subagent was aborted'));
        });
        child.once('error', reject);
      });
    };

    const manager = new SubagentManager(runner);
    let cancelTool: any;
    registerSubagentTools({ registerTool: (tool: any) => {
      if (tool.name === 'subagent_cancel') cancelTool = tool;
    } }, manager);

    const launched = await manager.run({ agent: 'analyst', task: `cancel real bash ${marker}`, mode: 'background' }, { cwd: env.tmp });
    const taskId = launched.task_ids[0]!;
    await waitFor(() => Boolean(shellPid && sleepPid), 5_000, 25, 'spawned shell and sleep pids');

    const cancelResult = await cancelTool.execute('1', { task_id: taskId }, undefined, undefined, { cwd: env.tmp });
    expect(cancelResult.details.task).toMatchObject({ id: taskId, status: 'stopping' });

    let cancelledObservedAt = 0;
    await waitFor(() => {
      const task = manager.getTask(taskId);
      if (task?.status === 'cancelled') {
        cancelledObservedAt = Date.now();
        return true;
      }
      return false;
    }, 5_000, 25, 'cancelled task status');

    const task = manager.getTask(taskId)!;
    expect(task).toMatchObject({ status: 'cancelled', error: 'Subagent cancelled: cancelled' });
    expect(toolEndedAt).toBeGreaterThan(0);
    expect(settledAt).toBeGreaterThan(0);
    expect(toolEndedAt).toBeLessThanOrEqual(cancelledObservedAt);
    expect(settledAt).toBeLessThanOrEqual(cancelledObservedAt);
    expect(processExists(shellPid)).toBe(false);
    expect(processExists(sleepPid)).toBe(false);
  }, 15_000);
});
