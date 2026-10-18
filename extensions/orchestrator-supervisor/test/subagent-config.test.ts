import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  DEFAULT_SUBAGENT_CONFIG,
  SUBAGENT_MODEL_COUNT_DEFAULT,
  SUBAGENT_MODEL_COUNT_MAX,
  SUBAGENT_MODEL_COUNT_MIN,
  getActiveSubagentCandidateIds,
  loadSubagentConfig,
  resolveSubagentConfigPath,
  updateSubagentConfig,
  validateSubagentConfig,
} from '../src/subagent-config.ts';
import { DEFAULT_SUPERVISOR_CONFIG, loadSupervisorConfig, resolveSupervisorConfigPath, updateSupervisorConfig, validateSupervisorConfig } from '../src/supervisor-config.ts';

/**
 * Every test runs against a private runtime directory through
 * `PI_SUPERVISOR_RUNTIME_DIR`, so no project, home or host file is touched. The
 * previously set environment is restored exactly, because `node --test` shares one
 * process across files.
 */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'subagent-config-'));
  const previousRuntimeDir = process.env.PI_SUPERVISOR_RUNTIME_DIR;
  const previousDisabled = process.env.PI_SUPERVISOR_DISABLED;

  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(dir, 'runtime');
  delete process.env.PI_SUPERVISOR_DISABLED;

  const cwd = join(dir, 'project');
  mkdirSync(cwd, { recursive: true });
  return {
    dir,
    cwd,
    path: () => resolveSubagentConfigPath(cwd),
    /** A second project that shares the same runtime directory. */
    other: () => {
      const other = join(dir, 'other-project');
      mkdirSync(other, { recursive: true });
      return other;
    },
    /** Writes raw bytes exactly where the loader reads them. */
    seed: (content: string) => {
      mkdirSync(dirname(resolveSubagentConfigPath(cwd)), { recursive: true, mode: 0o700 });
      writeFileSync(resolveSubagentConfigPath(cwd), content);
    },
    close: () => {
      rmSync(dir, { recursive: true, force: true });
      if (previousRuntimeDir === undefined) delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
      else process.env.PI_SUPERVISOR_RUNTIME_DIR = previousRuntimeDir;
      if (previousDisabled === undefined) delete process.env.PI_SUPERVISOR_DISABLED;
      else process.env.PI_SUPERVISOR_DISABLED = previousDisabled;
    },
  };
}

const IDS_22 = Array.from({ length: 22 }, (_, index) => `provider/model-${index + 1}`);

test('SUBAGENT-CONFIG-001 (S2, S3, S6): a missing file means the feature is disabled with count 5 and no slots', () => {
  const s = scratch();
  try {
    assert.equal(existsSync(s.path()), false);
    const loaded = loadSubagentConfig(s.cwd);
    assert.equal(loaded.source, 'default');
    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.config, DEFAULT_SUBAGENT_CONFIG);
    assert.equal(loaded.config.enabled, false);
    assert.equal(SUBAGENT_MODEL_COUNT_DEFAULT, 5);
    assert.equal(loaded.config.modelCount, 5, 'the documented default count is 5');
    assert.deepEqual(loaded.config.priorityCandidateIds, []);
    assert.deepEqual(getActiveSubagentCandidateIds(loaded.config), []);
    // Reading never creates the file or its directory.
    assert.equal(existsSync(s.path()), false);
  } finally { s.close(); }
});

