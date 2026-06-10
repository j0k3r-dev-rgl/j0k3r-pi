import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SubagentDefinition, SubagentsConfig } from '../src/types.js';

describe('subagent runner permission-required bridge', () => {
  it('preserves structured permission requests from nested tool failures while keeping result surfaces marker-free', async () => {
    vi.resetModules();
    const payload = {
      type: 'permission_required',
      requestId: 'req-subagent-read',
      tool: 'read',
      action: 'read',
      origin: 'subagent',
      requester: { subagentName: 'sdd-apply', taskId: '2.10' },
      reason: 'Outside-workspace read requires approval.',
      reasonCode: 'outside_workspace_read_approval_required',
      riskLevel: 'medium',
      prompt: {
        title: 'Permission required for read',
        message: 'Outside-workspace read requires approval.',
        choices: ['Allow once', 'Allow for session', 'Allow for project', 'Deny'],
        safeTarget: '/tmp/outside.txt',
      },
    };
    const structuredToolResult = {
      block: true,
      reason: 'Permission approval must be collected by the main thread.',
      details: {
        permissionRequest: {
          handle: 'perm_test_handle',
          payload,
          createdAt: new Date().toISOString(),
        },
      },
    };
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'tool_execution_start', toolName: 'read', args: { path: '../outside.txt' } });
        subscriber?.({
          type: 'tool_execution_end',
          toolName: 'read',
          isError: true,
          result: structuredToolResult,
        });
      }),
      messages: [{ role: 'assistant', content: 'I could not complete the read.' }],
      dispose: vi.fn(async () => undefined),
    };

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: vi.fn(() => ({ session })),
    }));

    const { sdkSubagentRunner } = await import('../src/runner.js');
    const definition: SubagentDefinition = {
      name: 'sdd-apply',
      description: 'implementation executor',
      filePath: '/tmp/sdd-apply.md',
      instructions: 'return a concise result',
      tools: ['read'],
    };
    const config: SubagentsConfig = {
      timeout_ms: 10_000,
      stall_timeout_ms: 10_000,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: {},
    };
    const activities: Array<{ transcript?: string; output?: string; message: string }> = [];
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-runner-permission-'));
    try {
      const result = await sdkSubagentRunner({
        definition,
        task: 'read outside workspace',
        cwd,
        ctx: { model: { provider: 'test', id: 'model' } },
        config,
        signal: new AbortController().signal,
        onActivity: (activity) => activities.push(activity),
      });

      expect(result.result).not.toContain('permission_required:');
      expect(result.permission_request).toEqual(expect.objectContaining({ requestId: 'req-subagent-read', tool: 'read' }));
      expect(activities.map((activity) => activity.transcript ?? activity.output ?? '').join('\n')).not.toContain('permission_required:');
      expect(session.prompt).toHaveBeenCalledOnce();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('extracts permission requests from nested Pi tool result details', async () => {
    vi.resetModules();
    const payload = {
      type: 'permission_required',
      requestId: 'req-nested-details',
      tool: 'read',
      action: 'read',
      origin: 'subagent',
      reasonCode: 'outside_workspace_read_requires_approval',
      prompt: { title: 'Permission required', message: 'Outside-workspace read requires approval.' },
    };
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({
          type: 'tool_execution_end',
          toolName: 'read',
          isError: true,
          result: {
            content: [{ type: 'text', text: 'Permission approval must be collected by the main thread.' }],
            details: {
              block: true,
              reason: 'Permission approval must be collected by the main thread.',
              details: {
                permissionRequest: { handle: 'perm_nested_details', payload, createdAt: new Date().toISOString() },
              },
            },
          },
        });
      }),
      messages: [{ role: 'assistant', content: 'blocked' }],
      dispose: vi.fn(async () => undefined),
    };

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: vi.fn(() => ({ session })),
    }));

    const { sdkSubagentRunner } = await import('../src/runner.js');
    const result = await sdkSubagentRunner({
      definition: { name: 'discovery', description: 'discovery', filePath: '/tmp/discovery.md', instructions: 'try read', tools: ['read'] },
      task: 'read outside workspace',
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-nested-permission-')),
      ctx: { model: { provider: 'test', id: 'model' } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {} },
      signal: new AbortController().signal,
    });

    expect(result.permission_request).toEqual(expect.objectContaining({ requestId: 'req-nested-details' }));
    expect(result.result).not.toContain('permission_required:');
  });

  it('recovers stripped permission payloads from the shared channel when Pi drops tool result details', async () => {
    vi.resetModules();
    const payload = {
      type: 'permission_required',
      requestId: 'req-channel-fallback',
      tool: 'read',
      action: 'read',
      origin: 'subagent',
      reasonCode: 'outside_workspace_read_requires_approval',
      prompt: { title: 'Permission required', message: 'Outside-workspace read requires approval.' },
    };
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        const { publishPermissionRequest } = await import('../src/permission-channel.js');
        publishPermissionRequest(payload as any);
        subscriber?.({
          type: 'tool_execution_end',
          toolName: 'read',
          isError: true,
          result: {
            content: [{ type: 'text', text: 'Permission approval must be collected by the main thread.' }],
            details: {},
          },
        });
      }),
      messages: [{ role: 'assistant', content: 'blocked' }],
      dispose: vi.fn(async () => undefined),
    };

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: vi.fn(() => ({ session })),
    }));

    const { sdkSubagentRunner } = await import('../src/runner.js');
    const result = await sdkSubagentRunner({
      definition: { name: 'discovery', description: 'discovery', filePath: '/tmp/discovery.md', instructions: 'try read', tools: ['read'] },
      task: 'read outside workspace',
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-channel-fallback-')),
      ctx: { model: { provider: 'test', id: 'model' } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {} },
      signal: new AbortController().signal,
    });

    expect(result.permission_request).toEqual(expect.objectContaining({ requestId: 'req-channel-fallback' }));
    expect(result.result).not.toContain('permission_required:');
  });

  it('passes profile model and effort to nested SDK sessions and reports them', async () => {
    vi.resetModules();
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      messages: [{ role: 'assistant', content: 'done' }],
      dispose: vi.fn(async () => undefined),
    };
    const createAgentSession = vi.fn(() => ({ session }));

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession,
    }));

    const { sdkSubagentRunner } = await import('../src/runner.js');
    const definition: SubagentDefinition = {
      name: 'sdd-apply',
      description: 'apply executor',
      filePath: '/tmp/sdd-apply.md',
      instructions: 'return a concise result',
      tools: ['read'],
    };
    const config: SubagentsConfig = {
      timeout_ms: 10_000,
      stall_timeout_ms: 10_000,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: { 'sdd-apply': { model: { provider: 'profile', id: 'model' }, effort: 'xhigh' } },
    };
    const profileModel = { provider: 'profile', id: 'model' };

    const result = await sdkSubagentRunner({
      definition,
      task: 'apply work',
      cwd: '/workspace',
      ctx: {
        model: { provider: 'orchestrator', id: 'model' },
        modelRegistry: { find: vi.fn((provider: string, id: string) => provider === 'profile' && id === 'model' ? profileModel : undefined) },
        pi: { getThinkingLevel: () => 'low' },
      },
      config,
      signal: new AbortController().signal,
    });

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ model: profileModel, thinkingLevel: 'xhigh' }));
    expect(result).toMatchObject({ model: 'profile/model', effort: 'xhigh', fallback_used: false });
  });

  it('inherits missing profile fields from the remaining fallback chain', async () => {
    vi.resetModules();
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      messages: [{ role: 'assistant', content: 'done' }],
      dispose: vi.fn(async () => undefined),
    };
    const createAgentSession = vi.fn(() => ({ session }));

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession,
    }));

    const { sdkSubagentRunner } = await import('../src/runner.js');
    const definition: SubagentDefinition = {
      name: 'sdd-design',
      description: 'design executor',
      filePath: '/tmp/sdd-design.md',
      instructions: 'return a concise result',
      model: { provider: 'frontmatter', id: 'model' },
      tools: ['read'],
    };
    const config: SubagentsConfig = {
      timeout_ms: 10_000,
      stall_timeout_ms: 10_000,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: { 'sdd-design': { effort: 'high' } },
    };
    const frontmatterModel = { provider: 'frontmatter', id: 'model' };

    await sdkSubagentRunner({
      definition,
      task: 'design work',
      cwd: '/workspace',
      ctx: { modelRegistry: { find: vi.fn(() => frontmatterModel) }, model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'low' },
      config,
      signal: new AbortController().signal,
    });

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ model: frontmatterModel, thinkingLevel: 'high' }));
  });

  it('keeps no-profile default-config and orchestrator-inherited behavior unchanged', async () => {
    vi.resetModules();
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      messages: [{ role: 'assistant', content: 'done' }],
      dispose: vi.fn(async () => undefined),
    };
    const createAgentSession = vi.fn(() => ({ session }));

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession,
    }));

    const { sdkSubagentRunner } = await import('../src/runner.js');
    const definition: SubagentDefinition = {
      name: 'reviewer',
      description: 'reviewer executor',
      filePath: '/tmp/reviewer.md',
      instructions: 'return a concise result',
      tools: ['read'],
    };
    const defaultModel = { provider: 'default', id: 'model' };
    const config: SubagentsConfig = {
      default_model: { provider: 'default', id: 'model' },
      default_effort: 'medium',
      timeout_ms: 10_000,
      stall_timeout_ms: 10_000,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: {},
    };

    await sdkSubagentRunner({
      definition,
      task: 'review work',
      cwd: '/workspace',
      ctx: { modelRegistry: { find: vi.fn(() => defaultModel) }, model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'low' },
      config,
      signal: new AbortController().signal,
    });

    expect(createAgentSession).toHaveBeenLastCalledWith(expect.objectContaining({ model: defaultModel, thinkingLevel: 'medium' }));

    createAgentSession.mockClear();
    await sdkSubagentRunner({
      definition,
      task: 'review work',
      cwd: '/workspace',
      ctx: { model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'low' },
      config: { ...config, default_model: undefined, default_effort: undefined },
      signal: new AbortController().signal,
    });

    expect(createAgentSession).toHaveBeenLastCalledWith(expect.objectContaining({ model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'low' }));
  });

  it('reports unresolved profile models with the subagent name and selected model', async () => {
    vi.resetModules();
    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: vi.fn(),
    }));

    const { sdkSubagentRunner } = await import('../src/runner.js');
    await expect(sdkSubagentRunner({
      definition: { name: 'sdd-apply', description: 'apply executor', filePath: '/tmp/sdd-apply.md', instructions: 'return a concise result', tools: ['read'] },
      task: 'apply work',
      cwd: '/workspace',
      ctx: { modelRegistry: { find: vi.fn(() => undefined) }, model: { provider: 'orchestrator', id: 'model' } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: { 'sdd-apply': { model: { provider: 'missing', id: 'model' } } } },
      signal: new AbortController().signal,
    })).rejects.toThrow('Subagent sdd-apply could not resolve selected model missing/model');
  });

  it('passes the resolved thinking effort to nested SDK sessions and reports it', async () => {
    vi.resetModules();
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      messages: [{ role: 'assistant', content: 'done' }],
      dispose: vi.fn(async () => undefined),
    };
    const createAgentSession = vi.fn(() => ({ session }));

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession,
    }));

    const { sdkSubagentRunner } = await import('../src/runner.js');
    const definition: SubagentDefinition = {
      name: 'sdd-design',
      description: 'design executor',
      filePath: '/tmp/sdd-design.md',
      instructions: 'return a concise result',
      effort: 'high',
      tools: ['read'],
    };
    const config: SubagentsConfig = {
      timeout_ms: 10_000,
      stall_timeout_ms: 10_000,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: {},
    };

    const result = await sdkSubagentRunner({
      definition,
      task: 'design work',
      cwd: '/workspace',
      ctx: { model: { provider: 'test', id: 'model' }, pi: { getThinkingLevel: () => 'low' } },
      config,
      signal: new AbortController().signal,
    });

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel: 'high' }));
    expect(result.effort).toBe('high');
  });

  it('registers nested SDK sessions as subagent permission requesters while the prompt runs', async () => {
    vi.resetModules();
    const registryKey = Symbol.for('pi.permissionGuard.subagentSessions');
    const holder = globalThis as Record<symbol, unknown>;
    const previousRegistry = holder[registryKey];
    let metadataDuringPrompt: unknown;
    const session = {
      sessionManager: { getSessionId: () => 'nested-session-1' },
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => {
        const registry = holder[registryKey] as Map<string, unknown> | undefined;
        metadataDuringPrompt = registry?.get('nested-session-1');
      }),
      messages: [{ role: 'assistant', content: 'done' }],
      dispose: vi.fn(async () => undefined),
    };

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: vi.fn(() => ({ session })),
    }));

    try {
      const { sdkSubagentRunner } = await import('../src/runner.js');
      const definition: SubagentDefinition = {
        name: 'sdd-verify',
        description: 'verification executor',
        filePath: '/tmp/sdd-verify.md',
        instructions: 'return a concise result',
        tools: ['read'],
      };
      const config: SubagentsConfig = {
        timeout_ms: 10_000,
        stall_timeout_ms: 10_000,
        max_concurrency: 1,
        default_tools: ['read'],
        model_profiles: {},
      };

      await sdkSubagentRunner({
        definition,
        task: 'read /etc/hosts',
        cwd: '/workspace',
        ctx: { model: { provider: 'test', id: 'model' } },
        config,
        signal: new AbortController().signal,
      });

      expect(metadataDuringPrompt).toEqual({
        origin: 'subagent',
        requester: { subagentName: 'sdd-verify', description: 'verification executor' },
      });
      expect((holder[registryKey] as Map<string, unknown> | undefined)?.has('nested-session-1')).toBe(false);
    } finally {
      if (previousRegistry === undefined) delete holder[registryKey];
      else holder[registryKey] = previousRegistry;
    }
  });
});

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

  async function runWithSession(session: any, cwd = '/workspace') {
    vi.resetModules();
    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: vi.fn(() => ({ session })),
    }));
    const { sdkSubagentRunner } = await import('../src/runner.js');
    const activities: any[] = [];
    const result = await sdkSubagentRunner({
      definition,
      task: 'capture a thread snapshot',
      cwd,
      ctx: { model: { provider: 'test', id: 'model' } },
      config,
      signal: new AbortController().signal,
      onActivity: (activity) => activities.push(activity),
    });
    return { result, activities };
  }

  it('emits and returns bounded snapshots for assistant text, paired bash output, tool errors, and custom fallback tools without changing result or usage', async () => {
    const largeOutput = 'x'.repeat(6000);
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'message_update', assistantMessageEvent: { delta: 'streamed ' } });
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
      expect.objectContaining({ type: 'bash', tool_call_id: 'bash-1', command: 'printf hello', status: 'completed' }),
      expect.objectContaining({ type: 'tool', tool_call_id: 'mem-1', name: 'memory_search', status: 'failed', result: expect.objectContaining({ isError: true, preview: expect.stringContaining('memory unavailable') }) }),
      expect.objectContaining({ type: 'tool', tool_call_id: 'custom-1', name: 'custom_tool', status: 'completed', result: expect.objectContaining({ preview: expect.stringContaining('custom result') }) }),
    ]));
    const bashItem = result.thread_snapshot?.items.find((item: any) => item.type === 'bash') as any;
    expect(bashItem.output.length).toBeLessThan(4500);
    expect(bashItem.truncated).toBe(true);
  });

  it('logs when streamed raw tool-call json is dropped from live thread snapshots', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'message_update', assistantMessageEvent: { delta: '{"query":"subagent renderer raw tool json","limit":3}' } });
        subscriber?.({ type: 'tool_execution_start', toolCallId: 'mem-1', toolName: 'memory_search', args: { query: 'subagent renderer raw tool json', limit: 3 } });
        subscriber?.({ type: 'tool_execution_end', toolCallId: 'mem-1', toolName: 'memory_search', isError: false, result: { content: [{ type: 'text', text: 'Found 3 memory result(s).' }] } });
      }),
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'final answer' }] }],
      dispose: vi.fn(async () => undefined),
    };

    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-runner-json-'));
    try {
      const { activities } = await runWithSession(session, cwd);
      const afterToolStart = activities.find((activity) => activity.message === 'memory_search');
      expect(afterToolStart?.thread_snapshot).toBeDefined();
      const visibleAssistantText = afterToolStart?.thread_snapshot?.items
        .filter((item: any) => item.type === 'assistant')
        .flatMap((item: any) => item.message.content.map((part: any) => part.text ?? part.thinking ?? ''))
        .join('\n') ?? '';
      expect(visibleAssistantText).not.toContain('{"query"');
      expect(afterToolStart?.thread_snapshot?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool', name: 'memory_search', status: 'running', arguments: expect.objectContaining({ query: 'subagent renderer raw tool json' }) }),
      ]));
      const log = fs.readFileSync(path.join(cwd, '.pi', 'subagents-debug.log'), 'utf8');
      expect(log).toContain('live_raw_tool_json_dropped');
      expect(log).toContain('memory_search');
      expect(log).toContain('query');
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
      : `${item.type}:${item.name}`);

    expect(labels).toEqual(['user:undefined', 'assistant:toolCall:read', 'tool:read', 'assistant:final after tools']);
    expect(result.thread_snapshot?.items[0]).toMatchObject({ type: 'user', label: 'delegated_task' });
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
      return `${item.type}:${item.label}`;
    });

    expect(labels).toEqual([
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
        subscriber?.({ type: 'message_update', assistantMessageEvent: { delta: 'draft text that should not replace final' } });
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

  it('finalizes assistant text from session messages when available while preserving streamed activity snapshots', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'message_update', assistantMessageEvent: { delta: 'draft text' } });
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
