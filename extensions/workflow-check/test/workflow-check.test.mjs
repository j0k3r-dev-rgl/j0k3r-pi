import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkflowCheckTool } from '../src/tools/workflow-check.ts';
import { checkWorkflow, recordWorkflow } from '../src/core/flow-check.ts';
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
