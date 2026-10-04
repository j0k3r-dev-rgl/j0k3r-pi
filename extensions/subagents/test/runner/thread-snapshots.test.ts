import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SubagentStructuredError, classifyFallbackFailure, classifyThrownError, deriveErrorString, normalizeErrorMetadata } from '../../src/error-metadata.js';
import type { SubagentDefinition, SubagentErrorMetadata, SubagentsConfig } from '../../src/types.js';

const sessionManagerSpies = vi.hoisted(() => ({
  create: vi.fn(() => ({ path: '/tmp/subagent-session.jsonl' })),
  open: vi.fn((sessionPath: string) => ({ path: sessionPath })),
}));

describe('subagent runner thread snapshots', () => {
  const definition: SubagentDefinition = {
    name: 'sdd-apply',
    description: 'implementation executor',
    filePath: '/tmp/sdd-apply.md',
    instructions: 'return a concise result',
    tools: ['bash', 'memory_search', 'custom_tool'],
  };
  const config: SubagentsConfig = {
    timeout_ms: 10_000,
    stall_timeout_ms: 10_000,
    max_concurrency: 1,
    default_tools: ['bash', 'memory_search', 'custom_tool'],
    model_profiles: {},
  };

  async function runWithSession(session: any, cwd = '/workspace', overrides: Record<string, unknown> = {}) {
    vi.resetModules();
    sessionManagerSpies.create.mockClear();
    sessionManagerSpies.open.mockClear();
    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: {
        inMemory: () => ({}),
        create: sessionManagerSpies.create,
        open: sessionManagerSpies.open,
      },
      createAgentSession: vi.fn(() => ({ session })),
    }));
    const { sdkSubagentRunner } = await import('../../src/runner.js');
    const activities: any[] = [];
    const result = await sdkSubagentRunner({
      definition,
      task: 'capture a thread snapshot',
      cwd,
      ctx: { model: { provider: 'test', id: 'model' } },
      config,
      signal: new AbortController().signal,
      onActivity: (activity: any) => activities.push(activity),
      ...overrides,
    } as any);
    return { result, activities };
  }

  it('creates persistent nested sessions for new tasks, reopens the exact session for continuations, and excludes earlier assistant text from the current attempt result', async () => {
    const initialSession = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'initial answer' }] }],
      dispose: vi.fn(async () => undefined),
    };

    const initialRun = await runWithSession(initialSession, '/workspace', { context: 'shared orchestrator context' });
    expect(sessionManagerSpies.create).toHaveBeenCalledOnce();
    expect(sessionManagerSpies.open).not.toHaveBeenCalled();
    expect(initialRun.result.result).toBe('initial answer');
    expect(initialRun.result.nested_session_path).toBe('/tmp/subagent-session.jsonl');
    expect(initialRun.result.thread_snapshot?.items.slice(0, 3)).toEqual([
      expect.objectContaining({ type: 'attempt', attempt: 1 }),
      expect.objectContaining({ type: 'user', label: 'context', text: 'shared orchestrator context' }),
      expect.objectContaining({ type: 'user', label: 'delegated_task', text: 'capture a thread snapshot' }),
    ]);
    expect(initialRun.result.thread_snapshot?.items.filter((item: any) => item.type === 'user' && item.label === 'context')).toHaveLength(1);

    const continuationSession = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async function (this: any) {
        this.messages = [
          { role: 'assistant', content: [{ type: 'text', text: 'initial answer' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'continued answer' }] },
        ];
      }),
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'initial answer' }] }],
      dispose: vi.fn(async () => undefined),
    };

    const continued = await runWithSession(continuationSession, '/workspace', {
      nested_session_path: '/tmp/subagent-session.jsonl',
      continuation: {
        prompt: 'Resume from the terminal state.',
        attempt: 2,
        previous_snapshot: { version: 1, source: 'events', items: [{ type: 'user', label: 'delegated_task', text: 'capture a thread snapshot' }] },
      },
    });

    expect(sessionManagerSpies.open).toHaveBeenCalledWith('/tmp/subagent-session.jsonl', expect.any(String), '/workspace');
    expect(continued.result.result).toBe('continued answer');
    expect(continued.result.thread_snapshot?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'user', label: 'delegated_task', text: 'capture a thread snapshot' }),
      expect.objectContaining({ type: 'user', label: 'continuation', text: 'Resume from the terminal state.' }),
      expect.objectContaining({ type: 'assistant', message: expect.objectContaining({ content: [expect.objectContaining({ type: 'text', text: 'continued answer' })] }) }),
    ]));
    expect(JSON.stringify(continued.result.thread_snapshot)).not.toContain('initial answer"},{"type":"assistant');
  });

  it('hardens nested session jsonl permissions after the file appears', async () => {
    if (process.platform === 'win32') return;
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-session-perms-'));
    const sessionPath = path.join(cwd, 'nested', 'late-session.jsonl');
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async function (this: any) {
        fs.mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o755 });
        fs.writeFileSync(sessionPath, '{"type":"session"}\n', { mode: 0o644 });
        fs.chmodSync(sessionPath, 0o644);
        this.messages = [{ role: 'assistant', content: [{ type: 'text', text: 'permission hardened' }] }];
      }),
      messages: [],
      dispose: vi.fn(async () => undefined),
    };

    try {
      sessionManagerSpies.create.mockReturnValueOnce({ path: sessionPath });
      const { result } = await runWithSession(session, cwd);
      expect(result.nested_session_path).toBe(sessionPath);
      expect(fs.statSync(sessionPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(sessionPath)).mode & 0o777).toBe(0o700);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('emits and returns bounded snapshots for assistant text, paired bash output, tool errors, and custom fallback tools without changing result or usage', async () => {
    const largeOutput = 'x'.repeat(6000);
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'streamed ' } });
        subscriber?.({ type: 'tool_execution_start', toolCallId: 'bash-1', toolName: 'bash', args: { command: 'printf hello' } });
        subscriber?.({ type: 'tool_execution_update', toolCallId: 'bash-1', toolName: 'bash', partialResult: { output: 'hello\n' } });
        subscriber?.({ type: 'tool_execution_end', toolCallId: 'bash-1', toolName: 'bash', isError: false, result: { output: largeOutput, exitCode: 0 } });
        subscriber?.({ type: 'tool_execution_start', toolCallId: 'mem-1', toolName: 'memory_search', args: { query: 'prior decisions' } });
        subscriber?.({ type: 'tool_execution_end', toolCallId: 'mem-1', toolName: 'memory_search', isError: true, result: { content: [{ type: 'text', text: 'memory unavailable' }] } });
        subscriber?.({ type: 'tool_execution_start', toolCallId: 'custom-1', toolName: 'custom_tool', args: { value: 42 } });
        subscriber?.({ type: 'tool_execution_end', toolCallId: 'custom-1', toolName: 'custom_tool', isError: false, result: { text: 'custom result' } });
      }),
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'final answer' }] }],
      dispose: vi.fn(async () => undefined),
    };

    const { result, activities } = await runWithSession(session);

    expect(result.result).toBe('final answer');
    expect(result.usage).toMatchObject({ input: 0, output: 0, turns: 0 });
    expect(activities.some((activity) => activity.thread_snapshot?.items?.length > 0)).toBe(true);
    expect(result.thread_snapshot).toMatchObject({ version: 1, source: 'mixed' });
    expect(result.thread_snapshot?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant', message: expect.objectContaining({ content: [expect.objectContaining({ type: 'text', text: 'final answer' })] }) }),
      expect.objectContaining({ type: 'tool', tool_call_id: 'bash-1', name: 'bash', status: 'completed', arguments: { command: 'printf hello' } }),
      expect.objectContaining({ type: 'tool', tool_call_id: 'mem-1', name: 'memory_search', status: 'failed', result: expect.objectContaining({ isError: true, preview: expect.stringContaining('memory unavailable') }) }),
      expect.objectContaining({ type: 'tool', tool_call_id: 'custom-1', name: 'custom_tool', status: 'completed', result: expect.objectContaining({ preview: expect.stringContaining('custom result') }) }),
    ]));
    const bashItem = result.thread_snapshot?.items.find((item: any) => item.type === 'tool' && item.name === 'bash') as any;
    expect(bashItem.started_at).toEqual(expect.any(String));
    expect(bashItem.ended_at).toEqual(expect.any(String));
    expect(bashItem.arguments).toMatchObject({ command: 'printf hello' });
    expect(bashItem.result.preview.length).toBeLessThan(4500);
    expect(String(bashItem.result.preview)).toContain('x');
  });

  it('retains latest-three distinct safe activity transitions and strips payload sentinels', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'secret-thought-sentinel' } });
        subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'stream me' } });
        subscriber?.({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'workspace_graph_status', args: { token: 'tool-arg-sentinel' } });
        subscriber?.({ type: 'tool_execution_update', toolCallId: 'tool-1', toolName: 'workspace_graph_status', partialResult: { text: 'tool-update-sentinel' } });
        subscriber?.({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'workspace_graph_status', isError: false, result: { text: 'tool-result-sentinel' } });
      }),
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'final answer' }] }],
      dispose: vi.fn(async () => undefined),
    };

    const { activities } = await runWithSession(session);
    const latest = [...activities].reverse().find((activity) => activity.live_activity?.trail?.length);
    expect(latest?.live_activity?.trail?.map((entry: any) => entry.label)).toEqual([
      'streaming response',
      'running tool: workspace_graph_status',
      'tool completed: workspace_graph_status',
    ]);
    expect(latest?.live_activity?.current?.label).toBe('tool completed: workspace_graph_status');
    expect(JSON.stringify(latest?.live_activity)).not.toContain('sentinel');
  });

  it('stalls long-running tool calls when they stop sending updates', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    let subscriber: ((event: unknown) => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read', args: { path: 'openspec/changes/websearch-extension/spec.md' } });
        return new Promise<void>((resolve) => { resolvePrompt = resolve; });
      }),
      abort: vi.fn(async () => { resolvePrompt?.(); }),
      messages: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'openspec/changes/websearch-extension/spec.md' } }] }],
      dispose: vi.fn(async () => undefined),
    };
    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: vi.fn(() => ({ session })),
    }));

    try {
      const { sdkSubagentRunner } = await import('../../src/runner.js');
      const promise = sdkSubagentRunner({
        definition,
        task: 'apply work that stalls inside a tool',
        cwd: '/workspace',
        ctx: { model: { provider: 'test', id: 'model' } },
        config: { ...config, stall_timeout_ms: 20 },
        signal: new AbortController().signal,
      });
      const rejection = promise.then(
        () => undefined,
        (error) => error,
      );

      await vi.dynamicImportSettled();
      expect(session.prompt).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(600);
      const error = await rejection;
      expect(error).toBeInstanceOf(Error);
      expect(error.error_metadata).toMatchObject({ category: 'stall_timeout', phase: 'runner_session' });
      expect(session.abort).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('records Pi retry and settled lifecycle events in transcript and status rows without incrementing attempt', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'auto_retry_start', attempt: 2, maxAttempts: 3 });
        subscriber?.({ type: 'auto_retry_end', attempt: 2, maxAttempts: 3 });
        subscriber?.({ type: 'agent_settled', reason: 'completed' });
      }),
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'final answer after retry' }] }],
      dispose: vi.fn(async () => undefined),
    };

    const { result, activities } = await runWithSession(session);

    const transcript = activities.map((activity) => activity.transcript ?? '').join('\n');
    expect(transcript).toContain('auto retry start');
    expect(transcript).toContain('auto retry end');
    expect(transcript).toContain('agent settled');
    expect(result.thread_snapshot?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'attempt', attempt: 1 }),
      expect.objectContaining({ type: 'status', text: expect.stringContaining('auto retry start') }),
      expect.objectContaining({ type: 'status', text: expect.stringContaining('auto retry end') }),
      expect.objectContaining({ type: 'status', text: expect.stringContaining('agent settled') }),
    ]));
    expect(result.thread_snapshot?.items.filter((item: any) => item.type === 'attempt')).toHaveLength(1);
  });

  it('keeps toolcall deltas out of live assistant text while preserving native tool rows', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const calls = [
      { id: 'graph-1', name: 'workspace_graph_status', args: {} },
      { id: 'bash-1', name: 'bash', args: { command: 'ls -la', timeout: 10 } },
    ];
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Starting codebase inventory' } });
        for (const call of calls) {
          subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start' } });
          subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', delta: JSON.stringify(call.args) } });
          subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end' } });
        }
        for (const call of calls) {
          subscriber?.({ type: 'tool_execution_start', toolCallId: call.id, toolName: call.name, args: call.args });
          subscriber?.({ type: 'tool_execution_end', toolCallId: call.id, toolName: call.name, isError: false, result: { content: [{ type: 'text', text: 'done' }] } });
        }
      }),
      messages: [{ role: 'assistant', content: [
        { type: 'thinking', thinking: 'Starting codebase inventory' },
        ...calls.map((call) => ({ type: 'toolCall', id: call.id, name: call.name, arguments: call.args })),
        { type: 'text', text: 'final answer' },
      ] }],
      dispose: vi.fn(async () => undefined),
    };

    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-runner-json-'));
    fs.mkdirSync(path.join(cwd, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.pi', 'subagents.json'), JSON.stringify({ debug: true }));
    try {
      const { result, activities } = await runWithSession(session, cwd);
      expect(activities.filter((activity) => activity.message === 'streaming response')).toHaveLength(0);
      const afterToolStart = activities.find((activity) => activity.message?.startsWith('workspace_graph_status'));
      const assistantContent = afterToolStart?.thread_snapshot?.items
        .filter((item: any) => item.type === 'assistant')
        .flatMap((item: any) => item.message.content.map((part: any) => part.text ?? part.thinking ?? ''))
        .join('\n') ?? '';
      expect(assistantContent).toContain('Starting codebase inventory');
      expect(assistantContent).not.toContain('{"command"');
      expect(afterToolStart?.transcript).not.toContain('{"command"');
      expect(result.thread_snapshot?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool', name: 'workspace_graph_status', arguments: {} }),
        expect.objectContaining({ type: 'tool', name: 'bash', arguments: { command: 'ls -la', timeout: 10 }, status: 'completed' }),
      ]));
      const log = fs.readFileSync(path.join(cwd, '.pi', 'subagents-debug.log'), 'utf8');
      expect(log).toContain('"assistantEventType":"toolcall_delta"');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('interleaves final session tool-call messages with matching tool rows before final assistant text', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read', args: { path: 'AGENTS.md' } });
        subscriber?.({ type: 'tool_execution_end', toolCallId: 'read-1', toolName: 'read', isError: false, result: { content: [{ type: 'text', text: '# Agent Guide' }] } });
      }),
      messages: [
        { role: 'assistant', content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'AGENTS.md' } }] },
        { role: 'assistant', content: [{ type: 'text', text: 'final after tools' }] },
      ],
      dispose: vi.fn(async () => undefined),
    };

    const { result } = await runWithSession(session);
    const labels = result.thread_snapshot?.items.map((item: any) => item.type === 'assistant'
      ? `assistant:${item.message.content.map((part: any) => part.type === 'toolCall' ? `toolCall:${part.name}` : part.text).join('|')}`
      : item.type === 'attempt' ? `attempt:${item.attempt}` : `${item.type}:${item.name}`);

    expect(labels).toEqual(['attempt:1', 'user:undefined', 'assistant:toolCall:read', 'tool:read', 'assistant:final after tools']);
    expect(result.thread_snapshot?.items[1]).toMatchObject({ type: 'user', label: 'delegated_task' });
    expect(JSON.stringify(result.thread_snapshot)).toContain('# Agent Guide');
  });

  it('persists streamed model thinking in sequence with tool rows in the final thread snapshot', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'first reasoning before reading' } });
        subscriber?.({ type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read', args: { path: 'AGENTS.md' } });
        subscriber?.({ type: 'tool_execution_end', toolCallId: 'read-1', toolName: 'read', isError: false, result: { content: [{ type: 'text', text: '# Agent Guide' }] } });
        subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'second reasoning after reading' } });
      }),
      messages: [
        { role: 'assistant', content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'AGENTS.md' } }] },
        { role: 'assistant', content: [{ type: 'text', text: 'final answer after sequential thinking' }] },
      ],
      dispose: vi.fn(async () => undefined),
    };

    const { result } = await runWithSession(session);
    const labels = result.thread_snapshot?.items.map((item: any) => {
      if (item.type === 'assistant') return `assistant:${item.message.content.map((part: any) => part.type === 'thinking' ? `thinking:${part.thinking}` : part.type === 'toolCall' ? `toolCall:${part.name}` : `text:${part.text}`).join('|')}`;
      if (item.type === 'tool') return `tool:${item.name}`;
      if (item.type === 'attempt') return `attempt:${item.attempt}`;
      return `${item.type}:${item.label}`;
    });

    expect(labels).toEqual([
      'attempt:1',
      'user:delegated_task',
      'assistant:thinking:first reasoning before reading',
      'assistant:toolCall:read',
      'tool:read',
      'assistant:thinking:second reasoning after reading',
      'assistant:text:final answer after sequential thinking',
    ]);
  });

  it('preserves streamed model thinking in the final thread snapshot when final messages omit it', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'thinking through the file plan' } });
        subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'draft text that should not replace final' } });
      }),
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'final answer after thinking' }] }],
      dispose: vi.fn(async () => undefined),
    };

    const { result, activities } = await runWithSession(session);

    expect(activities.find((activity) => activity.message === 'streaming thinking')?.thread_snapshot?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant', message: expect.objectContaining({ content: [expect.objectContaining({ type: 'thinking', thinking: expect.stringContaining('thinking through the file plan') })] }) }),
    ]));
    expect(result.result).toBe('final answer after thinking');
    expect(result.thread_snapshot?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant', message: expect.objectContaining({ content: [expect.objectContaining({ type: 'thinking', thinking: expect.stringContaining('thinking through the file plan') })] }) }),
      expect.objectContaining({ type: 'assistant', message: expect.objectContaining({ content: [expect.objectContaining({ type: 'text', text: 'final answer after thinking' })] }) }),
    ]));
    expect(JSON.stringify(result.thread_snapshot)).not.toContain('draft text that should not replace final');
  });

  it('projects queued steering messages live, consumes them chronologically once, and keeps their text out of non-thread activity fields', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const steeringText = 'read package.json now';
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'queue_update', steering: [steeringText] });
        subscriber?.({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: steeringText }] } });
        subscriber?.({ type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read', args: { path: 'package.json' } });
        subscriber?.({ type: 'tool_execution_end', toolCallId: 'read-1', toolName: 'read', isError: false, result: { content: [{ type: 'text', text: '{"name":"pkg"}' }] } });
      }),
      messages: [
        { role: 'assistant', content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'package.json' } }] },
        { role: 'assistant', content: [{ type: 'text', text: 'dependency summary' }] },
      ],
      dispose: vi.fn(async () => undefined),
    };

    const { result, activities } = await runWithSession(session);
    const queuedSnapshot = activities.find((activity) => activity.message === 'live steering queue updated')?.thread_snapshot;
    const consumedSnapshot = activities.find((activity) => activity.message === 'live steering message consumed')?.thread_snapshot;

    expect(queuedSnapshot?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'user', label: 'queued', text: steeringText }),
    ]));
    expect(consumedSnapshot?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'user', label: 'user', text: steeringText }),
    ]));
    expect(consumedSnapshot?.items.filter((item: any) => item.type === 'user' && item.text === steeringText)).toHaveLength(1);

    const labels = result.thread_snapshot?.items.map((item: any) => {
      if (item.type === 'attempt') return `attempt:${item.attempt}`;
      if (item.type === 'user') return `${item.label}:${item.text}`;
      if (item.type === 'tool') return `tool:${item.name}`;
      if (item.type === 'assistant') return `assistant:${item.message.content.map((part: any) => part.type === 'toolCall' ? `toolCall:${part.name}` : part.text).join('|')}`;
      return item.type;
    });

    expect(labels).toEqual([
      'attempt:1',
      'delegated_task:capture a thread snapshot',
      `user:${steeringText}`,
      'assistant:toolCall:read',
      'tool:read',
      'assistant:dependency summary',
    ]);
    expect(result.thread_snapshot?.items.filter((item: any) => item.type === 'user' && item.text === steeringText)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(`queued:${steeringText}`);
    expect(JSON.stringify(activities.map(({ message, output, transcript }: any) => ({ message, output, transcript })))).not.toContain(steeringText);
  });

  it('projects repeated identical steering messages with fifo matching and no duplicates', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const steeringText = 'same steering text';
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'queue_update', steering: [steeringText, steeringText] });
        subscriber?.({ type: 'queue_update', steering: [steeringText, steeringText] });
        subscriber?.({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: steeringText }] } });
        subscriber?.({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: steeringText }] } });
      }),
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
      dispose: vi.fn(async () => undefined),
    };

    const { result } = await runWithSession(session);
    const projected = result.thread_snapshot?.items.filter((item: any) => item.type === 'user' && item.text === steeringText) ?? [];

    expect(projected).toHaveLength(2);
    expect(projected.every((item: any) => item.label === 'user')).toBe(true);
    expect(new Set(projected.map((item: any) => item.id)).size).toBe(2);
  });

  it('persists an unconsumed queued steering row at settlement without fabricating a consumed user row', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const steeringText = 'still queued';
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'queue_update', steering: [steeringText] });
      }),
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done without consuming' }] }],
      dispose: vi.fn(async () => undefined),
    };

    const { result } = await runWithSession(session);
    const projected = result.thread_snapshot?.items.filter((item: any) => item.type === 'user' && item.text === steeringText) ?? [];

    expect(projected).toEqual([
      expect.objectContaining({ type: 'user', label: 'queued', text: steeringText }),
    ]);
  });

  it('finalizes assistant text from session messages when available while preserving streamed activity snapshots', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'draft text' } });
      }),
      messages: [{ role: 'assistant', content: 'final from messages' }],
      dispose: vi.fn(async () => undefined),
    };

    const { result, activities } = await runWithSession(session);

    expect(activities.find((activity) => activity.message === 'streaming response')?.thread_snapshot?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant' }),
    ]));
    expect(result.result).toBe('final from messages');
    expect(result.thread_snapshot?.source).toBe('session_messages');
    expect(JSON.stringify(result.thread_snapshot)).toContain('final from messages');
  });
});
