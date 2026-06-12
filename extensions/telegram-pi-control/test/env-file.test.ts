import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadGatewayEnvFile, mergeEnvFile } from '../src/env-file.js';

describe('gateway env file loading', () => {
  it('loads only token and user id lines while ignoring comments, blanks, and legacy workspace vars', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telegram-control-env-file-'));
    const envPath = join(dir, 'telegram-pi-control.env');
    await writeFile(envPath, [
      '# local telegram control env',
      'PI_TELEGRAM_CONTROL_BOT_TOKEN=token-placeholder',
      'PI_TELEGRAM_CONTROL_USER_ID="6744546050"',
      'PI_TELEGRAM_CONTROL_WORKSPACE_DIR=/home/j0k3r/.pi/agent',
      'PI_CODING_AGENT_DIR=/home/j0k3r/.pi/agent',
      '',
    ].join('\n'));

    const loaded = await loadGatewayEnvFile(envPath);

    expect(loaded).toEqual({
      PI_TELEGRAM_CONTROL_BOT_TOKEN: 'token-placeholder',
      PI_TELEGRAM_CONTROL_USER_ID: '6744546050',
    });
  });

  it('lets process environment override file values for the two supported variables', () => {
    const merged = mergeEnvFile({
      PI_TELEGRAM_CONTROL_USER_ID: 'from-file',
      PI_TELEGRAM_CONTROL_BOT_TOKEN: 'from-file-token',
    }, {
      PI_TELEGRAM_CONTROL_USER_ID: 'from-env',
    });

    expect(merged.PI_TELEGRAM_CONTROL_USER_ID).toBe('from-env');
    expect(merged.PI_TELEGRAM_CONTROL_BOT_TOKEN).toBe('from-file-token');
  });

  it('returns empty env for missing files', async () => {
    await expect(loadGatewayEnvFile('/tmp/does-not-exist-telegram-pi-control.env')).resolves.toEqual({});
  });
});
