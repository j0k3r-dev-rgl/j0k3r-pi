import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
