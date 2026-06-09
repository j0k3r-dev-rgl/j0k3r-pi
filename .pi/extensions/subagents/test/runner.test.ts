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
        choices: ['Allow once', 'Allow for session', 'Deny'],
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
