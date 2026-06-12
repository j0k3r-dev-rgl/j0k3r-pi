import type {
  AuthDecision,
  AuthorizationPolicy,
  TelegramControlConfig,
  TelegramIdentity,
  TelegramUpdate,
} from './types.js';

const GENERIC_DENIAL_MESSAGE = 'Authorization failed. Access is denied.';

export class TelegramAuthorizer implements AuthorizationPolicy {
  private readonly allowedUserIds: number[];
  private readonly allowedChatIds: number[];

  constructor(config: TelegramControlConfig) {
    this.allowedUserIds = config.telegram.allowedUserIds ?? [];
    this.allowedChatIds = config.telegram.allowedChatIds ?? [];
  }

  authorize(update: TelegramUpdate): AuthDecision {
    const identity = extractIdentity(update);
    if (!identity) {
      return { ok: false, reason: 'invalid_update' };
    }

    if (!Array.isArray(this.allowedUserIds) || this.allowedUserIds.length === 0) {
      return { ok: false, reason: 'missing_allowlist' };
    }

    if (!this.allowedUserIds.includes(identity.userId)) {
      return { ok: false, reason: 'user_denied' };
    }

    if (needsChatAllowlist(identity.chatType) && this.allowedChatIds.length > 0) {
      if (!this.allowedChatIds.includes(identity.chatId)) {
        return { ok: false, reason: 'chat_denied' };
      }
    }

    if (needsChatAllowlist(identity.chatType) && this.allowedChatIds.length === 0) {
      return { ok: false, reason: 'chat_denied' };
    }

    return { ok: true, identity };
  }

  denialMessage(_decision: AuthDecision): string {
    return GENERIC_DENIAL_MESSAGE;
  }
}

function needsChatAllowlist(chatType: TelegramIdentity['chatType']) {
  return chatType === 'group' || chatType === 'supergroup';
}

function extractIdentity(update: TelegramUpdate): TelegramIdentity | undefined {
  const message = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  if (!message || !message.chat || !message.from) return undefined;

  const userId = Number(message.from.id);
  const chatId = Number(message.chat.id);
  if (!Number.isInteger(userId) || !Number.isInteger(chatId)) {
    return undefined;
  }

  return {
    userId,
    chatId,
    chatType: message.chat.type,
    username: message.from.username,
  };
}
