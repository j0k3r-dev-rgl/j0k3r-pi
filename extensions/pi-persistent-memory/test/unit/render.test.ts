import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolExecutionComponent, initTheme } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { createMemoryTools } from '../../src/tools/index.ts';

initTheme();

function plainLines(lines: string[]): string[] {
  return lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').trimEnd()).filter(Boolean);
}

function assertTransparentAndUnboxed(lines: string[]): void {
  const joined = lines.join('\n');
  assert.ok(!lines.some((line) => /\x1b\[(?:[^m;]*;)*(?:4[0-7]|48|10[0-7]|7)(?:;|m)/.test(line)), 'Memory rows must not apply a background');
  assert.doesNotMatch(joined, /[╭╮╰╯│]/);
}

function assertNoHints(lines: string[]): void {
  const plain = lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  assert.doesNotMatch(plain, /\b(to expand|to collapse|ctrl\+o|app\.tools\.expand)\b/i);
}

test('M5-A07: Transparent cyan inline brain/tool call, native collapsed state without hints', () => {
  const tools = createMemoryTools();
  const searchTool = tools.find((t) => t.name === 'memory_search')!;

  assert.equal((searchTool as any).compactToolRenderingVersion, 1);
  assert.equal(searchTool.renderShell, 'self');

  const mockUi = { requestRender: () => {} };
  const comp = new ToolExecutionComponent(
    'memory_search',
    'call-1',
    { query: 'test query' },
    {},
    searchTool as any,
    mockUi as any,
    process.cwd(),
  );

  // Pending call before result
  const pendingLines = comp.render(80);
  assert.equal(plainLines(pendingLines).length, 1);
  assert.match(plainLines(pendingLines)[0], /🧠 memory_search.*test query.*───/);
  assertTransparentAndUnboxed(pendingLines);
  assertNoHints(pendingLines);

  // New row defaults collapsed
  assert.equal((comp as any).expanded, false);

  // Partial execution state
  comp.updateResult({ content: [{ type: 'text', text: 'Executing...' }], isError: false }, true);
  const partialLines = comp.render(80);
  assert.ok(partialLines.length > 0);
  assert.equal(plainLines(partialLines).length, 1);
  assert.match(plainLines(partialLines)[0], /🧠 memory_search.*test query.*───.*Executing/);
  assertTransparentAndUnboxed(partialLines);
  assertNoHints(partialLines);

  // Finished result
  comp.updateResult(
    {
      content: [{ type: 'text', text: 'Detailed search result line 1\nDetailed search result line 2' }],
      details: { count: 2, has_more: false },
      isError: false,
    },
    false,
  );

  // Collapsed rendering includes count, separator, and NO expand hint
  const collapsedLines = comp.render(80);
  const collapsedText = collapsedLines.join('\n');
  assert.equal(plainLines(collapsedLines).length, 1, 'Collapsed call and result must share a single line');
  assert.match(collapsedText, /🧠 memory_search/);
  assert.match(collapsedText, /───/);
  assert.match(collapsedText, /\x1b\[38;2;135;206;250m/);
  assertTransparentAndUnboxed(collapsedLines);
  assertNoHints(collapsedLines);
  assert.match(collapsedText, /Found 2 result\(s\)/);
  assert.ok(!collapsedText.includes('Detailed search result line 1'));
});

test('M5-A07: Mouse primary click toggles expanded on SAME Pi state, keyboard path matches', () => {
  const tools = createMemoryTools();
  const getTool = tools.find((t) => t.name === 'memory_get')!;
  const mockUi = { requestRender: () => {} };

  const comp = new ToolExecutionComponent(
    'memory_get',
    'call-2',
    { id: 42 },
    {},
    getTool as any,
    mockUi as any,
    process.cwd(),
  );

  const fullContent = 'Full stored content of memory #42 with multiple detailed paragraphs.';
  comp.updateResult(
    {
      content: [{ type: 'text', text: fullContent }],
      details: { id: 42, has_more: false },
      isError: false,
    },
    false,
  );

  assert.equal((comp as any).expanded, false);
  comp.render(80);

  const handledLeft = comp.handleMouse({
    type: 'click',
    button: 'left',
    x: 2,
    y: 1,
    width: 80,
    height: 10,
    screenX: 2,
    screenY: 1,
    shift: false,
    alt: false,
    ctrl: false,
  });
  assert.equal(handledLeft?.handled, true);
  assert.equal((comp as any).expanded, true);

  const expandedLines = comp.render(80);
  const expandedText = expandedLines.join('\n');
  assert.ok(expandedText.includes(fullContent));
  assert.deepEqual(plainLines(expandedLines), [` ${fullContent}`]);
  assertTransparentAndUnboxed(expandedLines);
  assertNoHints(expandedLines);

  const handledLeft2 = comp.handleMouse({
    type: 'click',
    button: 'left',
    x: 2,
    y: 1,
    width: 80,
    height: 10,
    screenX: 2,
    screenY: 1,
    shift: false,
    alt: false,
    ctrl: false,
  });
  assert.equal(handledLeft2?.handled, true);
  assert.equal((comp as any).expanded, false);

  const handledRight = comp.handleMouse({
    type: 'click',
    button: 'right',
    x: 2,
    y: 1,
    width: 80,
    height: 10,
    screenX: 2,
    screenY: 1,
    shift: false,
    alt: false,
    ctrl: false,
  });
  assert.equal(handledRight, undefined);
  assert.equal((comp as any).expanded, false);

  comp.setExpanded(true);
  assert.equal((comp as any).expanded, true);
  comp.setExpanded(false);
  assert.equal((comp as any).expanded, false);
});

test('M5-A07: Width safety across terminals (0, 1, 2, 10, 20, 80) with CJK/emoji/combining/OSC and theme invalidation', () => {
  const tools = createMemoryTools();
  const saveTool = tools.find((t) => t.name === 'memory_save')!;
  const mockUi = { requestRender: () => {} };

  const comp = new ToolExecutionComponent(
    'memory_save',
    'call-3',
    { title: 'Wide chars 🚀 測試文本 café\u0301 日本語' },
    {},
    saveTool as any,
    mockUi as any,
    process.cwd(),
  );

  comp.updateResult(
    {
      content: [{ type: 'text', text: 'Saved wide text 🌍 🚀 測試文本 café\u0301 日本語 한국어 \x1b]8;;https://example.com\x07link\x1b]8;;\x07' }],
      details: { id: 99, status: 'saved', indexing_status: 'indexed' },
      isError: false,
    },
    false,
  );

  // Width 0 emits zero cells
  assert.equal(saveTool.renderCall!({ title: 'x' }, {} as any, {} as any).render(0).length, 0);
  assert.equal(saveTool.renderResult!({ content: [{ type: 'text', text: 'x' }], details: {} }, { expanded: false, isPartial: false }, {} as any, {} as any).render(0).length, 0);
  assert.equal(saveTool.renderResult!({ content: [{ type: 'text', text: 'x' }], details: {} }, { expanded: true, isPartial: false }, {} as any, {} as any).render(0).length, 0);

  for (const expanded of [false, true]) {
    comp.setExpanded(expanded);
    for (const width of [1, 2, 10, 20, 80]) {
      const rendered = comp.render(width);
      assert.ok(Array.isArray(rendered));
      for (const line of rendered) {
        const visWidth = visibleWidth(line);
        assert.ok(visWidth <= width, `Rendered line exceeded width ${width}: got ${visWidth} for "${line}"`);
      }
    }
  }

  assert.doesNotThrow(() => {
    comp.invalidate();
    comp.render(80);
  });
});

test('All ten memory tools carry compactToolRenderingVersion: 1 and use one transparent cyan inline row and lossless expanded text', () => {
  const tools = createMemoryTools();
  assert.equal(tools.length, 10);
  for (const tool of tools) {
    assert.equal((tool as any).compactToolRenderingVersion, 1, tool.name);
    assert.equal(tool.renderShell, 'self', tool.name);
    const comp = new ToolExecutionComponent(tool.name, `call-${tool.name}`,
      { id: 42, query: 'prior decisions', title: 'Note', action: 'save' }, {}, tool as any,
      { requestRender() {} } as any, process.cwd());
    const text = 'First result block\nSecond result block';
    comp.updateResult({ content: [{ type: 'text', text }],
      details: { id: 42, count: 2, has_more: true, next_cursor: 'PRIVATE-CURSOR' }, isError: false }, false);
    const collapsed = comp.render(160);
    assert.equal(plainLines(collapsed).length, 1, tool.name);
    assert.match(plainLines(collapsed)[0], new RegExp(`🧠 ${tool.name}.*───`));
    assertTransparentAndUnboxed(collapsed);
    assertNoHints(collapsed);
    assert.match(collapsed.join(''), /\x1b\[38;2;135;206;250m/);
    comp.setExpanded(true);
    const expanded = comp.render(160);
    assert.deepEqual(plainLines(expanded), text.split('\n').map((l) => ` ${l}`), tool.name);
    assert.equal((tool as any).compactLeftMargin, 1, tool.name);
    assertTransparentAndUnboxed(expanded);
    assert.doesNotMatch(expanded.join('\n'), /PRIVATE-CURSOR|More data available|🧠|to expand/);
    comp.setExpanded(false);
    assert.equal(plainLines(comp.render(160)).length, 1, tool.name);
  }
});

test('Inline calls stay one line when arguments contain newlines or long Unicode text', () => {
  const tool = createMemoryTools().find((tool) => tool.name === 'memory_search')!;
  const comp = new ToolExecutionComponent(tool.name, 'long-call',
    { query: 'First line\nSecond line 🚀 測試文本 '.repeat(20) }, {}, tool as any,
    { requestRender() {} } as any, process.cwd());
  for (const width of [1, 2, 20, 80]) {
    const lines = comp.render(width);
    assert.ok(plainLines(lines).length <= 1);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `Width ${width}: ${visibleWidth(line)}`);
    assertTransparentAndUnboxed(lines);
  }
});

test('M5-A07: Error, empty, and partial states render deliberately without hints or exceptions', () => {
  const tools = createMemoryTools();
  const delTool = tools.find((t) => t.name === 'memory_delete')!;
  const mockUi = { requestRender: () => {} };

  const comp = new ToolExecutionComponent(
    'memory_delete',
    'call-4',
    { id: 999, owner_scope: 'project' },
    {},
    delTool as any,
    mockUi as any,
    process.cwd(),
  );

  // 1. Error state (collapsed)
  comp.updateResult(
    {
      content: [{ type: 'text', text: 'Error: target_not_found: Memory 999 not found' }],
      details: { error: 'target_not_found: Memory 999 not found' },
      isError: true,
    },
    false,
  );

  const errorCollapsed = comp.render(80);
  assert.match(errorCollapsed.join('\n'), /target_not_found/);
  assertNoHints(errorCollapsed);

  // 2. Error state (expanded)
  comp.setExpanded(true);
  const errorExpanded = comp.render(80);
  assert.deepEqual(plainLines(errorExpanded), [' Error: target_not_found: Memory 999 not found']);
  assert.doesNotMatch(errorExpanded.join('\n'), /Error details|🧠|to expand/);
  assertTransparentAndUnboxed(errorExpanded);

  // 3. Empty result
  comp.updateResult(
    {
      content: [],
      details: {},
      isError: false,
    },
    false,
  );
  const emptyExpanded = comp.render(80).join('\n');
  assert.equal(emptyExpanded.trim(), '', 'Expanded empty content must not invent text');

  // 4. Malformed inputs never throw
  assert.doesNotThrow(() => {
    delTool.renderCall!(null as any, undefined as any, undefined as any).render(80);
    delTool.renderResult!(null as any, undefined as any, undefined as any, undefined as any).render(80);
  });
});
