import { describe, expect, it, vi } from 'vitest';

import { TelegramRateLimitError } from '../src/telegram-adapter.js';
import { TelegramOutputRelay } from '../src/output-relay.js';
import { InMemoryTelegramPermissionApprovalStore } from '../src/permission-approval-store.js';
import type { TelegramMessageRef } from '../src/types.js';
import type { PiRpcClient, ActiveBinding } from '../src/types.js';

type FakePiRpcClient = PiRpcClient & {
  emitOutput: (text: string) => void;
  emitStatus: (status: 'completed' | 'failed' | 'cancelled' | 'timeout') => void;
  emitError: (message: string) => void;
};

type TelegramSendCall = {
  chatId: number;
  text: string;
};

function makeFakeTelegramAdapter() {
  const sendCalls: TelegramSendCall[] = [];
  const sendMessage = vi.fn(async (chatId: number, text: string): Promise<TelegramMessageRef> => {
    sendCalls.push({ chatId, text });
    return { chatId, messageId: sendCalls.length };
  });

  const editMessage = vi.fn(async () => undefined);

  return {
    sendCalls,
    sendMessage,
    editMessage,
  };
}

function makeFakeClient(): FakePiRpcClient {
  let listener: (event: any) => void = () => undefined;
  return {
    onEvent: vi.fn((fn: (event: any) => void) => {
      listener = fn;
      return () => {
        listener = () => undefined;
      };
    }),
    emitOutput: (text: string) => listener({ type: 'output', text }),
    emitStatus: (status: 'completed' | 'failed' | 'cancelled' | 'timeout') => {
      listener({ type: 'status', status, text: `${status} done` });
    },
    emitError: (message: string) => {
      listener({ type: 'error', message });
    },
    start: async () => undefined,
    stop: async () => undefined,
    getState: async () => ({ workspaceRoot: '/tmp/test', sessionId: 'session' }),
    newSession: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    prompt: async () => undefined,
    steer: async () => undefined,
    followUp: async () => undefined,
    abort: async () => undefined,
  } as FakePiRpcClient;
}

const binding: ActiveBinding = {
  chatId: 100,
  workspace: {
    id: 'ws',
    label: 'workspace',
    canonicalRoot: '/tmp/workspace',
  },
  sessionId: 'session-id',
  rpcKey: '/tmp/workspace|session-id',
};