test('SUBAGENT-CONFIG-002 (S4): a written configuration round-trips through a fresh read with private atomic bytes', () => {
  const s = scratch();
  try {
    const saved = updateSubagentConfig(s.cwd, {
      enabled: true,
      modelCount: 3,
      priorityCandidateIds: ['cliproxyapi/main/gpt-6.1-sol', 'anthropic/claude-sonnet-4-5', 'openrouter/meta-llama/llama-3-70b'],
    });
    assert.equal(saved.enabled, true);
    assert.equal(saved.modelCount, 3);
    assert.deepEqual(saved.priorityCandidateIds, ['cliproxyapi/main/gpt-6.1-sol', 'anthropic/claude-sonnet-4-5', 'openrouter/meta-llama/llama-3-70b']);

    // The stored document is versioned and contains exactly the documented fields.
    const onDisk = readFileSync(s.path(), 'utf8');
    assert.equal(onDisk.endsWith('\n'), true, 'JSON document ends with a newline');
    assert.deepEqual(JSON.parse(onDisk), {
      version: 1,
      enabled: true,
      modelCount: 3,
      priorityCandidateIds: ['cliproxyapi/main/gpt-6.1-sol', 'anthropic/claude-sonnet-4-5', 'openrouter/meta-llama/llama-3-70b'],
    });
    assert.equal(statSync(s.path()).mode & 0o777, 0o600, 'file is private');
    assert.equal(statSync(dirname(s.path())).mode & 0o777, 0o700, 'directory is private');
    // The atomic writer leaves no temporary sibling behind.
    assert.deepEqual(readdirSync(dirname(s.path())), ['subagents.json']);

    // A separate read - as a reopened panel would do - sees the same values.
    const reopened = loadSubagentConfig(s.cwd);
    assert.equal(reopened.source, 'file');
    assert.equal(reopened.error, undefined);
    assert.deepEqual(reopened.config, saved);

    // Disabling persists too, and the count/slots survive the switch.
    const disabled = updateSubagentConfig(s.cwd, { enabled: false });
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.modelCount, 3);
    assert.deepEqual(loadSubagentConfig(s.cwd).config.priorityCandidateIds, saved.priorityCandidateIds);
  } finally { s.close(); }
});

test('SUBAGENT-CONFIG-003 (S4): an unusable document is reported, fails closed and is never rewritten', () => {
  const cases: Array<[string, string]> = [
    ['not JSON', '{ broken'],
    ['not an object', '"nope"'],
    ['array root', '[]'],
    ['unsupported version', JSON.stringify({ version: 2, enabled: true })],
    ['non-boolean enabled', JSON.stringify({ version: 1, enabled: 'yes' })],
    ['count below minimum', JSON.stringify({ version: 1, modelCount: 1 })],
    ['count above maximum', JSON.stringify({ version: 1, modelCount: 21 })],
    ['count not an integer', JSON.stringify({ version: 1, modelCount: 2.5 })],
    ['count not a number', JSON.stringify({ version: 1, modelCount: '5' })],
    ['slots not an array', JSON.stringify({ version: 1, priorityCandidateIds: 'provider/model' })],
    ['malformed slot id', JSON.stringify({ version: 1, priorityCandidateIds: ['no-provider'] })],
    ['slot id with whitespace', JSON.stringify({ version: 1, priorityCandidateIds: ['provider/model one'] })],
    ['duplicate slot', JSON.stringify({ version: 1, priorityCandidateIds: ['p/a', 'p/a'] })],
    ['duplicate hidden slot', JSON.stringify({ version: 1, modelCount: 2, priorityCandidateIds: ['p/a', 'p/b', 'p/a'] })],
  ];

  for (const [name, content] of cases) {
    const s = scratch();
    try {
      s.seed(content);
      const before = readFileSync(s.path());

      const loaded = loadSubagentConfig(s.cwd);
      assert.equal(loaded.source, 'invalid', `${name}: source`);
      assert.equal(typeof loaded.error, 'string', `${name}: error reported`);
      assert.match(loaded.error as string, /subagent/i, `${name}: error names the subagent document`);
      // Fail closed: an unusable document never turns the feature on.
      assert.equal(loaded.config.enabled, false, `${name}: disabled`);
      assert.equal(loaded.config.modelCount, DEFAULT_SUBAGENT_CONFIG.modelCount, `${name}: default count`);
      assert.deepEqual(readFileSync(s.path()), before, `${name}: file untouched by reading`);

      // A writer refuses instead of papering over the failure.
      assert.throws(() => updateSubagentConfig(s.cwd, { enabled: true }), /subagent configuration/i, `${name}: update refuses`);
      assert.throws(() => updateSubagentConfig(s.cwd, { enabled: true }), /subagent configuration/i, `${name}: refusal is repeatable`);
      assert.deepEqual(readFileSync(s.path()), before, `${name}: file untouched after refused update`);
    } finally { s.close(); }
  }
});

