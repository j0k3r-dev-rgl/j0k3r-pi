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
    expect(lines).toContain('agent-todo');
    expect(lines).toContain('Ship feature');
    expect(lines).toContain('1/2');
    expect(lines).toContain('✓');
    expect(lines).toContain('○');
    expect(lines).toContain('Write tests');
    expect(lines).toContain('Implement');
    expect(lines).toContain('\u001b[9m');
  });

  it('renders a collapsed dim summary without changing the underlying active todo data', () => {
    const lines = renderAgentTodoWidgetLines(activeProjection.active_todo!, { collapsed: true, shortcut: 'ctrl+space' }).join('\n');

    expect(lines).toContain('agent-todo');
    expect(lines).toContain('Ship feature');
    expect(lines).toContain('1/2');
    expect(lines).toContain('complete');
    expect(lines).toContain('ctrl+space to expand');
    expect(lines).not.toContain('Write tests');
    expect(lines).toContain('\u001b[2m');
  });

  it('syncs the above-input widget for active and inactive projections', () => {
    const setWidget = vi.fn();
    const ctx = { ui: { setWidget } };

    syncAgentTodoWidget(ctx, activeProjection, { collapsed: false, shortcut: 'ctrl+space' });
    expect(setWidget).toHaveBeenCalledWith('agent-todo', expect.arrayContaining([
      expect.stringContaining('agent-todo'),
      expect.stringContaining('Ship feature'),
      expect.stringContaining('Write tests'),
      expect.stringContaining('Implement'),
      expect.stringContaining('ctrl+space to collapse'),
    ]));

    syncAgentTodoWidget(ctx, activeProjection, { collapsed: true, shortcut: 'ctrl+space' });
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', expect.arrayContaining([
      expect.stringContaining('1/2'),
      expect.stringContaining('complete'),
      expect.stringContaining('ctrl+space to expand'),
    ]));

    syncAgentTodoWidget(ctx, { active_todo: null, current_todo: null }, { collapsed: true, shortcut: 'ctrl+space' });
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', undefined);
  });
});
