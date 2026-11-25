import test from 'node:test';
import assert from 'node:assert/strict';
import supervisor from '../index.ts';

const ANSI_OSC_APC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const ZERO_WIDTH_RE = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/u;
const WIDE_CHAR_RE = /[\u1100-\u115f\u231a-\u231b\u2329-\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u;

function stripControl(text: string): string {
  return text.replace(ANSI_OSC_APC_RE, '');
}

function measureWidth(text: string): number {
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(stripControl(text))) {
    if (segment === '\t') width += 3;
    else if (ZERO_WIDTH_RE.test(segment)) width += 0;
    else if (WIDE_CHAR_RE.test(segment)) width += 2;
    else width += 1;
  }
  return width;
}

function assertCompliant(lines: string[]): void {
  const joined = lines.join('\n');
  assert.doesNotMatch(joined, /[╭╮╰╯│]/);
  assert.doesNotMatch(joined, /\x1b\[(?:4[0-7]|48;|10[0-7]|7m)/);
  assert.doesNotMatch(stripControl(joined), /\b(to expand|to collapse|ctrl\+o|app\.tools\.expand)\b/i);
}

function registerRotateTool() {
  const tools = new Map<string, any>();
  const pi: any = {
    registerCommand() {},
    registerTool(tool: any) { tools.set(tool.name, tool); },
    on() {},
    events: { on() {}, off() {}, emit() {} },
  };
  supervisor(pi);
  return tools.get('supervisor_rotate');
}

test('supervisor_rotate exposes standalone compactToolRenderingVersion: 1 and self-shell renderers', () => {
  const tool = registerRotateTool();
  assert.ok(tool);
  assert.equal(tool.compactToolRenderingVersion, 1);
  assert.equal(tool.renderShell, 'self');
  assert.equal(typeof tool.renderCall, 'function');
  assert.equal(typeof tool.renderResult, 'function');
});

test('supervisor_rotate coordinates pending call and result into a single inline row without cards or hints', () => {
  const tool = registerRotateTool();
  const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
  const args = { memory_id: 42, continue_task: true };
  const state: Record<string, unknown> = {};
  const context: any = { args, state };

  const callComp = tool.renderCall(args, theme, context);
  const pendingLines = callComp.render(80);
  assert.equal(pendingLines.length, 1);
  assert.match(stripControl(pendingLines[0]), /supervisor_rotate \[checkpoint #42 · continue\] ─── ● checkpointing…/);
  assertCompliant(pendingLines);

  const result = {
    content: [{ type: 'text', text: 'Rotation scheduled with verified checkpoint #42; opening the fresh session now.\nLiteral ╭box╮ to expand' }],
    details: { scheduled: true, memoryId: 42, dispatched: true },
  };
  const resultComp = tool.renderResult(result, { expanded: false, isPartial: false }, theme, context);
  assert.deepEqual(callComp.render(80), []);

  const collapsedLines = resultComp.render(80);
  assert.equal(collapsedLines.length, 1);
  assert.match(stripControl(collapsedLines[0]), /supervisor_rotate \[checkpoint #42 · continue\] ─── ✓ scheduled #42 · dispatched/);
  assertCompliant(collapsedLines);

  const expandedComp = tool.renderResult(result, { expanded: true, isPartial: false }, theme, { args, state: {} });
  const expandedPlain = stripControl(expandedComp.render(80).join('\n'));
  assert.match(expandedPlain, /Rotation scheduled with verified checkpoint #42/);
  assert.match(expandedPlain, /Literal ╭box╮ to expand/);
  assert.doesNotMatch(expandedPlain, /ctrl\+o/i);
});

test('supervisor_rotate handles partial, error, empty, width bounds (0..120), wide chars, and malformed inputs', () => {
  const tool = registerRotateTool();
  const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

  const partial = tool.renderResult({ content: [], details: undefined }, { expanded: false, isPartial: true }, theme, { args: {}, state: {} }).render(80);
  assert.equal(partial.length, 1);
  assert.match(stripControl(partial[0]), /rotating…/);
  assertCompliant(partial);

  const failed = tool.renderResult(
    { content: [{ type: 'text', text: 'Supervisor checkpoint failed' }], details: undefined, isError: true },
    { expanded: false, isPartial: false },
    theme,
    { args: {}, isError: true, state: {} },
  ).render(80);
  assert.equal(failed.length, 1);
  assert.match(stripControl(failed[0]), /✗ Supervisor checkpoint failed/);
  assertCompliant(failed);

  const wideResult = {
    content: [{ type: 'text', text: '漢字🚀 café\u0301 \x1b]8;;https://example.com\x07link\x1b]8;;\x07\nline two' }],
    details: { scheduled: true, memoryId: 7, dispatched: true },
  };
  const wideComp = tool.renderResult(wideResult, { expanded: true, isPartial: false }, theme, { args: { summary: '漢字🚀' }, state: {} });
  assert.deepEqual(wideComp.render(0), []);
  assert.deepEqual(tool.renderCall({ summary: '漢字🚀' }, theme, {}).render(0), []);

  for (const width of [1, 2, 10, 23, 24, 40, 80, 120]) {
    for (const line of wideComp.render(width)) {
      assert.ok(measureWidth(line) <= width, `width ${width}: ${measureWidth(line)}`);
    }
    const callLines = tool.renderCall({ memory_id: 7 }, theme, {}).render(width);
    if (width === 1) assert.deepEqual(callLines, [' ']);
    else assert.ok(callLines.length >= 1);
    for (const line of callLines) {
      assert.ok(measureWidth(line) <= width, `call width ${width}: ${measureWidth(line)}`);
    }
  }

  assert.doesNotThrow(() => tool.renderCall(null, undefined, undefined).render(80));
  assert.doesNotThrow(() => tool.renderResult(null, undefined, undefined, undefined).render(80));
});

test('supervisor_rotate wraps overflowing collapsed headers without ellipsis clipping', () => {
  const tool = registerRotateTool();
  const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

  const resLines = tool.renderResult(
    {
      content: [{ type: 'text', text: 'Rotation completed cleanly with END_MARKER' }],
      details: { scheduled: true, memoryId: 4242, dispatched: true },
    },
    { expanded: false, isPartial: false },
    theme,
    { args: { memory_id: 4242, continue_task: true }, state: {} },
  ).render(32);

  assert.ok(resLines.length > 1, 'overflowing collapsed header must wrap');
  assert.doesNotMatch(stripControl(resLines.join('\n')), /…/);
  assert.match(resLines.map((line) => stripControl(line).slice(1)).join(' '), /dispatched/);
  for (const line of resLines) {
    assert.ok(measureWidth(line) <= 32);
    assert.ok(stripControl(line).startsWith(' '));
  }
});

test('supervisor_rotate applies muted foreground to plain-text expanded body preserving ANSI and width-2 wide graphemes', () => {
  const tool = registerRotateTool();
  const customTheme = {
    fg: (token: string, text: string) => (token === 'muted' ? `\x1b[38;2;10;20;30m${text}\x1b[39m` : text),
  };
  const result = {
    content: [{ type: 'text', text: 'Plain checkpoint handoff note\n\x1b[33mAmber supervisor warning\x1b[0m' }],
    details: { scheduled: true, memoryId: 12, dispatched: true },
  };

  const themed = tool.renderResult(result, { expanded: true, isPartial: false }, customTheme, { args: { memory_id: 12 }, state: {} }).render(80).join('\n');
  assert.ok(themed.includes('\x1b[38;2;10;20;30mPlain checkpoint handoff note\x1b[39m'));
  assert.ok(themed.includes('\x1b[33mAmber supervisor warning\x1b[0m'));
  assert.ok(!themed.includes('\x1b[38;2;10;20;30m\x1b[33m'));

  const fallback = tool.renderResult(result, { expanded: true, isPartial: false }, undefined, { args: { memory_id: 12 }, state: {} }).render(80).join('\n');
  assert.ok(fallback.includes('\x1b[38;2;122;167;184mPlain checkpoint handoff note\x1b[39m'));
  assert.ok(fallback.includes('\x1b[33mAmber supervisor warning\x1b[0m'));

  const wideComp = tool.renderResult(
    { content: [{ type: 'text', text: 'A漢B' }], details: { scheduled: true, memoryId: 1 } },
    { expanded: true, isPartial: false },
    customTheme,
    { args: { memory_id: 1 }, state: {} },
  );
  assert.deepEqual(wideComp.render(0), []);
  assert.deepEqual(wideComp.render(1), [' ']);
  const w2 = wideComp.render(2);
  const plainW2 = w2.map(stripControl);
  assert.ok(plainW2.includes(' A'));
  assert.ok(plainW2.includes('漢'));
  assert.ok(plainW2.includes(' B'));
  for (const line of w2) assert.ok(measureWidth(line) <= 2);
});