test('SUBAGENT-CONFIG-004 (S3): the model count is bounded to 2..20 and a rejected count changes no bytes', () => {
  const s = scratch();
  try {
    assert.equal(SUBAGENT_MODEL_COUNT_MIN, 2);
    assert.equal(SUBAGENT_MODEL_COUNT_MAX, 20);

    // Both boundaries are accepted and stored.
    assert.equal(updateSubagentConfig(s.cwd, { modelCount: SUBAGENT_MODEL_COUNT_MIN }).modelCount, 2);
    assert.equal(loadSubagentConfig(s.cwd).config.modelCount, 2);
    assert.equal(updateSubagentConfig(s.cwd, { modelCount: SUBAGENT_MODEL_COUNT_MAX }).modelCount, 20);
    assert.equal(loadSubagentConfig(s.cwd).config.modelCount, 20);

    updateSubagentConfig(s.cwd, { modelCount: 4 });
    const before = readFileSync(s.path());
    const beforeState = loadSubagentConfig(s.cwd).config;
    for (const rejected of [0, 1, 21, 100, 3.5, '7', null, true]) {
      assert.throws(
        () => updateSubagentConfig(s.cwd, { modelCount: rejected as unknown as number }),
        /modelCount must be an integer between 2 and 20/,
        `count ${String(rejected)} is refused`,
      );
    }
    assert.deepEqual(readFileSync(s.path()), before, 'rejected counts left the bytes unchanged');
    assert.deepEqual(loadSubagentConfig(s.cwd).config, beforeState, 'rejected counts left the effective state unchanged');

    // A fully specified document is validated on the same boundary.
    assert.throws(() => validateSubagentConfig({ version: 1, enabled: true, modelCount: 1, priorityCandidateIds: [] }), /modelCount/);
    assert.throws(() => validateSubagentConfig({ version: 1, enabled: true, modelCount: 21, priorityCandidateIds: [] }), /modelCount/);
  } finally { s.close(); }
});

test('SUBAGENT-CONFIG-005 (S3, S4): changing the count keeps the whole ordered list, showing only the first N slots', () => {
  const s = scratch();
  try {
    updateSubagentConfig(s.cwd, { priorityCandidateIds: IDS_22, modelCount: 2 });
    const two = loadSubagentConfig(s.cwd).config;
    assert.equal(two.modelCount, 2);
    assert.deepEqual(two.priorityCandidateIds, IDS_22, 'the saved list is stored in full');
    assert.deepEqual(getActiveSubagentCandidateIds(two), IDS_22.slice(0, 2));

    // Raising the count reveals more of the same list without rewriting its order.
    const twenty = updateSubagentConfig(s.cwd, { modelCount: 20 });
    assert.deepEqual(twenty.priorityCandidateIds, IDS_22, 'raising the count deleted nothing');
    assert.deepEqual(getActiveSubagentCandidateIds(twenty), IDS_22.slice(0, 20));
    assert.deepEqual(loadSubagentConfig(s.cwd).config.priorityCandidateIds, IDS_22);

    // Lowering it hides entries again, still keeping every one of them.
    const back = updateSubagentConfig(s.cwd, { modelCount: 3 });
    assert.deepEqual(back.priorityCandidateIds, IDS_22);
    assert.deepEqual(getActiveSubagentCandidateIds(back), IDS_22.slice(0, 3));

    // Fewer saved entries than the count: only what exists is active, nothing is invented.
    updateSubagentConfig(s.cwd, { priorityCandidateIds: ['p/only'], modelCount: 20 });
    const sparse = loadSubagentConfig(s.cwd).config;
    assert.deepEqual(sparse.priorityCandidateIds, ['p/only']);
    assert.deepEqual(getActiveSubagentCandidateIds(sparse), ['p/only']);

    // An empty list is allowed and means no configured subagent model.
    const empty = updateSubagentConfig(s.cwd, { priorityCandidateIds: [] });
    assert.deepEqual(empty.priorityCandidateIds, []);
    assert.deepEqual(getActiveSubagentCandidateIds(empty), []);
  } finally { s.close(); }
});

