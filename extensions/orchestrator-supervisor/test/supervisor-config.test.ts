import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, openSync, closeSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  DEFAULT_SUPERVISOR_CONFIG,
  getActiveCandidateIds,
  isSupervisorEnabled,
  loadSupervisorConfig,
  resolveSupervisorConfigPath,
  saveSupervisorConfig,
  updateSupervisorConfig,
  validateSupervisorConfig,
} from '../src/supervisor-config.ts';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'supervisor-config-'));
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(dir, 'runtime');
  delete process.env.PI_SUPERVISOR_DISABLED;
  delete process.env.GENTLE_SUPERVISOR_RUNTIME_DIR;
  delete process.env.GENTLE_SUPERVISOR_DISABLED;
  const cwd = join(dir, 'project');
  mkdirSync(cwd, { recursive: true });
  return {
    dir,
    cwd,
    path: () => resolveSupervisorConfigPath(cwd),
    close: () => {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
      delete process.env.PI_SUPERVISOR_DISABLED;
      delete process.env.GENTLE_SUPERVISOR_RUNTIME_DIR;
      delete process.env.GENTLE_SUPERVISOR_DISABLED;
    },
  };
}

test('SUPERVISOR-CONFIG-001: a missing file means enabled with documented defaults', () => {
  const s = scratch();
  try {
    assert.equal(existsSync(s.path()), false);
    const loaded = loadSupervisorConfig(s.cwd);
    assert.equal(loaded.source, 'default');
    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.config, DEFAULT_SUPERVISOR_CONFIG);
    assert.equal(loaded.config.enabled, true);
    assert.deepEqual(loaded.config.priorityCandidateIds, []);
    assert.equal(loaded.config.modelCount, 5);
    assert.equal(loaded.config.rotationThresholdPercent, 90);
    assert.equal(loaded.config.codexQuotaThresholdPercent, 95);
    assert.equal(loaded.config.maxTransientFailures, 3);
    assert.equal(loaded.config.cooldownMinutes, 15);
    assert.equal(loaded.config.pollIntervalSeconds, 60);
    assert.equal(isSupervisorEnabled(s.cwd), true);
    // Reading never creates the file.
    assert.equal(existsSync(s.path()), false);
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-002: saving round-trips through a fresh read, private and atomic', () => {
  const s = scratch();
  try {
    const saved = saveSupervisorConfig(s.cwd, {
      ...DEFAULT_SUPERVISOR_CONFIG,
      enabled: false,
      priorityCandidateIds: ['cliproxyapi/main/gpt-6.1-sol', 'anthropic/claude-sonnet-4-5'],
    });
    assert.equal(saved.enabled, false);
    assert.equal(statSync(s.path()).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(s.path())).mode & 0o777, 0o700);

    const loaded = loadSupervisorConfig(s.cwd);
    assert.equal(loaded.source, 'file');
    assert.equal(loaded.config.enabled, false);
    assert.deepEqual(loaded.config.priorityCandidateIds, ['cliproxyapi/main/gpt-6.1-sol', 'anthropic/claude-sonnet-4-5']);
    assert.equal(isSupervisorEnabled(s.cwd), false);
    // No temp files are left behind.
    const leftovers = readFileSync(s.path(), 'utf8');
    assert.equal(leftovers.endsWith('\n'), true);
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-003: a malformed file disables the supervisor, reports why and is never rewritten', () => {
  const cases: Array<[string, string]> = [
    ['not JSON', '{ broken'],
    ['not an object', '"nope"'],
    ['unsupported version', JSON.stringify({ version: 2, enabled: true })],
    ['non-boolean enabled', JSON.stringify({ version: 1, enabled: 'yes' })],
    ['rotation out of range', JSON.stringify({ version: 1, enabled: true, rotationThresholdPercent: 0 })],
    ['quota out of range', JSON.stringify({ version: 1, enabled: true, codexQuotaThresholdPercent: 101 })],
    ['failures out of range', JSON.stringify({ version: 1, enabled: true, maxTransientFailures: 0 })],
    ['cooldown out of range', JSON.stringify({ version: 1, enabled: true, cooldownMinutes: 0 })],
    ['poll out of range', JSON.stringify({ version: 1, enabled: true, pollIntervalSeconds: 2 })],
    ['count below minimum', JSON.stringify({ version: 1, enabled: true, modelCount: 1 })],
    ['count above maximum', JSON.stringify({ version: 1, enabled: true, modelCount: 11 })],
    ['count not an integer', JSON.stringify({ version: 1, enabled: true, modelCount: 2.5 })],
    ['count not a number', JSON.stringify({ version: 1, enabled: true, modelCount: '5' })],
    ['duplicate slot', JSON.stringify({ version: 1, enabled: true, priorityCandidateIds: ['a/1', 'a/1'] })],
    ['duplicate hidden slot', JSON.stringify({ version: 1, enabled: true, modelCount: 2, priorityCandidateIds: ['a/1', 'a/2', 'a/1'] })],
    ['malformed slot id', JSON.stringify({ version: 1, enabled: true, priorityCandidateIds: ['no-provider'] })],
  ];

  for (const [name, content] of cases) {
    const s = scratch();
    try {
      mkdirSync(dirname(s.path()), { recursive: true, mode: 0o700 });
      writeFileSync(s.path(), content);
      const before = readFileSync(s.path());

      const loaded = loadSupervisorConfig(s.cwd);
      assert.equal(loaded.source, 'invalid', `${name}: source`);
      assert.equal(typeof loaded.error, 'string', `${name}: error reported`);
      assert.ok(loaded.error.length > 0, `${name}: non-empty error`);
      // Fail closed: an unusable file must not leave the supervisor running automatically.
      assert.equal(loaded.config.enabled, false, `${name}: disabled`);
      assert.equal(isSupervisorEnabled(s.cwd), false, `${name}: isSupervisorEnabled`);
      assert.deepEqual(readFileSync(s.path()), before, `${name}: file untouched`);

      // Refusing to write is part of fail-closed: a later mutation must not paper over it.
      assert.throws(() => updateSupervisorConfig(s.cwd, { enabled: true }), /configuration/i, `${name}: update refuses`);
      assert.deepEqual(readFileSync(s.path()), before, `${name}: file untouched after update`);
      // A wholesale replace may not paper over the failure either.
      assert.throws(() => saveSupervisorConfig(s.cwd, { ...DEFAULT_SUPERVISOR_CONFIG, enabled: true }), /configuration/i, `${name}: save refuses`);
      assert.deepEqual(readFileSync(s.path()), before, `${name}: file untouched after save`);
    } finally { s.close(); }
  }
});

