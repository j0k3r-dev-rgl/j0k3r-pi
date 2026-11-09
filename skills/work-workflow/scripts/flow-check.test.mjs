import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./flow-check.mjs', import.meta.url));
const ready = '## Workflow Status\n- Status: READY\n- Blockers: None\n\n';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-flow-'));
  const dir = join(root, 'openspec/changes/example');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, 'src'));
  const file = join(root, 'src/code.js');
  writeFileSync(file, 'export const result = 1;\n');
  writeFileSync(join(dir, 'plan.md'), ready + `## Goal\nExample\n## Scope & Exclusions\nOnly source\n## Execution Scope\n- Root: ${root}\n- Allowed Paths:\n  - ${root}/src/**\n- Writable Paths:\n  - ${root}/src/**\n- Allowed Bash:\n  - node --test\n- Notes: No settings changes\n## MINI-001: behavior\n- Contract: Return one\n- Acceptance: Result is one\n- Canonical sources: User request\n- Validation: node --test\n- Depends on: None\n## Risks & Constraints\nNone\n## Open Decisions\nNone\n## Next Permitted Action\nApply with consent\n`);
  writeFileSync(join(dir, 'apply.md'), ready + '## Implementation Summary\nMINI-001 implemented\n');
  writeFileSync(join(dir, 'verify.md'), ready + '## Verification Result\nVerification Result: PASS\n## Evidence Matrix\n| Contract | Evidence | Result |\n|---|---|---|\n| MINI-001 | node --test | PASS |\n');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [script, args[0], dir, ...args.slice(1)], { encoding: 'utf8', cwd: root });
  return { root, dir, file, run };
}
function ok(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
function blocked(result, pattern) { assert.equal(result.status, 1, result.stdout + result.stderr); assert.match(result.stdout + result.stderr, pattern); }
function authorize(f) { ok(f.run('authorize', '--author', 'j0k3r', '--reference', 'user-message:approved')); }
function candidate(f, executor = 'session:implementer') { ok(f.run('candidate', '--executor', executor, '--files', f.file)); }

test('CLI loads and reports an actionable missing-command error', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});
test('validates a READY plan; references do not count as duplicate definitions', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, 'discovery.md'), ready + '### EVID-001: Finding\nSource: code\nReference EVID-001\n');
  const plan = join(f.dir, 'plan.md');
  writeFileSync(plan, readFileSync(plan, 'utf8') + '\nEVID-001 supports MINI-001.\n');
  ok(f.run('check', '--phase', 'plan'));
  assert.equal(readFileSync(plan, 'utf8').includes('EVID-001'), true);
});
test('supports parallel discovery evidence and conventional bold contract labels', (t) => {
  const f = fixture(t);
  const plan = join(f.dir, 'plan.md');
  writeFileSync(join(f.dir, 'discovery-runtime.md'), ready + '### EVID-001: Runtime\n- Fact: Already exists\n');
  writeFileSync(plan, readFileSync(plan, 'utf8').replace('- Acceptance: Result is one', '- **Acceptance:** Result is one') + '\nEVID-001 supports the implementation.\n');
  ok(f.run('check', '--phase', 'plan'));
});
test('rejects duplicate MINI definitions, missing evidence, and missing acceptance', (t) => {
  const f = fixture(t);
  const plan = join(f.dir, 'plan.md');
  const original = readFileSync(plan, 'utf8');
  writeFileSync(plan, original + '\n## MINI-001: Duplicate\n');
  blocked(f.run('check', '--phase', 'plan'), /duplicate MINI-001/);
  writeFileSync(plan, original + '\nEVID-099\n');
  blocked(f.run('check', '--phase', 'plan'), /EVID-099/);
  writeFileSync(plan, original.replace('- Acceptance: Result is one', ''));
  blocked(f.run('check', '--phase', 'plan'), /Acceptance/);
});
test('rejects BLOCKED or contradictory status and unresolved decisions', (t) => {
  const f = fixture(t);
  const plan = join(f.dir, 'plan.md');
  const original = readFileSync(plan, 'utf8');
  writeFileSync(plan, original.replace('- Blockers: None', '- Blockers: Needs scope'));
  blocked(f.run('check', '--phase', 'plan'), /Blockers/);
  writeFileSync(plan, original.replace('## Open Decisions\nNone', '## Open Decisions\n- Choose storage'));
  blocked(f.run('check', '--phase', 'plan'), /Open Decisions/);
});
test('authorization is required and bound to the raw bytes of plan.md', (t) => {
  const f = fixture(t);
  blocked(f.run('check', '--phase', 'apply'), /authorization/);
  authorize(f);
  ok(f.run('check', '--phase', 'apply'));
  writeFileSync(join(f.dir, 'plan.md'), readFileSync(join(f.dir, 'plan.md'), 'utf8') + '\nEditorial change\n');
  blocked(f.run('check', '--phase', 'apply'), /plan.*changed|stale/i);
});
test('authorization requires a real author/reference and read-only checks do not write state', (t) => {
  const f = fixture(t);
  assert.equal(f.run('authorize', '--author', 'j0k3r').status, 2);
  ok(f.run('check', '--phase', 'plan'));
  assert.throws(() => readFileSync(join(f.dir, 'flow.json')), /ENOENT/);
});
test('rejects candidate paths outside Writable Paths and unexpected symlinks', (t) => {
  const f = fixture(t);
  authorize(f);
  blocked(f.run('candidate', '--executor', 'session:one', '--files', join(f.root, 'settings.json')), /Writable Paths/);
  symlinkSync(f.file, join(f.root, 'src/link.js'));
  blocked(f.run('candidate', '--executor', 'session:one', '--files', join(f.root, 'src/link.js')), /symlink/i);
});
test('candidate includes exact content and deletion identities, rejects duplicate or empty paths', (t) => {
  const f = fixture(t);
  authorize(f);
  blocked(f.run('candidate', '--executor', 'session:one'), /files/);
  blocked(f.run('candidate', '--executor', 'session:one', '--files', f.file, f.file), /duplicate/i);
  ok(f.run('candidate', '--executor', 'session:one', '--files', f.file, join(f.root, 'src/deleted.js')));
  const state = JSON.parse(readFileSync(join(f.dir, 'flow.json'), 'utf8'));
  assert.equal(state.implementation.records.length, 2);
  assert.deepEqual(state.implementation.records.find(([p]) => p.endsWith('deleted.js')), [join(f.root, 'src/deleted.js'), 'absent', '']);
});
test('requires independent executor identity, not a different model name', (t) => {
  const f = fixture(t);
  authorize(f); candidate(f);
  blocked(f.run('verify', '--executor', 'session:implementer'), /independent/);
  ok(f.run('verify', '--executor', 'session:reviewer'));
  ok(f.run('check', '--phase', 'deliver'));
});
test('rejects candidate drift before verification and after a passing verification', (t) => {
  const f = fixture(t);
  authorize(f); candidate(f);
  writeFileSync(f.file, 'export const result = 2;\n');
  blocked(f.run('verify', '--executor', 'session:reviewer'), /candidate.*changed|drift/i);
  candidate(f);
  ok(f.run('verify', '--executor', 'session:reviewer'));
  writeFileSync(f.file, 'export const result = 3;\n');
  blocked(f.run('check', '--phase', 'deliver'), /candidate.*changed|drift/i);
});
test('verification must cover every MINI with passing evidence', (t) => {
  const f = fixture(t);
  authorize(f); candidate(f);
  writeFileSync(join(f.dir, 'verify.md'), ready + 'Verification Result: PASS\n## Evidence Matrix\nNo evidence yet\n');
  blocked(f.run('verify', '--executor', 'session:reviewer'), /MINI-001/);
});
test('new candidate invalidates previous verification, changed verify artifact invalidates delivery', (t) => {
  const f = fixture(t);
  authorize(f); candidate(f);
  ok(f.run('verify', '--executor', 'session:reviewer'));
  writeFileSync(join(f.dir, 'verify.md'), readFileSync(join(f.dir, 'verify.md'), 'utf8') + '\nChanged evidence\n');
  blocked(f.run('check', '--phase', 'deliver'), /verification.*changed|verify.md.*changed/i);
  candidate(f);
  blocked(f.run('check', '--phase', 'deliver'), /verification/);
});
test('invalid JSON, unsafe receipt symlinks, and unknown flags fail closed', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, 'flow.json'), '{');
  blocked(f.run('check', '--phase', 'apply'), /JSON|receipt/i);
  rmSync(join(f.dir, 'flow.json'));
  symlinkSync(f.file, join(f.dir, 'flow.json'));
  blocked(f.run('authorize', '--author', 'j0k3r', '--reference', 'approved'), /symlink/i);
  assert.equal(f.run('check', '--phase', 'plan', '--ignore-errors').status, 2);
});
test('rejects dependent or overlapping parallel units and a verifier from any implementation session', (t) => {
  const f = fixture(t);
  const plan = join(f.dir, 'plan.md');
  const original = readFileSync(plan, 'utf8');
  const extraMini = '\n## MINI-002: other\n- Contract: Other\n- Acceptance: Other\n- Canonical sources: User\n- Validation: node --test\n- Depends on: MINI-001\n';
  writeFileSync(plan, original + extraMini + `\n## Parallel Units\n- UNIT-A: MINI-001 | Writable: ${f.root}/src/**\n- UNIT-B: MINI-002 | Writable: ${f.root}/src/**\n`);
  blocked(f.run('check', '--phase', 'plan'), /parallel|overlap|dependency/i);
  writeFileSync(plan, original);
  authorize(f);
  ok(f.run('candidate', '--executors', 'session:one', 'session:two', '--files', f.file));
  blocked(f.run('verify', '--executor', 'session:two'), /independent/);
  ok(f.run('verify', '--executor', 'session:three'));
});
test('rejects malformed parallel-unit lines rather than silently ignoring them', (t) => {
  const f = fixture(t);
  const plan = join(f.dir, 'plan.md');
  writeFileSync(plan, readFileSync(plan, 'utf8') + '\n## Parallel Units\n- UNIT-A: MINI-001\n');
  blocked(f.run('check', '--phase', 'plan'), /Parallel Units/);
});
test('rejects dependency cycles and incomplete passing evidence', (t) => {
  const f = fixture(t);
  const plan = join(f.dir, 'plan.md');
  const original = readFileSync(plan, 'utf8');
  writeFileSync(plan, original.replace('- Depends on: None', '- Depends on: MINI-002') + '\n## MINI-002: next\n- Contract: Next\n- Acceptance: Next\n- Canonical sources: User\n- Validation: node --test\n- Depends on: MINI-001\n');
  blocked(f.run('check', '--phase', 'plan'), /cycle/i);
  writeFileSync(plan, original);
  authorize(f); candidate(f);
  writeFileSync(join(f.dir, 'verify.md'), ready + 'Verification Result: PASS\n## Evidence Matrix\n| MINI-001 | | PASS |\n');
  blocked(f.run('verify', '--executor', 'session:reviewer'), /evidence/i);
});
test('rejects contradictory verification results and duplicate evidence rows', (t) => {
  const f = fixture(t);
  authorize(f); candidate(f);
  const verify = join(f.dir, 'verify.md');
  const original = readFileSync(verify, 'utf8');
  writeFileSync(verify, original + '\nVerification Result: BLOCKED\n');
  blocked(f.run('verify', '--executor', 'session:reviewer'), /Verification Result/);
  writeFileSync(verify, original + '| MINI-001 | required live check | FAIL |\n');
  blocked(f.run('verify', '--executor', 'session:reviewer'), /evidence/i);
});
test('rejects ambiguous duplicate scope sections and parallel discovery IDs', (t) => {
  const f = fixture(t);
  const plan = join(f.dir, 'plan.md');
  const original = readFileSync(plan, 'utf8');
  writeFileSync(plan, original + '\n## Execution Scope\n- Root: /\n');
  blocked(f.run('check', '--phase', 'plan'), /duplicate.*Execution Scope/i);
  writeFileSync(plan, original + '\nEVID-001\n');
  for (const name of ['discovery-runtime.md', 'discovery-rules.md']) writeFileSync(join(f.dir, name), ready + '### EVID-001: Fact\n- Fact: Current behavior\n');
  blocked(f.run('check', '--phase', 'plan'), /ambiguous.*EVID-001/i);
});
test('candidate requires all parallel executor identities and all ready apply artifacts', (t) => {
  const f = fixture(t);
  const plan = join(f.dir, 'plan.md');
  const second = join(f.root, 'other');
  mkdirSync(second);
  const original = readFileSync(plan, 'utf8');
  writeFileSync(plan, original.replace(`  - ${f.root}/src/**`, `  - ${f.root}/**`).replace(`  - ${f.root}/src/**`, `  - ${f.root}/**`) + `\n## MINI-002: other\n- Contract: Other\n- Acceptance: Other\n- Canonical sources: User\n- Validation: node --test\n- Depends on: None\n## Parallel Units\n- UNIT-A: MINI-001 | Writable: ${f.root}/src/**\n- UNIT-B: MINI-002 | Writable: ${second}/**\n`);
  writeFileSync(join(f.dir, 'apply-UNIT-A.md'), ready + 'MINI-001\n');
  authorize(f);
  blocked(f.run('candidate', '--executor', 'session:one', '--files', f.file), /every Parallel Unit/);
  blocked(f.run('candidate', '--executors', 'session:one', 'session:two', '--files', f.file), /apply-UNIT-B/);
  writeFileSync(join(f.dir, 'apply-UNIT-B.md'), ready + 'MINI-002\n');
  ok(f.run('candidate', '--executors', 'session:one', 'session:two', '--files', f.file));
});
test('rejects a symlinked change directory and a candidate parent redirect', (t) => {
  const f = fixture(t);
  authorize(f);
  symlinkSync(join(f.root, 'src'), join(f.root, 'src/redirect'));
  blocked(f.run('candidate', '--executor', 'session:one', '--files', join(f.root, 'src/redirect/code.js')), /symlink/i);
  const alias = join(f.root, 'alias');
  symlinkSync(f.dir, alias);
  const result = spawnSync(process.execPath, [script, 'check', alias, '--phase', 'plan'], { encoding: 'utf8' });
  blocked(result, /symlink/i);
});
test('records parallel apply summaries and does not require a monolithic apply.md', (t) => {
  const f = fixture(t);
  rmSync(join(f.dir, 'apply.md'));
  const plan = join(f.dir, 'plan.md');
  writeFileSync(plan, readFileSync(plan, 'utf8') + `\n## Parallel Units\n- UNIT-A: MINI-001 | Writable: ${f.root}/src/**\n`);
  writeFileSync(join(f.dir, 'apply-UNIT-A.md'), ready + 'MINI-001\n');
  authorize(f); candidate(f);
  ok(f.run('check', '--phase', 'verify'));
});
