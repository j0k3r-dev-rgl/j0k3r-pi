import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadTelegramControlConfig } from '../src/config.js';

describe('loadTelegramControlConfig', () => {
  it('uses PI_TELEGRAM_CONTROL_CONFIG precedence over .pi/telegram-pi-control.json', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'telegram-control-config-precedence-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: {
        allowedUserIds: [1],
        allowedChatIds: [10],
      },
      workspaces: [
        { id: 'file', root: '/tmp/file', label: 'From file' },
      ],
    }));

    const loaded = await loadTelegramControlConfig({
      cwd,
      env: {
        PI_TELEGRAM_CONTROL_CONFIG: JSON.stringify({
          telegram: { allowedUserIds: [2], allowedChatIds: [11] },
          workspaces: [
            { id: 'env', root: '/tmp/env', label: 'From env' },
          ],
        }),
      },
    });

    expect(loaded.configSource).toBe('env');
    expect(loaded.config.telegram.allowedUserIds).toEqual([2]);
    expect(loaded.config.workspaces).toEqual([
      { id: 'env', root: '/tmp/env', label: 'From env' },
    ]);
  });

  it('reads .pi/telegram-pi-control.json from nearest ancestor when env config is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-config-file-'));
    const nested = join(root, 'nested', 'dir');
    await mkdir(join(root, '.pi'), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: { allowedUserIds: [42] },
      workspaces: [{ id: 'ws', root: '/tmp/root-ws', label: 'Root workspace' }],
    }));

    const loaded = await loadTelegramControlConfig({
      cwd: nested,
      env: {},
    });

    expect(loaded.configPath).toBe(join(root, '.pi', 'telegram-pi-control.json'));
    expect(loaded.configSource).toBe('file');
    expect(loaded.config.telegram.allowedUserIds).toEqual([42]);
    expect(loaded.config.workspaces[0]).toEqual({
      id: 'ws',
      root: '/tmp/root-ws',
      label: 'Root workspace',
    });
  });

  it('does not derive nested workspace roots from trusted parent entries', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'telegram-control-config-trust-exact-only-'));
    const home = await mkdtemp(join(tmpdir(), 'telegram-control-config-trust-exact-home-'));
    await mkdir(join(home, '.pi', 'agent'), { recursive: true });
    await writeFile(join(home, '.pi', 'agent', 'trust.json'), JSON.stringify({
      [home]: true,
    }));

    const loaded = await loadTelegramControlConfig({
      cwd,
      homeDir: home,
      env: {
        PI_TELEGRAM_CONTROL_CONFIG: JSON.stringify({
          telegram: { allowedUserIds: [42] },
          workspacesFromTrust: true,
          workspaces: [{ id: 'nested', root: join(home, 'nested'), label: 'Nested' }],
        }),
      },
    });

    expect(loaded.config.workspaces).toEqual([
      { id: 'nested', root: join(home, 'nested'), label: 'Nested' },
      { id: basename(home).toLowerCase(), label: basename(home).toLowerCase(), root: home },
    ]);
  });

  it('derives workspace allowlist from trusted trust.json entries', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'telegram-control-config-trust-workspaces-'));
    const home = await mkdtemp(join(tmpdir(), 'telegram-control-config-trust-home-'));
    await mkdir(join(home, '.pi', 'agent'), { recursive: true });
    await writeFile(join(home, '.pi', 'agent', 'trust.json'), JSON.stringify({
      [join(home, 'project-a')]: true,
      [join(home, 'project-b')]: false,
      [join(home, '.pi', 'agent')]: true,
    }));

    const loaded = await loadTelegramControlConfig({
      cwd,
      homeDir: home,
      env: {
        PI_TELEGRAM_CONTROL_CONFIG: JSON.stringify({
          telegram: { allowedUserIds: [42] },
        }),
      },
    });

    expect(loaded.valid).toBe(true);
    expect(loaded.config.workspaces).toEqual([
      { id: 'project-a', label: 'project-a', root: join(home, 'project-a') },
      { id: 'agent', label: 'agent', root: join(home, '.pi', 'agent') },
    ]);
  });

  it('adds trusted trust.json entries alongside explicit workspace config', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'telegram-control-config-trust-merge-'));
    const home = await mkdtemp(join(tmpdir(), 'telegram-control-config-trust-merge-home-'));
    await mkdir(join(home, '.pi', 'agent'), { recursive: true });
    await writeFile(join(home, '.pi', 'agent', 'trust.json'), JSON.stringify({
      '/tmp/explicit': true,
      '/tmp/extra': true,
    }));

    const loaded = await loadTelegramControlConfig({
      cwd,
      homeDir: home,
      env: {
        PI_TELEGRAM_CONTROL_CONFIG: JSON.stringify({
          telegram: { allowedUserIds: [42] },
          workspacesFromTrust: true,
          workspaces: [{ id: 'explicit', root: '/tmp/explicit', label: 'Explicit' }],
        }),
      },
    });

    expect(loaded.config.workspaces).toEqual([
      { id: 'explicit', root: '/tmp/explicit', label: 'Explicit' },
      { id: 'extra', label: 'extra', root: '/tmp/extra' },
    ]);
  });

  it('rejects empty allowlists as invalid and fail-closed', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'telegram-control-config-empty-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: { allowedUserIds: [] },
      workspaces: [],
    }));

    const loaded = await loadTelegramControlConfig({ cwd, env: {} });

    expect(loaded.valid).toBe(false);
    expect(loaded.errors).toContain('telegram.allowedUserIds must be a non-empty array of integers');
    expect(loaded.errors).toContain('workspaces must be a non-empty array');
  });

  it('records invalid values and uses safe fallbacks', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'telegram-control-config-invalid-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: {
        allowedUserIds: ['not-number', 9],
        polling: { timeoutSeconds: -1, limit: 'bad' },
      },
      policy: {
        armDurationSeconds: '300',
        maxArmDurationSeconds: -100,
      },
      workspaces: [
        { id: 'ws', root: '/tmp/ws', label: 'Workspace' },
      ],
      token: 'should-not-be-loaded',
    }));

    const loaded = await loadTelegramControlConfig({ cwd, env: {} });

    expect(loaded.errors).toContain('telegram.allowedUserIds must be a non-empty array of integers');
    expect(loaded.warnings.join('\n')).toContain('Ignoring secret-like config key "token"');
    expect(loaded.config.telegram.polling?.timeoutSeconds).toBe(30);
    expect(loaded.config.telegram.polling?.limit).toBe(100);
    expect(loaded.config.policy?.armDurationSeconds).toBe(300);
    expect(loaded.config.policy?.maxArmDurationSeconds).toBe(900);
    expect(loaded.config.telegram.allowedUserIds).toEqual([]);
  });

  it('stores bot token only from environment', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'telegram-control-config-token-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: { allowedUserIds: [1] },
      workspaces: [{ id: 'ws', root: '/tmp/ws', label: 'Workspace' }],
      botToken: 'config-secret',
    }));

    const loaded = await loadTelegramControlConfig({
      cwd,
      env: {
        PI_TELEGRAM_CONTROL_BOT_TOKEN: 'env-secret',
      },
    });

    expect(loaded.botToken).toBe('env-secret');
    expect(loaded.warnings.join('\n')).toContain('Ignoring secret-like config key "botToken"');
    expect(JSON.stringify(loaded.config)).not.toContain('config-secret');
  });

  it('rejects invalid PI_TELEGRAM_CONTROL_CONFIG JSON and falls back to file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegram-control-config-bad-env-'));
    await mkdir(join(root, '.pi'), { recursive: true });
    await writeFile(join(root, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: { allowedUserIds: [7] },
      workspaces: [{ id: 'ws', root: '/tmp/ws', label: 'Workspace' }],
    }));

    const loaded = await loadTelegramControlConfig({
      cwd: root,
      env: {
        PI_TELEGRAM_CONTROL_CONFIG: '{ this is not valid json',
      },
    });

    expect(loaded.configSource).toBe('file');
    expect(loaded.config.telegram.allowedUserIds).toEqual([7]);
    expect(loaded.warnings.join('\n')).toContain('Could not parse PI_TELEGRAM_CONTROL_CONFIG');
  });

  it('supports optional home-root override of config without leaking token-like values', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'telegram-control-config-home-'));
    const configPath = join(cwd, '.pi', 'telegram-pi-control.json');
    await mkdir(join(cwd, '.pi'), { recursive: true });
    const secret = 'redaction-sentinel';
    await writeFile(configPath, JSON.stringify({
      telegram: { allowedUserIds: [3] },
      workspaces: [{ id: 'ws', root: '/tmp/ws', label: 'Workspace' }],
      apiKey: secret,
    }));

    const loaded = await loadTelegramControlConfig({ cwd, env: {} });
    expect(JSON.stringify(loaded)).not.toContain(secret);
    expect(loaded.configPath).toBe(configPath);
    expect(loaded.warnings.join('\n')).toContain('Ignoring secret-like config key "apiKey"');
  });

  it('allows negative Telegram group chat ids', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'telegram-control-config-negative-chat-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: { allowedUserIds: [3], allowedChatIds: [-100123, 77] },
      workspaces: [{ id: 'ws', root: '/tmp/ws', label: 'Workspace' }],
    }));

    const loaded = await loadTelegramControlConfig({ cwd, env: {} });

    expect(loaded.valid).toBe(true);
    expect(loaded.config.telegram.allowedChatIds).toEqual([-100123, 77]);
  });

  it('filters unsafe pi extra args', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'telegram-control-config-unsafe-args-'));
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(cwd, '.pi', 'telegram-pi-control.json'), JSON.stringify({
      telegram: { allowedUserIds: [3] },
      workspaces: [{ id: 'ws', root: '/tmp/ws', label: 'Workspace' }],
      pi: {
        extraArgs: ['--approve', '--fast'],
      },
    }));

    const loaded = await loadTelegramControlConfig({ cwd, env: {} });

    expect(loaded.config.pi?.extraArgs).toEqual(['--fast']);
    expect(loaded.warnings.join('\n')).toContain('Ignoring unsafe pi.extraArgs value');
  });
});
