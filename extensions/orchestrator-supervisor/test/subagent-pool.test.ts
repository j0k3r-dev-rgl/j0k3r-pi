import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  SUBAGENT_POOL_VERSION,
  acquireSubagentModel,
  releaseSubagentModel,
  resolveSubagentPoolPath,
  validateSubagentPoolState,
} from '../src/subagent-pool.ts';

/**
 * Every test runs against a private runtime directory through
 * `PI_SUPERVISOR_RUNTIME_DIR`, so no project, home or host file is touched. The
 * previously set environment is restored exactly, because `node --test` may share one
 * process across callbacks. The cross-process test passes the same runtime directory to
 * real child processes so the file coordination is exercised for real, with no provider.
 */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'subagent-pool-'));
  const previousRuntimeDir = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(dir, 'runtime');
  const cwd = join(dir, 'project');
  mkdirSync(cwd, { recursive: true });
  const path = () => resolveSubagentPoolPath(cwd);
  return {
    dir,
    cwd,
    path,
    /** A second project that shares the same runtime directory. */
    other: () => {
      const other = join(dir, 'other-project');
      mkdirSync(other, { recursive: true });
      return other;
    },
    /** Writes raw bytes exactly where the loader reads them. */
    seed: (content: string) => {
      mkdirSync(dirname(path()), { recursive: true, mode: 0o700 });
      writeFileSync(path(), content);
    },
    read: () => JSON.parse(readFileSync(path(), 'utf8')),
    close: () => {
      rmSync(dir, { recursive: true, force: true });
      if (previousRuntimeDir === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
      else process.env.PI_SUPERVISOR_RUNTIME_DIR = previousRuntimeDir;
    },
  };
}

const owner = (sessionId: string) => ({ pid: process.pid, sessionId });

/** Forces an ESRCH-proven dead PID by reaping a real child, never guessing a free number. */
function reapedPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  assert.equal(child.error, undefined);
  assert.equal(typeof child.pid, 'number');
  return child.pid as number;
}

