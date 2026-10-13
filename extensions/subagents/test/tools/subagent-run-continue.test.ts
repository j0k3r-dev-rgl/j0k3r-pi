import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

function setup(runner?: any) {
  env.writeAgent('analyst');
  fs.writeFileSync(`${env.tmp}/.pi/subagents.json`, JSON.stringify({ enable_continue: true }));
  const nestedSessionPath = `${env.tmp}/session.jsonl`;
  fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
  const manager = new SubagentManager(runner ?? (async ({ continuation, onActivity }: any) => {
    onActivity?.({ message: 'session ready', nested_session_path: nestedSessionPath });
    return { result: continuation ? `continued: ${continuation.prompt}` : 'initial', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath };
  }));
  let tool: any;
  const pi = { registerTool: (value: any) => { tool = value; }, events: { emit: vi.fn() } };
  registerSubagentTools(pi, manager, env.tmp);
  return { manager, tool, pi, nestedSessionPath };
}

describe('subagent_run action=continue', () => {
  it('preserves task/session identity, parent Pi API, allocation events, full result and visible attempt', async () => {
    const { manager, tool, pi, nestedSessionPath } = setup();
    const first = await tool.execute('1', { agent: 'analyst', task: 'initial', mode: 'task' }, undefined, undefined, { cwd: env.tmp });
    const id = first.details.task_ids[0];
    const result = await tool.execute('2', { action: 'continue', task_id: id, task: 'approved follow-up' }, undefined, undefined, { cwd: env.tmp });
    expect(result.isError).not.toBe(true);
    expect(result.details.task).toMatchObject({ id, attempt: 2, nested_session_path: nestedSessionPath, status: 'completed' });
    expect(result.content[0].text).toContain('continued: approved follow-up');
    expect(result.details.action).toBe('continue');
    expect(manager.getTask(id, env.tmp)?.id).toBe(id);
    expect(pi.events.emit.mock.calls.filter(([name]) => name === 'subagents:task:allocate')).toHaveLength(2);
    expect(tool.renderCall({}, {}).render(100)).toEqual([]);
    const text = env.stripAnsi(tool.renderResult(result, { expanded: false }, { fg: (_n: string, t: string) => t }).render(160).join('\n'));
    expect(text).toContain('attempt: 2');
    expect(text).not.toContain(id);
    const initialReplay = tool.renderResult(first, { expanded: true }, { fg: (_n: string, t: string) => t }).render(160).join('\n');
    expect(initialReplay).toContain('attempt: 1');
    expect(initialReplay).not.toContain('continued: approved follow-up');
  });

  it('does not subscribe historical terminal cards to a newer active attempt', () => {
    const { manager, tool } = setup();
    const subscribe = vi.spyOn(manager, 'onTaskUpdate');
    (manager as any).tasks.set('shared-id', { id: 'shared-id', agent: 'analyst', cwd: env.tmp, status: 'running', attempt: 2 });
    const historical = { details: { action: 'run', task: { id: 'shared-id', agent: 'analyst', cwd: env.tmp, status: 'completed', attempt: 1, result: 'first result' } } };
    const component = tool.renderResult(historical, { expanded: true }, { fg: (_n: string, t: string) => t });
    expect(component.render(120).join('\n')).toContain('first result');
    expect(subscribe).not.toHaveBeenCalled();
    component.dispose();
  });

  it('passes the exact parent Pi API and streams workspace-scoped progress', async () => {
    let continuationPi: any;
    const { manager, tool, pi } = setup(async ({ continuation, ctx, onActivity }: any) => {
      onActivity({ message: 'reading package.json', nested_session_path: `${env.tmp}/session.jsonl` });
      if (continuation) continuationPi = ctx.pi;
      return { result: 'done', model: 'mock/model', fallback_used: false, nested_session_path: `${env.tmp}/session.jsonl` };
    });
    const first = await manager.run({ agent: 'analyst', task: 'initial', mode: 'task' }, { cwd: env.tmp });
    const updates: any[] = [];
    await tool.execute('2', { action: 'continue', task_id: first.task_ids[0], task: 'follow-up' }, undefined, (value: any) => updates.push(value), { cwd: env.tmp });
    expect(continuationPi).toBe(pi);
    expect(updates.some((value) => value.details.cwd === env.tmp && value.details.tasks[0]?.attempt === 2)).toBe(true);
  });

  it.each(['task', 'background'] as const)('preserves omitted %s mode and supports its explicit override', async (mode) => {
    const { manager, tool } = setup();
    const first = await manager.run({ agent: 'analyst', task: 'initial', mode }, { cwd: env.tmp });
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0], env.tmp)?.status).toBe('completed'));
    const result = await tool.execute('2', { action: 'continue', task_id: first.task_ids[0], task: 'same mode' }, undefined, undefined, { cwd: env.tmp });
    expect(result.details.mode).toBe(mode);
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0], env.tmp)?.status).toBe('completed'));
    const override = mode === 'task' ? 'background' : 'task';
    const next = await tool.execute('3', { action: 'continue', task_id: first.task_ids[0], task: 'override mode', mode: override }, undefined, undefined, { cwd: env.tmp });
    expect(next.details.mode).toBe(override);
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0], env.tmp)?.status).toBe('completed'));
  });

  it('rechecks enable_continue at invocation time without changing the schema', async () => {
    const { manager, tool } = setup();
    const first = await manager.run({ agent: 'analyst', task: 'initial', mode: 'task' }, { cwd: env.tmp });
    fs.writeFileSync(`${env.tmp}/.pi/subagents.json`, JSON.stringify({ enable_continue: false }));
    const result = await tool.execute('2', { action: 'continue', task_id: first.task_ids[0], task: 'resume' }, undefined, undefined, { cwd: env.tmp });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('continuation is disabled');
    expect(manager.getTask(first.task_ids[0], env.tmp)?.attempt).toBe(1);
  });

  it.each(['completed', 'failed', 'cancelled', 'interrupted'])('can resume a persisted %s task', async (status) => {
    const { manager, tool, nestedSessionPath } = setup();
    const { SubagentHistoryStore } = await import('../../src/history.js');
    new SubagentHistoryStore().upsertTask(env.tmp, {
      id: 'historical', agent: 'analyst', task: 'history', mode: 'task', status,
      created_at: new Date().toISOString(), nested_session_path: nestedSessionPath, attempt: 1,
    } as any);
    const result = await tool.execute('resume', { action: 'continue', task_id: 'historical', task: 'resume history' }, undefined, undefined, { cwd: env.tmp });
    expect(result.isError).not.toBe(true);
    expect(manager.getTask('historical', env.tmp)).toMatchObject({ attempt: 2, status: 'completed' });
  });

  it('returns the complete error from a failed continuation and preserves error detail identity', async () => {
    const error = 'complete failure detail '.repeat(30) + 'FINAL_ERROR_MARKER';
    const { manager, tool } = setup(async ({ continuation }: any) => {
      if (continuation) throw new Error(error);
      return { result: 'initial', model: 'mock/model', nested_session_path: `${env.tmp}/session.jsonl` };
    });
    const first = await manager.run({ agent: 'analyst', task: 'initial', mode: 'task' }, { cwd: env.tmp });
    const result = await tool.execute('failed', { action: 'continue', task_id: first.task_ids[0], task: 'follow-up' }, undefined, undefined, { cwd: env.tmp });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(error);
    expect(result.content[0].text).toContain('action: "continue"');
    expect(result.details.task).toMatchObject({ id: first.task_ids[0], attempt: 2, status: 'failed' });
  });

  it('rejects unknown, foreign-workspace, active and missing-session tasks', async () => {
    const { manager, tool } = setup();
    for (const id of ['unknown', 'active', 'foreign', 'missing']) {
      if (id !== 'unknown') (manager as any).tasks.set(id, { id, agent: 'analyst', mode: 'task', task: 'prior', status: id === 'active' ? 'running' : 'completed', cwd: id === 'foreign' ? '/other/workspace' : env.tmp } as any);
      const result = await tool.execute(id, { action: 'continue', task_id: id, task: 'resume' }, undefined, undefined, { cwd: env.tmp });
      expect(result.isError, id).toBe(true);
    }
  });

  it.each(['cancel', 'handoff'])('preserves foreground %s controls on continuation', async (control) => {
    const { manager, tool } = setup(async ({ continuation, signal, onActivity }: any) => {
      onActivity({ message: 'session ready', nested_session_path: `${env.tmp}/session.jsonl` });
      if (continuation) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 120);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
      });
      return { result: 'done', model: 'mock/model', fallback_used: false, nested_session_path: `${env.tmp}/session.jsonl` };
    });
    const first = await manager.run({ agent: 'analyst', task: 'initial', mode: 'task' }, { cwd: env.tmp });
    const handlers: any[] = [];
    const resultPromise = tool.execute('2', { action: 'continue', task_id: first.task_ids[0], task: 'resume' }, undefined, undefined, {
      cwd: env.tmp, abort: vi.fn(), ui: { onTerminalInput: (handler: any) => { handlers.push(handler); return vi.fn(); }, notify: vi.fn() },
    });
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0], env.tmp)?.status).toBe('running'));
    if (control === 'cancel') { handlers.forEach((handler) => handler('\u001b')); handlers.forEach((handler) => handler('\u001b')); }
    else handlers.forEach((handler) => handler('\u0008'));
    const result = await resultPromise;
    expect(control === 'cancel' ? result.isError : result.terminate).toBe(true);
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0], env.tmp)?.status).toBe(control === 'cancel' ? 'cancelled' : 'completed'));
  });
});
