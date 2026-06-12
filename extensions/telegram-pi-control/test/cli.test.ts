import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { runTelegramControlGateway } from '../src/cli.js';
import type { BindingManager, OutputRelay, PiRpcProcessManager, PiRpcClient as PiRpcClientContract, TelegramBotCommand, TelegramUpdate } from '../src/types.js';

class FakeTelegramAdapter {
  public offset: number;
  public readonly startCalls: number[] = [];
  public readonly stopCalls: number[] = [];
  public readonly messages: Array<{ chatId: number; text: string }> = [];
  public readonly commandRegistrations: TelegramBotCommand[][] = [];

  constructor(
    private readonly updates: TelegramUpdate[],
    initialOffset: number,
  ) {
    this.offset = initialOffset;
  }

  async start(handler: (update: TelegramUpdate) => Promise<void>): Promise<void> {
    this.startCalls.push(1);
    for (const update of this.updates) {
      await handler(update);
      this.offset = Math.max(this.offset, update.update_id + 1);
    }
  }

  async stop(): Promise<void> {
    this.stopCalls.push(1);
  }

  async sendMessage(chatId: number, text: string): Promise<{ chatId: number; messageId: number }> {
    this.messages.push({ chatId, text });
    return { chatId, messageId: this.messages.length };
  }

  async editMessage(): Promise<void> {
    // output relay can be mocked in tests that do not exercise edits
    return;
  }

  async setMyCommands(commands: TelegramBotCommand[]): Promise<void> {
    this.commandRegistrations.push(commands);
  }
}

function telegramMessage(text: string, chatId: number, userId: number): TelegramUpdate {
  return {
    update_id: userId,
    message: {
      message_id: userId,
      date: Date.now(),
      text,
      chat: { id: chatId, type: 'private', username: 'chat' },
      from: { id: userId },
    },
  };
}

function buildConfigTempDir() {
  return mkdtemp(join(tmpdir(), 'telegram-cli-config-'));
}

const NOOP_OUTPUT_RELAY: OutputRelay = {
  attach: vi.fn(() => vi.fn()),
  flush: vi.fn().mockResolvedValue(undefined),
  complete: vi.fn().mockResolvedValue(undefined),
};

const DEFAULT_ALLOWED_USER = 42;
const DEFAULT_CHAT = 123;

