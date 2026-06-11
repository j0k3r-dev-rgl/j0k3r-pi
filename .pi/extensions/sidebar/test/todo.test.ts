import { describe, expect, it } from 'vitest';

import { createTodoAdapter } from '../src/adapters/todo.js';
import type { SidebarAdapterContext } from '../src/model.js';

function context(overrides: Partial<SidebarAdapterContext> = {}): SidebarAdapterContext {
  return {
    cwd: '/workspace/pi',
    ctx: {},
    pi: {},
    now: () => new Date('2026-06-10T00:00:00.000Z'),
    ...overrides,
  };
}

function provider(value: unknown) {
  return {
    name: 'agent-todo.activeTodo',
    getActiveTodo: () => value,
  };
}

describe('createTodoAdapter', () => {
  it('returns ready state for a valid active todo provider', async () => {
    const adapter = createTodoAdapter();
    const state = await adapter.load(context({
      pi: {
        agentTodo: provider({
          version: 1,
          source: 'agent-todo',
          active_todo: {
            id: 'todo-1',
            title: 'Ship feature',
            steps: [
              { id: '1', text: 'Write tests', status: 'completed' },
              { id: '2', text: 'Implement', status: 'open' },
            ],
            updated_at: '2026-06-10T00:00:00.000Z',
          },
        }),
      },
    }));

    expect(state.kind).toBe('ready');
    if (state.kind !== 'ready') throw new Error('expected ready state');
    expect(state.data.title).toBe('Ship feature');
    expect(state.data.progressLabel).toBe('1/2');
    expect(state.data.steps).toEqual([
      { id: '1', text: 'Write tests', status: 'completed' },
      { id: '2', text: 'Implement', status: 'open' },
    ]);
  });

  it('fails closed when the provider is missing, null, throws, or returns invalid data', async () => {
    const adapter = createTodoAdapter();
    await expect(adapter.load(context())).resolves.toEqual({ kind: 'empty', message: 'todo unavailable' });
    await expect(adapter.load(context({ pi: { agentTodo: provider(null) } }))).resolves.toEqual({ kind: 'empty', message: 'todo unavailable' });
    await expect(adapter.load(context({ pi: { agentTodo: { getActiveTodo: () => { throw new Error('boom'); } } } }))).resolves.toEqual({ kind: 'empty', message: 'todo unavailable' });
    await expect(adapter.load(context({ pi: { agentTodo: provider({ version: 2 }) } }))).resolves.toEqual({ kind: 'empty', message: 'todo unavailable' });
    await expect(adapter.load(context({ pi: { agentTodo: provider({ version: 1, source: 'agent-todo', active_todo: { id: 1 } }) } }))).resolves.toEqual({ kind: 'empty', message: 'todo unavailable' });
  });

  it('does not parse session history or tool result details independently', async () => {
    let branchReads = 0;
    const adapter = createTodoAdapter();
    const state = await adapter.load(context({
      ctx: {
        sessionManager: {
          getBranch: () => {
            branchReads += 1;
            return [];
          },
        },
      },
      pi: {
        agentTodo: provider({
          version: 1,
          source: 'agent-todo',
          active_todo: {
            id: 'todo-1',
            title: 'Ship feature',
            steps: [{ id: '1', text: 'Write tests', status: 'open' }],
            updated_at: '2026-06-10T00:00:00.000Z',
          },
        }),
      },
    }));

    expect(state.kind).toBe('ready');
    expect(branchReads).toBe(0);
  });
});