function waitFor(predicate: () => boolean, timeoutMs: number, describe: () => string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out waiting: ${describe()}`));
      }
    }, 10);
  });
}

test('SUBAGENT-POOL-001 (S3): a first acquisition creates a versioned private pool file with least-loaded selection starting at the first candidate', () => {
  const s = scratch();
  try {
    assert.equal(existsSync(s.path()), false);
    const lease = acquireSubagentModel(s.cwd, ['p/a', 'p/b'], owner('s1'));
    assert.equal(typeof lease.token, 'string');
    assert.equal(lease.token.length > 0, true);
    assert.equal(lease.modelId, 'p/a', 'all candidates are equally idle, so the first is selected');

    assert.equal(SUBAGENT_POOL_VERSION, 1);
    const state = s.read();
    assert.deepEqual(Object.keys(state).sort(), ['leases', 'rotation', 'version']);
    assert.equal(state.version, 1);
    assert.equal(state.leases.length, 1);
    assert.deepEqual(Object.keys(state.leases[0]).sort(), ['acquiredAt', 'modelId', 'pid', 'sessionId', 'token']);
    assert.equal(state.leases[0].token, lease.token);
    assert.equal(state.leases[0].modelId, 'p/a');
    assert.equal(state.leases[0].pid, process.pid);
    assert.equal(state.leases[0].sessionId, 's1');
    assert.equal(typeof state.leases[0].acquiredAt, 'number');
    assert.deepEqual(state.rotation, { 'p/a': 1 });
    assert.equal(statSync(s.path()).mode & 0o777, 0o600, 'the pool file is private');
    assert.equal(statSync(dirname(s.path())).mode & 0o777, 0o700, 'the pool directory is private');
  } finally { s.close(); }
});

test('SUBAGENT-POOL-002 (S3): candidate and owner input is validated explicitly and refusals never touch storage', () => {
  const s = scratch();
  try {
    for (const bad of [
      [],
      ['p/a', 'p/a'],
      ['p/a', 'nope'],
      ['p/a', ''],
      ['p/a', ' p/b'],
      ['p/a', 42],
      'p/a',
      null,
    ] as unknown[]) {
      assert.throws(() => acquireSubagentModel(s.cwd, bad as string[], owner('s1')), /subagent pool/i, JSON.stringify(bad));
    }

    assert.throws(() => acquireSubagentModel(s.cwd, [], owner('s1')), /at least one/i, 'the empty list is refused explicitly');
    assert.equal(existsSync(s.path()), false, 'a refused input never creates the pool file');

    assert.throws(() => acquireSubagentModel(s.cwd, ['p/a'], { pid: 0, sessionId: 's1' }), /subagent pool/i);
    assert.throws(() => acquireSubagentModel(s.cwd, ['p/a'], { pid: 1.5, sessionId: 's1' }), /subagent pool/i);
    assert.throws(() => acquireSubagentModel(s.cwd, ['p/a'], { pid: process.pid, sessionId: '' }), /subagent pool/i);
    assert.throws(() => acquireSubagentModel(s.cwd, ['p/a'], null as unknown as { pid: number; sessionId: string }), /subagent pool/i);
    assert.equal(existsSync(s.path()), false, 'a refused owner never creates the pool file');
  } finally { s.close(); }
});

test('SUBAGENT-POOL-003 (S3): repeated acquisition by the same owner returns the same lease and rewrites nothing', () => {
  const s = scratch();
  try {
    const first = acquireSubagentModel(s.cwd, ['p/a', 'p/b'], owner('s1'));
    const before = readFileSync(s.path(), 'utf8');
    const second = acquireSubagentModel(s.cwd, ['p/a', 'p/b'], owner('s1'));
    assert.equal(second.token, first.token);
    assert.equal(second.modelId, first.modelId);
    assert.equal(readFileSync(s.path(), 'utf8'), before, 'an idempotent re-acquisition changes no bytes');
    assert.equal(s.read().leases.length, 1);
    // A different session in the same process is a different owner and gets its own lease.
    const other = acquireSubagentModel(s.cwd, ['p/a', 'p/b'], owner('s2'));
    assert.notEqual(other.token, first.token);
    assert.equal(s.read().leases.length, 2);
  } finally { s.close(); }
});

test('SUBAGENT-POOL-004 (S3): an owner lease outside the new candidate list is rejected predictably and leaks nothing', () => {
  const s = scratch();
  try {
    const held = acquireSubagentModel(s.cwd, ['p/a', 'p/b'], owner('s1'));
    const before = readFileSync(s.path());
    assert.throws(
      () => acquireSubagentModel(s.cwd, ['p/c', 'p/d'], owner('s1')),
      (err: any) => {
        assert.equal(err.code, 'existing_lease_outside_candidates');
        assert.match(err.message, /subagent pool/i);
        assert.equal(err.message.includes(held.modelId), false, 'the rejection never reveals the held model');
        return true;
      },
    );
    assert.deepEqual(readFileSync(s.path()), before, 'the rejected acquisition changed no bytes');
    assert.equal(s.read().leases.length, 1, 'the original lease is still held and counted');
    assert.equal(s.read().leases[0].token, held.token);

    // Releasing clears the conflict, and the owner can acquire from the new list.
    releaseSubagentModel(s.cwd, held, owner('s1'));
    const next = acquireSubagentModel(s.cwd, ['p/c', 'p/d'], owner('s1'));
    assert.equal(next.modelId, 'p/c');
  } finally { s.close(); }
});

test('SUBAGENT-POOL-005 (S3): least-loaded sharing balances active leases and a persistent rotation breaks ties', () => {
  const s = scratch();
  try {
    const candidates = ['p/a', 'p/b'];
    const held = [
      ['s1', acquireSubagentModel(s.cwd, candidates, owner('s1'))],
      ['s2', acquireSubagentModel(s.cwd, candidates, owner('s2'))],
      ['s3', acquireSubagentModel(s.cwd, candidates, owner('s3'))],
      ['s4', acquireSubagentModel(s.cwd, candidates, owner('s4'))],
    ] as const;
    assert.deepEqual(held.map(([, lease]) => lease.modelId), ['p/a', 'p/b', 'p/a', 'p/b'], 'ties rotate instead of piling on one model');
    assert.deepEqual(s.read().rotation, { 'p/a': 2, 'p/b': 2 });

    for (const [sessionId, lease] of held) releaseSubagentModel(s.cwd, lease, owner(sessionId));
    assert.deepEqual(s.read().leases, [], 'the file drains cleanly');
    assert.deepEqual(s.read().rotation, { 'p/a': 2, 'p/b': 2 }, 'rotation survives release');

    // A second project starts from its own seeded rotation, proving the counter is read back.
    const other = s.other();
    mkdirSync(dirname(resolveSubagentPoolPath(other)), { recursive: true, mode: 0o700 });
    writeFileSync(resolveSubagentPoolPath(other), JSON.stringify({ version: 1, leases: [], rotation: { 'p/a': 5, 'p/b': 0 } }));
    const picked = acquireSubagentModel(other, ['p/a', 'p/b'], owner('seed'));
    assert.equal(picked.modelId, 'p/b', 'the persisted rotation decides the tie');
    assert.deepEqual(JSON.parse(readFileSync(resolveSubagentPoolPath(other), 'utf8')).rotation, { 'p/a': 5, 'p/b': 1 });
  } finally { s.close(); }
});

test('SUBAGENT-POOL-006 (S3): release is idempotent and checks token, model identity and ownership', () => {
  const s = scratch();
  try {
    const lease = acquireSubagentModel(s.cwd, ['p/a'], owner('s1'));
    assert.throws(() => releaseSubagentModel(s.cwd, { token: '', modelId: 'p/a' }, owner('s1')), /subagent pool/i);
    assert.throws(() => releaseSubagentModel(s.cwd, { token: lease.token, modelId: 'nope' }, owner('s1')), /subagent pool/i);
    assert.throws(() => releaseSubagentModel(s.cwd, { token: lease.token, modelId: 'p/b' }, owner('s1')), /subagent pool/i, 'the token alone is not enough');
    assert.throws(() => releaseSubagentModel(s.cwd, lease, owner('s2')), /subagent pool/i, 'another session cannot release it');
    assert.throws(() => releaseSubagentModel(s.cwd, lease, { pid: process.pid + 1, sessionId: 's1' }), /subagent pool/i, 'another process cannot release it');
    assert.equal(s.read().leases.length, 1, 'a refused release never drops the lease');

    releaseSubagentModel(s.cwd, lease, owner('s1'));
    assert.deepEqual(s.read().leases, []);
    const after = readFileSync(s.path(), 'utf8');
    releaseSubagentModel(s.cwd, lease, owner('s1'));
    assert.equal(readFileSync(s.path(), 'utf8'), after, 'a repeated release is a no-op');
    releaseSubagentModel(s.cwd, { token: 'missing-token', modelId: 'p/a' }, owner('s1'));
    assert.equal(readFileSync(s.path(), 'utf8'), after, 'an unknown token is a no-op');
    // Releasing against a project that never had a pool file is also a safe no-op.
    const other = s.other();
    releaseSubagentModel(other, { token: 'missing-token', modelId: 'p/a' }, owner('s1'));
    assert.equal(existsSync(resolveSubagentPoolPath(other)), false);
  } finally { s.close(); }
});

test('SUBAGENT-POOL-007 (S3): an unusable pool document is rejected by both operations and its bytes are preserved', () => {
  const cases: Array<[string, string]> = [
    ['not JSON', '{ broken'],
    ['array root', '[]'],
    ['unsupported version', JSON.stringify({ version: 2, leases: [], rotation: {} })],
    ['leases not an array', JSON.stringify({ version: 1, leases: {}, rotation: {} })],
    ['lease missing a field', JSON.stringify({ version: 1, leases: [{ modelId: 'p/a', pid: 1, sessionId: 's', acquiredAt: 1 }], rotation: {} })],
    ['lease invalid model', JSON.stringify({ version: 1, leases: [{ token: 't', modelId: 'nope', pid: 1, sessionId: 's', acquiredAt: 1 }], rotation: {} })],
    ['rotation not an object', JSON.stringify({ version: 1, leases: [], rotation: [] })],
  ];
  for (const [name, content] of cases) {
    const s = scratch();
    try {
      s.seed(content);
      const before = readFileSync(s.path());
      assert.throws(() => acquireSubagentModel(s.cwd, ['p/a'], owner('s1')), /subagent pool/i, `${name}: acquire refuses`);
      assert.throws(() => releaseSubagentModel(s.cwd, { token: 't', modelId: 'p/a' }, owner('s1')), /subagent pool/i, `${name}: release refuses`);
      assert.deepEqual(readFileSync(s.path()), before, `${name}: bytes untouched`);
    } finally { s.close(); }
  }
});

test('SUBAGENT-POOL-008 (S3): only an ESRCH-proven dead process frees its lease; uncertain liveness stays occupied', () => {
  const s = scratch();
  try {
    const deadPid = reapedPid();
    let provenEsrch = false;
    try { process.kill(deadPid, 0); } catch (err: any) { provenEsrch = err.code === 'ESRCH'; }
    assert.equal(provenEsrch, true, 'the reaped child is really gone');

    s.seed(JSON.stringify({
      version: 1,
      leases: [
        { token: 'dead', modelId: 'p/a', pid: deadPid, sessionId: 'dead', acquiredAt: 1 },
        { token: 'eperm', modelId: 'p/a', pid: 1, sessionId: 'root', acquiredAt: 1 },
        { token: 'live', modelId: 'p/a', pid: process.pid, sessionId: 'self', acquiredAt: 1 },
      ],
      rotation: {},
    }));
    acquireSubagentModel(s.cwd, ['p/a'], owner('newcomer'));
    const tokens = s.read().leases.map((lease: any) => lease.token);
    assert.equal(tokens.includes('dead'), false, 'the ESRCH lease is pruned');
    assert.equal(tokens.includes('eperm'), true, 'an EPERM (foreign but present) process stays occupied');
    assert.equal(tokens.includes('live'), true, 'a live process stays occupied');
    assert.equal(tokens.length, 3, 'two surviving leases plus the new one');
  } finally { s.close(); }

  // Any liveness outcome other than ESRCH is uncertain and must keep the lease.
  const uncertain = scratch();
  try {
    uncertain.seed(JSON.stringify({
      version: 1,
      leases: [{ token: 'weird', modelId: 'p/a', pid: 4194000, sessionId: 'weird', acquiredAt: 1 }],
      rotation: {},
    }));
    const originalKill = process.kill;
    try {
      (process as unknown as { kill: unknown }).kill = () => {
        const error: any = new Error('unknown liveness outcome');
        error.code = 'EINVAL';
        throw error;
      };
      acquireSubagentModel(uncertain.cwd, ['p/a'], owner('probe'));
    } finally {
      (process as unknown as { kill: unknown }).kill = originalKill;
    }
    assert.equal(uncertain.read().leases.some((lease: any) => lease.token === 'weird'), true, 'an unknown liveness error is not a death certificate');
  } finally { uncertain.close(); }
});

test('SUBAGENT-POOL-009 (S3): a held lock surfaces a bounded error, preserves bytes and is never reclaimed', () => {
  const s = scratch();
  try {
    acquireSubagentModel(s.cwd, ['p/a'], owner('s1'));
    const before = readFileSync(s.path());
    const lockPath = `${s.path()}.lock`;
    const fd = openSync(lockPath, 'wx', 0o600);
    try {
      const started = Date.now();
      assert.throws(() => acquireSubagentModel(s.cwd, ['p/b'], owner('s2')), /lock held by another process/);
      assert.throws(() => releaseSubagentModel(s.cwd, { token: 'x', modelId: 'p/a' }, owner('s1')), /lock held by another process/);
      const elapsed = Date.now() - started;
      assert.equal(elapsed < 2000, true, `the lock refusal is bounded (${elapsed}ms), not an indefinite wait`);
      assert.equal(existsSync(lockPath), true, 'the held lock is never deleted by the pool');
    } finally {
      closeSync(fd);
      rmSync(lockPath, { force: true });
    }
    assert.deepEqual(readFileSync(s.path()), before, 'a refused operation changed no bytes');
    const lease = acquireSubagentModel(s.cwd, ['p/b'], owner('s2'));
    assert.equal(lease.modelId, 'p/b', 'once the lock is gone the same call succeeds');
  } finally { s.close(); }
});

test('SUBAGENT-POOL-010 (S4): the pool is per project and never touches the subagent configuration', () => {
  const s = scratch();
  try {
    const other = s.other();
    assert.notEqual(resolveSubagentPoolPath(s.cwd), resolveSubagentPoolPath(other));
    acquireSubagentModel(s.cwd, ['p/a'], owner('s1'));
    assert.equal(existsSync(resolveSubagentPoolPath(other)), false, 'another project keeps its own pool');
    assert.equal(existsSync(join(dirname(s.path()), 'subagents.json')), false, 'the pool never writes the subagent configuration');
    assert.equal(existsSync(join(dirname(s.path()), 'supervisor.json')), false, 'the pool never writes the supervisor configuration');
  } finally { s.close(); }
});

test('SUBAGENT-POOL-012 (S3): the stored schema is validated strictly field by field', () => {
  const valid = { version: 1, leases: [{ token: 't', modelId: 'p/a', pid: 1, sessionId: 's', acquiredAt: 1 }], rotation: { 'p/a': 1 } };
  assert.deepEqual(validateSubagentPoolState(valid), valid);
  assert.deepEqual(validateSubagentPoolState({ version: 1, leases: [], rotation: {} }), { version: 1, leases: [], rotation: {} });

  for (const rejected of [
    null,
    'text',
    42,
    [],
    { version: 2, leases: [], rotation: {} },
    { version: '1', leases: [], rotation: {} },
    { version: 1, leases: {}, rotation: {} },
    { version: 1, leases: [], rotation: [] },
    { version: 1, leases: [], rotation: { 'p/a': -1 } },
    { version: 1, leases: [], rotation: { 'p/a': 1.5 } },
    { version: 1, leases: [], rotation: { 'p/a': '1' } },
    { version: 1, leases: [], rotation: { nope: 1 } },
    { version: 1, leases: [{ token: '', modelId: 'p/a', pid: 1, sessionId: 's', acquiredAt: 1 }], rotation: {} },
    { version: 1, leases: [{ token: 't', modelId: 'p/a', pid: 0, sessionId: 's', acquiredAt: 1 }], rotation: {} },
    { version: 1, leases: [{ token: 't', modelId: 'p/a', pid: 1.5, sessionId: 's', acquiredAt: 1 }], rotation: {} },
    { version: 1, leases: [{ token: 't', modelId: 'p/a', pid: 1, sessionId: '', acquiredAt: 1 }], rotation: {} },
    { version: 1, leases: [{ token: 't', modelId: 'nope', pid: 1, sessionId: 's', acquiredAt: 1 }], rotation: {} },
    { version: 1, leases: [{ token: 't', modelId: 'p/a', pid: 1, sessionId: 's', acquiredAt: 'x' }], rotation: {} },
    { version: 1, leases: [{ token: 't', modelId: 'p/a', pid: 1, sessionId: 's', acquiredAt: 1, extra: 1 }], rotation: {} },
    { version: 1, leases: [{ token: 't', modelId: 'p/a', pid: 1, sessionId: 's' }], rotation: {} },
    { version: 1, leases: [{ token: 'a', modelId: 'p/a', pid: 1, sessionId: 's', acquiredAt: 1 }, { token: 'a', modelId: 'p/b', pid: 2, sessionId: 's2', acquiredAt: 1 }], rotation: {} },
    { version: 1, leases: [{ token: 'a', modelId: 'p/a', pid: 1, sessionId: 's', acquiredAt: 1 }, { token: 'b', modelId: 'p/b', pid: 1, sessionId: 's', acquiredAt: 1 }], rotation: {} },
    { version: 1, leases: [], rotation: {}, extra: 1 },
  ]) {
    assert.throws(() => validateSubagentPoolState(rejected), /subagent pool/i, JSON.stringify(rejected));
  }
});

/** Child program: acquire one lease per session, stay alive, then release on demand. */
const POOL_CHILD_SOURCE = `const { acquireSubagentModel, releaseSubagentModel } = await import(process.env.POOL_MODULE);

const cwd = process.env.POOL_CWD;
const candidates = JSON.parse(process.env.POOL_CANDIDATES);
const sessions = JSON.parse(process.env.POOL_SESSIONS);

const spin = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* bounded busy wait */ } };

