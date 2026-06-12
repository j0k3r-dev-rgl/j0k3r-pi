import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_GATEWAY_ENV_FILE = 'telegram-pi-control.env';
const ALLOWED_GATEWAY_ENV_KEYS = new Set([
  'PI_TELEGRAM_CONTROL_BOT_TOKEN',
  'PI_TELEGRAM_CONTROL_USER_ID',
]);

export function defaultGatewayEnvFilePath(homeDir = homedir()): string {
  return join(homeDir, '.pi', 'agent', DEFAULT_GATEWAY_ENV_FILE);
}

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseGatewayEnvFile(content: string): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const equals = withoutExport.indexOf('=');
    if (equals <= 0) continue;

    const key = withoutExport.slice(0, equals).trim();
    const value = stripOptionalQuotes(withoutExport.slice(equals + 1));
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (!ALLOWED_GATEWAY_ENV_KEYS.has(key)) continue;
    output[key] = value;
  }

  return output;
}

export async function loadGatewayEnvFile(path: string): Promise<NodeJS.ProcessEnv> {
  const content = await readFile(path, 'utf8').catch(() => undefined);
  return content ? parseGatewayEnvFile(content) : {};
}

export function mergeEnvFile(fileEnv: NodeJS.ProcessEnv, processEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...fileEnv,
    ...processEnv,
  };
}