test('SUBAGENT-CONFIG-006 (S4): every saved model must be distinct and valid, and rejected lists change no bytes', () => {
  const s = scratch();
  try {
    updateSubagentConfig(s.cwd, { modelCount: 2, priorityCandidateIds: ['p/a', 'p/b'] });
    const before = readFileSync(s.path());

    // Duplicates are refused even when the duplicate sits past the visible slot count.
    assert.throws(() => updateSubagentConfig(s.cwd, { priorityCandidateIds: ['p/a', 'p/a'] }), /duplicate/i);
    assert.throws(() => updateSubagentConfig(s.cwd, { priorityCandidateIds: ['p/a', 'p/b', 'p/a'] }), /duplicate/i);
    // Identity is the full provider/model pair, so a different provider is a distinct model.
    assert.throws(() => updateSubagentConfig(s.cwd, { priorityCandidateIds: ['p/a', 'p/b', 'q/a', 'q/a'] }), /duplicate/i);
    // Non-candidate strings are refused instead of stored.
    for (const invalid of ['provider', '/model', 'provider/', 'provider//model', 'provider/mod el', ' provider/model', 42, null]) {
      assert.throws(() => updateSubagentConfig(s.cwd, { priorityCandidateIds: [invalid as unknown as string] }), /candidate|Malformed/i, `rejects ${String(invalid)}`);
    }
    assert.deepEqual(readFileSync(s.path()), before, 'rejected lists left the bytes unchanged');
    assert.deepEqual(loadSubagentConfig(s.cwd).config.priorityCandidateIds, ['p/a', 'p/b']);

    // A slash inside the model id is a legitimate distinct candidate.
    const nested = updateSubagentConfig(s.cwd, {
      priorityCandidateIds: ['cliproxyapi/main/gpt-6.1-sol', 'cliproxyapi/main/gpt-6.1', 'openrouter/meta-llama/llama-3-70b'],
    });
    assert.deepEqual(nested.priorityCandidateIds, ['cliproxyapi/main/gpt-6.1-sol', 'cliproxyapi/main/gpt-6.1', 'openrouter/meta-llama/llama-3-70b']);

    // Reordering and clearing are allowed; order is preserved verbatim.
    const reordered = updateSubagentConfig(s.cwd, { priorityCandidateIds: ['openrouter/meta-llama/llama-3-70b', 'cliproxyapi/main/gpt-6.1-sol'] });
    assert.deepEqual(reordered.priorityCandidateIds, ['openrouter/meta-llama/llama-3-70b', 'cliproxyapi/main/gpt-6.1-sol']);
    assert.deepEqual(loadSubagentConfig(s.cwd).config.priorityCandidateIds, reordered.priorityCandidateIds);
  } finally { s.close(); }
});

test('SUBAGENT-CONFIG-011: empty slot positions persist without weakening model uniqueness', () => {
  const s = scratch();
  try {
    const slots = ['p/a', '', 'p/c', ''];
    updateSubagentConfig(s.cwd, { modelCount: 3, priorityCandidateIds: slots });
    assert.deepEqual(loadSubagentConfig(s.cwd).config.priorityCandidateIds, slots);
    assert.deepEqual(JSON.parse(readFileSync(s.path(), 'utf8')).priorityCandidateIds, slots);
    assert.deepEqual(getActiveSubagentCandidateIds(loadSubagentConfig(s.cwd).config), ['p/a', 'p/c']);
    const before = readFileSync(s.path(), 'utf8');
    assert.throws(() => updateSubagentConfig(s.cwd, { priorityCandidateIds: ['p/a', '', 'p/a'] }), /duplicate/);
    assert.throws(() => updateSubagentConfig(s.cwd, { priorityCandidateIds: ['p/a', ' ', 'p/c'] }), /candidate/);
    assert.equal(readFileSync(s.path(), 'utf8'), before);
    updateSubagentConfig(s.cwd, { modelCount: 2 });
    assert.deepEqual(loadSubagentConfig(s.cwd).config.priorityCandidateIds, slots);
    updateSubagentConfig(s.cwd, { modelCount: 4 });
    assert.deepEqual(loadSubagentConfig(s.cwd).config.priorityCandidateIds, slots);
  } finally { s.close(); }
});

