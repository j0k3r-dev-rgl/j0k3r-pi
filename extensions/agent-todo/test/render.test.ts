import { describe, expect, it } from 'vitest';

import {
  BOLD,
  CYAN,
  DIM,
  LIME,
  RED,
  RESET,
  boxLine,
  cardBottomBorder,
  cardTopBorder,
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

describe('agent todo tool renderers', () => {
  it('renders concise call and compact result summaries without raw json or full step lists', () => {
    const call = renderAgentTodoCall({ action: 'create', title: 'Ship feature' }, theme).render(80).join('\n');
    expect(call).toContain('agent_todo');
    expect(call).toContain('create');
    expect(call).toContain('Ship feature');

    const result = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'create',
          ok: true,
          state: {
            active_todo: activeTodoFixture,
            current_todo: null,
          },
        },
      },
      content: [{ type: 'text', text: 'Created agent todo: Ship feature.' }],
    }, { isPartial: false }, theme).render(80).join('\n');

    expect(result).toContain('Ship feature');
    expect(result).toContain('1/3 complete');
    expect(result).not.toContain('[x] 1. Write tests');
    expect(result).not.toContain('[ ] 2. Implement');
    expect(result).not.toContain('{');
    expect(result).not.toContain('"version"');
  });

  it('keeps completed todo results compact', () => {
    const result = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'complete_all',
          ok: true,
          state: {
            active_todo: null,
            current_todo: {
              id: 'todo-1',
              title: 'Ship feature',
              status: 'completed',
              steps: [
                { id: '1', text: 'One', status: 'completed' },
                { id: '2', text: 'Two', status: 'completed' },
              ],
              created_at: '2026-06-10T00:00:00.000Z',
              updated_at: '2026-06-10T00:00:00.000Z',
              completed_at: '2026-06-10T00:00:00.000Z',
            },
          },
        },
      },
      content: [{ type: 'text', text: 'Completed all remaining steps for Ship feature.' }],
    }, { isPartial: false }, theme).render(80).join('\n');

    expect(result).toContain('completed');
    expect(result).toContain('Ship feature');
    expect(result).toContain('2/2');
    expect(result).not.toContain('[x]');
  });

  it('renders hollow card framing with rounded corners and consistent line widths without background fill', () => {
    const context = { state: {} };
    const callLines = renderAgentTodoCall({ action: 'create', title: 'Ship feature' }, theme, context).render(80);

    expect(callLines).toHaveLength(3);
    // Top border with rounded corners
    expect(callLines[0]).toContain('╭');
    expect(callLines[0]).toContain('╮');
    expect(callLines[0]).toContain('agent_todo [create]');
    // Box line with vertical borders
    expect(callLines[1]).toContain('│');
    expect(callLines[1]).toContain('Pending: Ship feature');
    // Bottom border with rounded corners
    expect(callLines[2]).toContain('╰');
    expect(callLines[2]).toContain('╯');

    // Verify each line visible width exactly matches 80
    for (const line of callLines) {
      expect(visibleWidth(line)).toBe(80);
      // No background fill escapes
      expect(line).not.toMatch(/\x1b\[4[0-7]m/);
      expect(line).not.toMatch(/\x1b\[48;/);
      expect(line).not.toMatch(/\x1b\[7m/);
    }
  });

  it('implements two-phase slot coordination between call and result via context.state', () => {
    const context: any = { state: {} };

    // Phase 1: Pending call before result arrives
    const pendingCall = renderAgentTodoCall({ action: 'create', title: 'Ship feature' }, theme, context).render(80);
    expect(pendingCall).toHaveLength(3);
    expect(pendingCall[0]).toContain('╭');
    expect(pendingCall[1]).toContain('●');
    expect(pendingCall[2]).toContain('╰');

    // Tool execution completes: renderResult is called
    const resultComponent = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'create',
          ok: true,
          state: {
            active_todo: activeTodoFixture,
            current_todo: null,
          },
        },
      },
      content: [{ type: 'text', text: 'Created todo' }],
    }, { expanded: false }, theme, context);

    expect(context.state.hasResult).toBe(true);

    // Phase 2: Call re-renders with result present -> only Slot 1 top border
    const resolvedCall = renderAgentTodoCall({ action: 'create', title: 'Ship feature' }, theme, context).render(80);
    expect(resolvedCall).toHaveLength(1);
    expect(resolvedCall[0]).toContain('╭');
    expect(resolvedCall[0]).toContain('╮');

    // Slot 2: Result renders framed content + bottom border
    const resultLines = resultComponent.render(80);
    expect(resultLines.length).toBeGreaterThanOrEqual(2);
    expect(resultLines[resultLines.length - 1]).toContain('╰');
    expect(resultLines[resultLines.length - 1]).toContain('╯');

    // Seamless assembled card has exactly 1 top border and 1 bottom border
    const assembledCard = [...resolvedCall, ...resultLines];
    const topBorders = assembledCard.filter((line) => line.includes('╭'));
    const bottomBorders = assembledCard.filter((line) => line.includes('╰'));
    expect(topBorders).toHaveLength(1);
    expect(bottomBorders).toHaveLength(1);

    for (const line of assembledCard) {
      expect(visibleWidth(line)).toBe(80);
    }
  });

  it('applies dynamic border colors for active (cyan), completed (lime), and error (red) states', () => {
    // 1. Active todo: CYAN
    const activeCtx: any = { state: {} };
    const activeResult = renderAgentTodoResult({
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
    expect(activeResult[activeResult.length - 1]).toContain(CYAN);

    // 2. Completed todo: LIME
    const completeCtx: any = { state: {} };
    const completeResult = renderAgentTodoResult({
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
    expect(completeResult[completeResult.length - 1]).toContain(LIME);

    // 3. Error result: RED
    const errorCtx: any = { state: {} };
    const errorResult = renderAgentTodoResult({
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
    expect(errorResult[errorResult.length - 1]).toContain(RED);
    expect(errorResult.join('\n')).toContain('Error: Title already exists');
  });

  it('formats top border action badges with target context', () => {
    const call1 = renderAgentTodoCall({ action: 'complete_step', step_id: 'step-2' }, theme).render(80)[0];
    expect(call1).toContain('agent_todo [complete_step step-2]');

    const call2 = renderAgentTodoCall({ action: 'complete_range', range: '2-4' }, theme).render(80)[0];
    expect(call2).toContain('agent_todo [complete_range 2-4]');

    const call3 = renderAgentTodoCall({ action: 'show' }, theme).render(80)[0];
    expect(call3).toContain('agent_todo [show]');
  });

  it('renders collapsed mode with summary and expand hint', () => {
    const result = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'create',
          ok: true,
          state: { active_todo: activeTodoFixture, current_todo: null },
        },
      },
      content: [{ type: 'text', text: 'Created' }],
    }, { expanded: false }, theme).render(80).join('\n');

    expect(result).toContain('Ship feature · 1/3 complete · 2 open');
    expect(result).toContain('ctrl+o expand');
    expect(result).not.toContain('✓');
    expect(result).not.toContain('○');
  });

  it('renders expanded mode with checklist bullets (✓ completed, ○ open) and collapse hint', () => {
    const result = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'show',
          ok: true,
          state: { active_todo: activeTodoFixture, current_todo: null },
        },
      },
      content: [{ type: 'text', text: 'Showing todo' }],
    }, { expanded: true }, theme).render(80).join('\n');

    expect(result).toContain('Ship feature');
    expect(result).toContain('[active]');
    // Completed step bullet
    expect(result).toContain('✓');
    expect(result).toContain('Write tests');
    expect(stripAnsi(result)).toContain('✓ Write tests');
    // Open step bullet
    expect(result).toContain('○');
    expect(result).toContain('Implement');
    expect(stripAnsi(result)).toContain('○ Implement');
    expect(stripAnsi(result)).toContain('○ Validate');
    // Collapse hint
    expect(result).toContain('ctrl+o collapse');
  });

  it('handles special states inside framed card (cleared, error with active, empty)', () => {
    // Cleared state
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
    }, { expanded: false }, theme).render(80).join('\n');

    expect(cleared).toContain('cleared');
    expect(cleared).toContain('Old task');
    expect(cleared).toContain('│');
    expect(cleared).toContain('╰');

    // Empty state
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
    }, { expanded: false }, theme).render(80).join('\n');

    expect(empty).toContain('No active agent todo.');
    expect(empty).toContain('│');
    expect(empty).toContain('╰');
  });

  it('falls back gracefully to plain text without crashing when terminal width is narrow (< 24)', () => {
    const call = renderAgentTodoCall({ action: 'create', title: 'Ship feature' }, theme).render(20);
    expect(call).toHaveLength(1);
    expect(call[0]).not.toContain('╭');
    expect(call[0]).toContain('agent_todo');
    expect(visibleWidth(call[0])).toBeLessThanOrEqual(20);

    const result = renderAgentTodoResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'create',
          ok: true,
          state: { active_todo: activeTodoFixture, current_todo: null },
        },
      },
      content: [{ type: 'text', text: 'ok' }],
    }, { expanded: false }, theme).render(20);

    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const line of result) {
      expect(line).not.toContain('│');
      expect(line).not.toContain('╰');
      expect(visibleWidth(line)).toBeLessThanOrEqual(20);
    }
  });
});
