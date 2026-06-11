import { describe, expect, it } from 'vitest';

import { renderAgentTodoCall, renderAgentTodoResult } from '../src/render.js';

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
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
          },
        },
      },
      content: [{ type: 'text', text: 'Created agent todo: Ship feature.' }],
    }, { isPartial: false }, theme).render(80).join('\n');

    expect(result).toContain('Ship feature');
    expect(result).toContain('1/2 complete');
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
});