test('SUBAGENT-CONFIG-007 (S6): the subagent document is per project and independent of the supervisor document', () => {
  const s = scratch();
  try {
    const other = s.other();
    assert.notEqual(resolveSubagentConfigPath(s.cwd), resolveSubagentConfigPath(other));
    assert.notEqual(resolveSubagentConfigPath(s.cwd), resolveSupervisorConfigPath(s.cwd), 'subagents.json is its own file');

    // Enabling subagents leaves the orchestrator settings untouched.
    updateSubagentConfig(s.cwd, { enabled: true, modelCount: 6, priorityCandidateIds: ['p/a'] });
    assert.deepEqual(loadSupervisorConfig(s.cwd).config, DEFAULT_SUPERVISOR_CONFIG);
    assert.equal(loadSupervisorConfig(s.cwd).source, 'default');

    // The supervisor host kill switch is about the main agent, not the subagent document.
    process.env.PI_SUPERVISOR_DISABLED = '1';
    assert.equal(loadSubagentConfig(s.cwd).config.enabled, true, 'subagents stay independent of the supervisor switch');
    assert.equal(loadSubagentConfig(s.cwd).source, 'file');
    delete process.env.PI_SUPERVISOR_DISABLED;

    // A broken supervisor document neither hides nor rewrites the subagent configuration.
    mkdirSync(dirname(resolveSupervisorConfigPath(s.cwd)), { recursive: true, mode: 0o700 });
    writeFileSync(resolveSupervisorConfigPath(s.cwd), '{ broken');
    const subagentBefore = readFileSync(s.path());
    assert.equal(loadSupervisorConfig(s.cwd).source, 'invalid');
    const subagentAfter = loadSubagentConfig(s.cwd);
    assert.equal(subagentAfter.source, 'file');
    assert.equal(subagentAfter.config.enabled, true);
    assert.deepEqual(readFileSync(s.path()), subagentBefore, 'an invalid supervisor file does not touch subagents.json');

    // A broken subagent document neither hides nor rewrites the supervisor configuration.
    rmSync(resolveSupervisorConfigPath(s.cwd), { force: true });
    updateSupervisorConfig(s.cwd, { enabled: true, modelCount: 4, priorityCandidateIds: ['p/z'] });
    const supervisorBefore = readFileSync(resolveSupervisorConfigPath(s.cwd));
    s.seed('{ broken');
    const brokenSubagent = readFileSync(s.path());
    assert.equal(loadSubagentConfig(s.cwd).source, 'invalid');
    const supervisorAfter = loadSupervisorConfig(s.cwd);
    assert.equal(supervisorAfter.source, 'file');
    assert.deepEqual(supervisorAfter.config, validateSupervisorConfig({ version: 1, ...DEFAULT_SUPERVISOR_CONFIG, enabled: true, modelCount: 4, priorityCandidateIds: ['p/z'] }));
    assert.deepEqual(readFileSync(resolveSupervisorConfigPath(s.cwd)), supervisorBefore, 'an invalid subagents.json does not touch supervisor.json');
    assert.deepEqual(readFileSync(s.path()), brokenSubagent);

    // Another project keeps its own independent defaults.
    assert.equal(loadSubagentConfig(other).source, 'default');
    assert.equal(loadSubagentConfig(other).config.enabled, false);
    assert.deepEqual(loadSubagentConfig(other).config.priorityCandidateIds, []);
  } finally { s.close(); }
});

test('SUBAGENT-CONFIG-008 (S2, S3, S4): validation normalizes documented documents and rejects every unnamed field', () => {
  // Documented defaults round-trip, and absent keys keep their default.
  assert.deepEqual(validateSubagentConfig({ version: 1, ...DEFAULT_SUBAGENT_CONFIG }), DEFAULT_SUBAGENT_CONFIG);
  assert.deepEqual(validateSubagentConfig({ version: 1 }), DEFAULT_SUBAGENT_CONFIG);
  assert.deepEqual(validateSubagentConfig({}), DEFAULT_SUBAGENT_CONFIG);
  assert.deepEqual(
    validateSubagentConfig({ version: 1, enabled: true, modelCount: 2, priorityCandidateIds: ['p/a', 'p/b'] }),
    { enabled: true, modelCount: 2, priorityCandidateIds: ['p/a', 'p/b'] },
  );

  if (!Object.isFrozen(DEFAULT_SUBAGENT_CONFIG.priorityCandidateIds)) assert.fail('default slot list must be immutable');
  for (const rejected of [
    null,
    'text',
    42,
    [],
    { version: 0 },
    { version: 2 },
    { version: '1' },
    { enabled: 'true' },
    { enabled: 1 },
    { modelCount: 1 },
    { modelCount: 21 },
    { modelCount: Number.NaN },
    { modelCount: Number.POSITIVE_INFINITY },
    { priorityCandidateIds: 'p/a' },
    { priorityCandidateIds: ['p/a', 'p/a'] },
    { priorityCandidateIds: ['p/a', 7] },
    { priorityCandidateIds: [{}] },
  ]) {
    assert.throws(() => validateSubagentConfig(rejected), /Malformed subagent configuration/i, JSON.stringify(rejected));
  }
});

