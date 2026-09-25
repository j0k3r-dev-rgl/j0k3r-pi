import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { resolveLocalAccount } from '../src/accounts.js';
import { ApiClientError } from '../src/client.js';
import type { GitFileInspector } from '../src/git.js';

function mockGitInspector(state: 'ignored' | 'unignored_untracked' | 'tracked' | 'unknown'): GitFileInspector {
  return { inspectFile: async () => state };
}

const SAMPLE_ACCOUNTS = [
  { role: 'PLATFORM_ADMIN', username: 'admin', email: 'admin@example.test', password: 'admin-password-123' },
  { role: 'BUSINESS_OWNER', username: 'owner_bob', email: 'bob@example.test', password: 'owner-password-456' },
  { role: 'STAFF', username: 'staff_alice', email: 'alice@example.test', password: 'staff-password-789' },
];

describe('resolveLocalAccount', () => {
  it('rejects path traversal, backslashes, control characters, and absolute paths', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'accounts-traversal-'));
    const gitInspector = mockGitInspector('ignored');

    await expect(resolveLocalAccount({ cwd, accountsFile: '../secret.json', alias: 'admin', gitInspector }))
      .rejects.toThrowError(ApiClientError);

    await expect(resolveLocalAccount({ cwd, accountsFile: 'foo/../../secret.json', alias: 'admin', gitInspector }))
      .rejects.toThrowError(ApiClientError);

    await expect(resolveLocalAccount({ cwd, accountsFile: 'foo/%2e%2e/secret.json', alias: 'admin', gitInspector }))
      .rejects.toThrowError(ApiClientError);

    await expect(resolveLocalAccount({ cwd, accountsFile: 'sub\\file.json', alias: 'admin', gitInspector }))
      .rejects.toThrowError(ApiClientError);

    await expect(resolveLocalAccount({ cwd, accountsFile: '/etc/passwd', alias: 'admin', gitInspector }))
      .rejects.toThrowError(ApiClientError);

    await expect(resolveLocalAccount({ cwd, accountsFile: 'file\u0000.json', alias: 'admin', gitInspector }))
      .rejects.toThrowError(ApiClientError);
  });

  it('rejects symlinks pointing outside the project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accounts-symlink-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'accounts-symlink-outside-'));
    const secretFile = join(outside, 'outside-secret.json');
    await writeFile(secretFile, JSON.stringify(SAMPLE_ACCOUNTS));

    const symlinkPath = join(root, 'escaped.json');
    await symlink(secretFile, symlinkPath);

    await expect(resolveLocalAccount({
      cwd: root,
      accountsFile: 'escaped.json',
      alias: 'admin',
      gitInspector: mockGitInspector('ignored'),
    })).rejects.toThrow(/symlink/i);
  });

  it('rejects tracked and untracked-unignored files via git safety preflight', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'accounts-git-'));
    const file = join(cwd, 'credentials.json');
    await writeFile(file, JSON.stringify(SAMPLE_ACCOUNTS));

    await expect(resolveLocalAccount({
      cwd,
      accountsFile: 'credentials.json',
      alias: 'admin',
      gitInspector: mockGitInspector('unignored_untracked'),
    })).rejects.toThrow(/not git-ignored/i);

    await expect(resolveLocalAccount({
      cwd,
      accountsFile: 'credentials.json',
      alias: 'admin',
      gitInspector: mockGitInspector('tracked'),
    })).rejects.toThrow(/tracked by git/i);
  });

  it('resolves account case-insensitively by role, username, or email and registers all passwords for redaction', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'accounts-resolve-'));
    const file = join(cwd, 'dev', '.accounts.json');
    await mkdir(join(cwd, 'dev'), { recursive: true });
    await writeFile(file, JSON.stringify(SAMPLE_ACCOUNTS));

    const secretValues: string[] = ['initial-token'];
    const gitInspector = mockGitInspector('ignored');

    // By role uppercase
    const byRole = await resolveLocalAccount({
      cwd,
      accountsFile: 'dev/.accounts.json',
      alias: 'platform_admin',
      secretValues,
      gitInspector,
    });
    expect(byRole.username).toBe('admin');
    expect(byRole.identifier).toBe('admin');
    expect(byRole.password).toBe('admin-password-123');

    // By username
    const byUsername = await resolveLocalAccount({
      cwd,
      accountsFile: 'dev/.accounts.json',
      alias: 'OWNER_BOB',
      secretValues,
      gitInspector,
    });
    expect(byUsername.role).toBe('BUSINESS_OWNER');
    expect(byUsername.identifier).toBe('owner_bob');

    // By email
    const byEmail = await resolveLocalAccount({
      cwd,
      accountsFile: 'dev/.accounts.json',
      alias: 'Alice@Example.Test',
      secretValues,
      gitInspector,
    });
    expect(byEmail.role).toBe('STAFF');
    expect(byEmail.username).toBe('staff_alice');

    // All passwords registered into secretValues
    expect(secretValues).toContain('admin-password-123');
    expect(secretValues).toContain('owner-password-456');
    expect(secretValues).toContain('staff-password-789');
  });

  it('returns actionable error for unmatched alias', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'accounts-unmatched-'));
    const file = join(cwd, 'credentials.json');
    await writeFile(file, JSON.stringify(SAMPLE_ACCOUNTS));

    await expect(resolveLocalAccount({
      cwd,
      accountsFile: 'credentials.json',
      alias: 'NON_EXISTENT_ROLE',
      gitInspector: mockGitInspector('ignored'),
    })).rejects.toThrow(/Account alias "NON_EXISTENT_ROLE" not found/i);
  });
});