test('SUPERVISOR-CONFIG-004: the environment override wins over a stored enabled flag', () => {
  const s = scratch();
  try {
    saveSupervisorConfig(s.cwd, { ...DEFAULT_SUPERVISOR_CONFIG, enabled: true });
    process.env.PI_SUPERVISOR_DISABLED = '1';
    assert.equal(isSupervisorEnabled(s.cwd), false);
    assert.equal(loadSupervisorConfig(s.cwd).config.enabled, false);
    process.env.PI_SUPERVISOR_DISABLED = '0';
    assert.equal(isSupervisorEnabled(s.cwd), true);
    delete process.env.PI_SUPERVISOR_DISABLED;
    assert.equal(isSupervisorEnabled(s.cwd), true);
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-005 (S3): the saved priority list is never capped and keeps its order', () => {
  const s = scratch();
  try {
    const six = ['p/a', 'p/b', 'p/c', 'p/d', 'p/e', 'p/f'];
    const saved = updateSupervisorConfig(s.cwd, { priorityCandidateIds: six });
    assert.deepEqual(saved.priorityCandidateIds, six);
    assert.deepEqual(loadSupervisorConfig(s.cwd).config.priorityCandidateIds, six);

    // A slot can be emptied and reordered; the stored document keeps the user's order.
    updateSupervisorConfig(s.cwd, { priorityCandidateIds: ['p/e', 'p/a'] });
    assert.deepEqual(loadSupervisorConfig(s.cwd).config.priorityCandidateIds, ['p/e', 'p/a']);
    updateSupervisorConfig(s.cwd, { priorityCandidateIds: [] });
    assert.deepEqual(loadSupervisorConfig(s.cwd).config.priorityCandidateIds, []);

    assert.throws(() => updateSupervisorConfig(s.cwd, { priorityCandidateIds: ['bad id with spaces'] }), /candidate|slot|route/i);
    assert.throws(() => updateSupervisorConfig(s.cwd, { priorityCandidateIds: ['p/a', 'p/a'] }), /duplicate/i);
    assert.deepEqual(loadSupervisorConfig(s.cwd).config.priorityCandidateIds, []);
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-014 (S2, S3): modelCount is 2..10 and selects the first N of the full saved list', () => {
  const s = scratch();
  try {
    const ten = ['p/a', 'p/b', 'p/c', 'p/d', 'p/e', 'p/f', 'p/g', 'p/h', 'p/i', 'p/j'];
    updateSupervisorConfig(s.cwd, { priorityCandidateIds: ten, modelCount: 2 });
    const two = loadSupervisorConfig(s.cwd).config;
    assert.equal(two.modelCount, 2);
    assert.deepEqual(two.priorityCandidateIds, ten);
    assert.deepEqual(getActiveCandidateIds(two), ['p/a', 'p/b']);

    // Raising the count selects more of the same saved list without deleting anything.
    updateSupervisorConfig(s.cwd, { modelCount: 4 });
    const four = loadSupervisorConfig(s.cwd).config;
    assert.deepEqual(four.priorityCandidateIds, ten, 'the saved list is untouched by a count change');
    assert.deepEqual(getActiveCandidateIds(four), ten.slice(0, 4));

    // Returning to 2 hides the extra entries but keeps them stored in the same order.
    const back = updateSupervisorConfig(s.cwd, { modelCount: 2 });
    assert.deepEqual(back.priorityCandidateIds, ten);
    assert.deepEqual(getActiveCandidateIds(back), ['p/a', 'p/b']);

    // Fewer saved entries than modelCount: use only what exists, never invent models.
    updateSupervisorConfig(s.cwd, { priorityCandidateIds: ['p/a'], modelCount: 5 });
    assert.deepEqual(getActiveCandidateIds(loadSupervisorConfig(s.cwd).config), ['p/a']);

    // An invalid count is refused and the stored bytes do not change.
    const before = readFileSync(s.path());
    assert.throws(() => updateSupervisorConfig(s.cwd, { modelCount: 1 }), /modelCount/);
    assert.throws(() => updateSupervisorConfig(s.cwd, { modelCount: 11 }), /modelCount/);
    assert.deepEqual(readFileSync(s.path()), before, 'invalid count changed nothing');
    assert.equal(loadSupervisorConfig(s.cwd).config.modelCount, 5);
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-006: a patch changes only the named fields', () => {
  const s = scratch();
  try {
    updateSupervisorConfig(s.cwd, { rotationThresholdPercent: 80, cooldownMinutes: 30, priorityCandidateIds: ['p/a'] });
    const after = updateSupervisorConfig(s.cwd, { maxTransientFailures: 5 });
    assert.equal(after.rotationThresholdPercent, 80);
    assert.equal(after.cooldownMinutes, 30);
    assert.equal(after.maxTransientFailures, 5);
    assert.deepEqual(after.priorityCandidateIds, ['p/a']);
    assert.equal(after.codexQuotaThresholdPercent, 95);
    assert.equal(after.pollIntervalSeconds, 60);
    assert.equal(after.enabled, true);
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-007: the flag is per project, not global', () => {
  const s = scratch();
  try {
    const other = join(s.dir, 'other-project');
    mkdirSync(other, { recursive: true });
    saveSupervisorConfig(s.cwd, { ...DEFAULT_SUPERVISOR_CONFIG, enabled: false });
    assert.notEqual(resolveSupervisorConfigPath(s.cwd), resolveSupervisorConfigPath(other));
    assert.equal(isSupervisorEnabled(s.cwd), false);
    assert.equal(isSupervisorEnabled(other), true);
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-008: validate rejects each field outside its documented range', () => {
  const valid = { version: 1, ...DEFAULT_SUPERVISOR_CONFIG };
  assert.deepEqual(validateSupervisorConfig(valid), DEFAULT_SUPERVISOR_CONFIG);
  for (const patch of [
    { rotationThresholdPercent: 100 },
    { rotationThresholdPercent: -1 },
    { codexQuotaThresholdPercent: 0 },
    { maxTransientFailures: 11 },
    { cooldownMinutes: 1441 },
    { pollIntervalSeconds: 3601 },
    { enabled: 1 },
    { modelCount: 1 },
    { modelCount: 11 },
    { modelCount: 2.5 },
    { modelCount: '5' },
    { priorityCandidateIds: 'p/a' },
  ]) {
    assert.throws(() => validateSupervisorConfig({ ...valid, ...patch }), Error, JSON.stringify(patch));
  }
});

test('SUPERVISOR-CONFIG-009: a held lock refuses the write and leaves the file untouched', () => {
  const s = scratch();
  try {
    saveSupervisorConfig(s.cwd, { ...DEFAULT_SUPERVISOR_CONFIG, enabled: true });
    const before = readFileSync(s.path());
    const fd = openSync(`${s.path()}.lock`, 'wx', 0o600);
    try {
      assert.throws(() => updateSupervisorConfig(s.cwd, { enabled: false }), /lock held/);
    } finally {
      closeSync(fd);
      rmSync(`${s.path()}.lock`, { force: true });
    }
    assert.deepEqual(readFileSync(s.path()), before);
    assert.equal(isSupervisorEnabled(s.cwd), true);
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-010: both writers refuse an unusable file with identical text and never touch it', () => {
  for (const content of ['{ broken', JSON.stringify({ version: 1, enabled: true, rotationThresholdPercent: 0 })]) {
    const s = scratch();
    try {
      mkdirSync(dirname(s.path()), { recursive: true });
      writeFileSync(s.path(), content);
      const before = readFileSync(s.path());

      let updateError = '';
      let saveError = '';
      try { updateSupervisorConfig(s.cwd, { enabled: true }); } catch (error: any) { updateError = error.message; }
      try { saveSupervisorConfig(s.cwd, { ...DEFAULT_SUPERVISOR_CONFIG, enabled: true }); } catch (error: any) { saveError = error.message; }

      assert.ok(updateError.length > 0, 'update refuses');
      assert.ok(saveError.length > 0, 'save refuses');
      assert.equal(saveError, updateError, 'identical refusal text');
      assert.deepEqual(readFileSync(s.path()), before, 'file untouched by either writer');
    } finally { s.close(); }
  }
});

test('SUPERVISOR-CONFIG-011: both writers still write for a valid or absent file', () => {
  const s = scratch();
  try {
    // Absent file: save creates it with the supplied values.
    const saved = saveSupervisorConfig(s.cwd, { ...DEFAULT_SUPERVISOR_CONFIG, enabled: false, cooldownMinutes: 7 });
    assert.equal(saved.cooldownMinutes, 7);
    assert.equal(loadSupervisorConfig(s.cwd).config.enabled, false);

    // Valid file: a partial update changes only the named field.
    const updated = updateSupervisorConfig(s.cwd, { pollIntervalSeconds: 30 });
    assert.equal(updated.pollIntervalSeconds, 30);
    assert.equal(updated.cooldownMinutes, 7, 'other fields preserved');
    assert.equal(updated.enabled, false, 'enabled preserved');

    // Valid file: a wholesale save replaces the document.
    const replaced = saveSupervisorConfig(s.cwd, { ...DEFAULT_SUPERVISOR_CONFIG, enabled: true });
    assert.equal(replaced.enabled, true);
    assert.equal(loadSupervisorConfig(s.cwd).config.pollIntervalSeconds, 60);
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-013: the two capability flags default to on, round-trip and fail closed', () => {
  const s = scratch();
  try {
    // Absent keys keep today's behaviour: both automatic capabilities are on.
    assert.equal(DEFAULT_SUPERVISOR_CONFIG.autoRotate, true);
    assert.equal(DEFAULT_SUPERVISOR_CONFIG.autoSwitchModel, true);
    assert.deepEqual(validateSupervisorConfig({ version: 1 }), DEFAULT_SUPERVISOR_CONFIG);

    const saved = updateSupervisorConfig(s.cwd, { autoRotate: false, autoSwitchModel: false });
    assert.equal(saved.autoRotate, false);
    assert.equal(saved.autoSwitchModel, false);
    const reloaded = loadSupervisorConfig(s.cwd);
    assert.equal(reloaded.source, 'file');
    assert.equal(reloaded.config.autoRotate, false);
    assert.equal(reloaded.config.autoSwitchModel, false);
    // The two capabilities are independent of the master switch.
    assert.equal(reloaded.config.enabled, true);

    const master = updateSupervisorConfig(s.cwd, { enabled: false });
    assert.equal(master.autoRotate, false, 'the master switch never resets a capability');
    assert.equal(master.autoSwitchModel, false);

    for (const field of ['autoRotate', 'autoSwitchModel'] as const) {
      assert.throws(() => validateSupervisorConfig({ version: 1, [field]: 'yes' }), new RegExp(field), `${field}: validate`);
      assert.throws(() => updateSupervisorConfig(s.cwd, { [field]: 'yes' } as any), new RegExp(field), `${field}: update refuses`);
    }
    assert.equal(loadSupervisorConfig(s.cwd).config.autoRotate, false, 'a refused write changed nothing');
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-012: an out-of-range value refuses before writing anything', () => {
  const s = scratch();
  try {
    saveSupervisorConfig(s.cwd, { ...DEFAULT_SUPERVISOR_CONFIG, enabled: false });
    const before = readFileSync(s.path());
    assert.throws(() => saveSupervisorConfig(s.cwd, { ...DEFAULT_SUPERVISOR_CONFIG, cooldownMinutes: 0 }), /configuration/i);
    assert.deepEqual(readFileSync(s.path()), before);
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-015 (S1, S2): modelEfforts is absent by default, and an old file without it stays absent', () => {
  assert.equal(DEFAULT_SUPERVISOR_CONFIG.modelEfforts, undefined);
  assert.equal(validateSupervisorConfig({ version: 1 }).modelEfforts, undefined);
  // A file written before this field existed has no `modelEfforts` key at all.
  assert.equal(validateSupervisorConfig({ version: 1, enabled: true, rotationThresholdPercent: 85 }).modelEfforts, undefined);
});

test('SUPERVISOR-CONFIG-016 (S1, S2): modelEfforts round-trips through save/load and update, keyed by full candidate ID', () => {
  const s = scratch();
  try {
    const efforts = { 'cliproxyapi/main/gpt-6.1-sol': 'xhigh', 'anthropic/claude-sonnet-4-5': 'low' };
    const saved = saveSupervisorConfig(s.cwd, { ...DEFAULT_SUPERVISOR_CONFIG, modelEfforts: efforts });
    assert.deepEqual(saved.modelEfforts, efforts);
    const loaded = loadSupervisorConfig(s.cwd);
    assert.equal(loaded.source, 'file');
    assert.deepEqual(loaded.config.modelEfforts, efforts);

    // A patch to an unrelated field preserves the stored effort map untouched.
    const afterPatch = updateSupervisorConfig(s.cwd, { cooldownMinutes: 20 });
    assert.deepEqual(afterPatch.modelEfforts, efforts);

    // A patch can replace the whole map explicitly (the panel always writes the complete map).
    const narrowed = updateSupervisorConfig(s.cwd, { modelEfforts: { 'anthropic/claude-sonnet-4-5': 'medium' } });
    assert.deepEqual(narrowed.modelEfforts, { 'anthropic/claude-sonnet-4-5': 'medium' });
  } finally { s.close(); }
});

test('SUPERVISOR-CONFIG-017 (S1, S2): modelEfforts validation never truncates a hidden/unassigned entry', () => {
  const s = scratch();
  try {
    const efforts = {
      'cliproxyapi/main/gpt-6.1-sol': 'xhigh',
      'anthropic/claude-sonnet-4-5': 'low',
      'openrouter/meta-llama/llama-3-70b': 'medium',
    };
    // modelCount: 2 means only first 2 slots active, but efforts contains 3 entries
    const saved = saveSupervisorConfig(s.cwd, {
      ...DEFAULT_SUPERVISOR_CONFIG,
      modelCount: 2,
      priorityCandidateIds: ['cliproxyapi/main/gpt-6.1-sol', 'anthropic/claude-sonnet-4-5'],
      modelEfforts: efforts,
    });
    assert.deepEqual(saved.modelEfforts, efforts);
    assert.equal(Object.keys(saved.modelEfforts!).length, 3);
  } finally { s.close(); }
});
