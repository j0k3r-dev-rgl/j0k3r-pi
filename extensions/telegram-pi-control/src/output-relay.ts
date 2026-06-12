import type {
  ActiveBinding,
  OutputRelay as OutputRelayContract,
  PiRpcClient,
  PiRpcEvent,
  TelegramAdapter,
  TelegramApprovalChoice,
  TelegramPermissionPrompt,
} from './types.js';
import type { TelegramPermissionApprovalStore } from './permission-approval-store.js';
import { TelegramRateLimitError } from './telegram-adapter.js';

export interface OutputRelayOptions {
  telegram: TelegramAdapter;
  maxTelegramMessageChars?: number;
  flushIntervalMs?: number;
  maxBufferChars?: number;
  maxPermissionPromptChars?: number;
  rateLimitRetryMultiplier?: number;
  permissionStore?: TelegramPermissionApprovalStore;
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
  private readonly maxPermissionPromptChars: number;
  private readonly rateLimitRetryMultiplier: number;
  private readonly permissionStore?: TelegramPermissionApprovalStore;

  private readonly streams = new Map<number, StreamState>();
  private readonly unsubscribers = new Map<number, Array<() => void>>();
  private readonly activeBindings = new Map<number, ActiveBinding>();

  constructor(options: OutputRelayOptions) {
    this.telegram = options.telegram;
    this.maxTelegramMessageChars = options.maxTelegramMessageChars ?? 3900;
    this.flushIntervalMs = options.flushIntervalMs ?? 400;
    this.maxBufferChars = options.maxBufferChars ?? 20_000;
    this.maxPermissionPromptChars = options.maxPermissionPromptChars ?? 1800;
    this.rateLimitRetryMultiplier = options.rateLimitRetryMultiplier ?? 1;
    this.permissionStore = options.permissionStore;
  }

  attach(chatId: number, binding: ActiveBinding, client: PiRpcClient): () => void {
    this.activeBindings.set(chatId, binding);
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
      this.activeBindings.delete(chatId);
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
    const permissionRequired = this.asPermissionRequiredEvent(event);
    if (permissionRequired) {
      const binding = this.activeBindings.get(chatId);
      if (!binding || !this.permissionStore) {
        return;
      }
      this.permissionStore.upsert(chatId, binding, permissionRequired.request);
      void this.sendPermissionPrompt(chatId, permissionRequired.request);
      return;
    }

    const permissionResolved = this.asPermissionResolvedEvent(event);
    if (permissionResolved) {
      const binding = this.activeBindings.get(chatId);
      if (!binding || !this.permissionStore) {
        return;
      }
      this.permissionStore.resolve(
        chatId,
        binding,
        permissionResolved.requestId,
        permissionResolved.status,
        permissionResolved.choice,
        permissionResolved.text,
      );
      return;
    }

    if (event.type === 'output') {
      const text = typeof event.text === 'string' ? this.sanitizeOutputText(event.text) : '';
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

    const binding = this.activeBindings.get(chatId);
    if (binding && this.permissionStore) {
      this.permissionStore.clearForBinding(chatId, binding);
    }

    void this.complete(chatId, status).catch(() => undefined);
  }

  private asPermissionRequiredEvent(event: PiRpcEvent): { type: 'permission_required'; request: TelegramPermissionPrompt } | undefined {
    if (event.type !== 'permission_required') {
      return undefined;
    }

    if (!event.request || typeof event.request !== 'object') {
      return undefined;
    }

    return event as { type: 'permission_required'; request: TelegramPermissionPrompt };
  }

  private asPermissionResolvedEvent(event: PiRpcEvent):
    | ({ type: 'permission_resolved'; requestId: string; status: 'approved' | 'denied' | 'expired' | 'aborted'; choice?: TelegramApprovalChoice; text?: string })
    | undefined {
    if (event.type !== 'permission_resolved') {
      return undefined;
    }

    if (typeof (event as { requestId?: unknown }).requestId !== 'string') {
      return undefined;
    }

    return event as {
      type: 'permission_resolved';
      requestId: string;
      status: 'approved' | 'denied' | 'expired' | 'aborted';
      choice?: 'Allow once' | 'Allow for session' | 'Allow for project' | 'Allow this file for project' | 'Allow this folder for project' | 'Deny';
      text?: string;
    };
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

  private async sendPermissionPrompt(chatId: number, request: TelegramPermissionPrompt): Promise<void> {
    const title = request.title ? `${request.title}\n\n` : '';
    const safeSummary = this.truncateText(request.message, this.maxPermissionPromptChars);
    const choicesLine = request.choices.join(' | ');
    const commandLine = `Reply: /approve ${request.requestId} [once|session|project|file|folder] or /deny ${request.requestId}`;
    const markerLine = `${request.requestId} • expires at ${new Date(request.expiresAt).toLocaleString()}`;
    const text = `${title}${safeSummary}\n\n${choicesLine}\n${commandLine}\n${markerLine}`.trim();

    await this.telegram.sendMessage(chatId, text);
  }

  private sanitizeOutputText(raw: string): string {
    const marker = 'permission_required:';
    if (!raw.includes(marker)) {
      return raw;
    }

    return raw
      .split('\n')
      .filter((line) => !line.includes('permission_required:'))
      .join('\n');
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength)}...`;
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
