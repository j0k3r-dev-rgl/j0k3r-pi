import { describe, expect, it } from 'vitest';
import type { TelegramControlConfig, TelegramUpdate } from '../src/types.js';
import { TelegramAuthorizer } from '../src/authorization.js';

function deniedReason(decision: ReturnType<TelegramAuthorizer['authorize']>): string {
  if (decision.ok) throw new Error('expected authorization denial');
  return decision.reason;
}

describe('authorization policy', () => {
  const baseConfig: TelegramControlConfig = {
    telegram: {
      allowedUserIds: [100],
      allowedChatIds: [200],
    },
    workspaces: [
      { id: 'agent', label: 'Agent', root: '/tmp/agent' },
    ],
  };

  it('denies by default when allowlists are not configured', () => {
    const auth = new TelegramAuthorizer({
      telegram: { allowedUserIds: [] },
      workspaces: [],
    });
    const decision = auth.authorize({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        text: '/start',
        chat: { id: 10, type: 'private' },
        from: { id: 99 },
      },
    });

    expect(decision.ok).toBe(false);
    expect(deniedReason(decision)).toBe('missing_allowlist');
    expect(auth.denialMessage(decision)).toBe('Authorization failed. Access is denied.');
  });

  it('allows only configured user ids and configured chats for group types', () => {
    const auth = new TelegramAuthorizer(baseConfig);

    const approvedPrivate: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 2,
        date: 2,
        text: 'hello',
        chat: { id: 10, type: 'private' },
        from: { id: 100 },
      },
    };
    expect(auth.authorize(approvedPrivate)).toEqual({
      ok: true,
      identity: {
        userId: 100,
        chatId: 10,
        chatType: 'private',
        username: undefined,
      },
    });

    const unlistedUser: TelegramUpdate = {
      update_id: 3,
      message: {
        message_id: 3,
        date: 3,
        text: 'hello',
        chat: { id: 10, type: 'private' },
        from: { id: 101 },
      },
    };
    const userDenied = auth.authorize(unlistedUser);
    expect(userDenied.ok).toBe(false);
    expect(deniedReason(userDenied)).toBe('user_denied');

    const groupDeniedChat: TelegramUpdate = {
      update_id: 4,
      message: {
        message_id: 4,
        date: 4,
        text: 'hello',
        chat: { id: 201, type: 'group' },
        from: { id: 100, username: 'user' },
      },
    };
    const chatDenied = auth.authorize(groupDeniedChat);
    expect(chatDenied.ok).toBe(false);
    expect(deniedReason(chatDenied)).toBe('chat_denied');

    const allowedGroup: TelegramUpdate = {
      update_id: 5,
      message: {
        message_id: 5,
        date: 5,
        text: 'hello',
        chat: { id: 200, type: 'group' },
        from: { id: 100, username: 'user' },
      },
    };
    expect(auth.authorize(allowedGroup).ok).toBe(true);
  });

  it('returns explicit invalid_update for malformed telegram updates', () => {
    const auth = new TelegramAuthorizer(baseConfig);

    const decision = auth.authorize({ update_id: 6 } as TelegramUpdate);
    expect(decision.ok).toBe(false);
    expect(deniedReason(decision)).toBe('invalid_update');

    const noUser: TelegramUpdate = {
      update_id: 7,
      message: {
        message_id: 7,
        date: 7,
        text: 'hi',
        chat: { id: 10, type: 'private' },
      },
    } as TelegramUpdate;
    const missingFrom = auth.authorize(noUser);
    expect(missingFrom.ok).toBe(false);
    expect(deniedReason(missingFrom)).toBe('invalid_update');

    const missingChat: TelegramUpdate = {
      update_id: 8,
      message: {
        message_id: 8,
        date: 8,
        text: 'hi',
        from: { id: 100 },
      } as unknown as never,
    };
    expect(deniedReason(auth.authorize(missingChat as TelegramUpdate))).toBe('invalid_update');
  });

  it('returns a generic denial message without disclosure', () => {
    const auth = new TelegramAuthorizer(baseConfig);
    const denied = auth.authorize({
      update_id: 9,
      message: {
        message_id: 9,
        date: 9,
        text: 'hello',
        chat: { id: 999, type: 'private' },
        from: { id: 101 },
      },
    });

    expect(deniedReason(denied)).toBe('user_denied');
    expect(auth.denialMessage(denied)).toBe('Authorization failed. Access is denied.');
    expect(auth.denialMessage(denied)).not.toContain('999');
    expect(auth.denialMessage(denied)).not.toContain('101');
    expect(auth.denialMessage(denied)).not.toContain('workspaces');
  });
});
