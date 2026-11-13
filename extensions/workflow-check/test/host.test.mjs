import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Only Pi's documented host packages are used; no sibling extension resolution.
const host = process.env.PI_WORKFLOW_TEST_HOST;
test('Pi loads both tools and native rendering preserves expanded content', { skip: !host }, async () => {
  const { loadExtensions } = await import(pathToFileURL(`${host}/dist/core/extensions/loader.js`).href);
  const entry = new URL('../index.ts', import.meta.url).pathname;
  const loaded = await loadExtensions([entry], process.cwd());
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual([...loaded.extensions[0].tools.keys()], ['workflow_check', 'workflow_record']);
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const context = { args: { phase: 'plan' }, keyHint: (key, text) => `${key} ${text}` };
  for (const registered of loaded.extensions[0].tools.values()) {
    const tool = registered.definition;
    const result = { content: [{ type: 'text', text: 'Full diagnostic\nSecond line 漢字' }], details: { status: 'BLOCKED', phase: 'plan' } };
    const collapsed = tool.renderResult(result, { expanded: false, isPartial: false }, theme, context).render(30);
    assert.match(collapsed.join('\n'), /BLOCKED/);
    assert.match(collapsed.join('\n'), /app.tools.expand/);
    const expanded = tool.renderResult(result, { expanded: true, isPartial: false }, theme, context).render(30);
    assert.match(expanded.join('\n'), /Second line 漢字/);
    assert.match(tool.renderResult(result, { expanded: false, isPartial: true }, theme, context).render(30).join('\n'), /Checking/);
  }
});

test('Pi reload refreshes workflow engine exports after an in-process update', { skip: !host }, async (t) => {
  const { loadExtensions, clearExtensionCache } = await import(pathToFileURL(`${host}/dist/core/extensions/loader.js`).href);
  const root = mkdtempSync(join(tmpdir(), 'workflow-reload-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(new URL('../', import.meta.url), root, { recursive: true });
  const entry = join(root, 'index.ts');
  const originalEntry = readFileSync(entry, 'utf8');
  const engineImport = readFileSync(join(root, 'src/tools/workflow-record.ts'), 'utf8').match(/from '(\.\.\/core\/[^']+)'/)[1];
  const engine = join(root, 'src/tools', engineImport);
  const originalEngine = readFileSync(engine, 'utf8');
  // Simulate a previously loaded release that had no receipt export.
  writeFileSync(engine, originalEngine.replace('export function recordWorkflow(', 'function recordWorkflow('));
  writeFileSync(entry, originalEntry.replace('  pi.registerTool({ ...createWorkflowRecordTool(withFileMutationQueue), renderCall, renderResult });', ''));
  const initial = await loadExtensions([entry], root);
  assert.deepEqual(initial.errors, []);
  await initial.extensions[0].tools.get('workflow_check').definition.execute('before', { change_dir: root, phase: 'plan' }, undefined, undefined, { cwd: root });
  writeFileSync(engine, originalEngine);
  writeFileSync(entry, originalEntry);
  clearExtensionCache();
  const reloaded = await loadExtensions([entry], root);
  assert.deepEqual(reloaded.errors, []);
  const result = await reloaded.extensions[0].tools.get('workflow_record').definition.execute('after', {
    change_dir: root, action: 'authorize', author: 'fixture', reference: 'isolated fixture only', plan_sha256: '0'.repeat(64),
  }, undefined, undefined, { cwd: root });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /ENOENT/, 'The fresh engine must execute and report missing plan.md, not an obsolete missing function');
  assert.doesNotMatch(result.content[0].text, /not a function/);
});

test('Pi-loaded tools execute plan, authorization, candidate, independent verification and delivery', { skip: !host }, async (t) => {
  const { loadExtensions } = await import(pathToFileURL(`${host}/dist/core/extensions/loader.js`).href);
  const root = mkdtempSync(join(tmpdir(), 'workflow-host-lifecycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'change');
  mkdirSync(dir);
  mkdirSync(join(root, 'src'));
  const contract = readFileSync(new URL('../../../skills/subagent-artifact-contracts/SKILL.md', import.meta.url), 'utf8');
  const template = contract.split('### `plan.md`')[1].split('### `apply.md`')[0].match(/```markdown\n([\s\S]*?)\n```/)[1];
  writeFileSync(join(dir, 'plan.md'), template.replaceAll('/absolute/workspace/root', root));
  const loaded = await loadExtensions([new URL('../index.ts', import.meta.url).pathname], root);
  assert.deepEqual(loaded.errors, []);
  const run = async (name, params) => {
    const result = await loaded.extensions[0].tools.get(name).definition.execute('fixture', { change_dir: dir, ...params }, undefined, undefined, { cwd: root });
    assert.equal(result.isError, false, JSON.stringify(result));
    return result;
  };
  const plan = await run('workflow_check', { phase: 'plan' });
  await run('workflow_record', { action: 'authorize', author: 'fixture-user', reference: 'isolated fixture only, not real approval', plan_sha256: plan.details.plan_sha256 });
  await run('workflow_check', { phase: 'apply' });
  const file = join(root, 'src/code.js');
  writeFileSync(file, 'export default 1;');
  const ready = '## Workflow Status\n- Status: READY\n- Blockers: None\n';
  writeFileSync(join(dir, 'apply.md'), ready + '\n## Implementation Summary\nMINI-001\n');
  await run('workflow_record', { action: 'candidate', executors: ['fixture-implementer'], files: [file] });
  await run('workflow_check', { phase: 'verify' });
  writeFileSync(join(dir, 'verify.md'), ready + '\n## Verification Result\nVerification Result: PASS\n## Evidence Matrix\n| MINI-001 | fixture assertion | PASS |\n');
  await run('workflow_record', { action: 'verify', executor: 'fixture-reviewer' });
  await run('workflow_check', { phase: 'deliver' });
});

test('workflow workers receive only the read-only tool and a phase-specific gate', () => {
  for (const [name, phase] of [['01-planning', 'plan'], ['02-apply', 'apply'], ['03-verify', 'verify']]) {
    const definition = readFileSync(new URL(`../../../subagents/${name}.md`, import.meta.url), 'utf8');
    const front = definition.split('---')[1];
    assert.match(front, /^  - workflow_check$/m);
    assert.doesNotMatch(front, /^  - workflow_record$/m);
    assert.match(definition, new RegExp(`phase (?:\x60|\x22)${phase}`));
    if (name === '01-planning') assert.doesNotMatch(front, /^  - bash$/m);
  }
});
