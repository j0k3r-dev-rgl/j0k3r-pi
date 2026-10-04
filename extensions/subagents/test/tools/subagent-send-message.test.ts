import { describe, expect, it, vi } from 'vitest';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

describe('subagent_send_message tool', () => {
  it('README documents queued acknowledgements, ownership rejection, undelivered counts, and unsupported runtime rejection', async () => {
    const fs = await import('node:fs');
    const readme = fs.readFileSync('README.md', 'utf8');

    expect(readme).toContain('subagent_send_message');
    expect(readme).toContain('pending_message_count');
    expect(readme).toContain('undelivered_message_count');
    expect(readme).toContain('unsupported_runtime');
    expect(readme).toContain('>=0.82.1');
  });

  it('accepts immediate same-parent messages from sessionManager context before bridge readiness', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents', 'backgrounder.md'), `---\nname: backgrounder\ndescription: background agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);

    const supportedSteer = vi.fn();
    let release: () => void = () => undefined;
    const manager = new SubagentManager(async ({ registerLiveBridge }) => {
      setTimeout(() => {
        registerLiveBridge?.({
          supported: true,
          detected_pi_version: '0.82.1',
          steer: supportedSteer,
        });
      }, 25);
      return await new Promise((resolve) => {
        release = () => resolve({ result: 'backgrounder done', model: 'mock/model', fallback_used: false });
      });
    });

    let sendTool: any;
    registerSubagentTools({ registerTool: (tool: any) => {
      if (tool.name === 'subagent_send_message') sendTool = tool;
    } }, manager);

    const ctx = { cwd: env.tmp, sessionManager: { getSessionId: () => 'parent-session-manager' } };
    const background = await manager.run({ agent: 'backgrounder', task: 'background work', mode: 'background' }, ctx);
    const backgroundTaskId = background.task_ids[0]!;

    const queued = await sendTool.execute('pre-ready', { task_id: backgroundTaskId, message: 'Please steer immediately.' }, undefined, undefined, ctx);
    expect(queued.details).toMatchObject({ status: 'queued', task_id: backgroundTaskId, pending_message_count: 1 });
    expect(supportedSteer).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(supportedSteer).toHaveBeenCalledTimes(1));
    expect(supportedSteer).toHaveBeenCalledWith('Please steer immediately.');

    release();
    await vi.waitFor(() => expect(manager.getTask(backgroundTaskId)?.status).toBe('completed'));
  });

  it('reports queued acknowledgements, unsupported runtimes, and queue-limit rejections without delivery claims', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents', 'backgrounder.md'), `---\nname: backgrounder\ndescription: background agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents', 'legacy.md'), `---\nname: legacy\ndescription: legacy background agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);

    const releases = new Map<string, () => void>();
    const manager = new SubagentManager(async ({ definition }) => await new Promise((resolve) => {
      releases.set(definition.name, () => resolve({ result: `${definition.name} done`, model: 'mock/model', fallback_used: false }));
    }));

    let sendTool: any;
    let statusTool: any;
    let resultTool: any;
    registerSubagentTools({ registerTool: (tool: any) => {
      if (tool.name === 'subagent_send_message') sendTool = tool;
      if (tool.name === 'subagent_status') statusTool = tool;
      if (tool.name === 'subagent_result') resultTool = tool;
    } }, manager);

    const background = await manager.run({ agent: 'backgrounder', task: 'background work', mode: 'background' }, { cwd: env.tmp, sessionId: 'parent-a' });
    const legacy = await manager.run({ agent: 'legacy', task: 'legacy work', mode: 'background' }, { cwd: env.tmp, sessionId: 'parent-a' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const backgroundTaskId = background.task_ids[0]!;
    const legacyTaskId = legacy.task_ids[0]!;
    const supportedSteer = vi.fn();
    (manager as any).registerLiveBridge(backgroundTaskId, {
      supported: true,
      detected_pi_version: '0.82.1',
      steer: supportedSteer,
    }, 'parent-a', 1);
    (manager as any).registerLiveBridge(legacyTaskId, {
      supported: false,
      detected_pi_version: '0.81.0',
      steer: vi.fn(),
    }, 'parent-a', 1);

    const queued = await sendTool.execute('1', { task_id: backgroundTaskId, message: 'Please include the missing constraint.' }, undefined, undefined, { cwd: env.tmp, sessionId: 'parent-a' });
    expect(queued.details).toMatchObject({ status: 'queued', task_id: backgroundTaskId, pending_message_count: 1 });
    expect(queued.content[0].text).toContain('queued');
    expect(queued.content[0].text).toContain('does not prove model consumption');
    expect(supportedSteer).toHaveBeenCalledWith('Please include the missing constraint.');

    const activeStatus = await statusTool.execute('status-1', { task_id: backgroundTaskId }, undefined, undefined, { cwd: env.tmp });
    expect(activeStatus.details.task).toMatchObject({ pending_message_count: 1 });
    expect(activeStatus.content[0].text).toContain('pending messages: 1');

    const unsupported = await sendTool.execute('2', { task_id: legacyTaskId, message: 'Please continue.' }, undefined, undefined, { cwd: env.tmp, sessionId: 'parent-a' });
    expect(unsupported.details).toMatchObject({
      status: 'rejected',
      reason: 'unsupported_runtime',
      required_pi_version: '>=0.82.1',
      detected_pi_version: '0.81.0',
    });
    expect(unsupported.content[0].text).toContain('>=0.82.1');
    expect(manager.getTask(legacyTaskId)?.pending_message_count ?? 0).toBe(0);

    for (let index = 0; index < 15; index += 1) {
      const response = await sendTool.execute(`limit-${index}`, { task_id: backgroundTaskId, message: `queued message ${index}` }, undefined, undefined, { cwd: env.tmp, sessionId: 'parent-a' });
      expect(response.details.status).toBe('queued');
    }
    expect(manager.getTask(backgroundTaskId)?.pending_message_count).toBe(16);
    const limitRejected = await sendTool.execute('17', { task_id: backgroundTaskId, message: 'one too many' }, undefined, undefined, { cwd: env.tmp, sessionId: 'parent-a' });
    expect(limitRejected.details).toMatchObject({ status: 'rejected', reason: 'queue_count_limit' });
    expect(limitRejected.content[0].text).not.toContain('delivered');
    expect(manager.getTask(backgroundTaskId)?.pending_message_count).toBe(16);

    releases.get('backgrounder')?.();
    releases.get('legacy')?.();
    await vi.waitFor(() => expect(manager.getTask(backgroundTaskId)?.status).toBe('completed'));
    await vi.waitFor(() => expect(manager.getTask(legacyTaskId)?.status).toBe('completed'));

    const terminalResult = await resultTool.execute('result-1', { task_id: backgroundTaskId }, undefined, undefined, { cwd: env.tmp });
    expect(terminalResult.details.task).toMatchObject({ pending_message_count: 0, undelivered_message_count: 16 });
    expect(terminalResult.content[0].text).not.toContain('queued message 0');
    expect(terminalResult.content[0].text).not.toContain('Please include the missing constraint.');

    const zeroUndelivered = await resultTool.execute('result-2', { task_id: legacyTaskId }, undefined, undefined, { cwd: env.tmp });
    expect(zeroUndelivered.details.task).toMatchObject({ undelivered_message_count: 0 });
  }, 5000);

  it('renders subagent_send_message with boxed layout in collapsed and expanded states', () => {
    let sendTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_send_message') sendTool = tool; } }, new SubagentManager(env.mockRunner()));

    expect(sendTool.renderShell).toBe('self');
    expect(sendTool.renderCall({}, {}).render(80)).toHaveLength(0);

    const queuedResult = {
      content: [{ type: 'text', text: 'queued: please steer' }],
      details: { status: 'queued', task_id: 'subtask_123', message: 'please steer', pending_message_count: 1 },
    };
    const theme = { fg: (_n: string, t: string) => t, bold: (t: string) => t };

    const collapsed = sendTool.renderResult(queuedResult, { expanded: false }, theme).render(80);
    expect(collapsed[0]).toContain('┌─');
    expect(collapsed[0]).toContain('󰣇');
    expect(collapsed[0]).toContain('subagent send message · queued');
    expect(collapsed.join('\n')).toContain('task_id: subtask_123');
    expect(collapsed.join('\n')).toContain('ctrl+o to expand');

    const expanded = sendTool.renderResult(queuedResult, { expanded: true }, theme).render(80);
    expect(expanded[0]).toContain('┌─');
    expect(expanded[0]).toContain('󰣇');
    expect(expanded.join('\n')).toContain('Message');
    expect(expanded.join('\n')).toContain('please steer');
    expect(expanded.join('\n')).toContain('pending messages: 1');
  });
});
