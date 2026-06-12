import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { PiSdkClient, type PiSdkRuntimeLike, type PiSdkSessionLike } from '../src/pi-sdk-client.js';

function makeSession(overrides: Partial<PiSdkSessionLike> = {}) {
  const emitter = new EventEmitter();
  const session: PiSdkSessionLike & { emitEvent: (event: any) => void } = {
    sessionFile: '/tmp/session-a.jsonl',
    sessionId: 'session-a',
    isStreaming: false,
    prompt: vi.fn(async () => undefined),
    steer: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(() => undefined),
    bindExtensions: vi.fn(async () => undefined),
    subscribe: vi.fn((listener: (event: any) => void) => {
      emitter.on('event', listener);
      return () => emitter.off('event', listener);
    }),
    emitEvent: (event: any) => emitter.emit('event', event),
    ...overrides,
  };
  return session;
}

function makeRuntime(initial = makeSession()) {
  const runtime: PiSdkRuntimeLike & { setSession: (session: PiSdkSessionLike) => void } = {
    cwd: '/tmp/ws',
    services: { cwd: '/tmp/ws' },
    session: initial,
    newSession: vi.fn(async () => {
      runtime.session = makeSession({ sessionFile: '/tmp/session-new.jsonl', sessionId: 'session-new' });
      return { cancelled: false };
    }),
    switchSession: vi.fn(async (sessionPath: string) => {
      runtime.session = makeSession({ sessionFile: sessionPath, sessionId: 'session-switched' });
      return { cancelled: false };
    }),
    dispose: vi.fn(async () => undefined),
    setSession: (session) => {
      runtime.session = session;
    },
  };
  return runtime;
}

describe('PiSdkClient', () => {
  it('maps SDK text deltas to output events and agent_end to completed status', async () => {
    const session = makeSession();
    const runtime = makeRuntime(session);
    const client = new PiSdkClient({ workspaceRoot: '/tmp/ws', runtimeFactory: async () => runtime });

    const events: Array<{ type: string; text?: string; status?: string }> = [];
    client.onEvent((event) => {
      if (event.type === 'output') events.push({ type: event.type, text: String(event.text) });
      if (event.type === 'status') events.push({ type: event.type, status: String(event.status) });
    });

    await client.start();
    session.emitEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'smoke' } });
    session.emitEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ' ok' } });
    session.emitEvent({ type: 'agent_end' });

    expect(events).toEqual([
      { type: 'output', text: 'smoke' },
      { type: 'output', text: ' ok' },
      { type: 'status', status: 'completed' },
    ]);
  });

  it('delegates prompt, steer, followup, and abort to the active SDK session', async () => {
    const session = makeSession();
    const runtime = makeRuntime(session);
    const client = new PiSdkClient({ workspaceRoot: '/tmp/ws', runtimeFactory: async () => runtime });
    await client.start();

    await client.prompt('hello');
    await client.steer('adjust');
    await client.followUp('later');
    await client.abort();

    expect(session.prompt).toHaveBeenCalledWith('hello');
    expect(session.steer).toHaveBeenCalledWith('adjust');
    expect(session.followUp).toHaveBeenCalledWith('later');
    expect(session.abort).toHaveBeenCalledOnce();
  });

  it('rebinds subscriptions after newSession and switchSession', async () => {
    const first = makeSession();
    const runtime = makeRuntime(first);
    const client = new PiSdkClient({ workspaceRoot: '/tmp/ws', runtimeFactory: async () => runtime });
    await client.start();

    await expect(client.newSession()).resolves.toEqual({ cancelled: false });
    expect(await client.getState()).toMatchObject({ sessionFile: '/tmp/session-new.jsonl', sessionId: 'session-new' });

    await expect(client.switchSession('/tmp/existing.jsonl')).resolves.toEqual({ cancelled: false });
    expect(runtime.switchSession).toHaveBeenCalledWith('/tmp/existing.jsonl', { cwdOverride: '/tmp/ws' });
    expect(await client.getState()).toMatchObject({ sessionFile: '/tmp/existing.jsonl', sessionId: 'session-switched' });
  });

  it('emits permission_required events and resolves answers back to the SDK approval hook', async () => {
    const session = makeSession();
    const runtime = makeRuntime(session);
    const client = new PiSdkClient({ workspaceRoot: '/tmp/ws', runtimeFactory: async () => runtime });
    const events: any[] = [];
    client.onEvent((event) => events.push(event));

    await client.start();
    const bindOptions = (session.bindExtensions as any).mock.calls.at(-1)?.[0];
    const approvalPromise = bindOptions.uiContext.requestPermissionApproval({
      requestId: 'req-sdk',
      reason: 'approval required',
      reasonCode: 'bash_default_requires_approval',
      riskLevel: 'medium',
      tool: 'bash',
      action: 'bash',
      prompt: {
        title: 'Permission required for bash',
        message: 'Bash command requires approval.',
        choices: ['Allow once', 'Deny'],
        workspaceRoot: '/tmp/ws',
      },
    });

    expect(events.find((event) => event.type === 'permission_required')).toMatchObject({
      request: {
        requestId: 'req-sdk',
        workspaceRoot: '/tmp/ws',
        choices: ['Allow once', 'Deny'],
      },
    });

    await expect(client.answerPermission('req-sdk', 'Allow once')).resolves.toEqual({
      ok: true,
      requestId: 'req-sdk',
      choice: 'Allow once',
    });
    await expect(approvalPromise).resolves.toBe('Allow once');
    expect(events.find((event) => event.type === 'permission_resolved')).toMatchObject({
      requestId: 'req-sdk',
      status: 'approved',
      choice: 'Allow once',
    });
  });

  it('creates default SDK sessions with the selected workspace as cwd', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'telegram-control-sdk-workspace-'));
    const agentDir = await mkdtemp(join(tmpdir(), 'telegram-control-sdk-agent-'));
    const client = new PiSdkClient({ workspaceRoot, agentDir });

    await client.start();
    const state = await client.getState();
    const runtime = (client as unknown as { runtime: PiSdkRuntimeLike }).runtime;
    const header = (runtime.session as any).sessionManager?.fileEntries?.[0] as { cwd?: string } | undefined;

    expect(state.workspaceRoot).toBe(workspaceRoot);
    expect(runtime.cwd).toBe(workspaceRoot);
    expect(runtime.services?.cwd).toBe(workspaceRoot);
    expect(header?.cwd).toBe(workspaceRoot);

    await client.newSession();
    const nextHeader = (runtime.session as any).sessionManager?.fileEntries?.[0] as { cwd?: string } | undefined;
    expect(nextHeader?.cwd).toBe(workspaceRoot);

    await client.stop();
  });

  it('disposes the SDK runtime on stop', async () => {
    const runtime = makeRuntime();
    const client = new PiSdkClient({ workspaceRoot: '/tmp/ws', runtimeFactory: async () => runtime });
    await client.start();
    await client.stop();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});
