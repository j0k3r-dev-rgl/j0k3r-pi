import { describe, expect, it, vi } from 'vitest';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

async function enableContinue() {
  await import('node:fs').then((fs) => fs.writeFileSync(`${env.tmp}/.pi/subagents.json`, JSON.stringify({ enable_continue: true })));
}

describe('subagent_continue tool', () => {
  it('registers subagent_continue only when continuation is explicitly enabled', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(env.mockRunner(0));
    const defaultTools: string[] = [];
    registerSubagentTools({ registerTool: (tool: any) => { defaultTools.push(tool.name); } }, manager, env.tmp);

    expect(defaultTools).not.toContain('subagent_continue');

    await enableContinue();
    const enabledTools: string[] = [];
    registerSubagentTools({ registerTool: (tool: any) => { enabledTools.push(tool.name); } }, manager, env.tmp);

    expect(enabledTools).toContain('subagent_continue');
  });

  it('propagates the parent Pi API into continuation attempts', async () => {
    env.writeAgent('analyst');
    await enableContinue();
    const nestedSessionPath = `${env.tmp}/pi-context-resume-session.jsonl`;
    await import('node:fs').then((fs) => fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n'));
    let continueTool: any;
    const parentPi = {
      getAllTools: vi.fn(() => []),
      registerTool: (tool: any) => { if (tool.name === 'subagent_continue') continueTool = tool; },
    };
    let continuationPi: unknown;
    const manager = new SubagentManager(async ({ continuation, ctx, onActivity }: any) => {
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      if (continuation) continuationPi = ctx?.pi;
      return { result: continuation ? 'continued' : 'initial', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any;
    });
    registerSubagentTools(parentPi, manager, env.tmp);

    const first = await manager.run({ agent: 'analyst', task: 'initial execution', mode: 'task' }, { cwd: env.tmp });
    await continueTool.execute('1', { task_id: first.task_ids[0], prompt: 'Continue.' }, undefined, undefined, { cwd: env.tmp });

    expect(continuationPi).toBe(parentPi);
  });

  it('registers an auditable continuation tool, preserves the task id, and warns that overrides require explicit user direction', async () => {
    env.writeAgent('analyst');
    await enableContinue();
    const nestedSessionPath = `${env.tmp}/resume-session.jsonl`;
    await import('node:fs').then((fs) => fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n'));
    const manager = new SubagentManager(async ({ continuation, nested_session_path, effectiveProfile, onActivity }) => {
      onActivity?.({ message: 'session ready', nested_session_path: nestedSessionPath } as any);
      return {
        result: continuation ? `continued: ${continuation.prompt}` : 'initial result',
        model: effectiveProfile?.model.label.replace(/^(?:profile|orchestrator): /, ''),
        effort: effectiveProfile?.effort.value,
        fallback_used: false,
        nested_session_path: nested_session_path ?? nestedSessionPath,
      } as any;
    });
    let continueTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_continue') continueTool = tool; } }, manager, env.tmp);

    const first = await manager.run({ agent: 'analyst', task: 'initial execution', mode: 'task' }, { cwd: env.tmp });
    const taskId = first.task_ids[0]!;
    const renderedCall = continueTool.renderCall(
      { task_id: taskId, prompt: 'Continue with the approved fix.' },
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
    ).render(160).join('\n');
    const result = await continueTool.execute('1', { task_id: taskId, prompt: 'Continue with the approved fix.' }, undefined, undefined, { cwd: env.tmp });

    expect(continueTool.description).toContain('explicit user decision');
    expect(continueTool.description).toContain('Never auto-switch models');
    expect(continueTool.renderShell).toBe('self');
    expect(continueTool.parameters.properties.mode.anyOf.map((entry: any) => entry.const)).toEqual(['task', 'background']);
    expect(renderedCall).toBe('');
    expect(result.details.task.id).toBe(taskId);
    expect(result.details.task.attempt).toBe(2);
    expect(result.content[0].text).toContain(`task_id: ${taskId}`);
    expect(result.content[0].text).toContain('continued: Continue with the approved fix.');
    expect(result.content[0].text).not.toContain('subagent_continue');
    expect(result.content[0].text).not.toContain('Ask the user before resuming');
    const renderedResult = continueTool.renderResult(result, { expanded: false, isPartial: false }, { fg: (_name: string, text: string) => text }).render(160).join('\n');
    expect(renderedResult).toContain('subagent: analyst');
    expect(renderedResult).toContain('status: completed');
    expect(renderedResult).toContain('click to view execution');
    expect(renderedResult).not.toContain(`id: ${taskId}`);
  });

  it('streams the same live task-mode progress rendering as subagent_run before completion', async () => {
    await enableContinue();
    env.writeAgent('analyst');
    const nestedSessionPath = `${env.tmp}/live-resume-session.jsonl`;
    await import('node:fs').then((fs) => fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n'));
    const manager = new SubagentManager(async ({ continuation, onActivity }) => {
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      if (continuation) {
        onActivity?.({ message: 'reading package.json', thread_snapshot: env.statusSnapshot('reading package.json') } as any);
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { result: 'live continuation done', model: 'mock/model', effort: 'high', fallback_used: false, nested_session_path: nestedSessionPath } as any;
      }
      return { result: 'initial result', model: 'mock/model', effort: 'high', fallback_used: false, nested_session_path: nestedSessionPath } as any;
    });
    let continueTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_continue') continueTool = tool; } }, manager, env.tmp);
    const ctx = { cwd: env.tmp, model: { provider: 'mock', id: 'model' }, thinkingLevel: 'high', ui: { onTerminalInput: vi.fn(() => () => undefined) } };
    const first = await manager.run({ agent: 'analyst', task: 'initial execution', mode: 'task' }, ctx);
    const updates: any[] = [];

    const result = await continueTool.execute(
      '1',
      { task_id: first.task_ids[0], prompt: 'Run the delayed live test.' },
      undefined,
      (update: any) => updates.push(update),
      ctx,
    );

    const activeUpdate = updates.find((update) => update.details?.tasks?.[0]?.status === 'running' && update.details.tasks[0].last_activity === 'reading package.json');
    expect(activeUpdate).toBeDefined();
    expect(activeUpdate.details.tasks[0]).toMatchObject({ agent: 'analyst', attempt: 2, model: 'mock/model', effort: 'high' });
    const partial = continueTool.renderResult(activeUpdate, { expanded: false, isPartial: true }, { fg: (_name: string, text: string) => text }).render(160).join('\n');
    expect(partial).toContain('agent: analyst');
    expect(partial).toContain('status: running');
    expect(partial).toContain('attempt: 2');
    expect(partial).toContain('reading package.json');
    expect(result.content[0].text).toContain('live continuation done');
  });

  it('supports double-escape cancellation while a continued task is running without cancelling background tasks', async () => {
    await enableContinue();
    env.writeAgent('analyst');
    env.writeAgent('backgrounder');
    const nestedSessionPath = `${env.tmp}/cancel-live-resume-session.jsonl`;
    await import('node:fs').then((fs) => fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n'));
    const manager = new SubagentManager(async ({ definition, continuation, signal, onActivity }) => {
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      if (definition.name === 'backgrounder') {
        await new Promise<void>((_resolve, reject) => {
          if (signal.aborted) reject(new Error('aborted'));
          else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        return { result: 'background unreachable', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any;
      }
      if (!continuation) return { result: 'initial result', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any;
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) reject(new Error('aborted'));
        else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return { result: 'unreachable', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any;
    });
    let continueTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_continue') continueTool = tool; } }, manager, env.tmp);
    const first = await manager.run({ agent: 'analyst', task: 'initial execution', mode: 'task' }, { cwd: env.tmp });
    const background = await manager.run({ agent: 'backgrounder', task: 'unrelated background execution', mode: 'background' }, { cwd: env.tmp });
    const backgroundId = background.task_ids[0]!;
    const terminalHandlers: Array<(data: string) => any> = [];
    const abort = vi.fn();
    const resultPromise = continueTool.execute(
      '1',
      { task_id: first.task_ids[0], prompt: 'Keep running until cancelled.' },
      undefined,
      vi.fn(),
      { cwd: env.tmp, abort, ui: { onTerminalInput: (handler: any) => { terminalHandlers.push(handler); return () => undefined; }, notify: vi.fn() } },
    );
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0]!, env.tmp)?.status).toBe('running'));

    for (const handler of terminalHandlers) handler('\u001b');
    for (const handler of terminalHandlers) handler('\u001b');
    const result = await resultPromise;

    expect(abort).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('cancelled by double escape');
    expect(result.content[0].text).toContain('can be resumed with `subagent_continue`');
    expect(manager.getTask(first.task_ids[0]!, env.tmp)?.status).toBe('cancelled');
    expect(manager.getTask(backgroundId, env.tmp)?.status).toBe('running');
    manager.cancel(backgroundId, 'test cleanup');
  });

  it('starts a fresh continuation attempt without restoring the prior live queue', async () => {
    await enableContinue();
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents', 'backgrounder.md'), `---\nname: backgrounder\ndescription: background agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);
    const nestedSessionPath = `${env.tmp}/fresh-continuation-session.jsonl`;
    fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
    let attempt = 0;
    let releaseFirst: (() => void) | undefined;
    const manager = new SubagentManager(async ({ continuation, onActivity }) => {
      attempt += 1;
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      if (!continuation) {
        return await new Promise((resolve) => {
          releaseFirst = () => resolve({ result: 'initial background done', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any);
        });
      }
      return { result: `continued attempt ${attempt}`, model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any;
    });

    const first = await manager.run({ agent: 'backgrounder', task: 'initial execution', mode: 'background' }, { cwd: env.tmp, sessionId: 'parent-a' });
    const taskId = first.task_ids[0]!;
    await vi.waitFor(() => expect(manager.getTask(taskId, env.tmp)?.status).toBe('running'));
    (manager as any).registerLiveBridge(taskId, { supported: true, detected_pi_version: '0.82.1', steer: vi.fn() }, 'parent-a', 1);
    expect((manager as any).sendMessage({ task_id: taskId, message: 'stale pending message', session_id: 'parent-a' })).toMatchObject({ status: 'queued', pending_message_count: 1 });

    releaseFirst?.();
    await vi.waitFor(() => expect(manager.getTask(taskId, env.tmp)?.status).toBe('completed'));
    expect(manager.getTask(taskId, env.tmp)).toMatchObject({ undelivered_message_count: 1, pending_message_count: 0 });

    const continued = await manager.continueTask({ task_id: taskId, prompt: 'Resume without replay.' }, { cwd: env.tmp });
    expect(continued).toMatchObject({ mode: 'background', task_ids: [taskId] });
    await vi.waitFor(() => expect(manager.getTask(taskId, env.tmp)?.status).toBe('completed'));
    expect(manager.getTask(taskId, env.tmp)).toMatchObject({ attempt: 2, pending_message_count: 0, undelivered_message_count: 0 });
  });

  it('preserves omitted background mode and renders it consistently for continuations', async () => {
    await enableContinue();
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents', 'backgrounder.md'), `---\nname: backgrounder\ndescription: background agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);
    const nestedSessionPath = `${env.tmp}/omitted-background-continue-session.jsonl`;
    fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
    let releaseContinuation: (() => void) | undefined;
    const manager = new SubagentManager(async ({ continuation, onActivity }) => {
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      if (!continuation) return { result: 'initial background done', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any;
      return await new Promise((resolve) => {
        releaseContinuation = () => resolve({ result: 'continued in background', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any);
      });
    });
    let continueTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_continue') continueTool = tool; } }, manager, env.tmp);

    const first = await manager.run({ agent: 'backgrounder', task: 'initial execution', mode: 'background' }, { cwd: env.tmp });
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0]!, env.tmp)?.status).toBe('completed'));

    const renderedCall = continueTool.renderCall(
      { task_id: first.task_ids[0], prompt: 'Resume without changing mode.' },
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
    ).render(160).join('\n');
    const resultPromise = continueTool.execute('1', { task_id: first.task_ids[0], prompt: 'Resume without changing mode.' }, undefined, undefined, { cwd: env.tmp });
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0]!, env.tmp)?.status).toBe('running'));
    const immediateResult = await resultPromise;

    expect(renderedCall).toBe('');
    expect(immediateResult.content[0].text).toContain('Continued 1 subagent task(s) to background');
    expect(immediateResult.content[0].text).toContain('The subagent will notify this chat automatically when it finishes.');
    expect(manager.getTask(first.task_ids[0]!, env.tmp)).toMatchObject({ attempt: 2, mode: 'background', effective_mode: 'background', status: 'running' });

    releaseContinuation?.();
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0]!, env.tmp)?.status).toBe('completed'));
  });

  it('lets an explicit task continuation override a previous background mode and wait for completion', async () => {
    await enableContinue();
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents', 'backgrounder.md'), `---\nname: backgrounder\ndescription: background agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);
    const nestedSessionPath = `${env.tmp}/explicit-task-continue-session.jsonl`;
    fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
    const manager = new SubagentManager(async ({ continuation, onActivity }) => {
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      if (!continuation) return { result: 'initial background done', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { result: 'continued in task mode', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any;
    });
    let continueTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_continue') continueTool = tool; } }, manager, env.tmp);

    const first = await manager.run({ agent: 'backgrounder', task: 'initial execution', mode: 'background' }, { cwd: env.tmp });
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0]!, env.tmp)?.status).toBe('completed'));

    const renderedCall = continueTool.renderCall(
      { task_id: first.task_ids[0], prompt: 'Wait for the continuation.', mode: 'task' },
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
    ).render(160).join('\n');
    const result = await continueTool.execute('1', { task_id: first.task_ids[0], prompt: 'Wait for the continuation.', mode: 'task' }, undefined, undefined, { cwd: env.tmp, ui: { onTerminalInput: vi.fn(() => () => undefined) } });

    expect(renderedCall).toBe('');
    expect(result.content[0].text).toContain('continued in task mode');
    expect(result.details.task).toMatchObject({ attempt: 2, mode: 'task', effective_mode: 'task', status: 'completed' });
    expect(result.content[0].text).not.toContain('to background');
  });

  it('lets an explicit background continuation override a previous task mode and return immediately', async () => {
    await enableContinue();
    env.writeAgent('analyst');
    const nestedSessionPath = `${env.tmp}/explicit-background-continue-session.jsonl`;
    await import('node:fs').then((fs) => fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n'));
    let releaseContinuation: (() => void) | undefined;
    const manager = new SubagentManager(async ({ continuation, onActivity }) => {
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      if (!continuation) return { result: 'initial task done', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any;
      return await new Promise((resolve) => {
        releaseContinuation = () => resolve({ result: 'continued in background mode', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any);
      });
    });
    let continueTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_continue') continueTool = tool; } }, manager, env.tmp);

    const first = await manager.run({ agent: 'analyst', task: 'initial execution', mode: 'task' }, { cwd: env.tmp });
    const taskId = first.task_ids[0]!;

    const renderedCall = continueTool.renderCall(
      { task_id: taskId, prompt: 'Resume in background.', mode: 'background' },
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
    ).render(160).join('\n');
    const resultPromise = continueTool.execute('1', { task_id: taskId, prompt: 'Resume in background.', mode: 'background' }, undefined, undefined, { cwd: env.tmp, ui: { notify: vi.fn() } });
    await vi.waitFor(() => expect(manager.getTask(taskId, env.tmp)?.status).toBe('running'));
    const immediateResult = await resultPromise;

    expect(renderedCall).toBe('');
    expect(immediateResult.content[0].text).toContain('Continued 1 subagent task(s) to background');
    expect(manager.getTask(taskId, env.tmp)).toMatchObject({ attempt: 2, mode: 'background', effective_mode: 'background', status: 'running' });

    releaseContinuation?.();
    await vi.waitFor(() => expect(manager.getTask(taskId, env.tmp)?.status).toBe('completed'));
  });

  it('supports ctrl+h background handoff for task-mode continuations', async () => {
    await enableContinue();
    const fs = await import('node:fs');
    env.writeAgent('analyst');
    const nestedSessionPath = `${env.tmp}/background-live-resume-session.jsonl`;
    fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
    const manager = new SubagentManager(async ({ continuation, onActivity }) => {
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      if (continuation) await new Promise((resolve) => setTimeout(resolve, 60));
      return { result: continuation ? 'background continuation done' : 'initial result', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any;
    });
    let continueTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_continue') continueTool = tool; } }, manager, env.tmp);
    const first = await manager.run({ agent: 'analyst', task: 'initial execution', mode: 'task' }, { cwd: env.tmp });
    const terminalHandlers: Array<(data: string) => any> = [];
    const resultPromise = continueTool.execute(
      '1',
      { task_id: first.task_ids[0], prompt: 'Continue in background.' },
      undefined,
      vi.fn(),
      { cwd: env.tmp, ui: { onTerminalInput: (handler: any) => { terminalHandlers.push(handler); return () => undefined; }, notify: vi.fn() } },
    );
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0]!, env.tmp)?.status).toBe('running'));

    for (const handler of terminalHandlers) handler('\u0008');
    const result = await resultPromise;

    expect(result.terminate).toBe(true);
    expect(result.content[0].text).toContain('Continued 1 subagent task(s) to background');
    expect(manager.getTask(first.task_ids[0]!, env.tmp)?.mode).toBe('background');
    await vi.waitFor(() => expect(manager.getTask(first.task_ids[0]!, env.tmp)?.status).toBe('completed'));
  });

  it('returns failed resumed attempts as errors with user-decision guidance', async () => {
    await enableContinue();
    env.writeAgent('analyst');
    const nestedSessionPath = `${env.tmp}/failed-resume-session.jsonl`;
    await import('node:fs').then((fs) => fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n'));
    let attempt = 0;
    const manager = new SubagentManager(async ({ onActivity }) => {
      attempt += 1;
      onActivity?.({ message: 'session ready', nested_session_path: nestedSessionPath } as any);
      if (attempt > 1) throw new Error('continued attempt failed');
      return { result: 'initial result', model: 'mock/model', fallback_used: false, nested_session_path: nestedSessionPath } as any;
    });
    let continueTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_continue') continueTool = tool; } }, manager, env.tmp);

    const first = await manager.run({ agent: 'analyst', task: 'initial execution', mode: 'task' }, { cwd: env.tmp });
    const result = await continueTool.execute('1', { task_id: first.task_ids[0], prompt: 'Try the next step.' }, undefined, undefined, { cwd: env.tmp });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('continued attempt failed');
    expect(result.content[0].text).toContain('can be resumed with `subagent_continue`');
    expect(result.content[0].text).toContain('Ask the user before resuming');
    expect(result.content[0].text).toContain('model and effort');
  });

  it('rejects legacy tasks without a valid persisted nested session file', async () => {
    await enableContinue();
    const history = new (await import('../../src/history.js')).SubagentHistoryStore();
    history.upsertTask(env.tmp, {
      id: 'subtask_legacy_resume',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'legacy execution',
      created_at: new Date().toISOString(),
      nested_session_path: `${env.tmp}/missing-session.jsonl`,
      result: 'legacy result',
      attempt: 1,
    } as any);
    const manager = new SubagentManager(env.mockRunner(), history);
    let continueTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_continue') continueTool = tool; } }, manager, env.tmp);

    const result = await continueTool.execute('1', { task_id: 'subtask_legacy_resume', prompt: 'resume it' }, undefined, undefined, { cwd: env.tmp });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('missing or unreadable nested session file');
  });
});
