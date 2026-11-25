import { describe, expect, it } from 'vitest';
import {
  COMPACT_TOOL_RENDERING,
  MUTED,
  RED,
  RESET,
  extractSkillRegistryAction,
  renderSkillRegistryCall,
  renderSkillRegistryResult,
  stripAnsi,
  visibleWidth,
} from '../src/render.js';
import { registerSkillRegistryTools } from '../src/tools.js';

const FRAME = /[╭╮╰╯│]/;

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  keybinding: (action: string) => (action === 'app.tools.expand' ? 'ctrl+o' : undefined),
};

describe('skill-registry renderers', () => {
  it('registers the compact marker, self shell, and both safe slots on every tool', () => {
    expect(COMPACT_TOOL_RENDERING.compactToolRenderingVersion).toBe(1);
    const tools: any[] = [];
    registerSkillRegistryTools({ registerTool: (tool: any) => tools.push(tool) });

    expect(tools.map((tool) => tool.name)).toEqual(['skill_registry_generate', 'skill_registry_resolve']);
    for (const tool of tools) {
      expect(tool.renderShell, `${tool.name} renderShell`).toBe('self');
      expect(tool.compactToolRenderingVersion, `${tool.name} marker`).toBe(1);
      expect(typeof tool.renderCall).toBe('function');
      expect(typeof tool.renderResult).toBe('function');
    }
  });

  it('extracts correct action badges for generate and resolve tools', () => {
    expect(extractSkillRegistryAction('skill_registry_generate', {})).toBe('generate');
    expect(extractSkillRegistryAction('skill_registry_generate', { write: false })).toBe('write: false');
    expect(extractSkillRegistryAction('skill_registry_generate', { write: true })).toBe('generate');

    expect(extractSkillRegistryAction('skill_registry_resolve', {})).toBe('resolve');
    expect(extractSkillRegistryAction('skill_registry_resolve', { workflow_phase: 'apply' })).toBe('phase: apply');
    expect(extractSkillRegistryAction('skill_registry_resolve', { paths: ['src/a.ts', 'src/b.ts'] })).toBe('paths: src/a.ts, src/b.ts');
    expect(extractSkillRegistryAction('skill_registry_resolve', { intent: 'find auth' })).toBe('intent: find auth');
  });

  it('renders the pending call as one compact inline row', () => {
    const context = { state: {} };
    const lines = renderSkillRegistryCall('skill_registry_generate', { write: true }, mockTheme, context).render(80);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('skill_registry_generate');
    expect(lines[0]).toContain('generate');
    expect(lines[0]).toContain('running');
    expect(lines[0]).toContain('─');
    expect(lines[0]).not.toMatch(FRAME);
    expect(lines[0]).not.toMatch(/ctrl\+o|to expand/i);
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(80);
  });

  it('coordinates two-phase slot assembly via context.state without duplicate borders', () => {
    const context: any = { state: {} };

    const pendingLines = renderSkillRegistryCall('skill_registry_resolve', { intent: 'search' }, mockTheme, context).render(80);
    expect(pendingLines).toHaveLength(1);

    const resultComponent = renderSkillRegistryResult(
      'skill_registry_resolve',
      {
        details: {
          matches: [{ score: 90, priority: 1, name: 'skill-a', path: 'skills/a/SKILL.md', reasons: [{ detail: 'match' }] }],
          related_matches: [],
          registry_status: { cache: 'fresh', source: 'global', live_hash: 'abc123456789' },
          warnings: [],
          guidance: [],
        },
      },
      { expanded: false },
      mockTheme,
      context,
    );

    expect(context.state.hasResult).toBe(true);

    const resolvedCall = renderSkillRegistryCall('skill_registry_resolve', { intent: 'search' }, mockTheme, context).render(80);
    expect(resolvedCall).toEqual([]);

    const resultLines = resultComponent.render(80);
    expect(resultLines).toHaveLength(1);
    expect(resultLines[0]).toContain('skill_registry_resolve');
    expect(resultLines[0]).toContain('1 direct');
    expect(resultLines[0]).not.toMatch(FRAME);
  });

  it('renders skill_registry_generate collapsed and expanded views', () => {
    const result = {
      content: [{ type: 'text', text: 'Summary of skills generated' }],
      details: {
        registry: { skill_count: 5, warnings: ['Warning 1'] },
        write_result: { json_changed: true, markdown_changed: false },
      },
    };

    const collapsedLines = renderSkillRegistryResult('skill_registry_generate', result, { expanded: false }, mockTheme, { state: {} }).render(120);
    const collapsedText = collapsedLines.join('\n');
    expect(collapsedLines).toHaveLength(1);
    expect(collapsedText).toContain('5 skill(s), 1 warning(s)');
    expect(collapsedText).toContain('json updated, markdown unchanged');
    expect(collapsedText).not.toMatch(/ctrl\+o|to expand/i);
    expect(collapsedText).not.toMatch(FRAME);

    const expandedLines = renderSkillRegistryResult('skill_registry_generate', result, { expanded: true }, mockTheme, { state: {} }).render(120);
    const expandedText = expandedLines.join('\n');
    expect(expandedLines[0]).toBe(collapsedLines[0]);
    expect(expandedText).not.toMatch(/ctrl\+o|to collapse/i);
    expect(expandedText).toContain('Summary of skills generated');
  });

  it('renders skill_registry_resolve collapsed and expanded views with structured matches', () => {
    const result = {
      content: [{ type: 'text', text: 'Resolve summary' }],
      details: {
        query: { paths: ['src/app.ts'] },
        registry_status: { source: 'project', cache: 'valid', live_hash: '1234567890abcdef' },
        matches: [
          {
            score: 95,
            priority: 10,
            name: 'test-skill',
            path: 'skills/test/SKILL.md',
            reasons: [{ detail: 'Matched path' }],
            read_before_acting: 'Check docs first',
          },
        ],
        related_matches: [
          {
            name: 'related-skill',
            path: 'skills/rel/SKILL.md',
            related_from: ['test-skill'],
            relation_reasons: ['dependency'],
            read_before_acting: 'Review carefully',
          },
        ],
        guidance: ['Guidance rule 1'],
        warnings: ['Warn A'],
      },
    };

    const collapsedLines = renderSkillRegistryResult('skill_registry_resolve', result, { expanded: false }, mockTheme, { state: {} }).render(120);
    const collapsed = collapsedLines.join('\n');
    expect(collapsedLines).toHaveLength(1);
    expect(collapsed).toContain('1 direct, 1 related');
    expect(collapsed).toContain('cache valid');
    expect(collapsed).toContain('1 warn');
    expect(collapsed).not.toMatch(/ctrl\+o|to expand/i);

    const expanded = renderSkillRegistryResult('skill_registry_resolve', result, { expanded: true }, mockTheme, { state: {} }).render(120).join('\n');
    expect(expanded).toContain('test-skill');
    expect(expanded).toContain('skills/test/SKILL.md');
    expect(expanded).toContain('primary');
    expect(expanded).toContain('Matched path');
    expect(expanded).toContain('Check docs first');
    expect(expanded).toContain('related-skill');
    expect(expanded).toContain('Guidance rule 1');
    expect(expanded).toContain('Warn A');
    expect(expanded).toContain('Resolve summary');
    expect(expanded).not.toMatch(/ctrl\+o|to collapse/i);
  });

  it('marks failures in one red inline row and keeps returned text on expansion', () => {
    const context: any = { state: {} };
    const errResult = {
      isError: true,
      details: { error: { message: 'Failed to parse skill YAML' } },
      content: [{ type: 'text', text: 'Error details' }],
    };

    const lines = renderSkillRegistryResult('skill_registry_generate', errResult, { expanded: false }, mockTheme, context).render(80);
    expect(context.state.isError).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Failed to parse skill YAML');
    expect(lines[0]).not.toMatch(FRAME);

    const redTheme = { ...mockTheme, fg: (name: string, text: string) => (name === 'error' ? `${RED}${text}\x1b[0m` : text) };
    expect(renderSkillRegistryResult('skill_registry_generate', errResult, { expanded: false }, redTheme, { state: {} }).render(80)[0]).toContain(RED);

    const expanded = renderSkillRegistryResult('skill_registry_generate', errResult, { expanded: true }, mockTheme, { state: {} }).render(80);
    expect(expanded.every((l) => l.startsWith(' '))).toBe(true);
    expect(expanded.slice(1)).toContain(` ${MUTED}Error details${RESET}`);
  });

  it('wraps narrow widths without clipping and preserves width 0/1/2 wide-grapheme rules', () => {
    const callLines = renderSkillRegistryCall('skill_registry_generate', { write: true }, mockTheme).render(15);
    expect(callLines.length).toBeGreaterThan(1);
    for (const line of callLines) {
      expect(line.startsWith(' ')).toBe(true);
      expect(visibleWidth(line)).toBeLessThanOrEqual(15);
      expect(line).not.toMatch(FRAME);
    }
    expect(callLines.map((l) => stripAnsi(l).slice(1)).join('')).toContain('generate');

    for (const width of [1, 2, 10, 23]) {
      const resultLines = renderSkillRegistryResult('skill_registry_resolve', {
        details: {
          matches: [{ score: 90, priority: 1, name: 'skill-a', path: 'skills/a/SKILL.md' }],
          registry_status: { cache: 'fresh', source: 'global', live_hash: 'abc123456789' },
        },
        content: [{ type: 'text', text: 'resolve body line\nsecond line' }],
      }, { expanded: true }, mockTheme, { state: {} }).render(width);
      expect(resultLines.length).toBeGreaterThan(0);
      for (const line of resultLines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }

    expect(renderSkillRegistryResult('skill_registry_generate', { details: {} }, { expanded: false }, mockTheme, { state: {} }).render(0)).toEqual([]);
    expect(renderSkillRegistryResult('skill_registry_generate', { details: {} }, { expanded: false }, mockTheme, { state: {} }).render(1)).toEqual([' ']);

    const wideRes = {
      content: [{ type: 'text', text: 'A漢B\nA🚀B' }],
      details: { registry: { skill_count: 1, warnings: [] } },
    };
    const w2 = renderSkillRegistryResult('skill_registry_generate', wideRes, { expanded: true }, mockTheme, { state: {} }).render(2);
    for (const line of w2) expect(visibleWidth(line)).toBeLessThanOrEqual(2);
    const plainW2 = w2.map(stripAnsi);
    expect(plainW2).toContain(' A');
    expect(plainW2).toContain('漢');
    expect(plainW2).toContain(' B');
    expect(plainW2).toContain('🚀');
  });

  it('applies theme.fg("muted", ...) with #7aa7b8 fallback while preserving existing ANSI in expanded bodies', () => {
    const customTheme = {
      ...mockTheme,
      fg: (token: string, text: string) => (token === 'muted' ? `\x1b[38;2;31;32;33m${text}\x1b[39m` : text),
    };
    const res = {
      content: [{ type: 'text', text: 'plain registry body\n\x1b[32msyntax\x1b[0m\n\x1b[36mhttps://docs.test\x1b[0m' }],
      details: {
        query: { paths: ['src/app.ts'] },
        registry_status: { source: 'project', cache: 'valid', live_hash: '1234567890abcdef' },
        matches: [],
        related_matches: [],
        guidance: [],
        warnings: [],
      },
    };
    const themed = renderSkillRegistryResult('skill_registry_resolve', res, { expanded: true }, customTheme, { state: {} }).render(100);
    expect(themed).toContain(' \x1b[38;2;31;32;33mpaths: src/app.ts\x1b[39m');
    expect(themed).toContain(' \x1b[38;2;31;32;33mplain registry body\x1b[39m');
    expect(themed).toContain(' \x1b[32msyntax\x1b[0m');
    expect(themed).toContain(' \x1b[36mhttps://docs.test\x1b[0m');

    const fallback = renderSkillRegistryResult('skill_registry_resolve', res, { expanded: true }, mockTheme, { state: {} }).render(100);
    expect(fallback).toContain(` ${MUTED}plain registry body${RESET}`);
    expect(fallback).toContain(' \x1b[32msyntax\x1b[0m');
  });
});
