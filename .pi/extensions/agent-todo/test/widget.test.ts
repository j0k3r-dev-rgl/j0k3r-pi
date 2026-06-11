import { describe, expect, it, vi } from 'vitest';

import { renderAgentTodoWidgetLines, syncAgentTodoWidget } from '../src/widget.js';
import type { AgentTodoProjection } from '../src/types.js';

const activeProjection: AgentTodoProjection = {
  active_todo: {
    id: 'todo-1',
    title: 'Ship feature',
    status: 'active',
    steps: [
      { id: 'step-1', text: 'Write tests', status: 'completed' },
      { id: 'step-2', text: 'Implement', status: 'open' },
    ],
    created_at: '2026-06-10T00:00:00.000Z',
    updated_at: '2026-06-10T00:00:00.000Z',
  },
  current_todo: null,
};

describe('widget helpers', () => {
  it('renders compact title, progress, and visible step ids/statuses without requiring body text', () => {
    const lines = renderAgentTodoWidgetLines(activeProjection.active_todo!).join('\n');
    expect(lines).toContain('Ship feature');
    expect(lines).toContain('1/2');
    expect(lines).toContain('[x] 1. Write tests');
    expect(lines).toContain('[ ] 2. Implement');
  });

  it('renders a collapsed dim summary without changing the underlying active todo data', () => {
    const lines = renderAgentTodoWidgetLines(activeProjection.active_todo!, { collapsed: true, shortcut: 'alt+t' }).join('\n');

    expect(lines).toContain('Agent Todo: Ship feature');
    expect(lines).toContain('1/2 complete');
    expect(lines).toContain('alt+t to expand');
    expect(lines).not.toContain('Write tests');
    expect(lines).toContain('\u001b[2m');
  });

  it('syncs the above-input widget for active and inactive projections', () => {
    const setWidget = vi.fn();
    const ctx = { ui: { setWidget } };

    syncAgentTodoWidget(ctx, activeProjection, { collapsed: false, shortcut: 'alt+t' });
    expect(setWidget).toHaveBeenCalledWith('agent-todo', [
      'Agent Todo: Ship feature',
      'Progress: 1/2 steps completed',
      '[x] 1. Write tests',
      '[ ] 2. Implement',
      '\u001b[2malt+t to collapse\u001b[22m',
    ]);

    syncAgentTodoWidget(ctx, activeProjection, { collapsed: true, shortcut: 'alt+t' });
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', expect.arrayContaining([
      expect.stringContaining('1/2 complete'),
      '\u001b[2malt+t to expand\u001b[22m',
    ]));

    syncAgentTodoWidget(ctx, { active_todo: null, current_todo: null }, { collapsed: true, shortcut: 'alt+t' });
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', undefined);
  });
});