function acquireWithBoundedRetry(owner) {
  for (let attempt = 0; attempt < 400; attempt++) {
    try {
      return acquireSubagentModel(cwd, candidates, owner);
    } catch (err) {
      if (/lock held by another process/i.test(String(err && err.message))) { spin(5); continue; }
      throw err;
    }
  }
  throw new Error('child exhausted lock retries');
}

function releaseWithBoundedRetry(leaseRef, owner) {
  for (let attempt = 0; attempt < 400; attempt++) {
    try {
      releaseSubagentModel(cwd, leaseRef, owner);
      return;
    } catch (err) {
      if (/lock held by another process/i.test(String(err && err.message))) { spin(5); continue; }
      throw err;
    }
  }
  throw new Error('child exhausted release retries');
}

const leases = [];
for (const sessionId of sessions) {
  const acquired = acquireWithBoundedRetry({ pid: process.pid, sessionId });
  leases.push({ sessionId, token: acquired.token, modelId: acquired.modelId });
}
process.stdout.write(JSON.stringify({ type: 'ready', leases }) + '\\n');

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line !== 'release') continue;
    for (const item of [...leases].reverse()) {
      releaseWithBoundedRetry({ token: item.token, modelId: item.modelId }, { pid: process.pid, sessionId: item.sessionId });
    }
    process.stdout.write(JSON.stringify({ type: 'released' }) + '\\n');
    process.exit(0);
  }
});
process.stdin.resume();
`;

test('SUBAGENT-POOL-011 (S3): separate processes coordinate concurrent acquisitions and releases through the shared file', { timeout: 25000 }, async () => {
  const s = scratch();
  try {
    const childScript = join(s.dir, 'pool-child.mjs');
    writeFileSync(childScript, POOL_CHILD_SOURCE);
    const poolModule = new URL('../src/subagent-pool.ts', import.meta.url).href;
    const candidates = ['p/a', 'p/b', 'p/c'];
    const childCount = 6;
    const perChild = 4;

    interface ChildRecord { child: ReturnType<typeof spawn>; out: string; err: string; ready: { leases: Array<{ sessionId: string; token: string; modelId: string }> } | null; }
    const children: ChildRecord[] = [];
    for (let index = 0; index < childCount; index++) {
      const sessions = Array.from({ length: perChild }, (_, slot) => `session-${index}-${slot}`);
      const child = spawn(process.execPath, [childScript], {
        env: {
          ...process.env,
          POOL_MODULE: poolModule,
          POOL_CWD: s.cwd,
          POOL_CANDIDATES: JSON.stringify(candidates),
          POOL_SESSIONS: JSON.stringify(sessions),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const record: ChildRecord = { child, out: '', err: '', ready: null };
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        record.out += chunk;
        for (const line of record.out.split('\n')) {
          if (!line.includes('"type":"ready"')) continue;
          try { record.ready = JSON.parse(line); } catch { /* wait for the complete line */ }
        }
      });
      child.stderr?.on('data', (chunk: string) => { record.err += chunk; });
      children.push(record);
    }

    await waitFor(
      () => children.every(record => record.ready !== null),
      20000,
      () => children.map(record => `code=${record.child.exitCode} err=${record.err.trim()}`).join(' | '),
    );

    const allLeases = children.flatMap(record => record.ready!.leases);
    assert.equal(allLeases.length, childCount * perChild);
    assert.equal(new Set(allLeases.map(lease => lease.token)).size, allLeases.length, 'every concurrent acquisition got a unique token');
    const counts = new Map(candidates.map(id => [id, 0]));
    for (const lease of allLeases) counts.set(lease.modelId, (counts.get(lease.modelId) ?? 0) + 1);
    assert.deepEqual([...counts.values()], [8, 8, 8], 'least-loaded sharing spreads leases evenly across processes');
    assert.equal(s.read().leases.length, childCount * perChild, 'the file holds every live lease exactly once');

    for (const record of children) record.child.stdin?.write('release\n');
    await waitFor(
      () => children.every(record => record.child.exitCode !== null || record.child.signalCode !== null),
      20000,
      () => children.map(record => `code=${record.child.exitCode} err=${record.err.trim()}`).join(' | '),
    );
    for (const record of children) {
      assert.equal(record.child.exitCode, 0, `child exited cleanly (stderr: ${record.err})`);
    }

    const drained = s.read();
    assert.deepEqual(drained.leases, [], 'every cross-process release reached the shared file');
    assert.deepEqual(drained.rotation, { 'p/a': 8, 'p/b': 8, 'p/c': 8 });
  } finally { s.close(); }
});
