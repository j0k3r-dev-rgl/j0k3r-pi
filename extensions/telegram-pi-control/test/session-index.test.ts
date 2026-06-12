import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { FileSessionIndex } from '../src/session-index.js';

describe('FileSessionIndex', () => {
  it('parses session headers and returns only canonically matching workspaces', async () => {
    const base = await mkdtemp(join(tmpdir(), 'telegram-control-session-index-'));
    const sessionsDir = join(base, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const workspaceA = join(base, 'workspaces', 'project-a');
    const workspaceB = join(base, 'workspaces', 'project-b');
    await mkdir(workspaceA, { recursive: true });
    await mkdir(workspaceB, { recursive: true });

    const matchingSession = join(sessionsDir, 'matching.jsonl');
    const mismatchSession = join(sessionsDir, 'mismatch.jsonl');
    const malformedSession = join(sessionsDir, 'malformed.jsonl');

    await writeFile(
      matchingSession,
      `${JSON.stringify({ type: 'session', id: 'session-match', cwd: workspaceA, version: 3 })}\n{\"bad\"\n`,
    );
    await writeFile(
      mismatchSession,
      `${JSON.stringify({ type: 'session', id: 'session-miss', cwd: workspaceB, version: 3 })}\n`,
    );
    await writeFile(
      malformedSession,
      '{ this-is-not-json }\n',
    );

    const index = new FileSessionIndex({ sessionDir: sessionsDir });
    const matches = await index.listWorkspaceSessions(workspaceA);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      sessionId: 'session-match',
      sessionFile: matchingSession,
    });

    const noMatches = await index.listWorkspaceSessions('/tmp/other-workspace');
    expect(noMatches).toHaveLength(0);

    const rawFile = await readFile(malformedSession, 'utf8');
    expect(rawFile).toContain('not-json');
  });

  it('matches canonical workspace roots through symlink aliases', async () => {
    const base = await mkdtemp(join(tmpdir(), 'telegram-control-session-index-canon-'));
    const sessionsDir = join(base, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const canonical = join(base, 'canonical-workspace');
    const alias = join(base, 'alias-workspace');
    await mkdir(canonical, { recursive: true });
    await symlink(canonical, alias);

    const sessionFile = join(sessionsDir, 'alias-session.jsonl');
    await writeFile(
      sessionFile,
      `${JSON.stringify({
        type: 'session',
        id: 'session-alias',
        cwd: canonical,
        version: 3,
      })}\n`,
    );

    const index = new FileSessionIndex({ sessionDir: sessionsDir });
    const matches = await index.listWorkspaceSessions(alias);

    expect(matches).toHaveLength(1);
    expect(matches[0].sessionId).toBe('session-alias');
  });
});
