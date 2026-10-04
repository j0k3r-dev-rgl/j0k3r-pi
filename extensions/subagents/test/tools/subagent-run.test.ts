import { describe, expect, it, vi } from 'vitest';
import extension from '../../index.js';
import { SubagentStructuredError, normalizeErrorMetadata } from '../../src/error-metadata.js';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

describe('subagent_run tool', () => {
  it('README documents single-agent subagent_run behavior without batch parameters', async () => {
    const fs = await import('node:fs');
    const readme = fs.readFileSync('README.md', 'utf8');

    expect(readme).toContain('subagent_mode');
    expect(readme).toContain('default_mode');
    expect(readme).toContain('input.mode ?? definition.subagent_mode ?? config.default_mode');
    expect(readme).toContain('agent: string;');
    expect(readme).not.toContain('agents?: string[];');
    expect(readme).not.toContain('Multiple agents can run from one request');
  });

  it('registers model-facing guidance to omit mode unless the user explicitly requested task or background', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(env.mockRunner(0));
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    expect(runTool.description).toContain('omit mode');
    expect(runTool.description).toContain('task');
    expect(runTool.description).toContain('background');
    expect(runTool.description).toContain('instead of sleeping, polling status, or fetching results just to wait');
    expect(runTool.renderShell).toBe('self');
    expect(runTool.promptSnippet).toContain('omit mode');
    expect(runTool.promptSnippet).toContain('respond immediately');
    expect(runTool.promptSnippet).toContain('do not sleep or poll status just to wait');
    expect(runTool.parameters.properties.mode).toBeDefined();
    expect(runTool.parameters.properties.agent).toBeDefined();
    expect(runTool.parameters.properties.name).toBeDefined();
    expect(runTool.parameters.properties.display_name).toBeDefined();
    expect(runTool.parameters.properties.agents).toBeUndefined();
  });

  it('rejects legacy batch agents input so subagent_run only launches one subagent', async () => {
    env.writeAgent('analyst');
    env.writeAgent('reviewer');
    const manager = new SubagentManager(env.mockRunner(0));
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const result = await runTool.execute('1', { agents: ['analyst', 'reviewer'], task: 'batch work' }, undefined, undefined, { cwd: env.tmp });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('subagent_run accepts exactly one agent');
    expect(manager.listTasks(env.tmp)).toHaveLength(0);
  });

  it('treats omitted mode that resolves to background as background UI behavior', async () => {
    const fs = await import('node:fs');
    fs.writeFileSync(`${env.tmp}/.pi/subagents.json`, JSON.stringify({ default_mode: 'background' }));
    env.writeAgent('analyst');
    const manager = new SubagentManager(env.mockRunner(50));
    let runTool: any;
    const onUpdate = vi.fn();
    const onTerminalInput = vi.fn(() => () => undefined);
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const result = await runTool.execute('1', { agent: 'analyst', task: 'implicit background instructions' }, undefined, onUpdate, { cwd: env.tmp, ui: { onTerminalInput } });

    expect(result.content[0].text).toContain('Started 1 subagent task(s) to background');
    expect(result.terminate).not.toBe(true);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onTerminalInput).not.toHaveBeenCalled();
  });

  it('tells the agent to free the chat and wait for automatic notification after background launch', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(env.mockRunner(50));
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const result = await runTool.execute('1', { agent: 'analyst', task: 'background instructions', mode: 'background' }, undefined, undefined, { cwd: env.tmp });
    const text = result.content[0].text;

    expect(text).toContain('Sent 1 subagent task(s) to background');
    expect(text).toContain('task_id: subtask_analyst_');
    expect(text).toContain('Do not call subagent_status or subagent_result just to wait');
    expect(text).toContain('The subagent will notify this chat automatically when it finishes');
    expect(text).toContain('Keep the chat available so the user can continue asking questions');
    expect(result.terminate).not.toBe(true);
  });

  it('streams task-mode progress from lifecycle updates without installing a recurring render timer', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(env.mockRunner(0));
    let runTool: any;
    const updates: any[] = [];
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    try {
      registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

      const result = await runTool.execute('1', { agent: 'analyst', task: 'event progress', mode: 'task' }, undefined, (update: any) => updates.push(update), { cwd: env.tmp });

      expect(result.isError).not.toBe(true);
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(updates.length).toBeGreaterThan(1);
      expect(updates.some((update) => update.content[0].text.includes('status: running'))).toBe(true);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it('returns a background handoff result for the latest active task-mode run when ctrl+h shortcut is triggered', async () => {
    env.writeAgent('analyst');
    env.writeAgent('reviewer');
    const manager = new SubagentManager(env.mockRunner(50));
    let runTool: any;
    let shortcutHandler: ((ctx: any) => any) | undefined;
    const notifications: string[] = [];
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    extension({
      registerTool: () => undefined,
      registerCommand: () => undefined,
      registerShortcut: (key: string, shortcut: any) => {
        if (key === 'ctrl+h') shortcutHandler = shortcut.handler;
      },
    });

    const firstResultPromise = runTool.execute('1', { agent: 'analyst', task: 'first task mode', mode: 'task' }, undefined, undefined, {
      cwd: env.tmp,
      ui: {
        onTerminalInput: () => () => undefined,
        notify: (message: string) => { notifications.push(message); },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const secondResultPromise = runTool.execute('2', { agent: 'reviewer', task: 'second task mode', mode: 'task' }, undefined, undefined, {
      cwd: env.tmp,
      ui: {
        onTerminalInput: () => () => undefined,
        notify: (message: string) => { notifications.push(message); },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await shortcutHandler?.({ cwd: env.tmp, ui: { notify: (message: string) => { notifications.push(message); } } });

    const secondResult = await secondResultPromise;
    const text = secondResult.content[0].text;
    expect(secondResult.isError).not.toBe(true);
    expect(secondResult.terminate).toBe(true);
    expect(notifications.some((message) => message.includes('Sent subagent to background:'))).toBe(true);
    expect(text).toContain('Sent 1 subagent task(s) to background');
    const taskId = secondResult.details?.task_ids?.[0];
    expect(taskId).toBeDefined();
    expect(manager.getTask(taskId, env.tmp)).toMatchObject({ agent: 'reviewer', mode: 'background' });

    const firstResult = await firstResultPromise;
    expect(firstResult.content[0].text).toContain('Completed 1 subagent task');
    expect(firstResult.details.results[0]).toMatchObject({ agent: 'analyst', mode: 'task', status: 'completed' });
  });

  it('keeps subagent_run command results compact when tasks include large thread snapshots', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(async () => ({
      result: 'compact result',
      model: 'mock/model',
      fallback_used: false,
      thread_snapshot: env.statusSnapshot('oversized snapshot text '.repeat(400)),
    }));
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const result = await runTool.execute('1', { agent: 'analyst', task: 'compact snapshots', mode: 'task' }, undefined, undefined, { cwd: env.tmp });
    const serialized = JSON.stringify(result);

    expect(result.content[0].text).toContain('Completed 1 subagent task');
    expect(serialized).not.toContain('thread_snapshot');
    expect(serialized).not.toContain('oversized snapshot text oversized snapshot text oversized snapshot text');
  });

  it('returns task-mode subagent_run with full content for the orchestrator and collapsed/expanded user render', async () => {
    env.writeAgent('analyst');
    const rawResponse = 'task-mode final response for orchestrator with tool-looking text to=functions.memory_get '.repeat(6);
    const manager = new SubagentManager(async () => ({ result: rawResponse, model: 'mock/model', fallback_used: false }));
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const result = await runTool.execute('1', { agent: 'analyst', task: 'return full content', mode: 'task' }, undefined, undefined, { cwd: env.tmp });

    expect(result.content[0].text).toContain(rawResponse);
    expect(result.content[0].text).toContain(`task_id: ${result.details.results[0].id}`);
    expect(result.content[0].text).not.toContain('subagent_continue');
    expect(result.details.results[0].result).toBe(rawResponse);

    const collapsedResult = runTool.renderResult(result, { expanded: false, isPartial: false }, { fg: (_name: string, text: string) => text }).render(90).join('\n');
    expect(collapsedResult).toContain('subagent: analyst');
    expect(collapsedResult).toContain('click to view execution');
    expect(collapsedResult).not.toContain('Subagent response');
    expect(collapsedResult).not.toContain('to=functions.memory_get');
    expect(collapsedResult).not.toContain('id: subtask_');

    const expandedResult = runTool.renderResult(result, { expanded: true, isPartial: false }, { fg: (_name: string, text: string) => text }).render(90).join('\n');
    expect(expandedResult).toContain('subagent: analyst');
    expect(expandedResult).toContain('click to view execution');
    expect(expandedResult).toContain('Subagent response');
    expect(expandedResult).toContain('to=functions.memory_get');
    expect(expandedResult).not.toContain('id: subtask_');
  });

  it('returns an error tool result without continuation guidance when continuation is disabled', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(async () => { throw new Error('review failed'); });
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const result = await runTool.execute('1', { agent: 'analyst', task: 'fail', mode: 'task' }, undefined, undefined, { cwd: env.tmp });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('failed');
    expect(result.content[0].text).not.toContain('subagent_continue');
    expect(result.content[0].text).not.toContain('Ask the user before resuming');
    expect(result.content[0].text).not.toContain('Never switch models automatically');
  });

  it('returns an error tool result when any task-mode subagent fails', async () => {
    env.writeAgent('analyst');
    await import('node:fs').then((fs) => fs.writeFileSync(`${env.tmp}/.pi/subagents.json`, JSON.stringify({ enable_continue: true })));
    const manager = new SubagentManager(async () => { throw new Error('review failed'); });
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const result = await runTool.execute('1', { agent: 'analyst', task: 'fail', mode: 'task' }, undefined, undefined, { cwd: env.tmp });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('failed');
    expect(result.content[0].text).toContain('can be resumed with `subagent_continue`');
    expect(result.content[0].text).toContain('Ask the user before resuming');
    expect(result.content[0].text).toContain('model and effort');
    expect(result.content[0].text).toContain('Never switch models automatically');
  });

  it('exposes only safe structured error summaries in subagent_run details while preserving legacy error text', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(async () => {
      throw new SubagentStructuredError(normalizeErrorMetadata({
        category: 'provider_api_error',
        message: 'Authorization: Bearer sk-fake-secret-token fake.user@example.com /tmp/fake-private.txt',
        partial_result_available: false,
        details: {
          provider_code: '429',
          auth_header: 'Authorization: Bearer sk-fake-secret-token',
          prompt: 'SYSTEM: hidden prompt body',
          file_path: '/tmp/fake-private.txt',
          nested_payload: JSON.stringify({ transcript: 'SECRET_FILE_BODY_DO_NOT_SHOW' }),
        },
        last_activity: 'USER: hidden prompt body /tmp/fake-private.txt',
      }));
    });
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const runResult = await runTool.execute('1', { agent: 'analyst', task: 'structured failure', mode: 'task' }, undefined, undefined, { cwd: env.tmp });

    expect(runResult.isError).toBe(true);
    expect(runResult.details.results[0].error).toBe('provider api error');
    expect(runResult.details.results[0].error_metadata).toMatchObject({
      version: 1,
      category: 'provider_api_error',
      retryable: true,
      code: 'provider_api_error',
      partial_result_available: false,
      details: { provider_code: '429' },
    });
    const serialized = JSON.stringify(runResult.details.results[0].error_metadata);
    expect(serialized).not.toContain('sk-fake-secret-token');
    expect(serialized).not.toContain('fake.user@example.com');
    expect(serialized).not.toContain('/tmp/fake-private.txt');
    expect(serialized).not.toContain('hidden prompt body');
    expect(serialized).not.toContain('SECRET_FILE_BODY_DO_NOT_SHOW');
  });

  it('ignores marker-like prose and docs text as actionable interaction requests and keeps final output marker-free', async () => {
    env.writeAgent('analyst');
    const markerLikeText = [
      'documentation example:',
      'interaction_required:{"type":"interaction_required","requestId":"fake","kind":"docs"}',
      'tool output fixture mentions interaction_required:{"type":"interaction_required","requestId":"fake-2","kind":"docs"}',
    ].join('\n');
    const runner = vi.fn(async () => ({
      result: markerLikeText,
      model: 'mock/model',
      fallback_used: false,
      thread_snapshot: {
        version: 1,
        source: 'events',
        items: [
          { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: markerLikeText }] } },
          { type: 'tool', name: 'read', status: 'completed', arguments: { path: 'docs.md' }, result: { content: [{ type: 'text', text: markerLikeText }], isError: false } },
        ],
      },
    }));
    const manager = new SubagentManager(runner as any);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const select = vi.fn();

    const result = await runTool.execute('1', { agent: 'analyst', task: 'document marker handling', mode: 'task' }, undefined, undefined, { cwd: env.tmp, ui: { select } });

    expect(select).not.toHaveBeenCalled();
    expect(runner).toHaveBeenCalledOnce();
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify(result.details.results[0])).not.toContain('interaction_required:');
  });

  it('prompts the main thread from a generic select interaction, publishes the response, retries, and keeps surfaces marker-free', async () => {
    env.writeAgent('analyst');
    const request = {
      type: 'interaction_required' as const,
      requestId: 'req-select',
      kind: 'operator-choice',
      origin: 'subagent',
      requester: { subagentName: 'analyst' },
      reason: 'The subagent needs an operator decision.',
      prompt: {
        title: 'Choose strategy',
        message: 'How should the subagent continue?',
        choices: ['safe', 'fast'],
      },
      payload: { candidates: ['safe path', 'fast path'] },
      response: { expected: 'choice' },
    };
    let attempts = 0;
    const runner = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          result: 'stale transcript mentions interaction_required:{"type":"interaction_required","requestId":"stale","kind":"docs"}',
          model: 'mock/model',
          fallback_used: false,
          interaction_request: request,
          transcript: 'stale transcript mentions interaction_required:{"type":"interaction_required","requestId":"stale","kind":"docs"}',
          thread_snapshot: { version: 1, source: 'events', items: [{ type: 'status', text: 'interaction_required:{"type":"interaction_required","requestId":"stale","kind":"docs"}' }] },
        } as any;
      }
      const { consumeInteractionResponse } = await import('../../src/interaction-channel.js');
      const response = consumeInteractionResponse('req-select');
      expect(response).toMatchObject({ status: 'answered', value: 'safe' });
      return {
        result: `continued with ${response?.value}`,
        model: 'mock/model',
        fallback_used: false,
        thread_snapshot: { version: 1, source: 'events', items: [{ type: 'status', text: 'continued with safe' }] },
      } as any;
    });
    const interactionPromptActive = vi.fn();
    const manager = new SubagentManager(runner, undefined, undefined, interactionPromptActive);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const select = vi.fn(async (message: string, choices: string[]) => {
      expect(choices).toEqual(['safe', 'fast']);
      expect(message).toContain('How should the subagent continue?');
      expect(message).toContain('safe path');
      expect(message).not.toContain('stale');
      return 'safe';
    });

    const result = await runTool.execute('1', { agent: 'analyst', task: 'choose strategy', mode: 'task' }, undefined, undefined, { cwd: env.tmp, ui: { select } });
    const task = manager.listTasks(env.tmp)[0];

    expect(select).toHaveBeenCalledOnce();
    expect(interactionPromptActive.mock.calls).toEqual([[true], [false]]);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeUndefined();
    expect(result.details.results[0].result).toContain('continued with safe');
    expect(JSON.stringify(result.details.results[0])).not.toContain('interaction_required:');
    expect(JSON.stringify(task)).not.toContain('interaction_required:');
  });

  it('uses editor fallback for arbitrary interaction payloads that cannot be represented as simple choices', async () => {
    env.writeAgent('analyst');
    const request = {
      type: 'interaction_required' as const,
      requestId: 'req-custom',
      kind: 'custom-workflow',
      origin: 'subagent',
      prompt: { title: 'Custom workflow input', message: 'Return a JSON plan.' },
      payload: { fields: [{ name: 'plan', type: 'array' }] },
      response: { expected: 'json', instructions: 'Return JSON with a plan array.' },
    };
    let attempts = 0;
    const runner = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) return { result: 'custom interaction pending', model: 'mock/model', fallback_used: false, interaction_request: request };
      const { consumeInteractionResponse } = await import('../../src/interaction-channel.js');
      const response = consumeInteractionResponse('req-custom');
      expect(response).toMatchObject({ status: 'answered', value: { plan: ['inspect', 'apply'] } });
      return { result: 'custom response consumed', model: 'mock/model', fallback_used: false };
    });
    const manager = new SubagentManager(runner as any);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const editor = vi.fn(async (message: string, initial: string) => {
      expect(message).toContain('Return a JSON plan.');
      expect(initial).toContain('custom-workflow');
      expect(initial).toContain('fields');
      return JSON.stringify({ plan: ['inspect', 'apply'] });
    });

    const result = await runTool.execute('1', { agent: 'analyst', task: 'needs arbitrary input', mode: 'task' }, undefined, undefined, { cwd: env.tmp, ui: { editor } });

    expect(editor).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeUndefined();
    expect(result.details.results[0].result).toContain('custom response consumed');
  });

  it('fails background subagents that request main-thread interaction', async () => {
    env.writeAgent('analyst');
    const request = {
      type: 'interaction_required' as const,
      requestId: 'req-background',
      kind: 'confirm',
      origin: 'subagent',
      prompt: { title: 'Confirm action', message: 'Continue?' },
      response: { expected: 'boolean' },
    };
    const runner = vi.fn(async () => ({ result: 'needs interaction', model: 'mock/model', fallback_used: false, interaction_request: request }));
    const manager = new SubagentManager(runner as any);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const result = await runTool.execute('1', { agent: 'analyst', task: 'background interaction', mode: 'background' }, undefined, undefined, { cwd: env.tmp, ui: { confirm: vi.fn() } });

    expect(result.isError).toBeUndefined();
    const taskId = result.details.task_ids[0];
    await vi.waitFor(() => expect(manager.getTask(taskId, env.tmp)?.status).toBe('failed'));
    expect(manager.getTask(taskId, env.tmp)?.error).toContain('Subagent interaction requires main-thread handling');
  });

  it('ingests display_name and name via subagent_run and keeps raw IDs hidden from user-visible UI', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(async () => ({ result: 'friendly execution done', model: 'mock/model', fallback_used: false }));
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const result = await runTool.execute('1', {
      agent: 'analyst',
      task: 'friendly task test',
      display_name: 'Friendly Test Name',
      mode: 'task',
    }, undefined, undefined, { cwd: env.tmp });

    // Machine/structured details preserve IDs
    expect(result.details.task_ids[0]).toMatch(/^subtask_analyst_/);
    expect(result.details.results[0].id).toMatch(/^subtask_analyst_/);
    expect(result.details.results[0].display_name).toBe('Friendly Test Name');

    // Default rendered output uses friendly name and hides raw ID
    const rendered = env.stripAnsi(runTool.renderResult(result, { expanded: false }, { fg: (_n: string, t: string) => t }).render(120).join('\n'));
    expect(rendered).toContain('Friendly Test Name');
    expect(rendered).toContain('subagent: analyst');
    expect(rendered).toContain('click to view execution');
    expect(rendered).not.toContain('id: subtask_');
    expect(rendered).not.toContain('subtask_analyst_');

    // No background fills
    const rawAnsi = runTool.renderResult(result, { expanded: false }, { fg: (_n: string, t: string) => t }).render(120).join('\n');
    expect(rawAnsi).not.toContain('\x1b[4');
  });
});
