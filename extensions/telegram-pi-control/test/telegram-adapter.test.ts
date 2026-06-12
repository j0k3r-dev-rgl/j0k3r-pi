import { describe, expect, it, vi } from 'vitest';
import type { TelegramUpdate } from '../src/types.js';
import { TelegramLongPollingAdapter, TelegramRateLimitError } from '../src/telegram-adapter.js';

type FetchResponse = {
  status: number;
  ok: boolean;
  headers?: { get: (name: string) => string | null };
  json: () => Promise<any>;
};

type FetchCall = {
  method: string;
  endpoint: string;
  body: string | undefined;
};

describe('telegram adapter transport', () => {
  it('fetches getUpdates with advancing offsets and processes mocked updates', async () => {
    const calls: FetchCall[] = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 5,
        message: {
          message_id: 11,
          date: 100,
          text: '/start',
          chat: { id: 10, type: 'private' },
          from: { id: 3 },
        },
      },
      {
        update_id: 6,
        message: {
          message_id: 12,
          date: 101,
          text: '/status',
          chat: { id: 10, type: 'private' },
          from: { id: 3 },
        },
      },
      {
        update_id: 7,
        message: {
          message_id: 13,
          date: 102,
          text: '/workspaces',
          chat: { id: 10, type: 'private' },
          from: { id: 3 },
        },
      },
    ];
    let callIndex = 0;
    const queue: Array<FetchResponse> = [
      {
        status: 200,
        ok: true,
        json: async () => ({ ok: true, result: [updates[0]] }),
      },
      {
        status: 200,
        ok: true,
        json: async () => ({ ok: true, result: [updates[1], updates[2]] }),
      },
      {
        status: 200,
        ok: true,
        json: async () => ({ ok: true, result: [] }),
      },
    ];

    const fetcher = vi.fn(async (url: string, options?: { method?: string; body?: string }) => {
      calls.push({
        method: options?.method ?? 'GET',
        endpoint: url,
        body: options?.body,
      });
      const response = queue[callIndex] ?? queue[queue.length - 1];
      callIndex += 1;
      return response;
    });

    const seenUpdateIds: number[] = [];
    const adapter = new TelegramLongPollingAdapter({
      token: 'test-token',
      polling: {
        timeoutSeconds: 1,
        limit: 100,
      },
      fetcher,
      pollIntervalMs: 0,
      maxPolls: 3,
    });

    await adapter.start(async (update) => {
      seenUpdateIds.push(update.update_id);
    });

    expect(seenUpdateIds).toEqual([5, 6, 7]);
    expect(calls).toHaveLength(3);
    expect(calls[0].endpoint).toContain('getUpdates?offset=0&timeout=1&limit=100');
    expect(calls[1].endpoint).toContain('getUpdates?offset=6&timeout=1&limit=100');
    expect(calls[2].endpoint).toContain('getUpdates?offset=8&timeout=1&limit=100');
  });

  it('sends and edits messages with mocked responses', async () => {
    const callBodies: string[] = [];
    const fetcher = vi.fn(async (_url: string, options?: { method?: string; body?: string }) => {
      if (options?.body) callBodies.push(options.body);
      const parsed = JSON.parse(options?.body ?? '{}');
      if (parsed.chat_id && parsed.text && !parsed.message_id) {
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            ok: true,
            result: {
              message_id: 42,
              chat: { id: parsed.chat_id },
            },
          }),
        };
      }
      if (parsed.chat_id && parsed.message_id && parsed.text) {
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ ok: true, result: true }),
        };
      }
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ ok: true, result: [] }) };
    });

    const adapter = new TelegramLongPollingAdapter({ token: 'test-token', fetcher, pollIntervalMs: 0, maxPolls: 1 });

    const sent = await adapter.sendMessage(11, 'hello', { parseMode: 'HTML' });
    await adapter.editMessage({ chatId: 11, messageId: 42 }, 'edited');

    expect(sent.messageId).toBe(42);
    expect(sent.chatId).toBe(11);
    expect(callBodies).toHaveLength(2);
    expect(callBodies[0]).toContain('"chat_id":11');
    expect(callBodies[1]).toContain('"message_id":42');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('registers bot commands with Telegram setMyCommands', async () => {
    const calls: FetchCall[] = [];
    const fetcher = vi.fn(async (url: string, options?: { method?: string; body?: string }) => {
      calls.push({
        method: options?.method ?? 'GET',
        endpoint: url,
        body: options?.body,
      });
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({ ok: true, result: true }),
      };
    });

    const adapter = new TelegramLongPollingAdapter({ token: 'test-token', fetcher, pollIntervalMs: 0, maxPolls: 1 });

    await adapter.setMyCommands([
      { command: 'workspaces', description: 'List workspaces' },
      { command: 'approve', description: 'Approve permission' },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toContain('/setMyCommands');
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      commands: [
        { command: 'workspaces', description: 'List workspaces' },
        { command: 'approve', description: 'Approve permission' },
      ],
    });
  });

  it('throws structured rate-limit errors from polling', async () => {
    const fetcher = vi.fn(async () => ({
      status: 429,
      ok: false,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'retry-after' ? '30' : null),
      },
      json: async () => ({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
      }),
    }));

    const adapter = new TelegramLongPollingAdapter({
      token: 'test-token',
      fetcher,
      pollIntervalMs: 0,
      maxPolls: 1,
    });

    await expect(adapter.start(async () => undefined)).rejects.toBeInstanceOf(TelegramRateLimitError);
    await expect(adapter.start(async () => undefined)).rejects.toThrow('retry-after=30');
  });
});
