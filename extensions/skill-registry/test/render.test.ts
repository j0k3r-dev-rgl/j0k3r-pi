import { describe, expect, it, vi } from 'vitest';
import skillRegistryExtension from '../index.js';
import {
  CYAN,
  DIM,
  LIME,
  RED,
  RESET,
  extractSkillRegistryAction,
  renderSkillRegistryCall,
  renderSkillRegistryResult,
  visibleWidth,
} from '../src/render.js';

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  keybinding: (action: string) => (action === 'app.tools.expand' ? 'ctrl+o' : undefined),
};

describe('skill-registry renderers', () => {
  it('registers tools with renderShell: "self", renderCall, and renderResult', () => {
    const tools: any[] = [];
    const pi = {
      registerTool: vi.fn((tool: any) => tools.push(tool)),
      registerCommand: vi.fn(),
    };

    skillRegistryExtension(pi);

    const generateTool = tools.find((t) => t.name === 'skill_registry_generate');
    const resolveTool = tools.find((t) => t.name === 'skill_registry_resolve');

    expect(generateTool).toBeDefined();
    expect(generateTool.renderShell).toBe('self');
    expect(typeof generateTool.renderCall).toBe('function');
    expect(typeof generateTool.renderResult).toBe('function');

    expect(resolveTool).toBeDefined();
    expect(resolveTool.renderShell).toBe('self');
    expect(typeof resolveTool.renderCall).toBe('function');
    expect(typeof resolveTool.renderResult).toBe('function');
  });

  it('extracts correct action badges for generate and resolve tools', () => {
    expect(extractSkillRegistryAction('skill_registry_generate', {})).toBe('generate');
    expect(extractSkillRegistryAction('skill_registry_generate', { write: false })).toBe('write: false');
    expect(extractSkillRegistryAction('skill_registry_generate', { write: true })).toBe('generate');

    expect(extractSkillRegistryAction('skill_registry_resolve', {})).toBe('resolve');
    expect(extractSkillRegistryAction('skill_registry_resolve', { sdd_phase: 'apply' })).toBe('phase: apply');
    expect(extractSkillRegistryAction('skill_registry_resolve', { paths: ['src/a.ts', 'src/b.ts'] })).toBe('paths: src/a.ts, src/b.ts');
    expect(extractSkillRegistryAction('skill_registry_resolve', { intent: 'find auth' })).toBe('intent: find auth');
  });

  it('renders pending call card with rounded corners and consistent line widths', () => {
    const context = { state: {} };
    const callComponent = renderSkillRegistryCall('skill_registry_generate', { write: true }, mockTheme, context);
    const lines = callComponent.render(80);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('╭');
    expect(lines[0]).toContain('╮');
    expect(lines[0]).toContain('skill_registry_generate [generate]');
    expect(lines[1]).toContain('│');
    expect(lines[1]).toContain('Pending: Generating skill registry...');
    expect(lines[2]).toContain('╰');
    expect(lines[2]).toContain('╯');

    for (const line of lines) {
      expect(visibleWidth(line)).toBe(80);
      expect(line).not.toMatch(/\x1b\[4[0-7]m/);
    }
  });

  it('coordinates two-phase slot assembly via context.state without duplicate borders', () => {
    const context: any = { state: {} };

    // Phase 1: Call is pending
    const pendingLines = renderSkillRegistryCall('skill_registry_resolve', { intent: 'search' }, mockTheme, context).render(80);
    expect(pendingLines).toHaveLength(3);
    expect(pendingLines[0]).toContain('╭');
    expect(pendingLines[2]).toContain('╰');

    // Result arrives and sets state
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
    expect(context.state.borderColor).toBe(LIME);

    // Phase 2: Call re-renders as top border only
    const resolvedCall = renderSkillRegistryCall('skill_registry_resolve', { intent: 'search' }, mockTheme, context).render(80);
    expect(resolvedCall).toHaveLength(1);
    expect(resolvedCall[0]).toContain('╭');
    expect(resolvedCall[0]).toContain('╮');
    expect(resolvedCall[0]).toContain(LIME);

    // Slot 2: Result renders framed content + bottom border
    const resultLines = resultComponent.render(80);
    expect(resultLines.length).toBeGreaterThanOrEqual(2);
    expect(resultLines[resultLines.length - 1]).toContain('╰');
    expect(resultLines[resultLines.length - 1]).toContain('╯');

    const assembled = [...resolvedCall, ...resultLines];
    const tops = assembled.filter((l) => l.includes('╭'));
    const bottoms = assembled.filter((l) => l.includes('╰'));
    expect(tops).toHaveLength(1);
    expect(bottoms).toHaveLength(1);

    for (const line of assembled) {
      expect(visibleWidth(line)).toBe(80);
    }
  });

  it('renders skill_registry_generate collapsed and expanded views', () => {
    const result = {
      content: [{ type: 'text', text: 'Summary of skills generated' }],
      details: {
        registry: { skill_count: 5, warnings: ['Warning 1'] },
        write_result: { json_changed: true, markdown_changed: false },
      },
    };

    // Collapsed
    const collapsedLines = renderSkillRegistryResult('skill_registry_generate', result, { expanded: false }, mockTheme).render(80);
    const collapsedText = collapsedLines.join('\n');
    expect(collapsedText).toContain('✓ 5 skill(s), 1 warning(s) · json updated, markdown unchanged');
    expect(collapsedText).toContain('ctrl+o expand');

    // Expanded
    const expandedLines = renderSkillRegistryResult('skill_registry_generate', result, { expanded: true }, mockTheme).render(80);
    const expandedText = expandedLines.join('\n');
    expect(expandedText).toContain('✓ 5 skill(s), 1 warning(s) · json updated, markdown unchanged');
    expect(expandedText).toContain('ctrl+o collapse');
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

    // Collapsed
    const collapsed = renderSkillRegistryResult('skill_registry_resolve', result, { expanded: false }, mockTheme).render(80).join('\n');
    expect(collapsed).toContain('✓ skill registry: 1 direct, 1 related, cache valid, 1 warn');
    expect(collapsed).toContain('ctrl+o expand');

    // Expanded
    const expanded = renderSkillRegistryResult('skill_registry_resolve', result, { expanded: true }, mockTheme).render(80).join('\n');
    expect(expanded).toContain('test-skill');
    expect(expanded).toContain('skills/test/SKILL.md');
    expect(expanded).toContain('primary');
    expect(expanded).toContain('Matched path');
    expect(expanded).toContain('Check docs first');
    expect(expanded).toContain('related-skill');
    expect(expanded).toContain('Guidance rule 1');
    expect(expanded).toContain('Warn A');
    expect(expanded).toContain('ctrl+o collapse');
  });

  it('renders electric red border and error message on failure', () => {
    const context: any = { state: {} };
    const errResult = {
      isError: true,
      details: { error: { message: 'Failed to parse skill YAML' } },
      content: [{ type: 'text', text: 'Error details' }],
    };

    const lines = renderSkillRegistryResult('skill_registry_generate', errResult, { expanded: false }, mockTheme, context).render(80);
    expect(context.state.borderColor).toBe(RED);
    expect(lines[lines.length - 1]).toContain(RED);
    expect(lines.join('\n')).toContain('Error: Failed to parse skill YAML');
  });

  it('safeguards against narrow width (< 24 columns) without crashing', () => {
    const callLines = renderSkillRegistryCall('skill_registry_generate', { write: true }, mockTheme).render(15);
    expect(callLines).toHaveLength(1);
    expect(callLines[0]).not.toContain('╭');

    const resultLines = renderSkillRegistryResult('skill_registry_generate', {
      details: { registry: { skill_count: 2, warnings: [] }, write_result: null },
    }, { expanded: false }, mockTheme).render(15);
    expect(resultLines.length).toBeGreaterThan(0);
    expect(resultLines[resultLines.length - 1]).not.toContain('╰');
  });
});
