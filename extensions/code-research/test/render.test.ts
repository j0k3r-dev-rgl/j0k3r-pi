import { describe, expect, it } from 'vitest';
import {
  boxLine,
  cardBottomBorder,
  cardTopBorder,
  CYAN,
  fit,
  frameContent,
  LIME,
  pad,
  RED,
  renderCodeResearchToolCall,
  renderCodeResearchToolResult,
  stripAnsi,
  toolActionBadge,
  visibleWidth,
} from '../src/render.js';
import { registerCodeFindTool } from '../src/tools/code-find.js';
import { registerCodeCallHierarchyTool } from '../src/tools/code-call-hierarchy.js';
import { registerWorkspaceGraphStatusTool } from '../src/tools/workspace-graph.js';
import { registerCodeChangeSurfaceTool } from '../src/tools/code-change-surface.js';
import { registerFindSymbolTool } from '../src/tools/find-symbol.js';
import { registerFindReferencesTool } from '../src/tools/find-references.js';
import { registerFunctionCallTreeTool } from '../src/tools/function-call-tree.js';
import { registerReverseFunctionCallTreeTool } from '../src/tools/reverse-function-call-tree.js';

const theme = {
  fg: (_name: string, text: string) => text,
  bold: (text: string) => text,
  keybinding: (action: string) => (action === 'app.tools.expand' ? 'ctrl+o' : undefined),
};

describe('code-research card framing helpers', () => {
  it('strips ANSI and measures visible width accurately', () => {
    const colored = `${CYAN}hello${LIME} world${RED}!`;
    expect(stripAnsi(colored)).toBe('hello world!');
    expect(visibleWidth(colored)).toBe(12);
  });

  it('fits and pads text to target width', () => {
    const text = 'research';
    expect(fit(text, 5)).toContain('resea');
    expect(pad(text, 10)).toBe('research  ');
  });

  it('builds top and bottom borders with rounded corners and horizontal dashes', () => {
    const top = cardTopBorder('code_find', 'query=Service', 40, CYAN);
    expect(top).toContain('╭');
    expect(top).toContain('╮');
    expect(top).toContain('code_find [query=Service]');
    expect(visibleWidth(top)).toBe(42); // 1 + 40 + 1 = 42

    const bottom = cardBottomBorder(40, CYAN);
    expect(bottom).toContain('╰');
    expect(bottom).toContain('╯');
    expect(visibleWidth(bottom)).toBe(42);
  });

  it('frames content lines with side borders', () => {
    const lines = ['First line', 'Second line'];
    const framed = frameContent(lines, 40, CYAN);
    expect(framed).toHaveLength(2);
    for (const line of framed) {
      expect(line).toContain('│');
      expect(visibleWidth(line)).toBe(42);
    }
  });
});

describe('code-research toolActionBadge', () => {
  it('extracts badges for modern and legacy tools', () => {
    expect(toolActionBadge('workspace_graph_status', {})).toBe('status');
    expect(toolActionBadge('code_find', { query: 'User', relation: 'declaration' })).toBe('User');
    expect(toolActionBadge('code_find', { query: 'User', relation: 'references' })).toBe('User relation=references');
    expect(toolActionBadge('code_call_hierarchy', { symbol: 'handleRequest', direction: 'incoming' })).toBe('handleRequest incoming');
    expect(toolActionBadge('code_change_surface', { query: 'authenticate' })).toBe('authenticate');
    expect(toolActionBadge('find_symbol', { symbol: 'MyClass' })).toBe('MyClass');
  });
});