test('SUBAGENT-CONFIG-009 (S4): a patch changes only the named fields and unknown stored keys are dropped', () => {
  const s = scratch();
  try {
    updateSubagentConfig(s.cwd, { enabled: true, modelCount: 7, priorityCandidateIds: ['p/a', 'p/b', 'p/c'] });
    const after = updateSubagentConfig(s.cwd, { modelCount: 3 });
    assert.equal(after.enabled, true, 'enabled preserved');
    assert.equal(after.modelCount, 3);
    assert.deepEqual(after.priorityCandidateIds, ['p/a', 'p/b', 'p/c'], 'slots preserved by a count patch');

    const switched = updateSubagentConfig(s.cwd, { enabled: false });
    assert.equal(switched.enabled, false);
    assert.equal(switched.modelCount, 3, 'a switch patch never resets the count');
    assert.deepEqual(switched.priorityCandidateIds, ['p/a', 'p/b', 'p/c']);

    // A hand-written document with extra keys is normalized on the next write.
    s.seed(JSON.stringify({ version: 1, enabled: true, modelCount: 2, priorityCandidateIds: ['p/a'], legacy: 'ignored' }));
    assert.deepEqual(Object.keys(loadSubagentConfig(s.cwd).config).sort(), ['enabled', 'modelCount', 'priorityCandidateIds']);
    updateSubagentConfig(s.cwd, { modelCount: 4 });
    assert.deepEqual(JSON.parse(readFileSync(s.path(), 'utf8')), { version: 1, enabled: true, modelCount: 4, priorityCandidateIds: ['p/a'] });
  } finally { s.close(); }
});

test('SUBAGENT-CONFIG-010 (S4): a held lock refuses the write and leaves the stored document untouched', () => {
  const s = scratch();
  try {
    updateSubagentConfig(s.cwd, { enabled: true, modelCount: 4 });
    const before = readFileSync(s.path());
    const fd = openSync(`${s.path()}.lock`, 'wx', 0o600);
    try {
      assert.throws(() => updateSubagentConfig(s.cwd, { enabled: false }), /lock held by another process/);
    } finally {
      closeSync(fd);
      rmSync(`${s.path()}.lock`, { force: true });
    }
    assert.deepEqual(readFileSync(s.path()), before);
    assert.equal(loadSubagentConfig(s.cwd).config.enabled, true);
    // Once the lock is gone the very same write succeeds.
    assert.equal(updateSubagentConfig(s.cwd, { enabled: false }).enabled, false);
  } finally { s.close(); }
});

test('SUBAGENT-CONFIG-012 (S1, S2): modelEfforts is absent by default, and an old file without it stays absent', () => {
  assert.equal(DEFAULT_SUBAGENT_CONFIG.modelEfforts, undefined);
  assert.equal(validateSubagentConfig({ version: 1 }).modelEfforts, undefined);
  assert.equal(validateSubagentConfig({ version: 1, enabled: true, modelCount: 6 }).modelEfforts, undefined);
});

test('SUBAGENT-CONFIG-013 (S1, S2): modelEfforts round-trips through update/load, keyed by full candidate ID', () => {
  const s = scratch();
  try {
    const efforts = { 'cliproxyapi/main/gpt-6.1-sol': 'medium', 'openrouter/meta-llama/llama-3-70b': 'off' };
    const saved = updateSubagentConfig(s.cwd, { modelEfforts: efforts });
    assert.deepEqual(saved.modelEfforts, efforts);
    const loaded = loadSubagentConfig(s.cwd);
    assert.equal(loaded.source, 'file');
    assert.deepEqual(loaded.config.modelEfforts, efforts);

    // A patch to an unrelated field preserves the stored effort map untouched.
    const afterPatch = updateSubagentConfig(s.cwd, { modelCount: 8 });
    assert.deepEqual(afterPatch.modelEfforts, efforts);
  } finally { s.close(); }
});

test('SUBAGENT-CONFIG-014 (S1, S2): modelEfforts validation never truncates an entry hidden by modelCount', () => {
  const s = scratch();
  try {
    const efforts = { 'p/a': 'high', 'p/not-visible': 'low' };
    const saved = updateSubagentConfig(s.cwd, { priorityCandidateIds: ['p/a', 'p/b', 'p/c'], modelCount: 2, modelEfforts: efforts });
    assert.deepEqual(saved.modelEfforts, efforts);
    assert.deepEqual(loadSubagentConfig(s.cwd).config.modelEfforts, efforts);
  } finally { s.close(); }
});

test('SUBAGENT-CONFIG-015 (S1, S2): an unsupported effort value is refused before writing anything', () => {
  const s = scratch();
  try {
    updateSubagentConfig(s.cwd, { enabled: true });
    const before = readFileSync(s.path());
    assert.throws(
      () => updateSubagentConfig(s.cwd, { modelEfforts: { 'p/a': 'extreme' } as any }),
      /unsupported effort/,
    );
    assert.deepEqual(readFileSync(s.path()), before);
    assert.throws(() => validateSubagentConfig({ version: 1, modelEfforts: { 'p/a': 'nope' } }), /unsupported effort/);
  } finally { s.close(); }
});
