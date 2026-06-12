import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { runTelegramControlGateway } from '../src/cli.js';
import type {
  OutputRelay,
  PiRpcProcessManager,
  PiRpcClient as PiRpcClientContract,
  TelegramUpdate,
} from '../src/types.js';
import { ExactWorkspaceRegistry } from '../src/workspace-registry.js';

class FakeTelegramAdapter {
  public offset: number;
  public readonly messages: Array<{ chatId: number; text: string }> = [];

  constructor(private readonly updates: TelegramUpdate[], initialOffset = 0) {
    this.offset = initialOffset;
  }

  async start(handler: (update: TelegramUpdate) => Promise<void>): Promise<void> {
    for (const update of this.updates) {
      await handler(update);
      this.offset = Math.max(this.offset, update.update_id + 1);
    }
  }

  async stop(): Promise<void> {
    return;
  }

  async sendMessage(chatId: number, text: string): Promise<{ chatId: number; messageId: number }> {
    this.messages.push({ chatId, text });
    return { chatId, messageId: this.messages.length };
  }

  async editMessage(): Promise<void> {
    return;
  }
}

class FakePiClient {
  public readonly prompt = vi.fn(async () => undefined);
  public readonly steer = vi.fn(async () => undefined);
  public readonly followUp = vi.fn(async () => undefined);
  public readonly abort = vi.fn(async () => undefined);
  public readonly newSession = vi.fn(async () => ({ cancelled: false }));
  public readonly switchSession = vi.fn(async () => ({ cancelled: false }));
  public readonly start = vi.fn(async () => undefined);
  public readonly stop = vi.fn(async () => undefined);
  public readonly getState = vi.fn(async () => ({
    workspaceRoot: '/tmp/fake',
    sessionId: 'session-fake',
    sessionFile: '/tmp/fake/session.json',
    sessionName: 'fake',
    running: true,
  }));
  public readonly onEvent = vi.fn(() => () => undefined);

  toContract(): PiRpcClientContract {
    return {
      start: this.start,
      stop: this.stop,
      getState: this.getState,
      newSession: this.newSession,
      switchSession: this.switchSession,
      prompt: this.prompt,
      steer: this.steer,
      followUp: this.followUp,
      abort: this.abort,
      onEvent: this.onEvent,
    };
  }
}

function update(updateId: number, chatId: number, userId: number, text: string): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Date.now(),
      text,
      chat: { id: chatId, type: 'private' },
      from: { id: userId },
    },
  };
}

const FAKE_OUTPUT_RELAY: OutputRelay = {
  attach: vi.fn(() => () => undefined),
  flush: vi.fn(async () => undefined),
  complete: vi.fn(async () => undefined),
};

describe('end-to-end command flow', () => {
  it('executes authorized flow and rejects unauthorized users', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'telegram-flow-'));
    await mkdir(join(cwd, 'workspace'), { recursive: true });
    await mkdir(join(cwd, '.pi'), { recursive: true });

    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: {
        allowedUserIds: [42],
      },
      workspaces: [{
        id: 'ws',
        label: 'Workspace',
        root: join(cwd, 'workspace'),
      }],
      policy: {
        armDurationSeconds: 300,
        maxArmDurationSeconds: 300,
      },
    }));

    const workspaceDir = join(cwd, 'workspace');
    const updates = [
      update(10, 100, 42, '/workspaces'),
      update(11, 100, 42, '/open ws'),
      update(12, 100, 42, '/arm 60'),
      update(13, 100, 42, 'run a prompt'),
      update(14, 100, 42, '/steer reduce'),
      update(15, 100, 42, '/followup refine'),
      update(16, 100, 42, '/abort'),
      update(17, 200, 99, '/status'),
    ];

    const fakeClient = new FakePiClient();
    const processManager: PiRpcProcessManager = {
      acquire: vi.fn(async () => fakeClient.toContract()),
      restart: vi.fn(async () => fakeClient.toContract()),
      stop: vi.fn(async () => undefined),
      stopAll: vi.fn(async () => undefined),
    };

    const adapter = new FakeTelegramAdapter(updates, 0);
    const workspaceRegistry = new ExactWorkspaceRegistry({
      telegram: { allowedUserIds: [42] },
      workspaces: [{
        id: 'ws',
        root: workspaceDir,
        label: 'Workspace',
      }],
    }, { cwd });

    const trustValidator = {
      validate: async () => ({
        trusted: true,
        matchedPath: workspaceDir,
        decision: true,
        reason: 'nearest_true' as const,
      }),
    };

    const gateway = await runTelegramControlGateway({
      cwd,
      env: {
        PI_TELEGRAM_CONTROL_BOT_TOKEN: 'token',
      },
      adapter,
      workspaceRegistry,
      trustValidator,
      processManager,
      sessionIndex: {
        listWorkspaceSessions: vi.fn(async () => []),
      },
      outputRelay: FAKE_OUTPUT_RELAY,
      installSignalHandlers: false,
      stateOffsetPath: join(cwd, 'state-offset.json'),
    });

    await gateway.waitUntilStopped();

    const responsesForAuthorized = adapter.messages
      .filter((entry) => entry.chatId === 100)
      .map((entry) => entry.text);
    const responsesForUnauthorized = adapter.messages
      .filter((entry) => entry.chatId === 200)
      .map((entry) => entry.text);

    expect(responsesForAuthorized[0]).toContain('Available workspaces');
    expect(responsesForAuthorized[1]).toContain('Workspace ws is now active.');
    expect(responsesForAuthorized[2]).toMatch(/Armed for \d+ seconds/);
    expect(responsesForAuthorized).not.toContain('Prompt sent.');
    expect(responsesForAuthorized).not.toContain('Steer request sent.');
    expect(responsesForAuthorized).not.toContain('Followup request sent.');
    expect(responsesForAuthorized[3]).toBe('Abort requested.');

    expect(responsesForUnauthorized).toContain('Authorization failed. Access is denied.');
    expect(fakeClient.prompt).toHaveBeenCalledWith('run a prompt');
    expect(fakeClient.steer).toHaveBeenCalledWith('reduce');
    expect(fakeClient.followUp).toHaveBeenCalledWith('refine');
    expect(fakeClient.abort).toHaveBeenCalled();
  });
});
