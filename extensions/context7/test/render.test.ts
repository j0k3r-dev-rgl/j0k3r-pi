import { describe, expect, it, vi } from 'vitest';
import { visibleWidth } from '@earendil-works/pi-tui';
import { renderContext7ToolCall, renderContext7ToolResult } from '../src/render/index.js';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  keyHint: (_binding: string, description: string) => `ctrl+o ${description}`,
}));

const theme = {
  fg(_name: string, text: string) {
    return text;
  },
  bold(text: string) {
    return text;
  },
} as any;

function rendered(component: { invalidate(): void; render(width: number): string[] }, width = 160): string {
  component.invalidate();
  return component.render(width).map((line) => line.trimEnd()).join('\n');
}

function result(content: string, details: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: content }], details };
}

describe('Context7 native tool rendering', () => {
  it('renders tool calls as compact native components', () => {
    const query = `focused-${'query-'.repeat(80)}`;
    const output = rendered(renderContext7ToolCall('context7_get_context', {
      libraryId: '/facebook/react',
      query,
      type: 'json',
    }, theme));

    expect(output).toContain('context7_get_context');
    expect(output).toContain('/facebook/react');
    expect(output).toContain('focused-');
    expect(output).not.toContain(query);
  });

  it('keeps documentation compact while collapsed and shows all current content when expanded', () => {
    const fullContent = 'FULL DOCUMENTATION\nline two\nline three';
    const toolResult = result(fullContent, {
      request: { libraryId: '/facebook/react', query: 'hooks', type: 'json' },
      documentation: {
        libraryId: '/facebook/react',
        query: 'hooks',
        type: 'json',
        snippets: [{ title: 'Hooks', content: 'Use hooks.' }],
        sources: [{ title: 'Hooks', sourceUrl: 'https://react.dev' }],
      },
      truncation: { truncated: false },
      cache: { enabled: true, hit: true },
      warnings: [],
    });

    const collapsed = rendered(renderContext7ToolResult('context7_get_context', toolResult, { expanded: false }, theme));
    const expanded = rendered(renderContext7ToolResult('context7_get_context', toolResult, { expanded: true }, theme));

    expect(collapsed).toContain('/facebook/react');
    expect(collapsed).toContain('hooks');
    expect(collapsed).toContain('1 snippet');
    expect(collapsed).toContain('cache hit');
    expect(collapsed).toMatch(/expand/i);
    expect(collapsed).not.toContain('FULL DOCUMENTATION');

    expect(expanded).toContain('/facebook/react');
    expect(expanded).toMatch(/collapse/i);
    expect(expanded).toContain(fullContent);
  });

  it.each([
    {
      toolName: 'context7_status',
      details: {
        sdkAvailable: true,
        apiKeyPresent: true,
        cache: { enabled: false },
        warnings: [],
      },
      expected: ['ready', 'API key configured', 'cache off'],
    },
    {
      toolName: 'context7_search_library',
      details: {
        request: { libraryName: 'react', query: 'hooks', limit: 2 },
        results: [{ id: '/facebook/react', name: 'React' }, { id: '/preactjs/preact', name: 'Preact' }],
        count: 2,
        cache: { enabled: true, hit: false },
        warnings: ['fallback config'],
      },
      expected: ['react', 'hooks', '2 candidates', '/facebook/react', 'cache miss', '1 warning'],
    },
    {
      toolName: 'context7_resolve_and_get_context',
      details: {
        request: { libraryName: 'router', query: 'routing docs' },
        status: 'ambiguous',
        candidates: [{ candidate: { id: '/alpha/router' } }, { candidate: { id: '/beta/router' } }],
        cache: { search: { enabled: true, hit: true } },
        warnings: [],
      },
      expected: ['router', 'routing docs', 'ambiguous', '2 candidates', 'cache hit'],
    },
  ])('summarizes $toolName without dumping result content', ({ toolName, details, expected }) => {
    const output = rendered(renderContext7ToolResult(toolName, result('SHOULD STAY HIDDEN', details), { expanded: false }, theme));

    for (const fragment of expected) expect(output).toContain(fragment);
    expect(output).not.toContain('SHOULD STAY HIDDEN');
    expect(output).toMatch(/expand/i);
  });

  it('renders partial execution distinctly and keeps every line within the supplied width', () => {
    const component = renderContext7ToolResult('context7_search_library', result('ignored', {}), {
      expanded: false,
      isPartial: true,
    }, theme);
    const lines = component.render(40);

    expect(lines.join('\n')).toMatch(/searching|running/i);
    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
  });
});
