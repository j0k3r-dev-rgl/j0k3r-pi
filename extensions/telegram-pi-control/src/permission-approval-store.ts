import type { ActiveBinding, TelegramApprovalChoice, TelegramPermissionPrompt } from './types.js';

export interface TelegramPermissionApprovalStore {
  upsert(chatId: number, binding: ActiveBinding, request: TelegramPermissionPrompt): void;
  get(chatId: number, binding: ActiveBinding, requestId: string): TelegramPermissionPrompt | undefined;
  list(chatId: number, binding: ActiveBinding): TelegramPermissionPrompt[];
  resolve(
    chatId: number,
    binding: ActiveBinding,
    requestId: string,
    status: 'approved' | 'denied' | 'expired' | 'aborted',
    choice?: TelegramApprovalChoice,
    text?: string,
  ): { ok: true } | { ok: false };
  clearForBinding(chatId: number, binding: ActiveBinding): void;
  clearForChat(chatId: number): void;
  clearExpired(now?: number): void;
}

interface StoredPrompt {
  request: TelegramPermissionPrompt;
}

function bindingKey(chatId: number, binding: ActiveBinding): string {
  return `${chatId}|${binding.rpcKey}`;
}

function isExpired(prompt: TelegramPermissionPrompt, now: number): boolean {
  const expireTime = Date.parse(prompt.expiresAt);
  if (Number.isNaN(expireTime)) return false;
  return expireTime <= now;
}

export class InMemoryTelegramPermissionApprovalStore implements TelegramPermissionApprovalStore {
  private readonly prompts = new Map<string, Map<string, StoredPrompt>>();

  upsert(chatId: number, binding: ActiveBinding, request: TelegramPermissionPrompt): void {
    const key = bindingKey(chatId, binding);
    const byRequest = this.prompts.get(key) ?? new Map<string, StoredPrompt>();
    byRequest.set(request.requestId, { request: { ...request } });
    this.prompts.set(key, byRequest);
  }

  get(chatId: number, binding: ActiveBinding, requestId: string): TelegramPermissionPrompt | undefined {
    const match = this.prompts.get(bindingKey(chatId, binding))?.get(requestId);
    if (!match) {
      return undefined;
    }
    return match.request;
  }

  list(chatId: number, binding: ActiveBinding): TelegramPermissionPrompt[] {
    const now = Date.now();
    const byRequest = this.prompts.get(bindingKey(chatId, binding));
    if (!byRequest) {
      return [];
    }

    return Array.from(byRequest.values())
      .map((entry) => entry.request)
      .filter((request) => !isExpired(request, now));
  }

  resolve(
    chatId: number,
    binding: ActiveBinding,
    requestId: string,
    status: 'approved' | 'denied' | 'expired' | 'aborted',
    choice?: TelegramApprovalChoice,
    text?: string,
  ): { ok: true } | { ok: false } {
    const byRequest = this.prompts.get(bindingKey(chatId, binding));
    if (!byRequest) {
      return { ok: false };
    }

    const current = byRequest.get(requestId);
    if (!current) {
      return { ok: false };
    }

    const request = current.request;
    const resolvedSuffix = status === 'approved'
      ? ' [approved]'
      : status === 'denied'
        ? ' [denied]'
        : status === 'expired'
          ? ' [expired]'
          : ' [aborted]';

    request.message = `${request.message}\nResult: ${resolvedSuffix}${choice ? ` (${choice})` : ''}`;
    if (text) {
      request.message = `${request.message}\n${text}`;
    }

    byRequest.delete(requestId);
    if (byRequest.size === 0) {
      this.prompts.delete(bindingKey(chatId, binding));
    }

    return { ok: true };
  }

  clearForBinding(chatId: number, binding: ActiveBinding): void {
    this.prompts.delete(bindingKey(chatId, binding));
  }

  clearForChat(chatId: number): void {
    for (const key of this.prompts.keys()) {
      if (!key.startsWith(`${chatId}|`)) {
        continue;
      }
      this.prompts.delete(key);
    }
  }

  clearExpired(now: number = Date.now()): void {
    for (const [key, byRequest] of this.prompts.entries()) {
      let changed = false;
      for (const [requestId, entry] of byRequest.entries()) {
        if (isExpired(entry.request, now)) {
          byRequest.delete(requestId);
          changed = true;
        }
      }
      if (byRequest.size === 0 || changed) {
        if (byRequest.size === 0) {
          this.prompts.delete(key);
        }
      }
    }
  }
}
