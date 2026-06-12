import { describe, expect, it, vi } from 'vitest';

import { InMemoryPiRpcProcessManager } from '../src/pi-rpc-process-manager.js';
import type { ActiveBinding, PiRpcClient as PiRpcClientType, PiRpcSessionState } from '../src/types.js';

function fakeClientFactory(stubs: PiRpcClientType[]) {
  const calls: number[] = [];
  let index = 0;

  return {
    calls,
    factory: async () => {
      const stub = stubs[index] ?? stubs[stubs.length - 1];
      index += 1;
      calls.push(index);
      return stub;
    },
  };
}

function createState(root: string, sessionId: string, sessionFile?: string): PiRpcSessionState {
  return {
    workspaceRoot: root,
    sessionId,
    ...(sessionFile ? { sessionFile } : {}),
    running: true,
  };
}

function createClientStub(state: PiRpcSessionState) {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    getState: vi.fn(async () => state),
    newSession: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    prompt: async () => undefined,
    steer: async () => undefined,
    followUp: async () => undefined,
    abort: async () => undefined,
    onEvent: () => () => undefined,
  } as PiRpcClientType;
}

describe('InMemoryPiRpcProcessManager', () => {
  const workspaceA = {
    id: 'ws-a',
    label: 'WS A',
    canonicalRoot: '/tmp/workspace-a',
  };
  const workspaceB = {
    id: 'ws-b',
    label: 'WS B',
    canonicalRoot: '/tmp/workspace-b',
  };

  const bindingA1: ActiveBinding = {
    chatId: 10,
    workspace: workspaceA,
    sessionId: 'session-a1',
    rpcKey: `${workspaceA.canonicalRoot}|session-a1`,
  };

  const bindingA2: ActiveBinding = {
    chatId: 11,
    workspace: workspaceA,
    sessionId: 'session-a2',
    rpcKey: `${workspaceA.canonicalRoot}|session-a2`,
  };

  const bindingB1: ActiveBinding = {
    chatId: 12,
    workspace: workspaceB,
    sessionId: 'session-b1',
    rpcKey: `${workspaceB.canonicalRoot}|session-b1`,
  };

  it('returns keyed singleton clients for identical workspace/session bindings', async () => {
    const stubA1 = createClientStub(createState('/tmp/workspace-a', 'session-a1'));
    const stubA2 = createClientStub(createState('/tmp/workspace-a', 'session-a2'));
    const { factory } = fakeClientFactory([stubA1, stubA2]);

    const manager = new InMemoryPiRpcProcessManager({
      createClient: factory,
    });

    const first = await manager.acquire(bindingA1);
    const second = await manager.acquire(bindingA1);

    expect(first).toBe(second);

    const firstWorkspaceTwo = await manager.acquire(bindingA2);
    const secondWorkspaceTwo = await manager.acquire(bindingA2);

    expect(firstWorkspaceTwo).toBe(secondWorkspaceTwo);
    expect(stubA1.start).toHaveBeenCalledTimes(1);
    expect(stubA2.start).toHaveBeenCalledTimes(1);
  });

  it('restarts identity-mismatched clients before returning a binding', async () => {
    const bad = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getState: vi.fn(async () => createState('/tmp/other-workspace', 'session-old')),
      newSession: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      onEvent: () => () => undefined,
    } as PiRpcClientType;
    const good = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getState: vi.fn(async () => createState('/tmp/workspace-a', 'session-a1')),
      newSession: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      onEvent: () => () => undefined,
    } as PiRpcClientType;

    const { factory, calls } = fakeClientFactory([bad, good]);
    const manager = new InMemoryPiRpcProcessManager({
      createClient: factory,
    });

    const client = await manager.acquire(bindingA1);

    expect(calls).toHaveLength(2);
    expect(client).toBe(good);
    expect(bad.stop).toHaveBeenCalledTimes(1);
  });

  it('restarts when the existing binding session becomes stale', async () => {
    const crashy = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getState: vi.fn(async () => Promise.reject(new Error('stale process'))),
      newSession: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      onEvent: () => () => undefined,
    } as PiRpcClientType;

    const fresh = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getState: vi.fn(async () => createState('/tmp/workspace-b', 'session-b1')),
      newSession: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      onEvent: () => () => undefined,
    } as PiRpcClientType;

    const { factory, calls } = fakeClientFactory([crashy, fresh]);
    const manager = new InMemoryPiRpcProcessManager({
      createClient: factory,
    });

    const first = await manager.acquire(bindingB1);
    expect(calls).toHaveLength(2);
    const second = await manager.acquire(bindingB1);
    expect(calls).toHaveLength(2);
    expect(first).toBe(second);
    expect(crashy.stop).toHaveBeenCalledTimes(1);
    expect(fresh.start).toHaveBeenCalledTimes(1);
  });

  it('rejects an existing client for mismatched session id', async () => {
    const stale = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getState: vi.fn(async () => createState('/tmp/workspace-a', 'session-old', 'old-file.sv')), 
      newSession: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      onEvent: () => () => undefined,
    } as PiRpcClientType;

    const fresh = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getState: vi.fn(async () => createState('/tmp/workspace-a', 'session-a1', 'session-a1.sv')),
      newSession: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      onEvent: () => () => undefined,
    } as PiRpcClientType;

    const { factory, calls } = fakeClientFactory([stale, fresh]);
    const manager = new InMemoryPiRpcProcessManager({
      createClient: factory,
    });

    const bindingWithDifferentSession: ActiveBinding = {
      ...bindingA1,
      sessionFile: 'session-a1.sv',
    };

    const first = await manager.acquire(bindingWithDifferentSession);

    expect(calls).toHaveLength(2);
    expect(first).toBe(fresh);
    expect(stale.stop).toHaveBeenCalledTimes(1);
  });

  it('switches a new client to the bound session file before identity validation', async () => {
    const client = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getState: vi.fn(async () => createState('/tmp/workspace-a', 'other-session', 'other.sv')),
      newSession: async () => ({ cancelled: false }),
      switchSession: vi.fn(async () => ({ cancelled: false })),
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      onEvent: () => () => undefined,
    } as PiRpcClientType;

    client.switchSession = vi.fn(async (sessionFile: string) => {
      client.getState = vi.fn(async () => createState('/tmp/workspace-a', 'session-a1', sessionFile));
      return { cancelled: false };
    });

    const manager = new InMemoryPiRpcProcessManager({ createClient: async () => client });

    const matched = await manager.acquire({
      ...bindingA1,
      sessionFile: 'session-a1.sv',
    });

    expect(matched).toBe(client);
    expect(client.switchSession).toHaveBeenCalledWith('session-a1.sv');
  });

  it('accepts matching session file even when runtime session id changes after switch', async () => {
    const good = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getState: vi.fn(async () => createState('/tmp/workspace-a', 'runtime-session-id', 'session-a1.sv')),
      newSession: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      onEvent: () => () => undefined,
    } as PiRpcClientType;

    const manager = new InMemoryPiRpcProcessManager({ createClient: async () => good });
    const matched = await manager.acquire({
      ...bindingA1,
      sessionId: 'stored-session-id',
      sessionFile: 'session-a1.sv',
    });

    expect(matched).toBe(good);
  });

  it('accepts a matching session file for binding identity', async () => {
    const good = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getState: vi.fn(async () => createState('/tmp/workspace-a', 'session-a1', 'session-a1.sv')),
      newSession: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      onEvent: () => () => undefined,
    } as PiRpcClientType;

    const { factory, calls } = fakeClientFactory([good]);
    const manager = new InMemoryPiRpcProcessManager({
      createClient: factory,
    });

    const matched = await manager.acquire({
      ...bindingA1,
      sessionFile: 'session-a1.sv',
    });

    expect(calls).toHaveLength(1);
    expect(matched).toBe(good);
  });

  it('emits lifecycle events when callback is provided', async () => {
    const onLifecycle = vi.fn();
    const client = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getState: vi.fn(async () => createState('/tmp/workspace-a', 'session-a1', 'session-a1.sv')),
      newSession: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      onEvent: () => () => undefined,
    } as PiRpcClientType;

    const manager = new InMemoryPiRpcProcessManager({
      createClient: async () => client,
      onLifecycle,
    });

    await manager.acquire(bindingA1);
    await manager.stop(bindingA1);

    expect(onLifecycle).toHaveBeenCalledWith(expect.objectContaining({ event: 'spawned' }));
    expect(onLifecycle).toHaveBeenCalledWith(expect.objectContaining({ event: 'stopped' }));
  });
});
