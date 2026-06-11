import { describe, expect, it } from 'vitest';

import { cleanupAgentTodoProvider, createAgentTodoProvider, publishAgentTodoProvider } from '../src/provider.js';
import type { AgentTodoProjection } from '../src/types.js';

function activeProjection(): AgentTodoProjection {
  return {
    active_todo: {
      id: 'todo-1',
      title: 'Ship feature',
      status: 'active',
      body: 'Optional body',
      steps: [
        { id: 'step-1', text: 'Write tests', status: 'open' },
      ],
      created_at: '2026-06-10T00:00:00.000Z',
      updated_at: '2026-06-10T00:00:00.000Z',
    },
    current_todo: null,
  };
}

describe('agent todo provider', () => {
  it('returns a versioned active todo snapshot only while active and clones its payload', async () => {
    const holder = { projection: activeProjection() };
    const provider = createAgentTodoProvider(() => holder.projection);

    const value = await provider.getActiveTodo();
    expect(value).toEqual({
      version: 1,
      source: 'agent-todo',
      active_todo: {
        id: 'todo-1',
        title: 'Ship feature',
        body: 'Optional body',
        steps: [{ id: 'step-1', text: 'Write tests', status: 'open' }],
        updated_at: '2026-06-10T00:00:00.000Z',
      },
    });

    value!.active_todo.steps[0]!.text = 'Mutated';
    const fresh = await provider.getActiveTodo();
    expect(fresh?.active_todo.steps[0]?.text).toBe('Write tests');

    holder.projection = { active_todo: null, current_todo: null };
    await expect(provider.getActiveTodo()).resolves.toBeNull();
  });

  it('publishes and cleans up owned provider surfaces', () => {
    const provider = createAgentTodoProvider(() => ({ active_todo: null, current_todo: null }));
    const pi: Record<string, unknown> = {};
    const ctx: Record<string, unknown> = {};
    const globalTarget: Record<string, unknown> = {};

    publishAgentTodoProvider(provider, { pi, ctx, globalTarget });
    expect(pi.agentTodo).toBe(provider);
    expect(ctx.agentTodo).toBe(provider);
    expect(globalTarget.__PI_AGENT_TODO_PROVIDER__).toBe(provider);

    cleanupAgentTodoProvider(provider, { pi, ctx, globalTarget });
    expect(pi.agentTodo).toBeUndefined();
    expect(ctx.agentTodo).toBeUndefined();
    expect(globalTarget.__PI_AGENT_TODO_PROVIDER__).toBeUndefined();
  });
});
