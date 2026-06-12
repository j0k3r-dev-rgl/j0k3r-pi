import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { FileAuditLogger } from '../src/audit.js';
import type { AuditEvent } from '../src/types.js';

type AuditLine = {
  event: string;
  reason: string;
  decision: string;
  [key: string]: unknown;
};

async function readEvents(path: string): Promise<AuditLine[]> {
  const contents = await readFile(path, 'utf8');
  if (!contents.trim()) return [];

  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AuditLine);
}

describe('FileAuditLogger', () => {
  it('writes ordered NDJSON events and preserves event order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-audit-ndjson-'));
    const auditPath = join(directory, 'audit.ndjson');

    const logger = new FileAuditLogger({
      enabled: true,
      path: auditPath,
      maxBytes: 1_000,
      maxFiles: 3,
    });

    const first: AuditEvent = {
      version: 1,
      timestamp: '2026-06-12T00:00:00.000Z',
      event: 'authorization',
      decision: 'deny',
      reason: 'missing allowlist',
      actor: { userId: 1, chatId: 10 },
    };

    const second: AuditEvent = {
      version: 1,
      timestamp: '2026-06-12T00:00:01.000Z',
      event: 'control_action',
      decision: 'allow',
      reason: 'prompt accepted',
      actor: { userId: 1, chatId: 10 },
      outputPreview: 'hello',
    };

    await logger.record(first);
    await logger.record(second);

    const events = await readEvents(auditPath);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: 'authorization', reason: 'missing allowlist' });
    expect(events[1]).toMatchObject({ event: 'control_action', reason: 'prompt accepted' });
  });

  it('redacts token-like secrets and output snapshots', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-audit-redact-'));
    const auditPath = join(directory, 'audit.ndjson');

    const logger = new FileAuditLogger({
      enabled: true,
      path: auditPath,
      maxBytes: 1_000,
      maxFiles: 3,
    });

    const event: AuditEvent = {
      version: 1,
      timestamp: '2026-06-12T00:00:00.000Z',
      event: 'control_action',
      decision: 'allow',
      reason: 'user requested followup',
      actor: { userId: 1, chatId: 10, username: 'alice' },
      outputPreview: 'prompt token=super-secret-value should never appear',
      command: 'Bearer ghp_xyz_very_secret',
      metadata: {
        apiKey: 'token-from-command',
        password: 'top_secret_password',
        publicNote: 'safe',
      },
    };

    await logger.record(event);

    const [recorded] = await readEvents(auditPath);
    expect(recorded.outputPreview).toBeDefined();
    expect(recorded.command).toBeDefined();

    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toContain('super-secret-value');
    expect(serialized).not.toContain('ghp_xyz_very_secret');
    expect(serialized).not.toContain('token-from-command');
    expect(serialized).not.toContain('top_secret_password');
    expect(serialized).toContain('user requested followup');
  });

  it('keeps deny reason visible in audit output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-audit-reason-'));
    const auditPath = join(directory, 'audit.ndjson');

    const logger = new FileAuditLogger({
      enabled: true,
      path: auditPath,
      maxBytes: 1_000,
      maxFiles: 3,
    });

    await logger.record({
      version: 1,
      timestamp: '2026-06-12T00:00:00.000Z',
      event: 'authorization',
      decision: 'deny',
      reason: 'workspace not allowlisted',
      actor: { userId: 5, chatId: 20 },
    });

    const [recorded] = await readEvents(auditPath);
    expect(recorded.decision).toBe('deny');
    expect(recorded.reason).toBe('workspace not allowlisted');
  });

  it('rotates oversized audit logs and preserves file permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-audit-rotate-'));
    const auditPath = join(directory, 'audit.ndjson');

    await writeFile(auditPath, `${'x'.repeat(256)}\n`, 'utf8');

    const logger = new FileAuditLogger({
      enabled: true,
      path: auditPath,
      maxBytes: 80,
      maxFiles: 2,
    });

    await logger.record({
      version: 1,
      timestamp: '2026-06-12T00:00:00.000Z',
      event: 'lifecycle',
      decision: 'observe',
      reason: 'restart completed',
      actor: { userId: 3, chatId: 30 },
    });

    const active = await readFile(auditPath, 'utf8');
    const rotated = await readFile(`${auditPath}.1`, 'utf8');

    expect(rotated).toContain('x');
    expect(active).toContain('restart completed');
    expect(active).not.toContain('x'.repeat(10));

    const directoryMode = (await stat(directory)).mode & 0o777;
    const fileMode = (await stat(auditPath)).mode & 0o777;
    await chmod(directory, 0o777).catch(() => undefined);

    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });
});
