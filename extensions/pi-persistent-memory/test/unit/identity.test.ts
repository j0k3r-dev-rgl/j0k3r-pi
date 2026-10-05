import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  resolveScope,
  encodeScope,
  decodeScope,
  normalizeGitRemote,
} from '../../src/identity.ts';

function createTempDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `pi-memory-mini-001-${prefix}-`));
  return {
    dir,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

test('M1-A02: encodeScope and decodeScope provide collision-free serialization', () => {
  const globalScope = { kind: 'global' as const };
  const encodedGlobal = encodeScope(globalScope);
  assert.equal(encodedGlobal, '["global"]');
  assert.deepEqual(decodeScope(encodedGlobal), globalScope);

  const projScope = { kind: 'project' as const, project: 'github.com/owner/repo' };
  const encodedProj = encodeScope(projScope);
  assert.equal(encodedProj, '["project","github.com/owner/repo"]');
  assert.deepEqual(decodeScope(encodedProj), projScope);
});

test('M1-A02: Exact home directory resolves to global scope, but descendants do not', () => {
  const home = homedir();
  const scopeHome = resolveScope(home, { isProjectTrusted: () => true });
  assert.deepEqual(scopeHome, { kind: 'global' });

  // A descendant of home should NOT automatically resolve global
  const { dir, cleanup } = createTempDir('descendant');
  try {
    const scopeDescendant = resolveScope(dir, { isProjectTrusted: () => true });
    assert.equal(scopeDescendant.kind, 'project');
  } finally {
    cleanup();
  }
});

test('M1-A02: Trust denial blocks project identity with actionable error without reading config or falling back', () => {
  const { dir, cleanup } = createTempDir('untrusted');
  try {
    // Even if valid .pi/memory.json exists
    mkdirSync(join(dir, '.pi'), { recursive: true });
    writeFileSync(join(dir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'secret-project' }));

    assert.throws(() => {
      resolveScope(dir, { isProjectTrusted: () => false });
    }, (err: any) => {
      return err?.message?.includes('project_not_trusted');
    });
  } finally {
    cleanup();
  }
});

test('M1-A02: Valid .pi/memory.json config resolves project identity', () => {
  const { dir, cleanup } = createTempDir('valid-config');
  try {
    mkdirSync(join(dir, '.pi'), { recursive: true });
    writeFileSync(join(dir, '.pi', 'memory.json'), JSON.stringify({ project_name: 'custom-named-project' }));

    const scope = resolveScope(dir, { isProjectTrusted: () => true });
    assert.deepEqual(scope, { kind: 'project', project: 'custom-named-project' });
  } finally {
    cleanup();
  }
});

test('M1-A02: Invalid or empty .pi/memory.json throws actionable error without silent fallback', () => {
  const { dir, cleanup } = createTempDir('invalid-config');
  try {
    mkdirSync(join(dir, '.pi'), { recursive: true });
    writeFileSync(join(dir, '.pi', 'memory.json'), '{ malformed json');

    assert.throws(() => {
      resolveScope(dir, { isProjectTrusted: () => true });
    }, /invalid_memory_config/);

    // Empty project_name
    writeFileSync(join(dir, '.pi', 'memory.json'), JSON.stringify({ project_name: '   ' }));
    assert.throws(() => {
      resolveScope(dir, { isProjectTrusted: () => true });
    }, /invalid_project_name/);
  } finally {
    cleanup();
  }
});

test('M1-A02: Git remotes — normalization, SSH/HTTPS equivalence, and alphabetical remote ordering', () => {
  // SSH and HTTPS normalization equivalence
  const https = normalizeGitRemote('https://github.com/owner/repo.git');
  const ssh = normalizeGitRemote('git@github.com:owner/repo.git');
  const sshUrl = normalizeGitRemote('ssh://git@github.com/owner/repo.git');
  const httpsCreds = normalizeGitRemote('https://user:token@github.com/owner/repo.git');

  assert.equal(https, 'github.com/owner/repo');
  assert.equal(ssh, 'github.com/owner/repo');
  assert.equal(sshUrl, 'github.com/owner/repo');
  assert.equal(httpsCreds, 'github.com/owner/repo');

  // Unsupported remotes must throw unsupported_remote
  assert.throws(() => normalizeGitRemote('file:///tmp/repo'), /unsupported_remote/);
  assert.throws(() => normalizeGitRemote('https://github.com:8443/owner/repo.git'), /unsupported_remote/);
  assert.throws(() => normalizeGitRemote('/local/path/repo'), /unsupported_remote/);

  // In an actual git repo with origin and upstream:
  const { dir, cleanup } = createTempDir('git-remotes');
  try {
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['remote', 'add', 'upstream', 'https://github.com/upstream-org/repo.git'], { cwd: dir });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/my-fork/repo.git'], { cwd: dir });

    // Alphabetical order: 'origin' comes before 'upstream', so 'origin' remote is selected!
    const scope = resolveScope(dir, { isProjectTrusted: () => true });
    assert.deepEqual(scope, { kind: 'project', project: 'github.com/my-fork/repo' });
  } finally {
    cleanup();
  }
});

test('M1-A02: Git repo with no remotes and non-git folder fall back to basename(cwd)', () => {
  const { dir: gitNoRemotes, cleanup: c1 } = createTempDir('git-no-remotes');
  const { dir: nonGit, cleanup: c2 } = createTempDir('non-git-dir');
  try {
    execFileSync('git', ['init'], { cwd: gitNoRemotes });
    const scopeGit = resolveScope(gitNoRemotes, { isProjectTrusted: () => true });
    assert.deepEqual(scopeGit, { kind: 'project', project: basename(gitNoRemotes) });

    const scopeNonGit = resolveScope(nonGit, { isProjectTrusted: () => true });
    assert.deepEqual(scopeNonGit, { kind: 'project', project: basename(nonGit) });
  } finally {
    c1();
    c2();
  }
});
