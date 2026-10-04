import { describe, expect, it } from 'vitest';
import { composeLeanSystemPrompt, extractActiveToolGuidelines } from '../src/runner/tool-guidelines.js';

describe('MINI-004: Tool-Guideline Composition for Lean Subagents', () => {
  it('extracts guidelines only from active tools matching allowlist through the Pi API', () => {
    const ctx = {
      getAllTools: () => [
        {
          name: 'tool_a',
          promptGuidelines: ['Guideline A1', 'Guideline A2'],
        },
        {
          name: 'tool_b',
          promptGuidelines: 'Guideline B1',
        },
        {
          name: 'tool_c_inactive',
          promptGuidelines: ['Guideline C1'],
        },
      ],
    };

    const allowed = ['tool_a', 'tool_other_not_in_ctx'];
    const extracted = extractActiveToolGuidelines(allowed, ctx);

    expect(extracted).toEqual(['Guideline A1', 'Guideline A2']);
  });

  it('normalizes, trims, and deduplicates guidelines while preserving order', () => {
    const ctx = {
      pi: {
        getAllTools: () => [
          {
            name: 'tool_1',
            promptGuidelines: ['  Shared guideline  ', 'Unique 1'],
          },
          {
            name: 'tool_2',
            promptGuidelines: ['Shared guideline', '', '   ', 'Unique 2'],
          },
        ],
      },
    };

    const allowed = ['tool_1', 'tool_2'];
    const extracted = extractActiveToolGuidelines(allowed, ctx);

    expect(extracted).toEqual(['Shared guideline', 'Unique 1', 'Unique 2']);
  });

  it('returns empty array when tools have no guidelines or allowlist is empty', () => {
    const ctx = {
      getAllTools: () => [
        { name: 'tool_x' },
        { name: 'tool_y', promptGuidelines: [] },
      ],
    };

    expect(extractActiveToolGuidelines(['tool_x', 'tool_y'], ctx)).toEqual([]);
    expect(extractActiveToolGuidelines([], ctx)).toEqual([]);
    expect(extractActiveToolGuidelines(['tool_x'], null)).toEqual([]);
  });

  it('composes lean system prompt with ## Active Tool Guidelines when present', () => {
    const ctx = {
      getAllTools: () => [
        {
          name: 'custom_calc',
          promptGuidelines: ['Always verify precision', 'Use scientific mode for powers'],
        },
      ],
    };

    const baseInstructions = '# Math Subagent\n\nYou calculate values.';
    const composed = composeLeanSystemPrompt(baseInstructions, ['custom_calc'], ctx);

    expect(composed).toBe(
      '# Math Subagent\n\nYou calculate values.\n\n## Active Tool Guidelines\n- Always verify precision\n- Use scientific mode for powers'
    );
  });

  it('leaves system prompt unchanged when no active allowlisted tools have guidelines', () => {
    const ctx = {
      getAllTools: () => [
        { name: 'read' },
        { name: 'write' },
      ],
    };

    const baseInstructions = '# Agent\n\nInstructions here.';
    const composed = composeLeanSystemPrompt(baseInstructions, ['read', 'write'], ctx);

    expect(composed).toBe(baseInstructions);
  });

  it('does not leak guidelines from registered tools outside the effective allowlist', () => {
    const ctx = {
      pi: {
        getAllTools: () => [
          { name: 'read' },
          { name: 'codegraph_explore', promptGuidelines: ['Inspect the code graph first'] },
        ],
      },
    };

    const composed = composeLeanSystemPrompt('Base instructions', ['read'], ctx);

    expect(composed).toBe('Base instructions');
    expect(composed).not.toContain('codegraph');
    expect(composed).not.toContain('Inspect the code graph first');
  });

  it('is completely generic with zero references to specific extensions', () => {
    const ctx = {
      getAllTools: () => [
        {
          name: 'any_arbitrary_tool_xyz',
          promptGuidelines: ['Arbitrary guideline 123'],
        },
      ],
    };

    const composed = composeLeanSystemPrompt('Base instructions', ['any_arbitrary_tool_xyz'], ctx);
    expect(composed).toContain('## Active Tool Guidelines');
    expect(composed).toContain('- Arbitrary guideline 123');
  });
});
