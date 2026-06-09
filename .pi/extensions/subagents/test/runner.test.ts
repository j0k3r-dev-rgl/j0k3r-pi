import { describe, expect, it, vi } from 'vitest';
import type { SubagentDefinition, SubagentsConfig } from '../src/types.js';

describe('subagent runner permission-required bridge', () => {
  it('preserves permission_required payloads from nested tool failures in the orchestrator-facing result and transcript', async () => {
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
    const marker = `permission_required:${JSON.stringify(payload)}`;
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
          result: { block: true, reason: marker },
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

    const result = await sdkSubagentRunner({
      definition,
      task: 'read outside workspace',
      cwd: '/workspace',
      ctx: { model: { provider: 'test', id: 'model' } },
      config,
      signal: new AbortController().signal,
      onActivity: (activity) => activities.push(activity),
    });

    expect(result.result).toContain(marker);
    expect(activities.map((activity) => activity.transcript ?? activity.output ?? '').join('\n')).toContain(marker);
    expect(session.prompt).toHaveBeenCalledOnce();
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
