import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';

import type {
  TelegramAdapter,
  TelegramEditOptions,
  TelegramBotCommand,
  TelegramMessage,
  TelegramMessageRef,
  TelegramSendOptions,
  TelegramUpdate,
  TelegramApiResponse,
} from './types.js';

const DEFAULT_POLLING_TIMEOUT_SECONDS = 30;
const DEFAULT_POLLING_LIMIT = 100;

export interface TelegramRateLimitContext {
  status: number;
  retryAfter?: string;
}

export class TelegramRateLimitError extends Error implements TelegramRateLimitContext {
  status: number;
  retryAfter?: string;

  constructor(message: string, retryAfter?: string, status = 429) {
    super(message);
    this.name = 'TelegramRateLimitError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

interface TelegramGetUpdatesPayload {
  offset?: number;
  timeout?: number;
  limit?: number;
}

interface PollingOptions {
  timeoutSeconds?: number;
  limit?: number;
}

interface TelegramHttpResponse {
  ok: boolean;
  status: number;
  headers?: {
    get: (name: string) => string | null;
  };
  json: () => Promise<unknown>;
}

type TelegramFetcher = (input: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<TelegramHttpResponse>;

function createNodeHttpsFetcher(): TelegramFetcher {
  return async (input, init = {}) => new Promise<TelegramHttpResponse>((resolve, reject) => {
    const url = new URL(input);
    const body = init.body;
    const request = httpsRequest(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      family: 4,
      timeout: 60_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
          status: response.statusCode ?? 0,
          headers: {
            get: (name: string) => {
              const value = response.headers[name.toLowerCase()];
              if (Array.isArray(value)) return value.join(', ');
              return value ?? null;
            },
          },
          json: async () => JSON.parse(text),
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`Telegram API request timed out: ${url.hostname}`));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

export interface TelegramAdapterOptions {
  token: string;
  baseUrl?: string;
  polling?: PollingOptions;
  fetcher?: TelegramFetcher;
  pollIntervalMs?: number;
  maxPolls?: number;
  initialOffset?: number;
}

export class TelegramLongPollingAdapter implements TelegramAdapter {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetcher: TelegramFetcher;
  private readonly timeoutSeconds: number;
  private readonly limit: number;
  private readonly pollIntervalMs: number;
  private readonly maxPolls?: number;

  private running = false;
  private currentOffset = 0;
  private stopped = false;

  constructor(options: TelegramAdapterOptions) {
    if (!options.token) {
      throw new Error('A Telegram bot token is required to create adapter.');
    }

    this.token = options.token;
    this.baseUrl = options.baseUrl ?? 'https://api.telegram.org';
    this.fetcher = options.fetcher ?? createNodeHttpsFetcher();
    this.timeoutSeconds = options.polling?.timeoutSeconds ?? DEFAULT_POLLING_TIMEOUT_SECONDS;
    this.limit = options.polling?.limit ?? DEFAULT_POLLING_LIMIT;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.maxPolls = options.maxPolls;
    this.currentOffset = options.initialOffset ?? 0;
  }

  get offset() {
    return this.currentOffset;
  }

  set offset(value: number) {
    this.currentOffset = Number.isFinite(value) ? value : 0;
  }

  async start(handler: (update: TelegramUpdate) => Promise<void>): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopped = false;

    let polls = 0;

    try {
      while (this.running && !this.stopped) {
        await this.pollOnce(handler);
        polls += 1;
        if (this.maxPolls !== undefined && polls >= this.maxPolls) {
          break;
        }
        if (this.running) {
          await delay(this.pollIntervalMs);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopped = true;
    await delay(0);
  }

  async sendMessage(chatId: number, text: string, opts: TelegramSendOptions = {}): Promise<TelegramMessageRef> {
    const payload = {
      chat_id: chatId,
      text,
      ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
      ...(typeof opts.disableNotification === 'boolean' ? { disable_notification: opts.disableNotification } : {}),
    };

    const message = await this.request<TelegramMessage>('sendMessage', payload);
    return {
      chatId: message.chat.id,
      messageId: message.message_id,
    };
  }

  async editMessage(ref: TelegramMessageRef, text: string, opts: TelegramEditOptions = {}): Promise<void> {
    await this.request<TelegramMessage | boolean>('editMessageText', {
      chat_id: ref.chatId,
      message_id: ref.messageId,
      text,
      ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
    });
  }

  async setMyCommands(commands: TelegramBotCommand[]): Promise<void> {
    await this.request<boolean>('setMyCommands', { commands });
  }

  private async pollOnce(handler: (update: TelegramUpdate) => Promise<void>): Promise<void> {
    const response = await this.request<TelegramUpdate[]>('getUpdates', {
      offset: this.currentOffset,
      timeout: this.timeoutSeconds,
      limit: this.limit,
    }, true);

    if (!Array.isArray(response)) {
      throw new Error('Telegram getUpdates response missing result array.');
    }

    for (const update of response) {
      await handler(update);
      this.currentOffset = Math.max(this.currentOffset, update.update_id + 1);
    }
  }

  private async request<T>(
    method: 'getUpdates' | 'sendMessage' | 'editMessageText' | 'setMyCommands',
    payload: Record<string, unknown>,
    includeOffset = false,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/bot${this.token}/${method}`);
    let body: string | undefined;

    if (method === 'getUpdates') {
      if (!includeOffset || typeof payload.offset !== 'number') {
        payload = { ...payload };
      }
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined) continue;
        params.set(key, String(value));
      }
      url.search = params.toString();
    } else {
      body = JSON.stringify(payload);
    }

    const response = await this.fetcher(url.toString(), {
      method: 'POST',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body } : {}),
    });

    if (response.status === 429) {
      const retryAfter = response.headers?.get?.('retry-after') ?? undefined;
      throw new TelegramRateLimitError(`Telegram returned 429 Too Many Requests; retry-after=${retryAfter ?? 'unknown'}`, retryAfter);
    }

    if (!response.ok) {
      throw new Error(`Telegram API request failed with status ${response.status}`);
    }

    const data = await response.json() as TelegramApiResponse<T>;
    if (!data.ok) {
      throw new Error(`Telegram API request failed: ${data.description ?? 'unknown error'}`);
    }

    return data.result as T;
  }
}