describe('code-research two-phase slot assembly', () => {
  it('renders call with full hollow card while execution is pending', () => {
    const context: any = { state: {} };
    const callComponent = renderCodeResearchToolCall('code_find', { query: 'Service' }, theme, context);
    const lines = callComponent.render(60);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('╭');
    expect(lines[0]).toContain('code_find [Service]');
    expect(lines[1]).toContain('│');
    expect(lines[1]).toContain('Pending: Service');
    expect(lines[2]).toContain('╰');
    expect(lines[2]).toContain('╯');
  });

  it('renders only top border when context.state.hasResult is true', () => {
    const context: any = { state: { hasResult: true, borderColor: LIME } };
    const callComponent = renderCodeResearchToolCall('code_find', { query: 'Service' }, theme, context);
    const lines = callComponent.render(60);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('╭');
    expect(lines[0]).toContain('code_find [Service]');
    expect(lines[0]).toContain(LIME);
  });

  it('renders result with electric lime on success, frames body lines, and sets context state', () => {
    const context: any = { state: {} };
    const result = {
      content: [{ type: 'text', text: 'Found 1 match' }],
      details: { found: 1, results: [{ symbol: 'Service', file: 'src/Service.ts', start_line: 1, start_column: 1 }] },
    };

    const resultComponent = renderCodeResearchToolResult('code_find', result, { expanded: false }, theme, context);
    expect(context.state.hasResult).toBe(true);
    expect(context.state.borderColor).toBe(LIME);

    const lines = resultComponent.render(60);
    expect(lines.length).toBeGreaterThan(1);
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toContain('╰');
    expect(lastLine).toContain('╯');
    expect(lines.some((l) => l.includes('ctrl+o expand'))).toBe(true);
  });

  it('renders result with electric red on error', () => {
    const context: any = { state: {} };
    const result = {
      isError: true,
      content: [{ type: 'text', text: 'Compilation failed' }],
      details: { error: { message: 'Failed to compile AST' } },
    };

    const resultComponent = renderCodeResearchToolResult('code_find', result, { expanded: false }, theme, context);
    expect(context.state.borderColor).toBe(RED);

    const lines = resultComponent.render(60);
    expect(lines[0]).toContain(RED);
    expect(lines.some((l) => l.includes('Error: Failed to compile AST'))).toBe(true);
  });

  it('renders expanded mode with collapse hint and full result text', () => {
    const context: any = { state: {} };
    const result = {
      content: [{ type: 'text', text: 'LINE_ONE\nLINE_TWO\nLINE_THREE' }],
      details: { found: 1 },
    };

    const resultComponent = renderCodeResearchToolResult('code_find', result, { expanded: true }, theme, context);
    const lines = resultComponent.render(60);

    expect(lines.some((l) => l.includes('LINE_ONE'))).toBe(true);
    expect(lines.some((l) => l.includes('LINE_TWO'))).toBe(true);
    expect(lines.some((l) => l.includes('ctrl+o collapse'))).toBe(true);
  });

  it('handles narrow terminal widths gracefully', () => {
    const context: any = { state: {} };
    const callComponent = renderCodeResearchToolCall('code_find', { query: 'Service' }, theme, context);
    const callLines = callComponent.render(15);
    expect(callLines).toHaveLength(1);
    expect(visibleWidth(callLines[0])).toBeLessThanOrEqual(15);

    const result = { content: [{ type: 'text', text: 'Found 1 match' }] };
    const resultComponent = renderCodeResearchToolResult('code_find', result, { expanded: false }, theme, context);
    const resultLines = resultComponent.render(15);
    for (const line of resultLines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(15);
    }
  });
});

describe('code-research tool registrations declare renderShell self', () => {
  function collectTools() {
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => tools.push(t) };
    registerCodeFindTool(pi);
    registerCodeCallHierarchyTool(pi);
    registerWorkspaceGraphStatusTool(pi);
    registerCodeChangeSurfaceTool(pi);
    registerFindSymbolTool(pi);
    registerFindReferencesTool(pi);
    registerFunctionCallTreeTool(pi);
    registerReverseFunctionCallTreeTool(pi);
    return tools;
  }

  it('registers renderShell self, renderCall, and renderResult on all 8 tools', () => {
    const tools = collectTools();
    expect(tools).toHaveLength(8);
    for (const tool of tools) {
      expect(tool.renderShell, `${tool.name} renderShell`).toBe('self');
      expect(tool.renderCall, `${tool.name} renderCall`).toBeTypeOf('function');
      expect(tool.renderResult, `${tool.name} renderResult`).toBeTypeOf('function');
    }
  });
});
