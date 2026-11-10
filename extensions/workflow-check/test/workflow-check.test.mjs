import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkflowCheckTool } from '../src/tools/workflow-check.ts';
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

test('preserves cancellation instead of reporting a validation failure', async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => f.run({ change_dir: f.dir, phase: 'plan' }, controller.signal), { name: 'AbortError' });
});