describe('runTelegramControlGateway', () => {
  it('fails fast when PI token is missing', async () => {
    const cwd = await buildConfigTempDir();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: {
        allowedUserIds: [DEFAULT_ALLOWED_USER],
      },
      workspaces: [{
        id: 'ws',
        root: cwd,
        label: 'root',
      }],
    }));

    await expect(
      runTelegramControlGateway({
        cwd,
        env: {},
        adapter: new FakeTelegramAdapter([], 0),
        outputRelay: NOOP_OUTPUT_RELAY,
      }),
    ).rejects.toThrow('missing PI_TELEGRAM_CONTROL_BOT_TOKEN');
  });

  it('fails fast when allowlist is empty', async () => {
    const cwd = await buildConfigTempDir();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: {
        allowedUserIds: [],
      },
      workspaces: [{
        id: 'ws',
        root: cwd,
        label: 'root',
      }],
    }));

    await expect(
      runTelegramControlGateway({
        cwd,
        env: {
          PI_TELEGRAM_CONTROL_BOT_TOKEN: 'token',
        },
        adapter: new FakeTelegramAdapter([], 0),
        outputRelay: NOOP_OUTPUT_RELAY,
      }),
    ).rejects.toThrow('telegram.allowedUserIds must be a non-empty array of integers');
  });

  it('starts and stops with an adapter-backed poller', async () => {
    const cwd = await buildConfigTempDir();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: {
        allowedUserIds: [DEFAULT_ALLOWED_USER],
      },
      workspaces: [{
        id: 'ws',
        root: cwd,
        label: 'root',
      }],
    }));

    const stateOffsetPath = join(cwd, 'state.json');
    const adapter = new FakeTelegramAdapter([
      telegramMessage('/start', DEFAULT_CHAT, DEFAULT_ALLOWED_USER),
    ], 0);

    const gateway = await runTelegramControlGateway({
      cwd,
      env: {
        PI_TELEGRAM_CONTROL_BOT_TOKEN: 'token',
      },
      adapter,
      outputRelay: NOOP_OUTPUT_RELAY,
      stateOffsetPath,
      installSignalHandlers: false,
    });

    await gateway.waitUntilStopped();

    expect(adapter.startCalls.length).toBe(1);
    expect(adapter.messages[0]).toMatchObject({ chatId: DEFAULT_CHAT, text: expect.stringContaining('ready') });

    await gateway.stop();

    expect(adapter.stopCalls.length).toBe(1);
  });

  it('registers the Telegram bot command menu on startup', async () => {
    const cwd = await buildConfigTempDir();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: {
        allowedUserIds: [DEFAULT_ALLOWED_USER],
      },
      workspaces: [{
        id: 'ws',
        root: cwd,
        label: 'root',
      }],
    }));

    const adapter = new FakeTelegramAdapter([], 0);

    const gateway = await runTelegramControlGateway({
      cwd,
      env: {
        PI_TELEGRAM_CONTROL_BOT_TOKEN: 'token',
      },
      adapter,
      outputRelay: NOOP_OUTPUT_RELAY,
      stateOffsetPath: join(cwd, 'state.json'),
      installSignalHandlers: false,
    });

    await gateway.waitUntilStopped();

    expect(adapter.commandRegistrations).toHaveLength(1);
    expect(adapter.commandRegistrations[0]).toEqual(expect.arrayContaining([
      { command: 'workspaces', description: expect.stringContaining('workspaces') },
      { command: 'approve', description: expect.stringContaining('permission') },
      { command: 'deny', description: expect.stringContaining('permission') },
    ]));
    expect(adapter.commandRegistrations[0].every((entry) => !entry.command.startsWith('/'))).toBe(true);
  });

  it('loads and persists update offsets', async () => {
    const cwd = await buildConfigTempDir();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: {
        allowedUserIds: [DEFAULT_ALLOWED_USER],
      },
      workspaces: [{
        id: 'ws',
        root: cwd,
        label: 'root',
      }],
    }));

    const stateOffsetPath = join(cwd, 'state-update.json');
    await writeFile(stateOffsetPath, JSON.stringify({ lastUpdateOffset: 40, updatedAt: new Date().toISOString() }, null, 2));

    const update = telegramMessage('/workspaces', DEFAULT_CHAT, DEFAULT_ALLOWED_USER);
    Object.assign(update, { update_id: 52 });

    const adapter = new FakeTelegramAdapter([
      update,
    ], 40);

    const gateway = await runTelegramControlGateway({
      cwd,
      env: {
        PI_TELEGRAM_CONTROL_BOT_TOKEN: 'token',
      },
      adapter,
      outputRelay: NOOP_OUTPUT_RELAY,
      stateOffsetPath,
      installSignalHandlers: false,
    });

    await gateway.waitUntilStopped();

    expect(adapter.offset).toBe(53);
    const persisted = JSON.parse(await readFile(stateOffsetPath, 'utf8')) as { lastUpdateOffset: number };
    expect(persisted.lastUpdateOffset).toBe(53);
  });

  it('starts audit logging by default with FileAuditLogger', async () => {
    const cwd = await buildConfigTempDir();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: {
        allowedUserIds: [DEFAULT_ALLOWED_USER],
      },
      workspaces: [{
        id: 'ws',
        root: cwd,
        label: 'root',
      }],
    }));

    const auditStateDir = join(cwd, 'state');
    const adapter = new FakeTelegramAdapter([
      telegramMessage('/workspaces', DEFAULT_CHAT, DEFAULT_ALLOWED_USER),
    ], 0);

    const gateway = await runTelegramControlGateway({
      cwd,
      env: {
        PI_TELEGRAM_CONTROL_BOT_TOKEN: 'token',
        XDG_STATE_HOME: auditStateDir,
      },
      adapter,
      outputRelay: NOOP_OUTPUT_RELAY,
      stateOffsetPath: join(cwd, 'state.json'),
      installSignalHandlers: false,
    });

    await gateway.waitUntilStopped();

    const auditPath = join(auditStateDir, 'pi', 'telegram-pi-control', 'audit.ndjson');
    const lines = (await readFile(auditPath, 'utf8')).split('\n').filter((line) => line.trim().length > 0);
    const events = lines.map((line) => JSON.parse(line) as { event: string });

    expect(events.length).toBeGreaterThan(0);
    const eventNames = events.map((entry) => entry.event);
    expect(eventNames).toContain('workspace_query');
  });

  it('reads trust store only from the gateway home agent directory by default', async () => {
    const cwd = await buildConfigTempDir();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    const fakeHome = await buildConfigTempDir();
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: {
        allowedUserIds: [DEFAULT_ALLOWED_USER],
      },
      workspaces: [{
        id: 'ws',
        root: cwd,
        label: 'root',
      }],
    }));

    await mkdir(join(fakeHome, '.pi', 'agent'), { recursive: true });
    const trustFilePath = join(fakeHome, '.pi', 'agent', 'trust.json');
    const trusted = Object.create(null);
    trusted[cwd] = true;
    await writeFile(trustFilePath, JSON.stringify(trusted));

    const adapter = new FakeTelegramAdapter([
      telegramMessage('/workspaces', DEFAULT_CHAT, DEFAULT_ALLOWED_USER),
    ], 0);

    const gateway = await runTelegramControlGateway({
      cwd,
      env: {
        PI_TELEGRAM_CONTROL_BOT_TOKEN: 'token',
      },
      adapter,
      outputRelay: NOOP_OUTPUT_RELAY,
      homeDir: fakeHome,
      installSignalHandlers: false,
    });

    await gateway.waitUntilStopped();

    expect(adapter.messages[0].text).toContain('root (ws)');
  });

  it('stops with emergency disable lifecycle and clears bindings', async () => {
    const cwd = await buildConfigTempDir();
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: {
        allowedUserIds: [DEFAULT_ALLOWED_USER],
      },
      workspaces: [{
        id: 'ws',
        root: cwd,
        label: 'root',
      }],
    }));

    const clearForEmergencyDisable = vi.fn();
    const fakeBindings: BindingManager = {
      get: vi.fn(),
      bind: vi.fn(),
      arm: vi.fn(),
      disarm: vi.fn(),
      unbind: vi.fn(),
      requireArmed: vi.fn(),
      clearForEmergencyDisable,
    };

    const fakeProcessClient = {
      start: async () => undefined,
      stop: async () => undefined,
      getState: async () => ({ }),
      newSession: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      onEvent: () => () => undefined,
    } as PiRpcClientContract;

    const stopAll = vi.fn(async () => undefined);
    const processManager: PiRpcProcessManager = {
      acquire: vi.fn(async () => fakeProcessClient),
      restart: vi.fn(async () => fakeProcessClient),
      stop: vi.fn(async () => undefined),
      stopAll,
    };

    const adapter = new FakeTelegramAdapter([telegramMessage('/start', DEFAULT_CHAT, DEFAULT_ALLOWED_USER)], 0);

    const gateway = await runTelegramControlGateway({
      cwd,
      env: {
        PI_TELEGRAM_CONTROL_BOT_TOKEN: 'token',
      },
      adapter,
      bindings: fakeBindings,
      processManager,
      outputRelay: NOOP_OUTPUT_RELAY,
      installSignalHandlers: false,
    });

    await gateway.waitUntilStopped();
    await gateway.emergencyStop();

    expect(clearForEmergencyDisable).toHaveBeenCalled();
    expect(stopAll).toHaveBeenCalled();
  });
});
