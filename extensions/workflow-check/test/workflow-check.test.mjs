import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkflowCheckTool } from '../src/tools/workflow-check.ts';
import { checkWorkflow, recordWorkflow, main as cliMain } from '../src/core/flow-check.ts';
import { createWorkflowRecordTool } from '../src/tools/workflow-record.ts';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-workflow-tool-'));
  const dir = join(root, 'change with spaces');
  mkdirSync(dir);
  mkdirSync(join(root, 'src'));
  const contract = readFileSync(new URL('../../../skills/subagent-artifact-contracts/SKILL.md', import.meta.url), 'utf8');
  const template = contract.split('### `plan.md`')[1].split('### `apply.md`')[0].match(/```markdown\n([\s\S]*?)\n```/)[1];
  writeFileSync(join(dir, 'plan.md'), template.replaceAll('/absolute/workspace/root', root));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tool = createWorkflowCheckTool();
  const run = (params, signal) => tool.execute('test', params, signal, undefined, { cwd: root });
  return { root, dir, tool, run };
}

test('checks a plan using only path and phase without writing receipts or files', async (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.dir, 'plan.md'));
  const result = await f.run({ change_dir: '@change with spaces', phase: 'plan' });
  assert.equal(result.isError, false);
  assert.equal(result.details.status, 'PASS');
  assert.equal(result.details.contract_count, 1);
  assert.match(result.content[0].text, /PASS plan/);
  assert.ok(result.content[0].text.includes(result.details.plan_sha256), 'Digest must be model-facing, not only UI metadata');
  assert.deepEqual(readdirSync(f.dir), ['plan.md']);
  assert.deepEqual(readFileSync(join(f.dir, 'plan.md')), before);
});

test('reports structural failures as BLOCKED with the exact diagnostic', async (t) => {
  const f = fixture(t);
  const plan = join(f.dir, 'plan.md');
  writeFileSync(plan, readFileSync(plan, 'utf8').replace('- Contract: The source module returns one.', '- Contract:'));
  const result = await f.run({ change_dir: f.dir, phase: 'plan' });
  assert.equal(result.isError, true);
  assert.equal(result.details.status, 'BLOCKED');
  assert.match(result.content[0].text, /MINI-001 missing Contract/);
});

test('retains receipt requirements for later boundaries without generating approval', async (t) => {
  const f = fixture(t);
  for (const phase of ['apply', 'verify', 'deliver']) {
    const result = await f.run({ change_dir: f.dir, phase });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Missing flow.json/);
  }
  assert.deepEqual(readdirSync(f.dir), ['plan.md']);
});