describe('TelegramOutputRelay', () => {
  it('delivers output in event order', async () => {
    const adapter = makeFakeTelegramAdapter();
    const relay = new TelegramOutputRelay({
      telegram: adapter as any,
      flushIntervalMs: 0,
      maxTelegramMessageChars: 64,
      maxBufferChars: 1024,
    });

    const client = makeFakeClient();
    relay.attach(100, binding, client);

    client.emitOutput('first ');
    client.emitOutput('second ');
    client.emitOutput('third');

    await relay.flush(100);

    expect(adapter.sendCalls.map((line) => line.text)).toHaveLength(1);
    expect(adapter.sendCalls[0].text).toBe('first second third');
  });

  it('chunks long messages into bounded Telegram-sized chunks', async () => {
    const adapter = makeFakeTelegramAdapter();
    const relay = new TelegramOutputRelay({
      telegram: adapter as any,
      flushIntervalMs: 0,
      maxTelegramMessageChars: 8,
      maxBufferChars: 1024,
    });

    const client = makeFakeClient();
    relay.attach(101, binding, client);

    client.emitOutput('abcdefghij12345');
    await relay.flush(101);

    expect(adapter.sendCalls).toHaveLength(2);
    expect(adapter.sendCalls[0].text).toBe('abcdefgh');
    expect(adapter.sendCalls[1].text).toBe('ij12345');
  });

  it('buffers and retries after rate-limit without dropping output', async () => {
    vi.useFakeTimers();

    const adapter = makeFakeTelegramAdapter();
    const relay = new TelegramOutputRelay({
      telegram: adapter as any,
      flushIntervalMs: 0,
      maxTelegramMessageChars: 80,
      maxBufferChars: 1024,
      rateLimitRetryMultiplier: 1,
    });

    adapter.sendMessage.mockImplementationOnce(async (chatId: number, text: string) => {
      adapter.sendCalls.push({ chatId, text: `[rate limited] ${text}` });
      throw new TelegramRateLimitError('rate limited', '1');
    });

    const client = makeFakeClient();
    relay.attach(102, binding, client);

    client.emitOutput('coalesced text around rate limit');
    const flush = relay.flush(102);

    await vi.advanceTimersByTimeAsync(1100);
    await flush;

    expect(adapter.sendCalls).toHaveLength(2);
    expect(adapter.sendCalls[1].text).toContain('coalesced text around rate limit');
    vi.useRealTimers();
  });

  it('indicates truncation when buffer capacity is exceeded', async () => {
    const adapter = makeFakeTelegramAdapter();
    const relay = new TelegramOutputRelay({
      telegram: adapter as any,
      flushIntervalMs: 0,
      maxTelegramMessageChars: 16,
      maxBufferChars: 10,
    });

    const client = makeFakeClient();
    relay.attach(103, binding, client);

    client.emitOutput('ABCDEFGHIJKLMN');
    await relay.flush(103);

    expect(adapter.sendCalls.length).toBeGreaterThan(0);
    expect(adapter.sendCalls.at(-1)?.text).toContain('truncated');
  });

  it('suppresses completed status messages after delivering final output', async () => {
    const adapter = makeFakeTelegramAdapter();
    const relay = new TelegramOutputRelay({
      telegram: adapter as any,
      flushIntervalMs: 0,
    });

    const client = makeFakeClient();
    relay.attach(104, binding, client);

    client.emitOutput('short output');
    client.emitStatus('completed');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(adapter.sendCalls.map((call) => call.text)).toEqual(['short output']);
  });

  it('renders permission prompts and suppresses raw permission markers from output', async () => {
    const adapter = makeFakeTelegramAdapter();
    const permissionStore = new InMemoryTelegramPermissionApprovalStore();
    const relay = new TelegramOutputRelay({
      telegram: adapter as any,
      flushIntervalMs: 0,
      permissionStore,
    });

    const client = makeFakeClient();
    relay.attach(106, binding, client);

    const listener = (client.onEvent as any).mock.calls[0][0];
    listener({
      type: 'permission_required',
      request: {
        id: 'req-2',
        requestId: 'req-2',
        workspaceRoot: '/tmp/workspace',
        title: 'Permission required for bash',
        message: 'Bash command requires approval.',
        reason: 'approval required',
        reasonCode: 'bash_default_requires_approval',
        riskLevel: 'medium',
        tool: 'bash',
        action: 'bash',
        choices: ['Allow once', 'Deny'],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    client.emitOutput('visible\npermission_required:{"secret":"no"}\nafter');
    await relay.flush(106);

    expect(adapter.sendCalls[0].text).toContain('/approve req-2');
    expect(permissionStore.get(106, binding, 'req-2')?.requestId).toBe('req-2');
    expect(adapter.sendCalls.map((call) => call.text).join('\n')).toContain('visible\nafter');
    expect(adapter.sendCalls.map((call) => call.text).join('\n')).not.toContain('permission_required:');
  });

  it('auto-completes on error events', async () => {
    const adapter = makeFakeTelegramAdapter();
    const relay = new TelegramOutputRelay({
      telegram: adapter as any,
      flushIntervalMs: 0,
    });

    const client = makeFakeClient();
    relay.attach(105, binding, client);

    client.emitOutput('short output');
    client.emitError('oops');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(adapter.sendCalls.at(-1)?.text).toContain('Status: failed');
  });

  it('sends final status messages', async () => {
    const adapter = makeFakeTelegramAdapter();
    const relay = new TelegramOutputRelay({
      telegram: adapter as any,
      flushIntervalMs: 0,
    });

    const client = makeFakeClient();
    relay.attach(104, binding, client);

    client.emitOutput('short output');
    await relay.flush(104);
    await relay.complete(104, 'failed');

    expect(adapter.sendCalls.at(-1)?.text).toContain('failed');
  });
});
