import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Only Pi's documented host packages are used; no sibling extension resolution.
const host = process.env.PI_WORKFLOW_TEST_HOST;
test('Pi loads both tools and compact rendering preserves expanded content without hints or cards', { skip: !host }, async () => {
  const { loadExtensions } = await import(pathToFileURL(`${host}/dist/core/extensions/loader.js`).href);
  const { ToolExecutionComponent, initTheme } = await import(pathToFileURL(`${host}/dist/modes/interactive/components/tool-execution.js`).href).catch(() => import(pathToFileURL(`${host}/dist/index.js`).href));
  const { visibleWidth } = await import(pathToFileURL(`${host}/node_modules/@earendil-works/pi-tui/dist/index.js`).href);
  if (typeof initTheme === 'function') initTheme();
  const entry = new URL('../index.ts', import.meta.url).pathname;
  const loaded = await loadExtensions([entry], process.cwd());
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual([...loaded.extensions[0].tools.keys()], ['workflow_check', 'workflow_record']);
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const home = process.env.HOME || '';
  const siblingPrefixPath = home ? `${home}-other/change` : '/tmp/other/change';
  const context = { args: { phase: 'plan', change_dir: siblingPrefixPath }, keyHint: (key, text) => `${key} ${text}`, state: {} };
  for (const registered of loaded.extensions[0].tools.values()) {
    const tool = registered.definition;
    assert.equal(tool.compactToolRenderingVersion, 1);
    assert.equal(tool.renderShell, 'self');
    const result = { content: [{ type: 'text', text: 'Full diagnostic\nSecond line 漢字\nLiteral ╭box╮ to expand' }], details: { status: 'BLOCKED', phase: 'plan', contract_count: 3 } };
    const callComp = tool.renderCall(context.args, theme, { ...context, state: {} });
    assert.equal(callComp.render(0).length, 0);
    const pending = callComp.render(80);
    assert.equal(pending.length, 1);
    assert.match(pending[0], /───/);
    if (home) assert.match(pending[0], /-other\/change/);

    const rowState = {};
    const coordCall = tool.renderCall(context.args, theme, { ...context, state: rowState });
    const coordResult = tool.renderResult(result, { expanded: false, isPartial: false }, theme, { ...context, state: rowState });
    assert.deepEqual(coordCall.render(80), []);
    const collapsed = coordResult.render(80);
    assert.ok(collapsed.length >= 1);
    const collapsedJoined = collapsed.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').slice(1)).join(' ');
    assert.match(collapsedJoined, /BLOCKED/);
    assert.match(collapsedJoined, /───/);
    assert.match(collapsedJoined, /3 contracts/);
    assert.doesNotMatch(collapsed.join('\n'), /…|app\.tools\.expand|to expand|ctrl\+o|[╭╮╰╯│]/);
    for (const line of collapsed) {
      assert.ok(visibleWidth(line) <= 80);
      assert.ok(line.startsWith(' '));
    }

    const narrowCollapsed = tool.renderResult(result, { expanded: false, isPartial: false }, theme, { ...context, state: {} }).render(32);
    assert.ok(narrowCollapsed.length > 1, 'overflowing collapsed header must wrap');
    assert.doesNotMatch(narrowCollapsed.join('\n'), /…/);
    assert.match(narrowCollapsed.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').slice(1)).join(' '), /3 contracts/);
    for (const line of narrowCollapsed) {
      assert.ok(visibleWidth(line) <= 32);
      assert.ok(line.startsWith(' '));
    }

    const expanded = tool.renderResult(result, { expanded: true, isPartial: false }, theme, { ...context, state: {} }).render(30);
    assert.match(expanded.join('\n'), /Second line 漢字/);
    assert.match(expanded.join('\n'), /Literal ╭box╮ to expand/);
    for (const width of [0, 1, 2, 10, 23, 24, 40, 80]) {
      for (const line of tool.renderResult(result, { expanded: true, isPartial: false }, theme, { ...context, state: {} }).render(width)) {
        assert.ok(visibleWidth(line) <= width, `width ${width}`);
      }
      const collapsedAtWidth = tool.renderResult(result, { expanded: false, isPartial: false }, theme, { ...context, state: {} }).render(width);
      for (const line of collapsedAtWidth) {
        assert.ok(visibleWidth(line) <= width, `collapsed width ${width}`);
      }
      if (width <= 0) assert.equal(collapsedAtWidth.length, 0);
      else if (width === 1) assert.deepEqual(collapsedAtWidth, [' ']);
      else assert.ok(collapsedAtWidth.length >= 1);
    }

    // Muted foreground on plain-text expanded body preserving existing ANSI
    const customTheme = {
      fg: (token, text) => (token === 'muted' ? `\x1b[38;2;10;20;30m${text}\x1b[39m` : text),
    };
    const styledResult = {
      content: [{ type: 'text', text: 'Plain diagnostic line\n\x1b[33mAmber diagnostic warning\x1b[0m' }],
      details: { status: 'PASS', phase: 'plan' },
    };
    const themedExpanded = tool.renderResult(styledResult, { expanded: true, isPartial: false }, customTheme, { ...context, state: {} }).render(80).join('\n');
    assert.ok(themedExpanded.includes('\x1b[38;2;10;20;30mPlain diagnostic line\x1b[39m'));
    assert.ok(themedExpanded.includes('\x1b[33mAmber diagnostic warning\x1b[0m'));
    assert.ok(!themedExpanded.includes('\x1b[38;2;10;20;30m\x1b[33m'));

    const fallbackExpanded = tool.renderResult(styledResult, { expanded: true, isPartial: false }, undefined, { ...context, state: {} }).render(80).join('\n');
    assert.ok(fallbackExpanded.includes('\x1b[38;2;122;167;184mPlain diagnostic line\x1b[39m'));
    assert.ok(fallbackExpanded.includes('\x1b[33mAmber diagnostic warning\x1b[0m'));

    // Width 2 preserves intact wide graphemes (A漢B) via conditional margin omission
    const wideResult = { content: [{ type: 'text', text: 'A漢B' }], details: { status: 'PASS', phase: 'plan' } };
    const wideW2 = tool.renderResult(wideResult, { expanded: true, isPartial: false }, theme, { ...context, state: {} }).render(2);
    const wideStripped = wideW2.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''));
    assert.ok(wideStripped.includes(' A'));
    assert.ok(wideStripped.includes('漢'));
    assert.ok(wideStripped.includes(' B'));
    for (const line of wideW2) assert.ok(visibleWidth(line) <= 2);

    const partial = tool.renderResult(result, { expanded: false, isPartial: true }, theme, { ...context, state: {} }).render(80);
    assert.equal(partial.length, 1);
    assert.match(partial[0], /Checking/);
    if (home) {
      const homeRow = tool.renderCall({ phase: 'plan', change_dir: `${home}/openspec/changes/x` }, theme, { state: {} }).render(80)[0];
      assert.match(homeRow, /~\/openspec\/changes\/x/);
    }
    assert.doesNotThrow(() => tool.renderCall(null, undefined, undefined).render(80));
    assert.doesNotThrow(() => tool.renderResult(null, undefined, undefined, undefined).render(80));
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
  writeFileSync(entry, originalEntry.replace(/^\s*pi\.registerTool\(\{ \.\.\.createWorkflowRecordTool\(withFileMutationQueue\).*\}\);\s*$/m, ''));
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
