import { describe, expect, it } from 'vitest';
import {
  AuthDecision,
  TelegramCommandInput,
  TelegramCommandResult,
  TelegramControlConfig,
  TelegramIdentity,
  TelegramUpdate,
  WorkspaceRef,
} from '../src/types.js';

describe('telegram-pi-control type contracts', () => {
  it('exports command/input/result unions for compile-surface tests', () => {
    const identity: TelegramIdentity = {
      userId: 123,
      chatId: 456,
      chatType: 'private',
      username: 'operator',
    };

    const commandInput: TelegramCommandInput = {
      kind: 'command',
      command: 'start',
      args: [],
      identity,
      rawText: '/start',
    };

    const textInput: TelegramCommandInput = {
      kind: 'text',
      text: 'hello',
      identity,
      rawText: 'hello',
    };

    const commandResult: TelegramCommandResult = {
      kind: 'ok',
      text: 'ack',
    };

    expect(commandInput.kind).toBe('command');
    expect(textInput.kind).toBe('text');
    expect(commandResult.kind).toBe('ok');
  });

  it('models auth decisions without exposing secret values', () => {
    const okDecision: AuthDecision = {
      ok: true,
      identity: { userId: 1, chatId: 2, chatType: 'private' },
    };

    const denyDecision: AuthDecision = {
      ok: false,
      reason: 'invalid_update',
    };

    expect(okDecision.ok).toBe(true);
    expect(denyDecision.ok).toBe(false);
    expect(denyDecision.reason).toBe('invalid_update');
  });

  it('exports shared control-domain config shapes', () => {
    const config: TelegramControlConfig = {
      telegram: {
        allowedUserIds: [1, 2, 3],
      },
      workspaces: [
        {
          id: 'agent',
          label: 'Agent Workspace',
          root: '/tmp/agent',
        },
      ],
    };

    const workspace: WorkspaceRef = {
      id: 'agent',
      label: 'Agent Workspace',
      canonicalRoot: '/tmp/agent',
    };

    const update: TelegramUpdate = {
      update_id: 10,
      message: {
        message_id: 1,
        date: 1_234,
        text: '/start',
        chat: { id: 2, type: 'private' },
        from: { id: 3 },
      },
    };

    expect(config.telegram.allowedUserIds).toHaveLength(3);
    expect(workspace.canonicalRoot).toBe('/tmp/agent');
    expect(update.message?.chat.type).toBe('private');
  });
});
