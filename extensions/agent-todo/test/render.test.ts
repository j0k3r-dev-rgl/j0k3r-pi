import { describe, expect, it } from 'vitest';

import {
  CYAN,
  LIME,
  RED,
  renderAgentTodoCall,
  renderAgentTodoResult,
  stripAnsi,
  visibleWidth,
} from '../src/render.js';

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  keybinding: (action: string) => (action === 'app.tools.expand' ? 'ctrl+o' : undefined),
};

const activeTodoFixture = {
  id: 'todo-1',
  title: 'Ship feature',
  status: 'active' as const,
  steps: [
    { id: 'step-1', text: 'Write tests', status: 'completed' as const },
    { id: 'step-2', text: 'Implement', status: 'open' as const },
    { id: 'step-3', text: 'Validate', status: 'open' as const },
  ],
  created_at: '2026-06-10T00:00:00.000Z',
  updated_at: '2026-06-10T00:00:00.000Z',
};

function assertUnboxedAndNoHints(lines: string[]): void {
  const joined = lines.join('\n');
  expect(joined).not.toMatch(/[╭╮╰╯│]/);
  expect(joined).not.toMatch(/\x1b\[(?:4[0-7]|48;|10[0-7]|7m)/);
  expect(stripAnsi(joined)).not.toMatch(/\b(to expand|to collapse|ctrl\+o|app\.tools\.expand)\b/i);
}

describe('agent todo compact tool renderers', () => {
  it('renders single inline pending call row with separator and no card borders or hints', () => {
    const context = { state: {} };
    const callLines = renderAgentTodoCall({ action: 'create', title: 'Ship feature' }, theme, context).render(80);

    expect(callLines).toHaveLength(1);
    expect(stripAnsi(callLines[0])).toContain('agent_todo');
    expect(stripAnsi(callLines[0])).toContain('create');
    expect(stripAnsi(callLines[0])).toContain('───');
    expect(stripAnsi(callLines[0])).toContain('Ship feature');
    expect(visibleWidth(callLines[0])).toBeLessThanOrEqual(80);
    assertUnboxedAndNoHints(callLines);
  });

  it('coordinates call and result into a single combined inline row via context.state', () => {
    const context: any = { state: {}, args: { action: 'create', title: 'Ship feature' } };
    const callComp = renderAgentTodoCall({ action: 'create', title: 'Ship feature' }, theme, context);
    expect(callComp.render(80)).toHaveLength(1);

    const resultComp = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'create',
          ok: true,
          state: { active_todo: activeTodoFixture, current_todo: null },
        },
      },
      content: [{ type: 'text', text: 'Created agent todo: Ship feature.' }],
    }, { expanded: false, isPartial: false }, theme, context);

    expect(context.state.hasResult).toBe(true);
    expect(callComp.render(80)).toEqual([]);

    const resultLines = resultComp.render(80);
    expect(resultLines).toHaveLength(1);
    const plain = stripAnsi(resultLines[0]);
    expect(plain).toContain('agent_todo [create]');
    expect(plain).toContain('───');
    expect(plain).toContain('Ship feature · 1/3 complete · 2 open');
    expect(plain).not.toContain('[x] 1. Write tests');
    expect(plain).not.toContain('"version"');
    assertUnboxedAndNoHints(resultLines);
  });

  it('applies palette colors for active (CYAN), completed (LIME), and error (RED)', () => {
    const activeCtx: any = { state: {} };
    const activeLines = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'create',
          ok: true,
          state: { active_todo: activeTodoFixture, current_todo: null },
        },
      },
      content: [{ type: 'text', text: 'ok' }],
    }, { expanded: false }, theme, activeCtx).render(80);
    expect(activeCtx.state.borderColor).toBe(CYAN);
    expect(activeLines.join('\n')).toContain(CYAN);

    const completeCtx: any = { state: {} };
    const completeLines = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'complete_all',
          ok: true,
          state: {
            active_todo: null,
            current_todo: {
              id: 'todo-1',
              title: 'Done task',
              status: 'completed',
              steps: [{ id: '1', text: 'Done', status: 'completed' }],
              created_at: '2026-06-10T00:00:00.000Z',
              updated_at: '2026-06-10T00:00:00.000Z',
            },
          },
        },
      },
      content: [{ type: 'text', text: 'ok' }],
    }, { expanded: false }, theme, completeCtx).render(80);
    expect(completeCtx.state.borderColor).toBe(LIME);
    expect(completeLines.join('\n')).toContain(LIME);
    expect(stripAnsi(completeLines.join('\n'))).toContain('completed · Done task · 1/1 complete');

    const errorCtx: any = { state: {} };
    const errorLines = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'create',
          ok: false,
          error: { code: 'active_todo_exists', message: 'Title already exists' },
          state: { active_todo: null, current_todo: null },
        },
      },
      content: [{ type: 'text', text: 'failed' }],
    }, { expanded: false }, theme, errorCtx).render(80);
    expect(errorCtx.state.borderColor).toBe(RED);
    expect(errorLines.join('\n')).toContain(RED);
    expect(stripAnsi(errorLines.join('\n'))).toContain('Error: Title already exists');
  });

  it('formats action badges with step_id and range targets', () => {
    const call1 = stripAnsi(renderAgentTodoCall({ action: 'complete_step', step_id: 'step-2' }, theme).render(80)[0]);
    expect(call1).toContain('agent_todo [complete_step step-2]');

    const call2 = stripAnsi(renderAgentTodoCall({ action: 'complete_range', range: '2-4' }, theme).render(80)[0]);
    expect(call2).toContain('agent_todo [complete_range 2-4]');

    const call3 = stripAnsi(renderAgentTodoCall({ action: 'show' }, theme).render(80)[0]);
    expect(call3).toContain('agent_todo [show]');
  });

  it('renders expanded checklist and all returned content blocks in order without truncation', () => {
    const lines = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'show',
          ok: true,
          state: { active_todo: activeTodoFixture, current_todo: null },
        },
      },
      content: [
        { type: 'text', text: 'First returned block' },
        { type: 'text', text: 'Second block with literal ╭box╮ and to expand' },
      ],
    }, { expanded: true }, theme, { args: { action: 'show' }, state: {} }).render(80);

    const plain = stripAnsi(lines.join('\n'));
    expect(plain).toContain('Ship feature [active]');
    expect(plain).toContain('✓ Write tests');
    expect(plain).toContain('○ Implement');
    expect(plain).toContain('○ Validate');
    expect(plain).toContain('First returned block');
    expect(plain).toContain('Second block with literal ╭box╮ and to expand');
    expect(plain).not.toMatch(/ctrl\+o/i);
  });

  it('handles partial, cleared, and empty states cleanly in one inline row', () => {
    const partial = renderAgentTodoResult({
      details: undefined as any,
      content: [{ type: 'text', text: 'working' }],
    }, { expanded: false, isPartial: true }, theme, { args: { action: 'show' }, state: {} }).render(80);
    expect(partial).toHaveLength(1);
    expect(stripAnsi(partial[0])).toContain('running…');
    assertUnboxedAndNoHints(partial);

    const cleared = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'clear',
          ok: true,
          state: {
            active_todo: null,
            current_todo: {
              id: 'todo-1',
              title: 'Old task',
              status: 'cleared',
              steps: [],
              created_at: '2026-06-10T00:00:00.000Z',
              updated_at: '2026-06-10T00:00:00.000Z',
            },
          },
        },
      },
      content: [{ type: 'text', text: 'Cleared active agent todo.' }],
    }, { expanded: false }, theme).render(80);
    expect(cleared).toHaveLength(1);
    expect(stripAnsi(cleared[0])).toContain('cleared · Old task');
    assertUnboxedAndNoHints(cleared);

    const empty = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'show',
          ok: true,
          state: { active_todo: null, current_todo: null },
        },
      },
      content: [{ type: 'text', text: 'No active agent todo.' }],
    }, { expanded: false }, theme).render(80);
    expect(empty).toHaveLength(1);
    expect(stripAnsi(empty[0])).toContain('No active agent todo.');
    assertUnboxedAndNoHints(empty);
  });

  it('enforces width 0 empty output and positive width bounds with CJK, emoji, combining, and OSC 8', () => {
    const wideTodo = {
      ...activeTodoFixture,
      title: '漢字🚀 café\u0301 \x1b]8;;https://example.com\x07link\x1b]8;;\x07',
      steps: [{ id: 's1', text: '漢字🚀 café\u0301 very long step text without breaks 1234567890', status: 'open' as const }],
    };
    const callComp = renderAgentTodoCall({ action: 'create', title: wideTodo.title }, theme);
    const resComp = renderAgentTodoResult({
      details: { agent_todo: { version: 1, action: 'create', ok: true, state: { active_todo: wideTodo, current_todo: null } } },
      content: [{ type: 'text', text: wideTodo.steps[0].text }],
    }, { expanded: true }, theme);

    expect(callComp.render(0)).toEqual([]);
    expect(resComp.render(0)).toEqual([]);

    for (const width of [1, 2, 10, 23, 24, 40, 80, 120]) {
      for (const line of callComp.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
      for (const line of resComp.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('never throws on malformed args, result, or context', () => {
    expect(() => renderAgentTodoCall(null, undefined, undefined).render(80)).not.toThrow();
    expect(() => renderAgentTodoResult(null as any, undefined, undefined, undefined).render(80)).not.toThrow();
  });
});
