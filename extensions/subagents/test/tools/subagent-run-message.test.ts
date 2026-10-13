import { describe, expect, it, vi } from 'vitest';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

describe('subagent_run action=message', () => {
  it('queues same-parent messages with continuation disabled, preserving limits and acknowledgements', async () => {
    env.writeAgent('analyst');
    const steer = vi.fn();
    let release: any;
    const manager = new SubagentManager(async ({ registerLiveBridge }) => {
      registerLiveBridge?.({ supported: true, detected_pi_version: '0.99.2', steer });
      return await new Promise((resolve) => { release = () => resolve({ result: 'done', model: 'mock/model', fallback_used: false }); });
    });
    let tool: any;
    registerSubagentTools({ registerTool: (value: any) => { tool = value; } }, manager, env.tmp);
    const ctx = { cwd: env.tmp, sessionManager: { getSessionId: () => 'parent' } };
    const launched = await tool.execute('launch', { agent: 'analyst', task: 'work', mode: 'background' }, undefined, undefined, ctx);
    const id = launched.details.task_ids[0];
    await vi.waitFor(() => expect(manager.getTask(id, env.tmp)?.status).toBe('running'));
    const queued = await tool.execute('message', { action: 'message', task_id: id, task: 'include missing constraints' }, undefined, undefined, ctx);
    expect(queued.isError).not.toBe(true);
    expect(queued.details).toMatchObject({ action: 'message', task_id: id, status: 'queued', pending_message_count: 1 });
    expect(queued.content[0].text).toContain('does not prove model consumption');
    expect(steer).toHaveBeenCalledWith('include missing constraints');
    const theme = { fg: (_n: string, t: string) => t };
    const rendered = tool.renderResult(queued, { expanded: true }, theme).render(120).join('\n');
    expect(rendered).toContain('subagent message');
    expect(rendered).toContain('pending messages: 1');
    expect(rendered).toContain('does not prove model consumption');
    expect(rendered).not.toContain(id);
    const forbidden = await tool.execute('foreign', { action: 'message', task_id: id, task: 'foreign instructions' }, undefined, undefined, { cwd: env.tmp, sessionId: 'different-parent' });
    expect(forbidden.isError).toBe(true);
    expect(forbidden.details.reason).toBe('not_owner');
    expect(forbidden.details.task).toBeUndefined();
    expect(JSON.stringify(forbidden)).not.toContain('include missing constraints');
    for (let index = 0; index < 15; index++) {
      const result = await tool.execute('queue', { action: 'message', task_id: id, task: `message ${index}` }, undefined, undefined, ctx);
      expect(result.details.status).toBe('queued');
    }
    const full = await tool.execute('full', { action: 'message', task_id: id, task: 'too many' }, undefined, undefined, ctx);
    expect(full.isError).toBe(true);
    expect(full.details.reason).toBe('queue_count_limit');
    release();
    await vi.waitFor(() => expect(manager.getTask(id, env.tmp)?.status).toBe('completed'));
    expect(manager.getTask(id, env.tmp)).toMatchObject({ pending_message_count: 0, undelivered_message_count: 16 });
    const completed = await tool.execute('late', { action: 'message', task_id: id, task: 'must not resume' }, undefined, undefined, ctx);
    expect(completed.isError).toBe(true);
    expect(completed.details.reason).toBe('not_running');
    expect(manager.getTask(id, env.tmp)?.attempt).toBe(1);
    expect(tool.renderResult(queued, { expanded: true }, theme).render(120).join('\n')).toBe(rendered);
  });

  it('rejects unsupported runtimes explicitly instead of claiming delivery', async () => {
    env.writeAgent('analyst');
    let release: any;
    const manager = new SubagentManager(async ({ registerLiveBridge }) => {
      registerLiveBridge?.({ supported: false, detected_pi_version: '0.81.0', steer: vi.fn() });
      return await new Promise((resolve) => { release = () => resolve({ result: 'done', model: 'mock/model', fallback_used: false }); });
    });
    let tool: any;
    registerSubagentTools({ registerTool: (value: any) => { tool = value; } }, manager, env.tmp);
    const ctx = { cwd: env.tmp, sessionId: 'owner' };
    const first = await manager.run({ agent: 'analyst', task: 'work', mode: 'background' }, ctx);
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0], env.tmp)?.status).toBe('running'));
    const result = await tool.execute('message', { action: 'message', task_id: first.task_ids[0], task: 'instructions' }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ reason: 'unsupported_runtime', required_pi_version: '>=0.82.1' });
    release();
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0], env.tmp)?.status).toBe('completed'));
  });
});
