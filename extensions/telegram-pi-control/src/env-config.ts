import type { TelegramControlConfig } from './types.js';

export interface GatewayEnvConfigOptions {
  PI_TELEGRAM_CONTROL_BOT_TOKEN?: string;
  PI_TELEGRAM_CONTROL_USER_ID?: string;
  [key: string]: string | undefined;
}

export function parseIntegerEnvList(value: string | undefined): number[] {
  if (!value?.trim()) return [];

  const parts = value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return [];

  const parsed = parts.map((part) => Number.parseInt(part, 10));
  if (parsed.some((item, index) => !Number.isInteger(item) || String(item) !== parts[index])) {
    return [];
  }

  return parsed;
}

export function buildEnvConfig(env: GatewayEnvConfigOptions): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  delete next.PI_TELEGRAM_CONTROL_CONFIG;

  const userIds = parseIntegerEnvList(env.PI_TELEGRAM_CONTROL_USER_ID)
    .filter((id) => id > 0);
  if (userIds.length === 0) {
    return next;
  }

  const config: TelegramControlConfig = {
    telegram: {
      allowedUserIds: userIds,
    },
    workspacesFromTrust: true,
    workspaces: [],
  };

  next.PI_TELEGRAM_CONTROL_CONFIG = JSON.stringify(config);
  return next;
}