test('rejects mutating actions, unknown fields, missing phases, and symlink redirects', async (t) => {
  const f = fixture(t);
  for (const params of [
    { change_dir: f.dir, phase: 'authorize' },
    { change_dir: f.dir, phase: 'plan', action: 'authorize' },
    { change_dir: f.dir },
    { change_dir: '' , phase: 'plan' },
  ]) {
    await assert.rejects(() => f.run(params), /Invalid workflow_check/);
  }
  const alias = join(f.root, 'alias');
  symlinkSync(f.dir, alias);
  const result = await f.run({ change_dir: alias, phase: 'plan' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unexpected symlink/);
});

test('orchestrator records the lifecycle without shell commands and retains independence and drift gates', async (t) => {
  const f = fixture(t);
  const queued = [];
  const record = createWorkflowRecordTool(async (path, callback) => { queued.push(path); return callback(); });
  const run = (params) => record.execute('record', { change_dir: f.dir, ...params }, undefined, undefined, { cwd: f.root });
  const checked = await f.run({ change_dir: f.dir, phase: 'plan' });
  const mismatched = await run({ action: 'authorize', author: 'j0k3r', reference: 'user:approval', plan_sha256: '0'.repeat(64) });
  assert.equal(mismatched.isError, true);
  assert.match(mismatched.content[0].text, /digest mismatch/);
  await run({ action: 'authorize', author: 'j0k3r', reference: 'user:approval', plan_sha256: checked.details.plan_sha256 });
  assert.equal((await f.run({ change_dir: f.dir, phase: 'apply' })).details.status, 'PASS');
  const file = join(f.root, 'src/code.js');
  writeFileSync(file, 'export default 1;');
  writeFileSync(join(f.dir, 'apply.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Implementation Summary\nMINI-001 implemented\n');
  await run({ action: 'candidate', executors: ['implementation-session'], files: [file] });
  assert.equal((await f.run({ change_dir: f.dir, phase: 'verify' })).details.status, 'PASS');
  writeFileSync(join(f.dir, 'verify.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Verification Result\nVerification Result: PASS\n## Evidence Matrix\n| MINI-001 | behavior test | PASS |\n');
  const dependent = await run({ action: 'verify', executor: 'implementation-session' });
  assert.equal(dependent.isError, true);
  assert.match(dependent.content[0].text, /independent/);
  await run({ action: 'verify', executor: 'review-session' });
  assert.equal((await f.run({ change_dir: f.dir, phase: 'deliver' })).details.status, 'PASS');
  assert.ok(queued.every((path) => path === join(f.dir, 'flow.json')));
  writeFileSync(file, 'export default 2;');
  assert.equal((await f.run({ change_dir: f.dir, phase: 'deliver' })).details.status, 'BLOCKED');
  await assert.rejects(() => run({ action: 'authorize', executor: 'review-session' }), /Invalid workflow_record/);
  await assert.rejects(() => run({ action: 'toString' }), /Invalid workflow_record/);
  await assert.rejects(() => run({ action: 'candidate', executors: 'session', files: [file] }), /Invalid workflow_record/);
});

test('oversized diagnostics can be retrieved without losing data', async (t) => {
  const f = fixture(t);
  const plan = join(f.dir, 'plan.md');
  writeFileSync(plan, readFileSync(plan, 'utf8').replace('## Execution Scope', `## Execution Scope\n- Root: /${'a'.repeat(10000)}`));
  let offset = 0;
  let diagnostic = '';
  for (;;) {
    const result = await f.run({ change_dir: f.dir, phase: 'plan', diagnostic_offset: offset });
    assert.equal(result.isError, true);
    const page = result.content[0].text.split('\nDiagnostic range ')[0];
    assert.ok(page.length <= 4000);
    diagnostic += page;
    if (result.details.next_offset === undefined) {
      assert.equal(diagnostic.length, result.details.diagnostic_total);
      break;
    }
    offset = result.details.next_offset;
  }
  assert.match(diagnostic, /flow-check: BLOCKED/);
});

function stagedFixture(t) {
  const f = fixture(t);
  const mini = (id, depends) => `## ${id}: work\n- Contract: Implement agreed behavior\n- Acceptance: Behavior matches the contract\n- Canonical sources: User request\n- Validation: node --test\n- Depends on: ${depends}\n`;
  const path = join(f.dir, 'plan.md');
  const original = readFileSync(path, 'utf8');
  const start = original.indexOf('## MINI-001');
  const end = original.indexOf('## Risks & Constraints');
  const contract = join(f.root, 'src/contracts/messages.md');
  mkdirSync(join(f.root, 'src/contracts'));
  const plan = original.slice(0, start)
    + mini('MINI-001', 'None') + mini('MINI-002', 'MINI-001')
    + mini('MINI-003', 'MINI-001') + mini('MINI-004', 'MINI-002, MINI-003')
    + `## Apply Sequence\n- Preparation: MINI-001\n- Integration: MINI-004\n`
    + `## Parallel Units\n- UNIT-SERVER: MINI-002 | Writable: ${f.root}/src/actions.ts ; ${f.root}/src/server-tests/**\n- UNIT-UI: MINI-003 | Writable: ${f.root}/src/component.tsx\n`
    + `## Integrated Validation\n- Owner: Integration worker\n- Command: node --test\n`
    + `## Project Contracts\n- ${contract}\n` + original.slice(end);
  writeFileSync(path, plan);
  const authorize = () => recordWorkflow(f.dir, 'authorize', { author: 'fixture', reference: 'user approval', plan_sha256: checkWorkflow(f.dir, 'plan').plan_sha256 });
  const summaries = () => {
    for (const name of ['apply-preparation.md', 'apply-UNIT-SERVER.md', 'apply-UNIT-UI.md', 'apply-integration.md']) {
      writeFileSync(join(f.dir, name), '## Workflow Status\n- Status: READY\n- Blockers: None\n');
    }
  };
  return { ...f, path, plan, contract, authorize, summaries };
}

test('supports preparation, same-directory independent files and final integration without new phases', (t) => {
  const f = stagedFixture(t);
  f.authorize();
  checkWorkflow(f.dir, 'apply'); // Contract creation is authorized preparation, not a planning write.
  writeFileSync(f.contract, '# Message contract\n');
  f.summaries();
  const options = { executors: ['prep', 'server', 'ui', 'integration'], files: [f.contract] };
  recordWorkflow(f.dir, 'candidate', options);
  checkWorkflow(f.dir, 'verify');
  for (const executor of options.executors) {
    assert.throws(() => recordWorkflow(f.dir, 'verify', { executor }), /independent/);
  }
  writeFileSync(f.contract, '# Changed contract\n');
  assert.throws(() => checkWorkflow(f.dir, 'verify'), /drift|contract/i);
});

test('staged apply rejects incomplete ownership, backwards dependencies and shared concurrent files', (t) => {
  const f = stagedFixture(t);
  for (const [from, to, error] of [
    ['- Preparation: MINI-001', '- Preparation: None', /assign every MINI/],
    ['- Integration: MINI-004', '- Integration: MINI-002, MINI-004', /ownership/],
    ['- Depends on: None', '- Depends on: MINI-002', /cycle|dependency/i],
    ['- Depends on: MINI-001\n## MINI-004', '- Depends on: MINI-002\n## MINI-004', /Cross-unit/],
    [`${f.root}/src/component.tsx`, `${f.root}/src/actions.ts`, /overlap/i],
    [`${f.root}/src/component.tsx`, `${f.root}/src/**`, /overlap/i],
    [`${f.root}/src/component.tsx`, `${f.root}/outside.tsx`, /Writable Paths/],
    ['- Preparation: MINI-001', '- Preparation: MINI-099', /ownership/],
    ['- Preparation: MINI-001', '- Preparation: MINI-001\n- Preparation: None', /Apply Sequence/],
    ['- Command: node --test', '- Command:', /Integrated Validation/],
    ['- Owner: Integration worker', '- Owner:', /Integrated Validation/],
    ['- Preparation: MINI-001', '- Prepare: MINI-001', /Apply Sequence/],
    ['- Integration: MINI-004', '', /Apply Sequence/],
    [`${f.root}/src/actions.ts ; ${f.root}/src/server-tests/**`, `${f.root}/src/actions.ts ; ${f.root}/src/actions.ts`, /overlap/i],
  ]) {
    writeFileSync(f.path, f.plan.replace(from, to));
    assert.throws(() => checkWorkflow(f.dir, 'plan'), error, `${from} -> ${to}`);
  }
});

test('rejects empty staged sections and a sequence without concurrent units', (t) => {
  const f = stagedFixture(t);
  for (const replacement of ['', '- Preparation: None\n- Integration: None']) {
    writeFileSync(f.path, f.plan.replace('- Preparation: MINI-001\n- Integration: MINI-004', replacement));
    assert.throws(() => checkWorkflow(f.dir, 'plan'), /Apply Sequence|assign every MINI/);
  }
  writeFileSync(f.path, f.plan.replace(/- UNIT-UI:[^\n]+\n/, ''));
  assert.throws(() => checkWorkflow(f.dir, 'plan'), /at least two/);
});

test('staged candidate requires preparation and integration summaries and all executor identities', (t) => {
  const f = stagedFixture(t);
  f.authorize();
  writeFileSync(f.contract, '# Contract\n');
  f.summaries();
  const options = { executors: ['prep', 'server', 'ui', 'integration'], files: [f.contract] };
  assert.throws(() => recordWorkflow(f.dir, 'candidate', { ...options, executors: ['server', 'ui'] }), /executor/i);
  for (const name of ['apply-preparation.md', 'apply-integration.md']) {
    rmSync(join(f.dir, name));
    assert.throws(() => recordWorkflow(f.dir, 'candidate', options), new RegExp(name));
    f.summaries();
  }
  recordWorkflow(f.dir, 'candidate', options);
  writeFileSync(join(f.dir, 'apply-preparation.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\nChanged');
  assert.throws(() => checkWorkflow(f.dir, 'verify'), /summary changed/);
});

test('optional preparation and integration stages require only the declared summaries', (t) => {
  const f = stagedFixture(t);
  const plan = f.plan.replace('- Preparation: MINI-001', '- Preparation: None')
    .replace('- Integration: MINI-004', '- Integration: None')
    .replace('UNIT-SERVER: MINI-002', 'UNIT-SERVER: MINI-001, MINI-002, MINI-004')
    .replace('- Depends on: MINI-002, MINI-003', '- Depends on: MINI-002')
    .replace('## MINI-003: work\n- Contract: Implement agreed behavior\n- Acceptance: Behavior matches the contract\n- Canonical sources: User request\n- Validation: node --test\n- Depends on: MINI-001', '## MINI-003: work\n- Contract: Implement agreed behavior\n- Acceptance: Behavior matches the contract\n- Canonical sources: User request\n- Validation: node --test\n- Depends on: None');
  writeFileSync(f.path, plan);
  f.authorize();
  writeFileSync(f.contract, '# Contract\n');
  f.summaries();
  rmSync(join(f.dir, 'apply-preparation.md'));
  rmSync(join(f.dir, 'apply-integration.md'));
  recordWorkflow(f.dir, 'candidate', { executors: ['server', 'ui'], files: [f.contract] });
  checkWorkflow(f.dir, 'verify');
});

test('staged apply rejects acyclic backwards preparation and unit dependencies', (t) => {
  const f = stagedFixture(t);
  const independentUI = f.plan.replace('- Depends on: MINI-001\n## MINI-004', '- Depends on: None\n## MINI-004');
  writeFileSync(f.path, independentUI.replace('- Depends on: None', '- Depends on: MINI-003'));
  assert.throws(() => checkWorkflow(f.dir, 'plan'), /Cross-unit/);
  writeFileSync(f.path, f.plan.replace('- Depends on: MINI-002, MINI-003', '- Depends on: None')
    .replace('- Depends on: MINI-001\n## MINI-003', '- Depends on: MINI-004\n## MINI-003'));
  assert.throws(() => checkWorkflow(f.dir, 'plan'), /Cross-unit/);
});

test('missing project contracts block candidate capture and read-only inputs block delivery on drift', (t) => {
  const f = stagedFixture(t);
  // Contract is outside Writable Paths, but remains inside Allowed Paths.
  const plan = f.plan.replace(`- Writable Paths:\n  - ${f.root}/src/**`, `- Writable Paths:\n  - ${f.root}/src/actions.ts\n  - ${f.root}/src/server-tests/**\n  - ${f.root}/src/component.tsx`);
  writeFileSync(f.path, plan);
  f.authorize();
  f.summaries();
  const file = join(f.root, 'src/actions.ts');
  writeFileSync(file, 'export const action = () => 1;');
  const options = { executors: ['prep', 'server', 'ui', 'integration'], files: [file] };
  assert.throws(() => recordWorkflow(f.dir, 'candidate', options), /ENOENT/);
  writeFileSync(f.contract, '# Contract\n');
  recordWorkflow(f.dir, 'candidate', options);
  writeFileSync(join(f.dir, 'verify.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Verification Result\nVerification Result: PASS\n## Evidence Matrix\n'
    + ['001', '002', '003', '004'].map((id) => `| MINI-${id} | integrated behavior assertion | PASS |`).join('\n'));
  recordWorkflow(f.dir, 'verify', { executor: 'reviewer' });
  checkWorkflow(f.dir, 'deliver');
  writeFileSync(f.contract, '# Changed\n');
  assert.throws(() => checkWorkflow(f.dir, 'deliver'), /contract.*drift/i);
});

test('project contracts include unchanged read-only references in continuity and reject unsafe paths', (t) => {
  const f = stagedFixture(t);
  writeFileSync(f.contract, '# Existing contract\n');
  f.authorize();
  f.summaries();
  const file = join(f.root, 'src/actions.ts');
  writeFileSync(file, 'export const action = () => 1;');
  recordWorkflow(f.dir, 'candidate', { executors: ['prep', 'server', 'ui', 'integration'], files: [file] });
  const receipt = JSON.parse(readFileSync(join(f.dir, 'flow.json'), 'utf8'));
  assert.equal(receipt.implementation.contracts[0][0], f.contract);
  writeFileSync(f.contract, '# Drift\n');
  assert.throws(() => checkWorkflow(f.dir, 'verify'), /contract.*drift/i);
  for (const target of [join(f.dir, 'plan.md'), join(f.root, 'outside.md'), `${f.contract}/**`, f.contract + '\n- ' + f.contract]) {
    writeFileSync(f.path, f.plan.replace(`- ${f.contract}\n`, `- ${target}\n`));
    assert.throws(() => checkWorkflow(f.dir, 'plan'), /Project Contracts/);
  }
  writeFileSync(f.path, f.plan);
  rmSync(f.contract);
  symlinkSync(file, f.contract);
  assert.throws(() => checkWorkflow(f.dir, 'plan'), /symlink/i);
});

test('preserves cancellation instead of reporting a validation failure', async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => f.run({ change_dir: f.dir, phase: 'plan' }, controller.signal), { name: 'AbortError' });
});

test('accepts standard Markdown formatting and prose test counts in verify.md while still rejecting non-PASS results', (t) => {
  const f = fixture(t);
  const plan = checkWorkflow(f.dir, 'plan');
  recordWorkflow(f.dir, 'authorize', { author: 'j0k3r', reference: 'approval', plan_sha256: plan.plan_sha256 });
  const file = join(f.root, 'src/code.js');
  writeFileSync(file, 'export default 1;');
  writeFileSync(join(f.dir, 'apply.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Implementation Summary\nMINI-001\n');
  recordWorkflow(f.dir, 'candidate', { executors: ['impl-1'], files: [file] });

  // Before verify.md exists, phase verify passes continuity check.
  checkWorkflow(f.dir, 'verify');

  // Markdown backticks/bold, section-only PASS, and prose mentioning "0 fail, 0 skip" / "fail-closed" must pass.
  const passingVerify = [
    '## Workflow Status',
    '- Status: READY',
    '- Blockers: None',
    '',
    '## Verification Result',
    '**PASS**',
    '',
    '## Evidence Matrix',
    '| MINI | Acceptance Checks | Independent Verification Evidence | Result |',
    '|---|---|---|---|',
    '| `MINI-001` | Verifies fail-closed error path | `npm test` (45 pass, 0 fail, 0 skip; 1 opt-in live skip; pending: none) | `PASS` |',
    '',
  ].join('\n');
  writeFileSync(join(f.dir, 'verify.md'), passingVerify);

  // Ready verify.md is validated during checkWorkflow(verify) and recordWorkflow(verify).
  checkWorkflow(f.dir, 'verify');
  recordWorkflow(f.dir, 'verify', { executor: 'verify-1' });
  checkWorkflow(f.dir, 'deliver');

  // Invalid Result cells or contradictory Verification Result must still be rejected by both checkWorkflow(verify) and recordWorkflow(verify).
  for (const [label, mutated, pattern] of [
    ['FAIL result cell', passingVerify.replace('| `PASS` |', '| FAIL |'), /missing passing evidence/],
    ['BLOCKED result cell', passingVerify.replace('| `PASS` |', '| BLOCKED |'), /missing passing evidence/],
    ['SKIP result cell', passingVerify.replace('| `PASS` |', '| SKIP |'), /missing passing evidence/],
    ['mixed PASS/FAIL result cell', passingVerify.replace('| `PASS` |', '| PASS (1 FAIL) |'), /missing passing evidence/],
    ['contradictory Verification Result', passingVerify.replace('**PASS**', 'PASS\nFAIL'), /Verification Result: PASS/],
    ['explicit Verification Result: FAIL', passingVerify.replace('**PASS**', 'Verification Result: FAIL'), /Verification Result: PASS/],
    ['missing evidence cell', passingVerify.replace('| Verifies fail-closed error path | `npm test` (45 pass, 0 fail, 0 skip; 1 opt-in live skip; pending: none) |', '| | |'), /missing passing evidence/],
  ]) {
    writeFileSync(join(f.dir, 'verify.md'), mutated);
    assert.throws(() => checkWorkflow(f.dir, 'verify'), pattern, `checkWorkflow(verify) should reject ${label}`);
    assert.throws(() => recordWorkflow(f.dir, 'verify', { executor: 'verify-2' }), pattern, `recordWorkflow(verify) should reject ${label}`);
  }

  // A prior BLOCKED verify.md must NOT block pre-verify continuity checks when launching a fresh verifier.
  writeFileSync(join(f.dir, 'verify.md'), '## Workflow Status\n- Status: BLOCKED\n- Blockers: Prior failure\n\n## Verification Result\nFAIL\n');
  checkWorkflow(f.dir, 'verify');
});

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

test('MINI-001: snapshot computes canonical read-only continuity records and detects deliverable, deletion, contract, and apply drift', (t) => {
  const f = fixture(t);
  const plan = checkWorkflow(f.dir, 'plan');
  recordWorkflow(f.dir, 'authorize', { author: 'j0k3r', reference: 'approval', plan_sha256: plan.plan_sha256 });
  const fileA = join(f.root, 'src/code.js');
  const fileDeleted = join(f.root, 'src/removed.js');
  writeFileSync(fileA, 'export const a = 1;\n');
  writeFileSync(join(f.dir, 'apply.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Implementation Summary\nMINI-001\n');
  recordWorkflow(f.dir, 'candidate', { executors: ['impl-1'], files: [fileA, fileDeleted] });

  const flowBefore = readFileSync(join(f.dir, 'flow.json'), 'utf8');
  const filesBefore = readdirSync(f.dir);
  const snap = checkWorkflow(f.dir, 'snapshot');
  assert.equal(snap.continuity_status, 'MATCH');
  assert.equal(snap.contracts_status, 'NONE');
  assert.deepEqual(snap.drift, []);
  const expectedRecords = [
    [fileA, 'present', sha256('export const a = 1;\n')],
    [fileDeleted, 'absent', ''],
  ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  assert.deepEqual(snap.records, expectedRecords);
  assert.deepEqual(snap.snapshot_records, expectedRecords);
  assert.equal(snap.candidate_sha256, sha256(JSON.stringify(expectedRecords)));
  assert.equal(snap.snapshot_sha256, snap.candidate_sha256);
  // Strictly read-only
  assert.equal(readFileSync(join(f.dir, 'flow.json'), 'utf8'), flowBefore);
  assert.deepEqual(readdirSync(f.dir), filesBefore);
  // CLI parity on MATCH
  assert.equal(cliMain(['check', f.dir, '--phase', 'snapshot']), 0);

  // Deliverable modification -> DRIFT
  writeFileSync(fileA, 'export const a = 2;\n');
  const modDrift = checkWorkflow(f.dir, 'snapshot');
  assert.equal(modDrift.continuity_status, 'DRIFT');
  assert.ok(modDrift.drift.some((d) => d.kind === 'deliverable' && d.path === fileA));
  assert.equal(cliMain(['check', f.dir, '--phase', 'snapshot']), 1);

  // Restore fileA, recreate deleted deliverable -> DRIFT
  writeFileSync(fileA, 'export const a = 1;\n');
  writeFileSync(fileDeleted, 'recreated\n');
  const recDrift = checkWorkflow(f.dir, 'snapshot');
  assert.equal(recDrift.continuity_status, 'DRIFT');
  assert.ok(recDrift.drift.some((d) => d.kind === 'deliverable' && d.path === fileDeleted && d.expected_state === 'absent' && d.actual_state === 'present'));
  rmSync(fileDeleted);

  // Edit apply.md -> DRIFT
  const origApply = readFileSync(join(f.dir, 'apply.md'), 'utf8');
  writeFileSync(join(f.dir, 'apply.md'), origApply + '\nEdited after candidate\n');
  const applyDrift = checkWorkflow(f.dir, 'snapshot');
  assert.equal(applyDrift.continuity_status, 'DRIFT');
  assert.ok(applyDrift.drift.some((d) => d.kind === 'apply' && d.name === 'apply.md'));
  writeFileSync(join(f.dir, 'apply.md'), origApply);

  // Unexpected symlink fails closed
  rmSync(fileA);
  symlinkSync(join(f.dir, 'plan.md'), fileA);
  assert.throws(() => checkWorkflow(f.dir, 'snapshot'), /symlink/i);
});

test('MINI-001: snapshot merges deduplicated read-only Project Contracts and handles 85+ files with UTF-16 sort order', (t) => {
  const f = stagedFixture(t);
  // Contract outside Writable Paths (read-only input), inside Allowed Paths
  const plan = f.plan.replace(
    `- Writable Paths:\n  - ${f.root}/src/**`,
    `- Writable Paths:\n  - ${f.root}/src/actions.ts\n  - ${f.root}/src/server-tests/**\n  - ${f.root}/src/component.tsx`,
  );
  writeFileSync(f.path, plan);
  writeFileSync(f.contract, '# Read-only contract\n');
  f.authorize();
  f.summaries();

  mkdirSync(join(f.root, 'src/server-tests'), { recursive: true });
  const files = [join(f.root, 'src/actions.ts'), join(f.root, 'src/component.tsx')];
  writeFileSync(files[0], 'export const action = 1;\n');
  writeFileSync(files[1], 'export const ui = 1;\n');
  // Add 83 files including uppercase and lowercase names to verify UTF-16 code-unit sort ('Z' < 'a')
  for (let i = 0; i < 83; i++) {
    const prefix = i % 2 === 0 ? 'Z' : 'a';
    const filePath = join(f.root, `src/server-tests/${prefix}-file-${String(i).padStart(3, '0')}.test.js`);
    writeFileSync(filePath, `export const id = ${i};\n`);
    files.push(filePath);
  }
  recordWorkflow(f.dir, 'candidate', { executors: ['prep', 'server', 'ui', 'integration'], files });

  const snap = checkWorkflow(f.dir, 'snapshot');
  assert.equal(snap.continuity_status, 'MATCH');
  assert.equal(snap.contracts_status, 'MATCH');
  assert.equal(snap.records.length, 85);
  assert.equal(snap.contracts.length, 1);
  assert.equal(snap.snapshot_records.length, 86);
  // Verify exact UTF-16 code-unit ordering and aggregate digest
  const expectedUnion = [...snap.records, ...snap.contracts].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  assert.deepEqual(snap.snapshot_records, expectedUnion);
  assert.equal(snap.snapshot_sha256, sha256(JSON.stringify(expectedUnion)));

  // Mutating read-only Project Contract -> DRIFT
  writeFileSync(f.contract, '# Mutated contract\n');
  const contractDrift = checkWorkflow(f.dir, 'snapshot');
  assert.equal(contractDrift.continuity_status, 'DRIFT');
  assert.equal(contractDrift.contracts_status, 'DRIFT');
  assert.ok(contractDrift.drift.some((d) => d.kind === 'contract' && d.path === f.contract));

  // Deleting read-only Project Contract -> DRIFT
  rmSync(f.contract);
  const deletedContractDrift = checkWorkflow(f.dir, 'snapshot');
  assert.equal(deletedContractDrift.continuity_status, 'DRIFT');
  assert.equal(deletedContractDrift.contracts_status, 'DRIFT');
  assert.ok(deletedContractDrift.drift.some((d) => d.kind === 'contract' && d.path === f.contract && d.actual_state === 'absent'));
});

test('MINI-001: snapshot fails closed on missing candidate, malformed records, non-file deliverables, or paths outside Writable Paths', (t) => {
  const f = fixture(t);
  assert.throws(() => checkWorkflow(f.dir, 'snapshot'), /Missing flow.json/);
  const plan = checkWorkflow(f.dir, 'plan');
  recordWorkflow(f.dir, 'authorize', { author: 'j0k3r', reference: 'approval', plan_sha256: plan.plan_sha256 });
  assert.throws(() => checkWorkflow(f.dir, 'snapshot'), /Missing candidate/);

  const flowPath = join(f.dir, 'flow.json');
  const baseReceipt = JSON.parse(readFileSync(flowPath, 'utf8'));
  // Malformed record
  writeFileSync(flowPath, JSON.stringify({ ...baseReceipt, implementation: { executors: ['impl'], records: [[join(f.root, 'src/a.js'), 'present', 'not-a-sha']], sha256: '0'.repeat(64), apply: [] } }));
  assert.throws(() => checkWorkflow(f.dir, 'snapshot'), /Invalid candidate records/);
  // Path outside Writable Paths
  const outside = join(f.root, 'outside.js');
  writeFileSync(outside, 'x');
  writeFileSync(flowPath, JSON.stringify({ ...baseReceipt, implementation: { executors: ['impl'], records: [[outside, 'present', sha256('x')]], sha256: '0'.repeat(64), apply: [] } }));
  assert.throws(() => checkWorkflow(f.dir, 'snapshot'), /Writable Paths/);
  // Directory instead of regular file
  const dirDeliverable = join(f.root, 'src/subdir');
  mkdirSync(dirDeliverable);
  writeFileSync(flowPath, JSON.stringify({ ...baseReceipt, implementation: { executors: ['impl'], records: [[dirDeliverable, 'present', sha256('x')]], sha256: '0'.repeat(64), apply: [] } }));
  assert.throws(() => checkWorkflow(f.dir, 'snapshot'), /not a regular file/);
});

test('MINI-002: baseline stores metadata only, excludes secrets/git/node_modules, preserves baselines across writes, and surface hands off exact candidate_files', (t) => {
  const f = fixture(t);
  const planPath = join(f.dir, 'plan.md');
  // Broaden Allowed Paths to root/** while keeping Writable Paths at src/** so out-of-surface edits are detectable
  writeFileSync(planPath, readFileSync(planPath, 'utf8').replace(`- Allowed Paths:\n  - ${f.root}/src/**`, `- Allowed Paths:\n  - ${f.root}/**`));
  const plan = checkWorkflow(f.dir, 'plan');
  recordWorkflow(f.dir, 'authorize', { author: 'j0k3r', reference: 'approval', plan_sha256: plan.plan_sha256 });

  const keepDirty = join(f.root, 'src/preexisting-dirty.js');
  const toModify = join(f.root, 'src/modify-me.js');
  const toDelete = join(f.root, 'src/delete-me.js');
  const preLink = join(f.root, 'src/preexisting-link.js');
  writeFileSync(keepDirty, 'export const secretMarker = "RAW_CONTENT_MUST_NOT_BE_IN_FLOW_JSON";\n');
  writeFileSync(toModify, 'export const v = 1;\n');
  writeFileSync(toDelete, 'export const gone = true;\n');
  symlinkSync(keepDirty, preLink);

  // Excluded trees and secret files
  mkdirSync(join(f.root, '.git'), { recursive: true });
  writeFileSync(join(f.root, '.git/HEAD'), 'ref: refs/heads/main\n');
  mkdirSync(join(f.root, 'node_modules/pkg'), { recursive: true });
  writeFileSync(join(f.root, 'node_modules/pkg/index.js'), 'module.exports = 1;\n');
  for (const secretName of ['.env', '.env.local', '.env.production.local', 'tls.pem', 'server.key', 'id_rsa', 'id_ed25519']) {
    writeFileSync(join(f.root, 'src', secretName), `SUPER_SECRET_VALUE_${secretName}`);
  }

  const base1 = recordWorkflow(f.dir, 'baseline', { label: 'pre-apply' });
  assert.equal(base1.baseline_id, 'baseline-1');
  assert.equal(base1.baseline_label, 'pre-apply');
  assert.equal(base1.file_count, 4);

  const flowRaw = readFileSync(join(f.dir, 'flow.json'), 'utf8');
  assert.doesNotMatch(flowRaw, /RAW_CONTENT_MUST_NOT_BE_IN_FLOW_JSON/);
  assert.doesNotMatch(flowRaw, /SUPER_SECRET_VALUE/);
  for (const secretName of ['.env', 'tls.pem', 'server.key', 'id_rsa', 'id_ed25519', '.git', 'node_modules']) {
    assert.ok(!flowRaw.includes(secretName), `flow.json must exclude ${secretName}`);
  }

  // Perform apply mutations (create, modify, delete) while leaving pre-existing file & symlink untouched
  const created = join(f.root, 'src/created.js');
  writeFileSync(created, 'export const added = 42;\n');
  writeFileSync(toModify, 'export const v = 2;\n');
  rmSync(toDelete);

  const surface = checkWorkflow(f.dir, 'surface');
  assert.equal(surface.surface_status, 'CLEAN');
  assert.equal(surface.baseline_id, 'baseline-1');
  assert.equal(surface.contracts_status, 'NONE');
  assert.deepEqual(surface.violations, []);
  assert.deepEqual(surface.created, [created]);
  assert.deepEqual(surface.modified, [toModify]);
  assert.deepEqual(surface.deleted, [toDelete]);
  assert.deepEqual(surface.by_owner['Writable Paths'], {
    created: [created],
    modified: [toModify],
    deleted: [toDelete],
  });
  const expectedCandidate = [created, toDelete, toModify].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(surface.candidate_files, expectedCandidate);

  // Capture a second labeled baseline and verify selection by label and id
  const base2 = recordWorkflow(f.dir, 'baseline', { label: 'post-apply' });
  assert.equal(base2.baseline_id, 'baseline-2');
  const cleanAfterBase2 = checkWorkflow(f.dir, 'surface', { baseline_id: 'post-apply' });
  assert.equal(cleanAfterBase2.baseline_id, 'baseline-2');
  assert.deepEqual(cleanAfterBase2.candidate_files, []);
  const diffFromBase1 = checkWorkflow(f.dir, 'surface', { baseline_id: 'pre-apply' });
  assert.equal(diffFromBase1.baseline_id, 'baseline-1');
  assert.deepEqual(diffFromBase1.candidate_files, expectedCandidate);

  // Direct surface -> candidate handoff & preservation of baselines across candidate/verify writes
  writeFileSync(join(f.dir, 'apply.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Implementation Summary\nMINI-001\n');
  recordWorkflow(f.dir, 'candidate', { executors: ['impl-1'], files: diffFromBase1.candidate_files });
  writeFileSync(join(f.dir, 'verify.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Verification Result\nVerification Result: PASS\n## Evidence Matrix\n| MINI-001 | tests | PASS |\n');
  recordWorkflow(f.dir, 'verify', { executor: 'verify-1' });
  const finalReceipt = JSON.parse(readFileSync(join(f.dir, 'flow.json'), 'utf8'));
  assert.equal(finalReceipt.baselines.length, 2);
  assert.equal(cliMain(['check', f.dir, '--phase', 'surface', '--baseline-id', 'pre-apply']), 0);
});

test('MINI-002: surface detects out-of-surface edits, unexpected new/modified symlinks, missing/stale baselines, and CLI violations', (t) => {
  const f = fixture(t);
  const planPath = join(f.dir, 'plan.md');
  writeFileSync(planPath, readFileSync(planPath, 'utf8').replace(`- Allowed Paths:\n  - ${f.root}/src/**`, `- Allowed Paths:\n  - ${f.root}/**`));
  const plan = checkWorkflow(f.dir, 'plan');
  recordWorkflow(f.dir, 'authorize', { author: 'j0k3r', reference: 'approval', plan_sha256: plan.plan_sha256 });

  // Missing baseline fails closed
  assert.throws(() => checkWorkflow(f.dir, 'surface'), /Missing baseline/i);

  const preLink = join(f.root, 'src/prelink.js');
  const code = join(f.root, 'src/code.js');
  writeFileSync(code, 'export const x = 1;\n');
  symlinkSync(code, preLink);
  assert.equal(cliMain(['baseline', f.dir, '--label', 'cli-base']), 0);

  // Out-of-surface edit + new symlink + modified symlink target
  const outFile = join(f.root, 'outside.js');
  writeFileSync(outFile, 'bad\n');
  const newLink = join(f.root, 'src/newlink.js');
  symlinkSync(code, newLink);
  rmSync(preLink);
  symlinkSync(outFile, preLink);

  const surface = checkWorkflow(f.dir, 'surface', { baseline_id: 'cli-base' });
  assert.equal(surface.surface_status, 'VIOLATIONS');
  assert.ok(surface.violations.some((v) => v.type === 'out_of_surface' && v.path === outFile));
  assert.ok(surface.violations.some((v) => v.type === 'unexpected_symlink' && v.path === newLink));
  assert.ok(surface.violations.some((v) => v.type === 'unexpected_symlink' && v.path === preLink));
  assert.ok(!surface.candidate_files.includes(outFile));
  assert.ok(!surface.candidate_files.includes(newLink));
  assert.ok(!surface.candidate_files.includes(preLink));
  assert.equal(cliMain(['check', f.dir, '--phase', 'surface', '--baseline-id', 'cli-base']), 1);

  // Unknown baseline_id fails closed
  assert.throws(() => checkWorkflow(f.dir, 'surface', { baseline_id: 'does-not-exist' }), /Unknown baseline/i);

  // Stale baseline (plan changed after baseline, even if re-authorized with same baseline record) fails closed
  const receipt = JSON.parse(readFileSync(join(f.dir, 'flow.json'), 'utf8'));
  receipt.baselines[0].plan_sha256 = '0'.repeat(64);
  writeFileSync(join(f.dir, 'flow.json'), JSON.stringify(receipt, null, 2));
  assert.throws(() => checkWorkflow(f.dir, 'surface'), /Stale baseline/i);
});

test('MINI-002: surface attributes legacy Parallel Units, staged Apply Sequence, unassigned writable edits, and read-only Project Contract drift', (t) => {
  // Part A: Staged Apply Sequence with read-only Project Contract
  const f = stagedFixture(t);
  const plan = f.plan.replace(
    `- Writable Paths:\n  - ${f.root}/src/**`,
    `- Writable Paths:\n  - ${f.root}/src/actions.ts\n  - ${f.root}/src/server-tests/**\n  - ${f.root}/src/component.tsx\n  - ${f.root}/src/shared.ts`,
  );
  writeFileSync(f.path, plan);
  writeFileSync(f.contract, '# Read-only contract\n');
  f.authorize();
  recordWorkflow(f.dir, 'baseline', { label: 'staged-base' });

  writeFileSync(join(f.root, 'src/actions.ts'), 'export const a = 1;\n');
  writeFileSync(join(f.root, 'src/component.tsx'), 'export const C = () => null;\n');
  writeFileSync(join(f.root, 'src/shared.ts'), 'export const shared = 1;\n');

  const clean = checkWorkflow(f.dir, 'surface');
  assert.equal(clean.surface_status, 'CLEAN');
  assert.equal(clean.contracts_status, 'MATCH');
  assert.deepEqual(clean.by_owner['UNIT-SERVER'].created, [join(f.root, 'src/actions.ts')]);
  assert.deepEqual(clean.by_owner['UNIT-UI'].created, [join(f.root, 'src/component.tsx')]);
  assert.deepEqual(clean.by_owner['Preparation/Integration'].created, [join(f.root, 'src/shared.ts')]);

  // Mutate read-only Project Contract -> project_contract_drift violation
  writeFileSync(f.contract, '# Unauthorized edit\n');
  const drifted = checkWorkflow(f.dir, 'surface');
  assert.equal(drifted.surface_status, 'VIOLATIONS');
  assert.equal(drifted.contracts_status, 'DRIFT');
  assert.ok(drifted.violations.some((v) => v.type === 'project_contract_drift' && v.path === f.contract));

  // Part B: Legacy Parallel Units (no Preparation/Integration) flags unassigned writable edits
  const f2 = fixture(t);
  const planPath2 = join(f2.dir, 'plan.md');
  mkdirSync(join(f2.root, 'src/unit-a'), { recursive: true });
  mkdirSync(join(f2.root, 'src/unit-b'), { recursive: true });
  const basePlan2 = readFileSync(planPath2, 'utf8');
  writeFileSync(
    planPath2,
    basePlan2.replace(
      '## Risks & Constraints',
      `## MINI-002: second\n- Contract: Second\n- Acceptance: Works\n- Canonical sources: User\n- Validation: node --test\n- Depends on: None\n\n## Parallel Units\n- UNIT-A: MINI-001 | Writable: ${f2.root}/src/unit-a/**\n- UNIT-B: MINI-002 | Writable: ${f2.root}/src/unit-b/**\n\n## Risks & Constraints`,
    ),
  );
  const p2 = checkWorkflow(f2.dir, 'plan');
  recordWorkflow(f2.dir, 'authorize', { author: 'j0k3r', reference: 'ok', plan_sha256: p2.plan_sha256 });
  recordWorkflow(f2.dir, 'baseline', {});
  writeFileSync(join(f2.root, 'src/unit-a/a.js'), 'export const a = 1;\n');
  writeFileSync(join(f2.root, 'src/unassigned.js'), 'export const stray = 1;\n');
  const s2 = checkWorkflow(f2.dir, 'surface');
  assert.equal(s2.surface_status, 'VIOLATIONS');
  assert.deepEqual(s2.by_owner['UNIT-A'].created, [join(f2.root, 'src/unit-a/a.js')]);
  assert.ok(s2.violations.some((v) => v.type === 'unassigned_writable' && v.path === join(f2.root, 'src/unassigned.js')));

  // Baseline file-count safety cap fails closed with actionable error
  writeFileSync(join(f2.root, 'src/unit-b/b.js'), 'export const b = 2;\n');
  assert.throws(() => recordWorkflow(f2.dir, 'baseline', {}, { maxBaselineFiles: 2 }), /safety cap/i);
});

function verifiedArchiveFixture(t, slug = 'demo-change') {
  const root = mkdtempSync(join(tmpdir(), 'pi-workflow-archive-'));
  const dir = join(root, 'openspec', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  const contract = readFileSync(new URL('../../../skills/subagent-artifact-contracts/SKILL.md', import.meta.url), 'utf8');
  const template = contract.split('### `plan.md`')[1].split('### `apply.md`')[0].match(/```markdown\n([\s\S]*?)\n```/)[1];
  writeFileSync(join(dir, 'plan.md'), template.replaceAll('/absolute/workspace/root', root));
  writeFileSync(join(dir, 'discovery.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n### EVID-001: Fact\n- Fact: Verified\n');
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  writeFileSync(join(dir, 'evidence/note.txt'), 'preserved evidence\n');
  const file = join(root, 'src/code.js');
  writeFileSync(file, 'export const one = 1;\n');
  const plan = checkWorkflow(dir, 'plan');
  recordWorkflow(dir, 'authorize', { author: 'j0k3r', reference: 'user:apply-ok', plan_sha256: plan.plan_sha256 });
  writeFileSync(join(dir, 'apply.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Implementation Summary\nMINI-001\n');
  recordWorkflow(dir, 'candidate', { executors: ['impl-session'], files: [file] });
  writeFileSync(join(dir, 'verify.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Verification Result\nVerification Result: PASS\n## Evidence Matrix\n| MINI-001 | node --test | PASS |\n');
  recordWorkflow(dir, 'verify', { executor: 'verify-session' });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, dir, file, slug };
}

test('MINI-003: archive atomically moves verified change tree, verifies post-move integrity, records metadata, and keeps archived deliver passing', (t) => {
  const f = verifiedArchiveFixture(t);
  const archived = recordWorkflow(f.dir, 'archive', {
    author: 'j0k3r',
    reference: 'user:archive-approved',
    date: '2026-11-25',
  });
  const expectedDest = join(f.root, 'openspec', 'archive', '2026-11-25', f.slug);
  assert.equal(archived.source, f.dir);
  assert.equal(archived.destination, expectedDest);
  assert.ok(archived.archived_files >= 5);
  assert.throws(() => readdirSync(f.dir), /ENOENT/);
  assert.equal(readFileSync(join(expectedDest, 'evidence/note.txt'), 'utf8'), 'preserved evidence\n');
  assert.equal(readdirSync(expectedDest).some((name) => name.endsWith('.tmp')), false);
  const receipt = JSON.parse(readFileSync(join(expectedDest, 'flow.json'), 'utf8'));
  assert.equal(receipt.archive.author, 'j0k3r');
  assert.equal(receipt.archive.reference, 'user:archive-approved');
  assert.equal(receipt.archive.source, f.dir);
  assert.equal(receipt.archive.destination, expectedDest);
  assert.equal(receipt.archive.candidate_sha256, receipt.implementation.sha256);
  assert.equal(receipt.archive.artifact_sha256, receipt.verification.artifact_sha256);
  // Archived directory still passes deliver check
  checkWorkflow(expectedDest, 'deliver');

  // CLI archive parity with default UTC date
  const f2 = verifiedArchiveFixture(t, 'cli-archive-demo');
  assert.equal(cliMain(['archive', f2.dir, '--author', 'j0k3r', '--reference', 'cli:archive-ok']), 0);
  const utcToday = new Date().toISOString().slice(0, 10);
  const cliDest = join(f2.root, 'openspec', 'archive', utcToday, 'cli-archive-demo');
  checkWorkflow(cliDest, 'deliver');
});

test('MINI-003: archive fails closed without mutating source on missing approval, drift, wrong path, destination collision, symlinks, cross-device, or rename failure', (t) => {
  // Missing author/reference or invalid date
  const f = verifiedArchiveFixture(t);
  assert.throws(() => recordWorkflow(f.dir, 'archive', { author: '', reference: 'ref' }), /author and reference/i);
  assert.throws(() => recordWorkflow(f.dir, 'archive', { author: 'j0k3r', reference: '   ' }), /author and reference/i);
  assert.throws(() => recordWorkflow(f.dir, 'archive', { author: 'j0k3r', reference: 'ref', date: '2026-02-31' }), /YYYY-MM-DD|date/i);

  // Non-openspec/changes/<slug> source path
  const wrongLoc = fixture(t);
  const wp = checkWorkflow(wrongLoc.dir, 'plan');
  recordWorkflow(wrongLoc.dir, 'authorize', { author: 'j0k3r', reference: 'ok', plan_sha256: wp.plan_sha256 });
  const wf = join(wrongLoc.root, 'src/code.js');
  writeFileSync(wf, 'export default 1;');
  writeFileSync(join(wrongLoc.dir, 'apply.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n');
  recordWorkflow(wrongLoc.dir, 'candidate', { executors: ['impl'], files: [wf] });
  writeFileSync(join(wrongLoc.dir, 'verify.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Verification Result\nVerification Result: PASS\n## Evidence Matrix\n| MINI-001 | ok | PASS |\n');
  recordWorkflow(wrongLoc.dir, 'verify', { executor: 'rev' });
  assert.throws(() => recordWorkflow(wrongLoc.dir, 'archive', { author: 'j0k3r', reference: 'ok' }), /openspec\/changes/i);

  // Drifted candidate blocks archive without mutating source
  writeFileSync(f.file, 'export const one = 2;\n');
  assert.throws(() => recordWorkflow(f.dir, 'archive', { author: 'j0k3r', reference: 'ok', date: '2026-11-25' }), /drift|changed/i);
  writeFileSync(f.file, 'export const one = 1;\n');

  // Existing destination collision blocks without overwrite/merge
  const collidingDest = join(f.root, 'openspec', 'archive', '2026-11-25', f.slug);
  mkdirSync(collidingDest, { recursive: true });
  writeFileSync(join(collidingDest, 'keep.txt'), 'do not overwrite\n');
  assert.throws(() => recordWorkflow(f.dir, 'archive', { author: 'j0k3r', reference: 'ok', date: '2026-11-25' }), /already exists/i);
  assert.equal(readFileSync(join(collidingDest, 'keep.txt'), 'utf8'), 'do not overwrite\n');
  rmSync(join(f.root, 'openspec', 'archive'), { recursive: true, force: true });

  // Unexpected symlink inside source dir
  const badLink = join(f.dir, 'evil-link');
  symlinkSync(f.file, badLink);
  assert.throws(() => recordWorkflow(f.dir, 'archive', { author: 'j0k3r', reference: 'ok', date: '2026-11-25' }), /symlink/i);
  rmSync(badLink);

  // Symlinked openspec/archive redirect
  const outsideTarget = join(f.root, 'outside-archive');
  mkdirSync(outsideTarget);
  symlinkSync(outsideTarget, join(f.root, 'openspec', 'archive'));
  assert.throws(() => recordWorkflow(f.dir, 'archive', { author: 'j0k3r', reference: 'ok', date: '2026-11-25' }), /symlink/i);
  rmSync(join(f.root, 'openspec', 'archive'));

  // Cross-filesystem device mismatch fails closed with no copy/delete fallback and zero mutation
  assert.throws(
    () => recordWorkflow(f.dir, 'archive', { author: 'j0k3r', reference: 'ok', date: '2026-11-25' }, {
      devFor: (targetPath) => (targetPath === f.dir ? 100 : 200),
    }),
    /same-filesystem|different device|copy\/delete/i,
  );
  assert.ok(readdirSync(f.dir).includes('plan.md'));
  assert.throws(() => readdirSync(join(f.root, 'openspec', 'archive')), /ENOENT/);

  // Simulated EXDEV on renameSync cleans up newly created empty date dir and leaves source intact
  assert.throws(
    () => recordWorkflow(f.dir, 'archive', { author: 'j0k3r', reference: 'ok', date: '2026-11-25' }, {
      renameSync: () => {
        const err = new Error('EXDEV: cross-device link not permitted');
        err.code = 'EXDEV';
        throw err;
      },
    }),
    /EXDEV|same-filesystem|copy\/delete/i,
  );
  assert.ok(readdirSync(f.dir).includes('plan.md'));
  assert.throws(() => readdirSync(join(f.root, 'openspec', 'archive', '2026-11-25')), /ENOENT/);
});

test('MINI-004: workflow_check snapshot and surface losslessly paginate 90+ files and return BLOCKED on DRIFT/violations with full report', async (t) => {
  const f = fixture(t);
  const queued = [];
  const record = createWorkflowRecordTool(async (path, callback) => { queued.push(path); return callback(); });
  const runRecord = (params, signal) => record.execute('rec', { change_dir: f.dir, ...params }, signal, undefined, { cwd: f.root });

  const planRes = await f.run({ change_dir: f.dir, phase: 'plan' });
  await runRecord({ action: 'authorize', author: 'j0k3r', reference: 'user:ok', plan_sha256: planRes.details.plan_sha256 });
  const baseRes = await runRecord({ action: 'baseline', label: 'bulk-90' });
  assert.equal(baseRes.isError, false);
  assert.equal(baseRes.details.baseline_id, 'baseline-1');
  assert.equal(baseRes.details.file_count, 0);

  // Create 90 files inside Writable Paths
  const created = [];
  for (let i = 0; i < 90; i++) {
    const filePath = join(f.root, `src/module-${String(i).padStart(3, '0')}.js`);
    writeFileSync(filePath, `export const index = ${i};\n`);
    created.push(filePath);
  }

  // Page through workflow_check phase="surface"
  let surfaceOffset = 0;
  let surfaceFull = '';
  let surfacePages = 0;
  let lastSurfaceDetails;
  for (;;) {
    const res = await f.run({ change_dir: f.dir, phase: 'surface', baseline_id: 'bulk-90', diagnostic_offset: surfaceOffset });
    assert.equal(res.isError, false);
    assert.equal(res.details.status, 'PASS');
    const pageText = res.content[0].text.split('\nDiagnostic range ')[0];
    assert.ok(pageText.length <= 4000);
    assert.ok(pageText.split('\n').length <= 101);
    surfaceFull += pageText;
    surfacePages++;
    lastSurfaceDetails = res.details;
    if (res.details.next_offset === undefined) {
      assert.equal(surfaceFull.length, res.details.diagnostic_total);
      break;
    }
    surfaceOffset = res.details.next_offset;
  }
  assert.ok(surfacePages >= 2, '90 files should span multiple diagnostic pages');
  const candidateJsonBlock = surfaceFull.split('Candidate Files JSON:\n')[1];
  const parsedCandidateFiles = JSON.parse(candidateJsonBlock);
  assert.equal(parsedCandidateFiles.length, 90);
  assert.deepEqual(parsedCandidateFiles, created.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  assert.deepEqual(lastSurfaceDetails.candidate_files, parsedCandidateFiles);

  // Capture candidate from surface output and page through workflow_check phase="snapshot"
  writeFileSync(join(f.dir, 'apply.md'), '## Workflow Status\n- Status: READY\n- Blockers: None\n\n## Implementation Summary\nMINI-001\n');
  const candRes = await runRecord({ action: 'candidate', executors: ['impl-bulk'], files: parsedCandidateFiles });
  assert.equal(candRes.isError, false);

  let snapOffset = 0;
  let snapFull = '';
  let snapPages = 0;
  let lastSnapDetails;
  for (;;) {
    const res = await f.run({ change_dir: f.dir, phase: 'snapshot', diagnostic_offset: snapOffset });
    assert.equal(res.isError, false);
    assert.equal(res.details.status, 'PASS');
    assert.equal(res.details.continuity_status, 'MATCH');
    const pageText = res.content[0].text.split('\nDiagnostic range ')[0];
    assert.ok(pageText.length <= 4000);
    assert.ok(pageText.split('\n').length <= 101);
    snapFull += pageText;
    snapPages++;
    lastSnapDetails = res.details;
    if (res.details.next_offset === undefined) {
      assert.equal(snapFull.length, res.details.diagnostic_total);
      break;
    }
    snapOffset = res.details.next_offset;
  }
  assert.ok(snapPages >= 3, '90 snapshot records should span multiple diagnostic pages');
  const recordsJsonBlock = snapFull.split('Snapshot Records JSON:\n')[1];
  const parsedRecords = JSON.parse(recordsJsonBlock);
  assert.equal(parsedRecords.length, 90);
  assert.equal(sha256(JSON.stringify(parsedRecords)), lastSnapDetails.snapshot_sha256);

  // Induce DRIFT -> snapshot returns status BLOCKED (isError: true) WITH complete paged report
  writeFileSync(created[0], 'export const mutated = true;\n');
  const driftRes = await f.run({ change_dir: f.dir, phase: 'snapshot' });
  assert.equal(driftRes.isError, true);
  assert.equal(driftRes.details.status, 'BLOCKED');
  assert.equal(driftRes.details.continuity_status, 'DRIFT');
  assert.equal(driftRes.details.drift_count, 1);
  assert.match(driftRes.content[0].text, /Continuity: DRIFT/);
  assert.match(driftRes.content[0].text, /Drift Details:/);

  // Induce unexpected symlink -> surface returns status BLOCKED (isError: true) WITH violation report
  symlinkSync(created[0], join(f.root, 'src/bad-link.js'));
  const violRes = await f.run({ change_dir: f.dir, phase: 'surface' });
  assert.equal(violRes.isError, true);
  assert.equal(violRes.details.status, 'BLOCKED');
  assert.equal(violRes.details.surface_status, 'VIOLATIONS');
  assert.equal(violRes.details.violation_count, 1);
  assert.match(violRes.content[0].text, /unexpected_symlink/);
  assert.ok(queued.every((p) => p === join(f.dir, 'flow.json')));
});

test('MINI-004: strict parameter validation and AbortSignal enforcement on new workflow_check and workflow_record operations', async (t) => {
  const f = verifiedArchiveFixture(t, 'tool-strict-check');
  const checkTool = createWorkflowCheckTool();
  const recordTool = createWorkflowRecordTool(async (_path, callback) => callback());
  const runCheck = (params, signal) => checkTool.execute('c', { change_dir: f.dir, ...params }, signal, undefined, { cwd: f.root });
  const runRecord = (params, signal) => recordTool.execute('r', { change_dir: f.dir, ...params }, signal, undefined, { cwd: f.root });

  // baseline_id only allowed for phase="surface"
  await assert.rejects(() => runCheck({ phase: 'plan', baseline_id: 'baseline-1' }), /Invalid workflow_check/);
  await assert.rejects(() => runCheck({ phase: 'snapshot', baseline_id: 'baseline-1' }), /Invalid workflow_check/);
  await assert.rejects(() => runCheck({ phase: 'surface', baseline_id: '   ' }), /Invalid workflow_check/);

  // Strict allowlists on baseline and archive
  await assert.rejects(() => runRecord({ action: 'baseline', author: 'j0k3r' }), /Invalid workflow_record/);
  await assert.rejects(() => runRecord({ action: 'baseline', label: '   ' }), /Invalid workflow_record/);
  await assert.rejects(() => runRecord({ action: 'archive', author: 'j0k3r' }), /Invalid workflow_record/);
  await assert.rejects(() => runRecord({ action: 'archive', author: 'j0k3r', reference: 'ok', date: 'bad-date' }), /Invalid workflow_record/);
  await assert.rejects(() => runRecord({ action: 'archive', author: 'j0k3r', reference: 'ok', label: 'nope' }), /Invalid workflow_record/);

  // AbortSignal respected on baseline, archive, snapshot, surface
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() => runCheck({ phase: 'snapshot' }, aborted.signal), { name: 'AbortError' });
  await assert.rejects(() => runCheck({ phase: 'surface' }, aborted.signal), { name: 'AbortError' });
  await assert.rejects(() => runRecord({ action: 'baseline' }, aborted.signal), { name: 'AbortError' });
  await assert.rejects(() => runRecord({ action: 'archive', author: 'j0k3r', reference: 'ok' }, aborted.signal), { name: 'AbortError' });

  // Valid archive through workflow_record tool succeeds
  const archived = await runRecord({ action: 'archive', author: 'j0k3r', reference: 'user:archive-ok', date: '2026-11-25' });
  assert.equal(archived.isError, false);
  assert.equal(archived.details.status, 'PASS');
  assert.equal(archived.details.destination, join(f.root, 'openspec', 'archive', '2026-11-25', f.slug));
});
