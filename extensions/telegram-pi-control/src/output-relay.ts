import type {
  ActiveBinding,
  OutputRelay as OutputRelayContract,
  PiRpcClient,
  PiRpcEvent,
  TelegramAdapter,
} from './types.js';
import { TelegramRateLimitError } from './telegram-adapter.js';

export interface OutputRelayOptions {
  telegram: TelegramAdapter;
  maxTelegramMessageChars?: number;
  flushIntervalMs?: number;
  maxBufferChars?: number;
  rateLimitRetryMultiplier?: number;
}

interface StreamState {
  buffer: string;
  truncated: boolean;
  flushTimer?: ReturnType<typeof setTimeout>;
  inFlight: boolean;
  completed: boolean;
}

export class TelegramOutputRelay implements OutputRelayContract {
  private readonly telegram: TelegramAdapter;
  private readonly maxTelegramMessageChars: number;
  private readonly flushIntervalMs: number;
  private readonly maxBufferChars: number;
  private readonly rateLimitRetryMultiplier: number;

  private readonly streams = new Map<number, StreamState>();
  private readonly unsubscribers = new Map<number, Array<() => void>>();

  constructor(options: OutputRelayOptions) {
    this.telegram = options.telegram;
    this.maxTelegramMessageChars = options.maxTelegramMessageChars ?? 3900;
    this.flushIntervalMs = options.flushIntervalMs ?? 400;
    this.maxBufferChars = options.maxBufferChars ?? 20_000;
    this.rateLimitRetryMultiplier = options.rateLimitRetryMultiplier ?? 1;
  }

  attach(chatId: number, _binding: ActiveBinding, client: PiRpcClient): () => void {
    this.streams.set(chatId, {
      buffer: '',
      truncated: false,
      inFlight: false,
      completed: false,
    });

    const unsubscribe = client.onEvent((event) => this.handleEvent(chatId, event));
    const existing = this.unsubscribers.get(chatId) ?? [];
    const withNew = [...existing, unsubscribe];
    this.unsubscribers.set(chatId, withNew);

    return () => {
      for (const cleanup of withNew) {
        cleanup();
      }
      this.unsubscribers.delete(chatId);
      this.streams.delete(chatId);
    };
  }

  async flush(chatId: number): Promise<void> {
    const state = this.streams.get(chatId);
    if (!state || state.inFlight) {
      return;
    }

    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = undefined;
    }

    if (!state.buffer) {
      return;
    }

    state.inFlight = true;
    const chunk = state.buffer;
    state.buffer = '';

    const payload = chunk + (state.truncated ? '\n[output truncated]' : '');
    state.truncated = false;

    try {
      await this.sendBounded(chatId, payload);
    } catch (error) {
      state.buffer = chunk;
      state.truncated = payload.includes('output truncated') || state.truncated;
      if (error instanceof TelegramRateLimitError) {
        const retryAfter = Number.parseInt(error.retryAfter ?? '1', 10);
        const delaySeconds = Number.isFinite(retryAfter) ? retryAfter : 1;
        const waitMs = delaySeconds * 1000 * this.rateLimitRetryMultiplier;
        state.buffer = payload;
        state.flushTimer = setTimeout(() => {
          this.flush(chatId).catch(() => undefined);
        }, waitMs);
      } else {
        state.buffer = payload;
      }
    } finally {
      state.inFlight = false;
      if (state.buffer && !state.flushTimer) {
        const next = state.buffer;
        if (next.length > 0) {
          state.flushTimer = setTimeout(() => {
            this.flush(chatId).catch(() => undefined);
          }, this.flushIntervalMs);
        }
      }
    }
  }

  async complete(chatId: number, status: 'completed' | 'failed' | 'cancelled' | 'timeout'): Promise<void> {
    await this.flush(chatId);
    const text = this.statusText(status);
    if (text) {
      await this.telegram.sendMessage(chatId, text);
    }
  }

  private handleEvent(chatId: number, event: PiRpcEvent): void {
    if (event.type === 'output') {
      const text = typeof event.text === 'string' ? event.text : '';
      if (!text) {
        return;
      }
      this.append(chatId, text);
      return;
    }

    if (event.type === 'status') {
      if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
        this.completeIfNeeded(chatId, event.status);
      }
      return;
    }

    if (event.type === 'state') {
      return;
    }

    if (event.type === 'error') {
      this.completeIfNeeded(chatId, 'failed');
    }
  }

  private completeIfNeeded(chatId: number, status: 'completed' | 'failed' | 'cancelled'): void {
    const state = this.streams.get(chatId);
    if (!state || state.completed) {
      return;
    }

    state.completed = true;
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = undefined;
    }

    void this.complete(chatId, status).catch(() => undefined);
  }

  private append(chatId: number, text: string): void {
    const state = this.streams.get(chatId);
    if (!state) return;

    const next = state.buffer + text;
    if (next.length <= this.maxBufferChars) {
      state.buffer = next;
    } else {
      state.buffer = next.slice(next.length - this.maxBufferChars);
      state.truncated = true;
    }

    if (!state.flushTimer) {
      state.flushTimer = setTimeout(() => {
        state.flushTimer = undefined;
        void this.flush(chatId);
      }, this.flushIntervalMs);
    }
  }

  private async sendBounded(chatId: number, text: string): Promise<void> {
    const chunks: string[] = [];
    if (text.length === 0) return;

    const effectiveChunkSize = Math.max(1, this.maxTelegramMessageChars);
    for (let offset = 0; offset < text.length; offset += effectiveChunkSize) {
      chunks.push(text.slice(offset, offset + effectiveChunkSize));
    }

    for (const chunk of chunks) {
      await this.telegram.sendMessage(chatId, chunk);
    }
  }

  private statusText(status: 'completed' | 'failed' | 'cancelled' | 'timeout'): string {
    switch (status) {
      case 'completed':
        return '';
      case 'failed':
        return 'Status: failed';
      case 'cancelled':
        return 'Status: cancelled';
      case 'timeout':
      default:
        return 'Status: timeout';
    }
  }
}
