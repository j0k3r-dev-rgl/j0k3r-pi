import { describe, expect, it } from 'vitest';
import { buildEnvConfig, parseIntegerEnvList } from '../src/env-config.js';

describe('environment convenience config', () => {
  it('builds PI_TELEGRAM_CONTROL_CONFIG from only token/user env vars and leaves workspaces to trust.json', () => {
    const env = buildEnvConfig({
      PI_TELEGRAM_CONTROL_BOT_TOKEN: 'token-placeholder',
      PI_TELEGRAM_CONTROL_USER_ID: '12345',
      PI_TELEGRAM_CONTROL_WORKSPACE_DIR: '/tmp/workspace',
      PI_TELEGRAM_CONTROL_WORKSPACE_ID: 'agent',
      PI_TELEGRAM_CONTROL_WORKSPACE_LABEL: 'Agent Workspace',
      PI_TELEGRAM_CONTROL_PI_COMMAND: '/opt/pi/bin/pi',
      PI_TELEGRAM_CONTROL_CHAT_ID: '-100',
      PI_TELEGRAM_CONTROL_CONFIG: '{"telegram":{"allowedUserIds":[999]},"workspaces":[{"id":"x","root":"/x"}]}',
    });

    expect(env.PI_TELEGRAM_CONTROL_BOT_TOKEN).toBe('token-placeholder');
    expect(env.PI_TELEGRAM_CONTROL_CONFIG).toBeDefined();

    const parsed = JSON.parse(env.PI_TELEGRAM_CONTROL_CONFIG ?? '{}');
    expect(parsed).toEqual({
      telegram: { allowedUserIds: [12345] },
      workspacesFromTrust: true,
      workspaces: [],
    });
  });

  it('removes generated config when user id is missing', () => {
    expect(buildEnvConfig({}).PI_TELEGRAM_CONTROL_CONFIG).toBeUndefined();
    expect(buildEnvConfig({ PI_TELEGRAM_CONTROL_WORKSPACE_DIR: '/tmp/ws' }).PI_TELEGRAM_CONTROL_CONFIG).toBeUndefined();
    expect(buildEnvConfig({ PI_TELEGRAM_CONTROL_CONFIG: '{"telegram":{"allowedUserIds":[1]}}' }).PI_TELEGRAM_CONTROL_CONFIG).toBeUndefined();
  });

  it('parses comma-separated integer lists and rejects invalid values', () => {
    expect(parseIntegerEnvList('1, 2 -3')).toEqual([1, 2, -3]);
    expect(parseIntegerEnvList('')).toEqual([]);
    expect(parseIntegerEnvList('1,bad')).toEqual([]);
  });
});
