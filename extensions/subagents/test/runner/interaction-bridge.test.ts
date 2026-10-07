import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SubagentStructuredError, classifyFallbackFailure, classifyThrownError, deriveErrorString, normalizeErrorMetadata } from '../../src/error-metadata.js';
import type { SubagentDefinition, SubagentErrorMetadata, SubagentsConfig } from '../../src/types.js';

describe('subagent runner interaction-required bridge', () => {
  it('uses a lean isolated resource loader with modelRuntime and systemPromptOverride', async () => {
    vi.resetModules();
    let delegatedPrompt = '';
    const session = {
      systemPrompt: '# Analyst\nSYSTEM_SENTINEL',
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async (prompt: string) => { delegatedPrompt = prompt; }),
      messages: [{ role: 'assistant', content: 'lean done' }],
      dispose: vi.fn(async () => undefined),
    };
    const createAgentSession = vi.fn(() => ({ session }));
    const inMemory = vi.fn(() => ({ kind: 'memory-session' }));
    const loaderInstances: any[] = [];
    class DefaultResourceLoader {
      options: any;
      reload = vi.fn(async () => undefined);
      constructor(options: any) { this.options = options; loaderInstances.push(this); }
    }
    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      DefaultResourceLoader,
      getAgentDir: () => '/agent-dir',
      SessionManager: { inMemory },
      createAgentSession,
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');
    const definition: SubagentDefinition = {
      name: 'analyst',
      description: 'analysis',
      filePath: '/tmp/analyst.md',
      instructions: '# Analyst\nSYSTEM_SENTINEL',
      tools: ['read'],
    };
    const config: SubagentsConfig = {
      timeout_ms: 10_000,
      stall_timeout_ms: 10_000,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: {},
      session_resources: 'lean',
    };
    const activities: any[] = [];
    const modelRuntime = { getModel: vi.fn() };

    const result = await sdkSubagentRunner({
      definition,
      task: 'lean startup',
      cwd: '/workspace',
      ctx: { model: { provider: 'test', id: 'model' }, modelRuntime },
      config,
      signal: new AbortController().signal,
      onActivity: (activity) => activities.push(activity),
    });

    expect(result.result).toBe('lean done');
    expect(loaderInstances).toHaveLength(1);
    expect(loaderInstances[0].reload).toHaveBeenCalledTimes(1);
    expect(loaderInstances[0].options).toMatchObject({ cwd: '/workspace', agentDir: '/agent-dir', noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
    expect(loaderInstances[0].options.systemPrompt).toBeUndefined();
    expect(typeof loaderInstances[0].options.systemPromptOverride).toBe('function');
    expect(loaderInstances[0].options.systemPromptOverride()).toBe('# Analyst\nSYSTEM_SENTINEL');
    expect(typeof loaderInstances[0].options.extensionsOverride).toBe('function');
    expect(inMemory).toHaveBeenCalledWith('/workspace');
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ resourceLoader: loaderInstances[0], cwd: '/workspace', tools: ['read'], modelRuntime }));
    expect(createAgentSession).not.toHaveBeenCalledWith(expect.objectContaining({ authStorage: expect.anything() }));
    expect(delegatedPrompt).toBe('## delegated task\nlean startup');
    expect(delegatedPrompt).not.toContain('SYSTEM_SENTINEL');
    expect(activities.some((activity) => activity.system_prompt === '# Analyst\nSYSTEM_SENTINEL')).toBe(true);
  });

  it('resolves configured models through modelRuntime.getModel before falling back to modelRegistry', async () => {
    vi.resetModules();
    const resolvedModel = { provider: 'runtime', id: 'resolved-model' };
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      messages: [{ role: 'assistant', content: 'runtime done' }],
      dispose: vi.fn(async () => undefined),
    };
    const createAgentSession = vi.fn(() => ({ session }));
    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession,
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');
    const modelRuntime = { getModel: vi.fn(() => resolvedModel) };
    const modelRegistry = { find: vi.fn(() => ({ provider: 'registry', id: 'old-path' })) };

    await sdkSubagentRunner({
      definition: { name: 'analyst', description: 'analysis', filePath: '/tmp/analyst.md', instructions: 'system', tools: ['read'], model: { provider: 'openai', id: 'gpt-5.5' } },
      task: 'use configured model',
      cwd: '/workspace',
      ctx: { modelRuntime, modelRegistry },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {} },
      effectiveProfile: {
        agent: 'analyst',
        model: { value: { provider: 'openai', id: 'gpt-5.5' }, source: 'allocated', label: 'allocated: openai/gpt-5.5' },
        effort: { source: 'unresolved', label: 'unresolved' },
      },
      signal: new AbortController().signal,
    } as any);

    expect(modelRuntime.getModel).toHaveBeenCalledWith('openai', 'gpt-5.5');
    expect(modelRegistry.find).not.toHaveBeenCalled();
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ model: resolvedModel }));
  });

  it('filters subagent extension hooks to tools and tool-safety events only', async () => {
    vi.resetModules();
    const loaderInstances: any[] = [];
    class DefaultResourceLoader {
      options: any;
      reload = vi.fn(async () => undefined);
      constructor(options: any) { this.options = options; loaderInstances.push(this); }
    }
    const session = { systemPrompt: 'system', subscribe: vi.fn(() => vi.fn()), prompt: vi.fn(async () => undefined), messages: [{ role: 'assistant', content: 'ok' }], dispose: vi.fn(async () => undefined) };
    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      DefaultResourceLoader,
      getAgentDir: () => '/agent-dir',
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: vi.fn(() => ({ session })),
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');
    await sdkSubagentRunner({
      definition: { name: 'analyst', description: 'analysis', filePath: '/tmp/analyst.md', instructions: 'system', tools: ['read'] },
      task: 'ping',
      cwd: '/workspace',
      ctx: { model: { provider: 'test', id: 'model' } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {}, session_resources: 'lean' },
      signal: new AbortController().signal,
    });

    const beforeAgentStart = vi.fn();
    const toolCall = vi.fn();
    const tool = { name: 'memory_search' };
    const filtered = loaderInstances[0].options.extensionsOverride({
      runtime: { keep: true },
      errors: [],
      extensions: [{
        path: 'memory',
        resolvedPath: 'memory',
        sourceInfo: {},
        handlers: new Map<string, any[]>([
          ['before_agent_start', [beforeAgentStart]],
          ['context', [vi.fn()]],
          ['tool_call', [toolCall]],
          ['user_bash', [vi.fn()]],
          ['message_update', [vi.fn()]],
        ]),
        tools: new Map([['memory_search', tool]]),
        messageRenderers: new Map([['memory-context', vi.fn()]]),
        commands: new Map([['memory', vi.fn()]]),
        flags: new Map([['flag', {}]]),
        shortcuts: new Map([['ctrl+x', {}]]),
      }],
    });

    const extension = filtered.extensions[0];
    expect(extension.tools.get('memory_search')).toBe(tool);
    expect(extension.handlers.has('before_agent_start')).toBe(false);
    expect(extension.handlers.has('context')).toBe(false);
    expect(extension.handlers.has('message_update')).toBe(false);
    expect(extension.handlers.get('tool_call')).toEqual([toolCall]);
    expect(extension.handlers.has('user_bash')).toBe(true);
    expect(extension.commands.size).toBe(0);
    expect(extension.flags.size).toBe(0);
    expect(extension.shortcuts.size).toBe(0);
  });

  it('preserves structured interaction requests from nested tool failures while keeping result surfaces marker-free', async () => {
    vi.resetModules();
    const payload = {
      type: 'interaction_required',
      requestId: 'req-subagent-read',
      tool: 'read',
      action: 'read',
      origin: 'subagent',
      requester: { subagentName: 'sdd-apply', taskId: '2.10' },
      reason: 'Outside-workspace read requires approval.',
      reasonCode: 'outside_workspace_read_approval_required',
      riskLevel: 'medium',
      prompt: {
        title: 'Interaction required for read',
        message: 'Outside-workspace read requires approval.',
        choices: ['Allow once', 'Allow for session', 'Allow for project', 'Deny'],
        safeTarget: '/tmp/outside.txt',
      },
    };
    const structuredToolResult = {
      block: true,
      reason: 'Interaction response must be collected by the main thread.',
      details: {
        interactionRequest: {
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

    const { sdkSubagentRunner } = await import('../../src/runner.js');
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
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-runner-interaction-'));
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

      expect(result.result).not.toContain('interaction_required:');
      expect(result.interaction_request).toEqual(expect.objectContaining({ requestId: 'req-subagent-read', tool: 'read' }));
      expect(activities.map((activity) => activity.transcript ?? activity.output ?? '').join('\n')).not.toContain('interaction_required:');
      expect(session.prompt).toHaveBeenCalledOnce();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('extracts interaction requests from nested Pi tool result details', async () => {
    vi.resetModules();
    const payload = {
      type: 'interaction_required',
      requestId: 'req-nested-details',
      tool: 'read',
      action: 'read',
      origin: 'subagent',
      reasonCode: 'outside_workspace_read_requires_approval',
      prompt: { title: 'Interaction required', message: 'Outside-workspace read requires approval.' },
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
            content: [{ type: 'text', text: 'Interaction response must be collected by the main thread.' }],
            details: {
              block: true,
              reason: 'Interaction response must be collected by the main thread.',
              details: {
                interactionRequest: { handle: 'perm_nested_details', payload, createdAt: new Date().toISOString() },
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

    const { sdkSubagentRunner } = await import('../../src/runner.js');
    const result = await sdkSubagentRunner({
      definition: { name: 'discovery', description: 'discovery', filePath: '/tmp/discovery.md', instructions: 'try read', tools: ['read'] },
      task: 'read outside workspace',
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-nested-interaction-')),
      ctx: { model: { provider: 'test', id: 'model' } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {} },
      signal: new AbortController().signal,
    });

    expect(result.interaction_request).toEqual(expect.objectContaining({ requestId: 'req-nested-details' }));
    expect(result.result).not.toContain('interaction_required:');
  });

  it('recovers stripped interaction payloads from the shared channel when Pi drops tool result details', async () => {
    vi.resetModules();
    const payload = {
      type: 'interaction_required',
      requestId: 'req-channel-fallback',
      tool: 'read',
      action: 'read',
      origin: 'subagent',
      reasonCode: 'outside_workspace_read_requires_approval',
      prompt: { title: 'Interaction required', message: 'Outside-workspace read requires approval.' },
    };
    let subscriber: ((event: unknown) => void) | undefined;
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        const { publishInteractionRequest } = await import('../../src/interaction-channel.js');
        publishInteractionRequest(payload as any);
        subscriber?.({
          type: 'tool_execution_end',
          toolName: 'read',
          isError: true,
          result: {
            content: [{ type: 'text', text: 'Interaction response must be collected by the main thread.' }],
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

    const { sdkSubagentRunner } = await import('../../src/runner.js');
    const result = await sdkSubagentRunner({
      definition: { name: 'discovery', description: 'discovery', filePath: '/tmp/discovery.md', instructions: 'try read', tools: ['read'] },
      task: 'read outside workspace',
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-channel-fallback-')),
      ctx: { model: { provider: 'test', id: 'model' } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {} },
      signal: new AbortController().signal,
    });

    expect(result.interaction_request).toEqual(expect.objectContaining({ requestId: 'req-channel-fallback' }));
    expect(result.result).not.toContain('interaction_required:');
  });

  it.each([
    { name: 'registry allocation', claim: 'model', lookup: 'registry', available: true },
    { name: 'runtime allocation', claim: 'model', lookup: 'runtime', available: true },
    { name: 'unavailable allocation', claim: 'model', lookup: 'registry', available: false },
    { name: 'no allocator', claim: 'none', lookup: 'registry', available: true },
    { name: 'allocator declining claim', claim: 'undefined', lookup: 'registry', available: true },
  ])('passes the manager allocation through actual SDK options: $name', async ({ claim, lookup, available }) => {
    vi.resetModules();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagents-sdk-allocation-'));
    const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
    const oldHistoryDbPath = process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
    process.env.PI_CODING_AGENT_DIR = path.join(tmp, 'isolated-agent');
    process.env.PI_SUBAGENTS_HISTORY_DB_PATH = path.join(tmp, 'history.sqlite');
    try {
      const agentDir = path.join(tmp, '.pi', 'subagents');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'analyst.md'), '---\nname: analyst\ndescription: analysis\ntools:\n  - read\n---\nReturn a concise result.');
      const session = {
        subscribe: vi.fn(() => vi.fn()),
        prompt: vi.fn(async () => undefined),
        messages: [{ role: 'assistant', content: 'allocated done' }],
        dispose: vi.fn(async () => undefined),
      };
      const order: string[] = [];
      const createAgentSession = vi.fn((_options: unknown) => {
        order.push('createSession');
        return { session };
      });
      vi.doMock('@earendil-works/pi-coding-agent', () => ({
        SessionManager: { inMemory: () => ({}) },
        DefaultResourceLoader: class { reload = vi.fn(async () => undefined); },
        getAgentDir: () => process.env.PI_CODING_AGENT_DIR,
        createAgentSession,
      }));
      const { SubagentManager } = await import('../../src/manager.js');
      const { profileSourceLabel } = await import('../../src/profile-resolver.js');
      const prefixes = ['pdas', 'j0k3r2', 'j0k3r3', 'j0k3r', 'unpa', 'ytest664'];
      const models = prefixes.map((prefix) => ({
        provider: 'cliproxyapi', id: `${prefix}/gemini-3.8-flash-high`,
        name: `Gemini ${prefix}`, api: 'google-generative-ai', baseUrl: 'http://127.0.0.1:8317/v1',
        reasoning: true, input: ['text'], contextWindow: 1_000_000, maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }));
      const allocatedModel = models[0];
      const parentModel = models[5];
      const find = vi.fn((provider: string, id: string) => models.find((model) =>
        model.provider === provider && model.id === id && (available || model !== allocatedModel)));
      const modelRegistry = { find };
      const modelRuntime = lookup === 'runtime' ? { getModel: find } : undefined;
      const ctx = { cwd: tmp, model: parentModel, modelRegistry, modelRuntime, thinkingLevel: 'low' };
      const terminalStatuses: string[] = [];
      let cleanupCompleted = false;
      const events = { emit(channel: string, event: any) {
        if (channel === 'subagents:task:allocate') {
          order.push('allocate');
          if (claim !== 'none') event.claimModel(async () => {
            await Promise.resolve();
            order.push('claim settled');
            return claim === 'undefined' ? undefined : {
              model: { provider: allocatedModel.provider, id: allocatedModel.id }, effort: 'high',
            };
          });
        } else if (channel === 'subagents:task:terminal') {
          terminalStatuses.push(event.status);
          event.registerCleanup(async () => { await Promise.resolve(); cleanupCompleted = true; });
        }
      } };
      // No injected runner: manager -> sdkSubagentRunner -> private createSession -> SDK options.
      const manager = new SubagentManager(undefined, undefined, undefined, undefined, events);
      const result = await manager.run({ agent: 'analyst', task: 'use the leased account' }, ctx);
      if (claim === 'model' && !available) {
        expect(createAgentSession).not.toHaveBeenCalled();
        expect(session.prompt).not.toHaveBeenCalled();
        expect(result.results?.[0]).toMatchObject({ status: 'failed', model_source: 'allocated' });
        expect(result.results?.[0].error).toContain('Subagent analyst could not resolve selected model cliproxyapi/pdas/gemini-3.8-flash-high (allocated)');
        expect(terminalStatuses).toEqual(['failed']);
      } else {
        expect(result.results?.[0].error_metadata).toBeUndefined();
        expect(result.results?.[0].error).toBeUndefined();
        const expectedModel = claim === 'model' ? allocatedModel : parentModel;
        const expectedEffort = claim === 'model' ? 'high' : 'low';
        expect(createAgentSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          model: expectedModel, thinkingLevel: expectedEffort,
        }));
        expect(createAgentSession.mock.calls[0][0]).toHaveProperty('model', expectedModel);
        expect((createAgentSession.mock.calls[0][0] as any).model).toBe(expectedModel);
        expect(result.results?.[0]).toMatchObject({
          status: 'completed', model: `${expectedModel.provider}/${expectedModel.id}`, effort: expectedEffort,
          model_source: claim === 'model' ? 'allocated' : 'orchestrator',
          effort_source: claim === 'model' ? 'allocated' : 'orchestrator',
        });
        expect(terminalStatuses).toEqual(['completed']);
        expect(order).toEqual(claim === 'none' ? ['allocate', 'createSession'] : ['allocate', 'claim settled', 'createSession']);
      }
      if (claim === 'model') {
        expect(find).toHaveBeenCalledWith(allocatedModel.provider, allocatedModel.id);
        expect(profileSourceLabel('allocated', { provider: allocatedModel.provider, id: allocatedModel.id },
          (model) => `${model.provider}/${model.id}`)).toBe('allocated: cliproxyapi/pdas/gemini-3.8-flash-high');
      } else {
        expect(find).not.toHaveBeenCalled();
      }
      expect(ctx.model).toBe(parentModel);
      expect(cleanupCompleted).toBe(true);
    } finally {
      if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
      if (oldHistoryDbPath === undefined) delete process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
      else process.env.PI_SUBAGENTS_HISTORY_DB_PATH = oldHistoryDbPath;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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

    const { sdkSubagentRunner } = await import('../../src/runner.js');
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
      effectiveProfile: {
        agent: 'sdd-apply',
        model: { value: { provider: 'profile', id: 'model' }, source: 'allocated', label: 'allocated: profile/model' },
        effort: { value: 'xhigh', source: 'allocated', label: 'allocated: xhigh' },
      },
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

    const { sdkSubagentRunner } = await import('../../src/runner.js');
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
      ctx: { modelRegistry: { find: vi.fn(() => frontmatterModel) }, model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'high' },
      config,
      signal: new AbortController().signal,
    });

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'high' }));
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

    const { sdkSubagentRunner } = await import('../../src/runner.js');
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
      ctx: { modelRegistry: { find: vi.fn(() => defaultModel) }, model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'medium' },
      config,
      signal: new AbortController().signal,
    });

    expect(createAgentSession).toHaveBeenLastCalledWith(expect.objectContaining({ model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'medium' }));

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

  it.each([false, true])('preserves unclaimed unresolved SDK defaults and orchestrator registry lookup (inherited=$0)', async (inherited) => {
    vi.resetModules();
    const session = {
      subscribe: vi.fn(() => vi.fn()), prompt: vi.fn(async () => undefined),
      messages: [{ role: 'assistant', content: 'done' }], dispose: vi.fn(async () => undefined),
    };
    const createAgentSession = vi.fn((_options: unknown) => ({ session }));
    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) }, createAgentSession,
    }));
    const { sdkSubagentRunner } = await import('../../src/runner.js');
    const resolvedModel = { provider: 'parent', id: 'registered-model' };
    const find = vi.fn((provider: string, id: string) =>
      provider === resolvedModel.provider && id === resolvedModel.id ? resolvedModel : undefined);
    await sdkSubagentRunner({
      definition: { name: 'analyst', description: 'analysis', filePath: '/tmp/analyst.md', instructions: 'system', tools: ['read'] },
      task: 'unclaimed work', cwd: '/workspace', ctx: { modelRegistry: { find } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {} },
      signal: new AbortController().signal,
      effectiveProfile: inherited ? {
        agent: 'analyst',
        model: { source: 'orchestrator', value: resolvedModel, label: 'orchestrator: parent/registered-model' },
        effort: { source: 'unresolved', label: 'unresolved' },
      } : undefined,
    });
    expect(createAgentSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      model: inherited ? resolvedModel : undefined, thinkingLevel: undefined,
    }));
    if (inherited) expect(find).toHaveBeenCalledWith(resolvedModel.provider, resolvedModel.id);
    else expect(find).not.toHaveBeenCalled();
  });

  it('reports unresolved profile models with the subagent name and selected model', async () => {
    vi.resetModules();
    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: vi.fn(),
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');
    await expect(sdkSubagentRunner({
      definition: { name: 'sdd-apply', description: 'apply executor', filePath: '/tmp/sdd-apply.md', instructions: 'return a concise result', tools: ['read'] },
      task: 'apply work',
      cwd: '/workspace',
      ctx: { modelRegistry: { find: vi.fn(() => undefined) }, model: { provider: 'orchestrator', id: 'model' } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {} },
      effectiveProfile: {
        agent: 'sdd-apply',
        model: { value: { provider: 'missing', id: 'model' }, source: 'allocated', label: 'allocated: missing/model' },
        effort: { source: 'unresolved', label: 'unresolved' },
      },
      signal: new AbortController().signal,
    })).rejects.toThrow('Subagent sdd-apply could not resolve selected model missing/model (allocated)');
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

    const { sdkSubagentRunner } = await import('../../src/runner.js');
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
      ctx: { model: { provider: 'test', id: 'model' }, pi: { getThinkingLevel: () => 'high' } },
      config,
      signal: new AbortController().signal,
    });

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel: 'high' }));
    expect(result.effort).toBe('high');
  });

  it('expands wildcard tool patterns from active parent-session tools only', async () => {
    vi.resetModules();
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      messages: [{ role: 'assistant', content: 'done' }],
      dispose: vi.fn(async () => undefined),
    };
    const createAgentSession = vi.fn(() => ({ session }));
    const getActiveTools = vi.fn(() => ['read', 'tool_lookup', 'tool_write']);
    const getAllTools = vi.fn(() => [{ name: 'read' }, { name: 'tool_lookup' }, { name: 'tool_write' }, { name: 'tool_hidden' }]);

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession,
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');
    await sdkSubagentRunner({
      definition: { name: 'tool-user', description: 'tool user', filePath: '/tmp/tool-user.md', instructions: 'return a concise result', tools: ['tool_*', 'read'] },
      task: 'use tools',
      cwd: '/workspace',
      ctx: { model: { provider: 'test', id: 'model' }, pi: { getActiveTools, getAllTools } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {} },
      signal: new AbortController().signal,
    } as any);

    expect(getActiveTools).toHaveBeenCalledTimes(1);
    expect(getAllTools).not.toHaveBeenCalled();
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ tools: ['tool_lookup', 'tool_write', 'read'] }));
  });

  it('expands wildcard patterns from default_tools using the active parent-session tools', async () => {
    vi.resetModules();
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      messages: [{ role: 'assistant', content: 'done' }],
      dispose: vi.fn(async () => undefined),
    };
    const createAgentSession = vi.fn(() => ({ session }));
    const getActiveTools = vi.fn(() => ['read', 'tool_lookup']);

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession,
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');
    await sdkSubagentRunner({
      definition: { name: 'tool-user', description: 'tool user', filePath: '/tmp/tool-user.md', instructions: 'return a concise result', tools: [] },
      task: 'use tools',
      cwd: '/workspace',
      ctx: { model: { provider: 'test', id: 'model' }, pi: { getActiveTools } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['tool_*', 'read'], model_profiles: {} },
      signal: new AbortController().signal,
    } as any);

    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ tools: ['tool_lookup', 'read'] }));
  });

  it('detects supported and unsupported Pi versions from the loaded SDK version export', async () => {
    const { detectPiRuntimeSupport } = await import('../../src/runner/pi-sdk-module.js');

    expect((detectPiRuntimeSupport as any)('0.83.0')).toEqual({
      supported: true,
      detected_pi_version: '0.83.0',
      required_pi_version: '>=0.82.1',
    });
    expect((detectPiRuntimeSupport as any)('0.81.0')).toEqual({
      supported: false,
      detected_pi_version: '0.81.0',
      required_pi_version: '>=0.82.1',
    });
    expect((detectPiRuntimeSupport as any)(undefined)).toEqual({
      supported: false,
      detected_pi_version: 'unknown',
      required_pi_version: '>=0.82.1',
    });
  });

  it('registers the nested SDK live steering bridge and clears it after settlement', async () => {
    vi.resetModules();
    const steer = vi.fn(async () => undefined);
    const session = {
      steer,
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      messages: [{ role: 'assistant', content: 'done' }],
      dispose: vi.fn(async () => undefined),
    };
    const createAgentSession = vi.fn(() => ({ session }));
    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      VERSION: '0.83.0',
      SessionManager: { inMemory: () => ({}) },
      createAgentSession,
    }));

    try {
      const { sdkSubagentRunner } = await import('../../src/runner.js');
      const bridges: any[] = [];
      let cleared = 0;
      await sdkSubagentRunner({
        definition: { name: 'sdd-apply', description: 'implementation executor', filePath: '/tmp/sdd-apply.md', instructions: 'return a concise result', tools: ['read'] },
        task: 'implement work',
        cwd: '/workspace',
        ctx: { model: { provider: 'test', id: 'model' } },
        config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {} },
        signal: new AbortController().signal,
        registerLiveBridge: (bridge) => bridges.push(bridge),
        clearLiveBridge: () => { cleared += 1; },
      });

      expect(createAgentSession).toHaveBeenCalledOnce();
      expect(bridges).toHaveLength(1);
      expect(bridges[0]).toMatchObject({ supported: true, detected_pi_version: '0.83.0' });
      bridges[0].steer('steer this nested session');
      expect(steer).toHaveBeenCalledWith('steer this nested session');
      expect(cleared).toBe(1);
    } finally {
      vi.doUnmock('../../src/runner/pi-sdk-module.js');
    }
  });

  it('registers nested SDK sessions as subagent interaction requesters while the prompt runs', async () => {
    vi.resetModules();
    const registryKey = Symbol.for('pi.subagents.interactionSessions');
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
      const { sdkSubagentRunner } = await import('../../src/runner.js');
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
        taskId: 'task_sdd-verify_123',
        cwd: '/workspace',
        ctx: { model: { provider: 'test', id: 'model' }, sessionManager: { getSessionId: () => 'parent-pi-session' } },
        config,
        signal: new AbortController().signal,
      });

      expect(metadataDuringPrompt).toEqual({
        origin: 'subagent',
        requester: { subagentName: 'sdd-verify', description: 'verification executor', taskId: 'task_sdd-verify_123' },
        parent: { piSessionId: 'parent-pi-session' },
      });
      expect((holder[registryKey] as Map<string, unknown> | undefined)?.has('nested-session-1')).toBe(false);
    } finally {
      if (previousRegistry === undefined) delete holder[registryKey];
      else holder[registryKey] = previousRegistry;
    }
  });

  it('consumes one queued message only after post-initial user-message safe boundaries', async () => {
    let subscriber: ((event: unknown) => void) | undefined;
    const consumed: string[] = [];
    const session = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        subscriber?.({ type: 'message_start', message: { role: 'user' } });
        subscriber?.({ type: 'message_start', message: { role: 'assistant' } });
        subscriber?.({ type: 'message_start', message: { role: 'user' } });
        subscriber?.({ type: 'message_start', message: { role: 'user' } });
      }),
      messages: [{ role: 'assistant', content: 'done' }],
      dispose: vi.fn(async () => undefined),
    };

    const { promptWithInactivity } = await import('../../src/runner/event-processing.js');
    await promptWithInactivity(
      session,
      'delegate',
      10_000,
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'delegated_task',
      'delegate',
      1,
      () => consumed.push(`consume-${consumed.length + 1}`),
    );

    expect(consumed).toEqual(['consume-1', 'consume-2']);
  });

  it('aborts the created AgentSession and waits for prompt settlement on in-flight cancellation', async () => {
    vi.resetModules();
    let settlePrompt: (() => void) | undefined;
    let promptEntered: (() => void) | undefined;
    const promptStarted = new Promise<void>((resolve) => { promptEntered = resolve; });
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async (_prompt: string, options?: unknown) => {
        expect(options).toBeUndefined();
        promptEntered?.();
        await new Promise<void>((resolve) => { settlePrompt = resolve; });
      }),
      abort: vi.fn(async () => { settlePrompt?.(); }),
      messages: [{ role: 'assistant', content: 'aborted after cleanup' }],
      dispose: vi.fn(async () => undefined),
    };

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: vi.fn(() => ({ session })),
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');
    const controller = new AbortController();
    const runPromise = sdkSubagentRunner({
      definition: { name: 'sdd-apply', description: 'apply executor', filePath: '/tmp/sdd-apply.md', instructions: 'return a concise result', tools: ['read'] },
      task: 'cancel in flight',
      cwd: '/workspace',
      ctx: { model: { provider: 'test', id: 'model' } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {} },
      signal: controller.signal,
    });

    await promptStarted;
    controller.abort();

    await expect(runPromise).rejects.toThrow('Subagent was aborted');
    expect(session.prompt).toHaveBeenCalledOnce();
    expect(session.abort).toHaveBeenCalledOnce();
  });

  it('aborts a pre-aborted AgentSession before prompting', async () => {
    vi.resetModules();
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
      messages: [{ role: 'assistant', content: 'should not be returned' }],
      dispose: vi.fn(async () => undefined),
    };

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: vi.fn(() => ({ session })),
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');
    const controller = new AbortController();
    controller.abort();

    await expect(sdkSubagentRunner({
      definition: { name: 'sdd-apply', description: 'apply executor', filePath: '/tmp/sdd-apply.md', instructions: 'return a concise result', tools: ['read'] },
      task: 'cancel before prompt',
      cwd: '/workspace',
      ctx: { model: { provider: 'test', id: 'model' } },
      config: { timeout_ms: 10_000, stall_timeout_ms: 10_000, max_concurrency: 1, default_tools: ['read'], model_profiles: {} },
      signal: controller.signal,
    })).rejects.toThrow('Subagent was aborted');

    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.prompt).not.toHaveBeenCalled();
  });
});
