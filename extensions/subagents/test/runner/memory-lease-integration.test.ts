import { describe, it, expect, vi } from 'vitest';
import type { SubagentDefinition, SubagentsConfig } from '../../src/types.js';

describe('subagent runner optional memory lease integration', () => {
  it('binds memory-invocation-adapter-v1, emits bind request, activates on user message, and terminates lease on completion', async () => {
    vi.resetModules();

    let capturedBindRequest: any = undefined;
    let activated = false;
    let terminatedWith: string | undefined = undefined;

    const mockLease = {
      version: 1,
      activate: vi.fn(async () => {
        activated = true;
      }),
      terminate: vi.fn(async (outcome: string) => {
        terminatedWith = outcome;
      }),
      perform: vi.fn(),
    };

    const listeners = new Map<string, Function[]>();
    const childEventBus = {
      emit: vi.fn((channel: string, data: any) => {
        if (channel === 'memory:invocation:bind:v1') {
          capturedBindRequest = data;
          data.accept(mockLease);
        }
        for (const handler of listeners.get(channel) ?? []) {
          handler(data);
        }
      }),
      on: vi.fn((channel: string, handler: Function) => {
        const list = listeners.get(channel) ?? [];
        list.push(handler);
        listeners.set(channel, list);
        return () => {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        };
      }),
    };

    let registeredExtensionHandlers = new Map<string, Function[]>();
    class MockDefaultResourceLoader {
      options: any;
      reload = vi.fn(async () => undefined);
      constructor(options: any) {
        this.options = options;
        // Run extensionFactories
        for (const ext of options.extensionFactories ?? []) {
          if (ext.name === 'memory-invocation-adapter-v1') {
            ext.factory({
              events: childEventBus,
              on: (event: string, handler: Function) => {
                const list = registeredExtensionHandlers.get(event) ?? [];
                list.push(handler);
                registeredExtensionHandlers.set(event, list);
              },
            });
          }
        }
      }
    }

    const session = {
      messages: [{ role: 'assistant', content: 'all good' }],
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => {
        // Simulate message_start for user
        for (const handler of registeredExtensionHandlers.get('message_start') ?? []) {
          await handler({ message: { role: 'user', content: 'test prompt' } });
        }
      }),
      abort: vi.fn(async () => undefined),
      sessionManager: {
        getSessionId: () => 'child-uuid-123',
        getSessionFile: () => '/tmp/session.jsonl',
        getBranch: () => [],
      },
    };

    const createAgentSession = vi.fn(async () => ({
      session,
      extensionsResult: {
        runtime: {
          createContext: () => ({ cwd: '/workspace', isProjectTrusted: () => true }),
        },
      },
    }));

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      DefaultResourceLoader: MockDefaultResourceLoader,
      createEventBus: () => childEventBus,
      getAgentDir: () => '/agent-dir',
      SessionManager: {
        inMemory: () => session.sessionManager,
        create: async () => session.sessionManager,
      },
      createAgentSession,
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');

    const definition: SubagentDefinition = {
      name: 'worker',
      description: 'worker subagent',
      filePath: '/tmp/worker.md',
      instructions: 'instructions',
      tools: ['read'],
    };
    const config: SubagentsConfig = {
      timeout_ms: 5000,
      stall_timeout_ms: 5000,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: {},
      session_resources: 'lean',
    };

    const result = await sdkSubagentRunner({
      definition,
      task: 'test memory lease task',
      cwd: '/workspace',
      ctx: {
        model: { provider: 'test', id: 'model' },
        sessionManager: { getSessionId: () => 'parent-session-456' },
      },
      config,
      signal: new AbortController().signal,
    });

    expect(result.result).toBe('all good');
    expect(capturedBindRequest).toBeDefined();
    expect(capturedBindRequest.version).toBe(1);
    expect(capturedBindRequest.identity.childSessionId).toBe('child-uuid-123');
    expect(capturedBindRequest.identity.invokingParentSessionId).toBe('parent-session-456');
    expect(activated).toBe(true);
    expect(terminatedWith).toBe('completed');
  });

  it('terminates lease with cancelled when runner signal is aborted', async () => {
    vi.resetModules();

    let terminatedWith: string | undefined = undefined;
    const mockLease = {
      version: 1,
      activate: vi.fn(async () => undefined),
      terminate: vi.fn(async (outcome: string) => {
        terminatedWith = outcome;
      }),
      perform: vi.fn(),
    };

    const childEventBus = {
      emit: vi.fn((channel: string, data: any) => {
        if (channel === 'memory:invocation:bind:v1') {
          data.accept(mockLease);
        }
      }),
      on: vi.fn(() => () => undefined),
    };

    class MockDefaultResourceLoader {
      options: any;
      reload = vi.fn(async () => undefined);
      constructor(options: any) {
        this.options = options;
        for (const ext of options.extensionFactories ?? []) {
          if (ext.name === 'memory-invocation-adapter-v1') {
            ext.factory({
              events: childEventBus,
              on: () => undefined,
            });
          }
        }
      }
    }

    const session = {
      prompt: vi.fn(async () => 'ok'),
      abort: vi.fn(async () => undefined),
      sessionManager: {
        getSessionId: () => 'child-uuid-cancel',
        getSessionFile: () => '/tmp/session.jsonl',
        getBranch: () => [],
      },
    };

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      DefaultResourceLoader: MockDefaultResourceLoader,
      createEventBus: () => childEventBus,
      getAgentDir: () => '/agent-dir',
      SessionManager: { inMemory: () => session.sessionManager },
      createAgentSession: vi.fn(async () => ({
        session,
        extensionsResult: {
          runtime: { createContext: () => ({ cwd: '/workspace', isProjectTrusted: () => true }) },
        },
      })),
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');

    const abortController = new AbortController();
    abortController.abort(); // Pre-aborted

    const definition: SubagentDefinition = {
      name: 'worker',
      description: 'worker subagent',
      filePath: '/tmp/worker.md',
      instructions: 'instructions',
      tools: ['read'],
    };
    const config: SubagentsConfig = {
      timeout_ms: 5000,
      stall_timeout_ms: 5000,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: {},
      session_resources: 'lean',
    };

    await expect(sdkSubagentRunner({
      definition,
      task: 'test abort task',
      cwd: '/workspace',
      ctx: { model: { provider: 'test', id: 'model' } },
      config,
      signal: abortController.signal,
    })).rejects.toThrow('Subagent was aborted');

    expect(terminatedWith).toBe('cancelled');
  });

  it('throws SubagentStructuredError with operation memory.lease.terminate when terminateLease throws', async () => {
    vi.resetModules();

    const mockLease = {
      version: 1,
      activate: vi.fn(async () => undefined),
      terminate: vi.fn(async () => {
        throw new Error('database lock failure during terminal cleanup');
      }),
      perform: vi.fn(),
    };

    const childEventBus = {
      emit: vi.fn((channel: string, data: any) => {
        if (channel === 'memory:invocation:bind:v1') {
          data.accept(mockLease);
        }
      }),
      on: vi.fn(() => () => undefined),
    };

    class MockDefaultResourceLoader {
      options: any;
      reload = vi.fn(async () => undefined);
      constructor(options: any) {
        this.options = options;
        for (const ext of options.extensionFactories ?? []) {
          if (ext.name === 'memory-invocation-adapter-v1') {
            ext.factory({
              events: childEventBus,
              on: () => undefined,
            });
          }
        }
      }
    }

    const session = {
      messages: [{ role: 'assistant', content: 'finished task' }],
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => 'finished task'),
      abort: vi.fn(async () => undefined),
      sessionManager: {
        getSessionId: () => 'child-uuid-err',
        getSessionFile: () => '/tmp/session.jsonl',
        getBranch: () => [],
      },
    };

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      DefaultResourceLoader: MockDefaultResourceLoader,
      createEventBus: () => childEventBus,
      getAgentDir: () => '/agent-dir',
      SessionManager: { inMemory: () => session.sessionManager },
      createAgentSession: vi.fn(async () => ({
        session,
        extensionsResult: {
          runtime: { createContext: () => ({ cwd: '/workspace', isProjectTrusted: () => true }) },
        },
      })),
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');
    const { SubagentStructuredError } = await import('../../src/error-metadata.js');

    const definition: SubagentDefinition = {
      name: 'worker',
      description: 'worker subagent',
      filePath: '/tmp/worker.md',
      instructions: 'instructions',
      tools: ['read'],
    };
    const config: SubagentsConfig = {
      timeout_ms: 5000,
      stall_timeout_ms: 5000,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: {},
      session_resources: 'lean',
    };

    let caughtError: any;
    try {
      await sdkSubagentRunner({
        definition,
        task: 'test throwing cleanup task',
        cwd: '/workspace',
        ctx: { model: { provider: 'test', id: 'model' } },
        config,
        signal: new AbortController().signal,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(SubagentStructuredError);
    expect(caughtError.error_metadata.source?.operation).toBe('memory.lease.terminate');
    expect(caughtError.error_metadata.message).toContain('database lock failure');
  });

  it('preserves child session ID and binds new parent/invocation on continuation', async () => {
    vi.resetModules();

    const bindRequests: any[] = [];
    const mockLease = {
      version: 1,
      activate: vi.fn(async () => undefined),
      terminate: vi.fn(async () => undefined),
      perform: vi.fn(),
    };

    const childEventBus = {
      emit: vi.fn((channel: string, data: any) => {
        if (channel === 'memory:invocation:bind:v1') {
          bindRequests.push(data);
          data.accept(mockLease);
        }
      }),
      on: vi.fn(() => () => undefined),
    };

    class MockDefaultResourceLoader {
      options: any;
      reload = vi.fn(async () => undefined);
      constructor(options: any) {
        this.options = options;
        for (const ext of options.extensionFactories ?? []) {
          if (ext.name === 'memory-invocation-adapter-v1') {
            ext.factory({
              events: childEventBus,
              on: () => undefined,
            });
          }
        }
      }
    }

    const sessionManager = {
      getSessionId: () => 'reopened-child-id',
      getSessionFile: () => '/tmp/nested/session.jsonl',
      getBranch: () => [],
      getCwd: () => '/workspace',
    };

    const session = {
      messages: [{ role: 'assistant', content: 'prior result' }],
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => {
        session.messages.push({ role: 'assistant', content: 'continued result' });
      }),
      abort: vi.fn(async () => undefined),
      sessionManager,
    };

    vi.doMock('@earendil-works/pi-coding-agent', () => ({
      DefaultResourceLoader: MockDefaultResourceLoader,
      createEventBus: () => childEventBus,
      getAgentDir: () => '/agent-dir',
      SessionManager: {
        open: vi.fn(async () => sessionManager),
        inMemory: () => sessionManager,
      },
      createAgentSession: vi.fn(async () => ({
        session,
        extensionsResult: {
          runtime: { createContext: () => ({ cwd: '/workspace', isProjectTrusted: () => true }) },
        },
      })),
    }));

    const { sdkSubagentRunner } = await import('../../src/runner.js');

    const definition: SubagentDefinition = {
      name: 'worker',
      description: 'worker subagent',
      filePath: '/tmp/worker.md',
      instructions: 'instructions',
      tools: ['read'],
    };
    const config: SubagentsConfig = {
      timeout_ms: 5000,
      stall_timeout_ms: 5000,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: {},
      session_resources: 'lean',
    };

    const res = await sdkSubagentRunner({
      definition,
      task: 'continuation task',
      cwd: '/workspace',
      parentPiSessionId: 'second-parent-session-999',
      nested_session_path: '/tmp/nested/session.jsonl',
      continuation: {
        prompt: 'continuation prompt',
        attempt: 2,
      },
      ctx: {
        model: { provider: 'test', id: 'model' },
      },
      config,
      signal: new AbortController().signal,
    });

    expect(res.result).toBe('continued result');
    expect(bindRequests.length).toBe(1);
    const req = bindRequests[0];
    expect(req.identity.childSessionId).toBe('reopened-child-id');
    expect(req.identity.invokingParentSessionId).toBe('second-parent-session-999');
    expect(req.identity.attempt).toBe(2);
    expect(req.identity.invocationId).toBeDefined();
  });
});
