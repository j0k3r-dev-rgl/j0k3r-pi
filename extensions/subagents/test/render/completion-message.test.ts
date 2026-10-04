import { describe, expect, it, vi } from 'vitest';
import extension, { completionMessage, sendSubagentCompletionMessage } from '../../index.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

describe('completion message render', () => {
  it('suppresses continuation guidance in failed and cancelled completion messages when continuation is disabled', () => {
    for (const status of ['failed', 'cancelled']) {
      const message = completionMessage({ id: `subtask_${status}`, agent: 'analyst', status, error: `${status} result`, cwd: env.tmp });
      expect(message).not.toContain('subagent_continue');
      expect(message).not.toContain('Ask the user before resuming');
      expect(message).not.toContain('Never switch models automatically');
    }

    const completed = completionMessage({ id: 'subtask_completed', agent: 'analyst', status: 'completed', result: 'done', cwd: env.tmp });
    expect(completed).not.toContain('subagent_continue');
    expect(completed).not.toContain('Ask the user before resuming');
  });

  it('adds English resume instructions only to failed and cancelled completion messages when continuation is enabled', async () => {
    await import('node:fs').then((fs) => fs.writeFileSync(`${env.tmp}/.pi/subagents.json`, JSON.stringify({ enable_continue: true })));

    for (const status of ['failed', 'cancelled']) {
      const message = completionMessage({ id: `subtask_${status}`, agent: 'analyst', status, error: `${status} result`, cwd: env.tmp });
      expect(message).toContain('can be resumed with `subagent_continue`');
      expect(message).toContain('Ask the user before resuming');
      expect(message).toContain('model and effort');
      expect(message).toContain('Never switch models automatically');
    }
  });

  it('registers a compact/expanded renderer for background subagent completion messages', () => {
    let renderer: any;
    extension({
      registerTool: () => undefined,
      registerCommand: () => undefined,
      registerShortcut: () => undefined,
      registerMessageRenderer: (customType: string, value: any) => { if (customType === 'subagent-completion') renderer = value; },
    });
    const message = {
      customType: 'subagent-completion',
      content: 'full content for orchestrator to=functions.memory_get',
      details: {
        full_result: 'background final response to=functions.memory_get',
        task: { id: 'subtask_background_1', agent: 'analyst', status: 'completed' },
      },
    };

    const collapsed = env.stripAnsi(renderer(message, { expanded: false }, { fg: (_name: string, text: string) => text }).render(120).join('\n'));
    expect(collapsed).toContain('[subagent] analyst · completed');
    expect(collapsed).toContain('ctrl+o to expand');
    expect(collapsed).not.toContain('to=functions.memory_get');
    expect(collapsed).not.toContain('subtask_background_1');

    const expanded = env.stripAnsi(renderer(message, { expanded: true }, { fg: (_name: string, text: string) => text }).render(120).join('\n'));
    expect(expanded).toContain('background final response to=functions.memory_get');
  });

  it('renders completion messages framed with boxed borders and no background padding rows', () => {
    let renderer: any;
    extension({
      registerTool: () => undefined,
      registerCommand: () => undefined,
      registerShortcut: () => undefined,
      registerMessageRenderer: (customType: string, value: any) => { if (customType === 'subagent-completion') renderer = value; },
    });
    const message = {
      customType: 'subagent-completion',
      content: 'compact visible content',
      details: {
        full_result: 'done',
        task: { id: 'subtask_spaced', agent: 'discovery', status: 'completed' },
      },
    };

    const lines = renderer(message, { expanded: false }, {
      fg: (_name: string, text: string) => text,
      bg: (_name: string, text: string) => text,
    }).render(80);

    expect(lines[0]).toMatch(/^┌─+ 󰣇 \[subagent\] discovery · completed ─+┐$/);
    expect(lines[1]).toContain('subagent: discovery');
    expect(lines).toContainEqual(expect.stringContaining('ctrl+o to expand'));
    expect(lines.at(-1)).toMatch(/^└─+┘$/);
    expect(lines[0]).not.toBe(' '.repeat(80));
    expect(lines.at(-1)).not.toBe(' '.repeat(80));
  });

  it('reads the task cwd configuration at notification time for background completion guidance', async () => {
    const sendMessage = vi.fn();
    await import('node:fs').then((fs) => fs.writeFileSync(`${env.tmp}/.pi/subagents.json`, JSON.stringify({ enable_continue: true })));
    await import('node:fs').then((fs) => fs.writeFileSync(`${env.tmp}/.pi/subagents.json`, JSON.stringify({ enable_continue: false })));

    sendSubagentCompletionMessage({ sendMessage }, {
      id: 'subtask_notify_disabled',
      agent: 'analyst',
      status: 'failed',
      mode: 'background',
      error: 'done while disabled',
      cwd: env.tmp,
    });

    expect(sendMessage.mock.calls[0][0].content).not.toContain('subagent_continue');
    expect(sendMessage.mock.calls[0][0].content).not.toContain('Ask the user before resuming');
  });

  it('delivers background completion messages as followUp and triggers an LLM turn immediately', () => {
    const sendMessage = vi.fn();
    sendSubagentCompletionMessage({ sendMessage }, {
      id: 'subtask_notify_1',
      agent: 'analyst',
      status: 'completed',
      mode: 'background',
      result: 'done while main agent continues',
      model: 'mock/model',
      effort: 'high',
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({ display: true });
    expect(sendMessage.mock.calls[0][0].content).toContain('subtask_notify_1');
    expect(sendMessage.mock.calls[0][1]).toEqual({ triggerTurn: true, deliverAs: 'followUp' });
  });

  it('renders background completion messages with boxed borders and no background fills', () => {
    let renderer: any;
    extension({
      registerTool: () => undefined,
      registerCommand: () => undefined,
      registerShortcut: () => undefined,
      registerMessageRenderer: (customType: string, value: any) => { if (customType === 'subagent-completion') renderer = value; },
    });
    const message = {
      customType: 'subagent-completion',
      content: 'compact visible content',
      details: {
        full_result: 'background response',
        task: { id: 'subtask_background_color', agent: 'discovery', status: 'completed' },
      },
    };
    const theme = {
      fg: (name: string, text: string) => `FG(${name}:${text})`,
      bg: (name: string, text: string) => `BG(${name}:${text})`,
    };

    const rendered = renderer(message, { expanded: false }, theme).render(90).join('\n');
    expect(rendered).not.toContain('BG(');
    expect(rendered).not.toContain('customMessageBg');
    expect(rendered).toContain('FG(accent:┌)');
    expect(rendered).toContain('FG(accent:│)');
    expect(rendered).toContain('FG(customMessageLabel:');
    expect(rendered).toContain('[subagent] discovery · completed');
    expect(rendered).toContain('FG(accent:└)');
  });

  it('wraps expanded background completion responses instead of truncating them', () => {
    let renderer: any;
    extension({
      registerTool: () => undefined,
      registerCommand: () => undefined,
      registerShortcut: () => undefined,
      registerMessageRenderer: (customType: string, value: any) => { if (customType === 'subagent-completion') renderer = value; },
    });
    const longResponse = 'Una herramienta de subagentes en background debería comportarse de forma claramente asíncrona para que el usuario pueda leer todo el texto sin cortes.';
    const message = {
      customType: 'subagent-completion',
      content: 'compact visible content',
      details: {
        full_result: longResponse,
        task: { id: 'subtask_background_wrap', agent: 'discovery', status: 'completed' },
      },
    };

    const rendered = env.stripAnsi(renderer(message, { expanded: true }, { fg: (_name: string, text: string) => text }).render(52).join('\n'));
    expect(rendered).toContain('[subagent] discovery · completed');
    expect(rendered).not.toContain('subtask_background_wrap');
    expect(rendered).toContain('response sent to the orchestrator');
    expect(rendered).toContain('Una herramienta de subagentes en background');
    expect(rendered).toContain('cortes.');
    expect(rendered).not.toContain('…');
  });

  it('includes only bounded structured error summaries in background completion details', () => {
    const sendMessage = vi.fn();
    sendSubagentCompletionMessage({ sendMessage }, {
      id: 'subtask_background_failure',
      agent: 'analyst',
      status: 'failed',
      mode: 'background',
      error: 'provider api error',
      model: 'mock/model',
      effort: 'high',
      error_metadata: {
        category: 'provider_api_error',
        message: 'Authorization: Bearer sk-fake-secret-token fake.user@example.com /tmp/fake-private.txt',
        partial_result_available: true,
        details: {
          provider_code: '429',
          auth_header: 'Authorization: Bearer sk-fake-secret-token',
          prompt: 'SYSTEM: hidden prompt body',
          file_path: '/tmp/fake-private.txt',
          nested_payload: JSON.stringify({ transcript: 'SECRET_FILE_BODY_DO_NOT_SHOW' }),
        },
        last_activity: 'USER: hidden prompt body /tmp/fake-private.txt',
        usage_at_failure: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 5, contextTokens: 6, turns: 7 },
        task_id: 'subtask_background_failure',
        parent_session_id: 'parent-session-secret',
      },
    });

    const payload = sendMessage.mock.calls[0][0];
    expect(payload.details.full_result).toBe('provider api error');
    expect(payload.details.task.error).toBe('provider api error');
    expect(payload.details.task.error_metadata).toMatchObject({
      version: 1,
      category: 'provider_api_error',
      retryable: true,
      code: 'provider_api_error',
      partial_result_available: true,
      details: { provider_code: '429' },
    });
    expect(payload.details.task.error_metadata.message).toBeUndefined();
    expect(payload.details.task.error_metadata.last_activity).toBeUndefined();
    expect(payload.details.task.error_metadata.usage_at_failure).toBeUndefined();
    expect(payload.details.task.error_metadata.task_id).toBeUndefined();
    expect(payload.details.task.error_metadata.parent_session_id).toBeUndefined();
    const serialized = JSON.stringify(payload.details.task.error_metadata);
    expect(serialized).not.toContain('sk-fake-secret-token');
    expect(serialized).not.toContain('fake.user@example.com');
    expect(serialized).not.toContain('/tmp/fake-private.txt');
    expect(serialized).not.toContain('hidden prompt body');
    expect(serialized).not.toContain('SECRET_FILE_BODY_DO_NOT_SHOW');
  });

  it('renders friendly display_name in completion title and omits response section when response is absent', () => {
    let renderer: any;
    extension({
      registerTool: () => undefined,
      registerCommand: () => undefined,
      registerShortcut: () => undefined,
      registerMessageRenderer: (customType: string, value: any) => { if (customType === 'subagent-completion') renderer = value; },
    });

    // 1. With display_name
    const msgWithName = {
      customType: 'subagent-completion',
      content: 'done',
      details: {
        full_result: 'audit completed clean',
        task: { id: 'subtask_comp_name', display_name: 'Security Audit', agent: 'analyst', status: 'completed' },
      },
    };
    const renderedWithName = env.stripAnsi(renderer(msgWithName, { expanded: false }, { fg: (_n: string, t: string) => t }).render(120).join('\n'));
    expect(renderedWithName).toContain('[subagent] Security Audit · completed');
    expect(renderedWithName).not.toContain('subtask_comp_name');

    // 2. Whitespace-only result should NOT emit "response sent to the orchestrator"
    const msgEmptyResp = {
      customType: 'subagent-completion',
      content: 'done',
      details: {
        full_result: '   \n  \t  ',
        task: { id: 'subtask_comp_empty', agent: 'analyst', status: 'completed', result: '   ' },
      },
    };
    const renderedEmpty = env.stripAnsi(renderer(msgEmptyResp, { expanded: true }, { fg: (_n: string, t: string) => t }).render(120).join('\n'));
    expect(renderedEmpty).not.toContain('response sent to the orchestrator');
    expect(renderedEmpty).not.toContain('subtask_comp_empty');

    // 3. Error-only message shows error block, not response section
    const msgError = {
      customType: 'subagent-completion',
      content: 'failed',
      details: {
        task: { id: 'subtask_comp_err', agent: 'analyst', status: 'failed', error: 'execution timed out' },
      },
    };
    const renderedError = env.stripAnsi(renderer(msgError, { expanded: true }, { fg: (_n: string, t: string) => t }).render(120).join('\n'));
    expect(renderedError).not.toContain('response sent to the orchestrator');
    expect(renderedError).toContain('error');
    expect(renderedError).toContain('execution timed out');
  });

  it('includes structured error details in completionMessage when error_metadata is present', () => {
    const message = completionMessage({
      id: 'subtask_err_details',
      agent: 'analyst',
      status: 'failed',
      error: 'provider auth error',
      cwd: env.tmp,
      error_metadata: {
        category: 'provider_auth_error',
        message: '503: No capacity available',
        retryable: false,
        phase: 'assistant_final',
        code: 'provider_auth_error',
        source: { provider: 'antigravity', model: 'gemini-3.8-flash-high', operation: 'session.prompt' },
        partial_result_available: true,
        details: { error_class: 'Error', provider_code: '503' },
      },
    });

    expect(message).toContain('## error');
    expect(message).toContain('provider auth error');
    expect(message).toContain('## error details');
    expect(message).toContain('- category: provider_auth_error');
    expect(message).toContain('- phase: assistant_final');
    expect(message).toContain('- retryable: false');
    expect(message).toContain('- source: provider=antigravity, model=gemini-3.8-flash-high, op=session.prompt');
    expect(message).toContain('- partial_result_available: true');
    expect(message).toContain('- error_class: Error');
    expect(message).toContain('- provider_code: 503');
  });

  it('omits error details section when error_metadata is absent', () => {
    const message = completionMessage({
      id: 'subtask_no_meta',
      agent: 'analyst',
      status: 'failed',
      error: 'something went wrong',
      cwd: env.tmp,
    });

    expect(message).toContain('## error');
    expect(message).toContain('something went wrong');
    expect(message).not.toContain('## error details');
  });

  it('renders structured error details in expanded UI when error_metadata is present', () => {
    let renderer: any;
    extension({
      registerTool: () => undefined,
      registerCommand: () => undefined,
      registerShortcut: () => undefined,
      registerMessageRenderer: (customType: string, value: any) => { if (customType === 'subagent-completion') renderer = value; },
    });

    const msg = {
      customType: 'subagent-completion',
      content: 'failed',
      details: {
        task: {
          id: 'subtask_ui_err',
          agent: 'discovery',
          status: 'failed',
          error: 'provider auth error',
          error_metadata: {
            category: 'provider_rate_limit',
            message: '429: quota exhausted',
            retryable: true,
            phase: 'runner_invoke',
            code: 'provider_rate_limit',
            source: { provider: 'antigravity', model: 'gemini-3.8-flash-high' },
            details: { reset_time: '3h25m14s', error_class: 'Error' },
          },
        },
      },
    };

    const rendered = env.stripAnsi(renderer(msg, { expanded: true }, { fg: (_n: string, t: string) => t }).render(120).join('\n'));
    expect(rendered).toContain('error');
    expect(rendered).toContain('provider auth error');
    expect(rendered).toContain('error details');
    expect(rendered).toContain('- category: provider_rate_limit');
    expect(rendered).toContain('- phase: runner_invoke');
    expect(rendered).toContain('- retryable: true');
    expect(rendered).toContain('- source: provider=antigravity, model=gemini-3.8-flash-high');
    expect(rendered).toContain('- reset_time: 3h25m14s');
  });

  it('redacts secrets from error details rendered in completionMessage and UI', () => {
    const message = completionMessage({
      id: 'subtask_redact',
      agent: 'analyst',
      status: 'failed',
      error: 'provider api error',
      cwd: env.tmp,
      error_metadata: {
        category: 'provider_auth_error',
        message: 'Authorization: Bearer sk-fake-secret-token fake.user@example.com /tmp/fake-private.txt',
        retryable: false,
        phase: 'assistant_final',
        details: {
          provider_code: '429',
          auth_header: 'Authorization: Bearer sk-fake-secret-token',
          prompt: 'SYSTEM: hidden prompt body',
          file_path: '/tmp/fake-private.txt',
        },
      },
    });

    expect(message).toContain('## error details');
    expect(message).toContain('- category: provider_auth_error');
    expect(message).not.toContain('sk-fake-secret-token');
    expect(message).not.toContain('fake.user@example.com');
    expect(message).not.toContain('/tmp/fake-private.txt');
    expect(message).not.toContain('hidden prompt body');
  });
});
