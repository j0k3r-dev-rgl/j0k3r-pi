import { describe, expect, it, vi } from 'vitest';

import { registerAgentTodoTool } from '../src/tools.js';

function createRuntime() {
  return {
    projection: { active_todo: null, current_todo: null },
    deps: {
      now: () => '2026-06-10T00:00:00.000Z',
      idGenerator: ((ids) => (_kind: 'todo' | 'step') => ids.shift() ?? 'generated')(['todo-1', 'step-1', 'step-2', 'todo-2', 'step-3']),
    },
    provider: { name: 'agent-todo.activeTodo', getActiveTodo: () => null },
  };
}

describe('registerAgentTodoTool', () => {
  it('registers a single agent_todo tool with string action params and loud validation failures', async () => {
    const tools: any[] = [];
    const runtime = createRuntime();
    registerAgentTodoTool({ registerTool: (tool: any) => tools.push(tool) }, runtime as any);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('agent_todo');
    expect(tools[0].parameters.properties.action.type).toBe('string');

    const setWidget = vi.fn();
    const ctx = { ui: { setWidget } };
    const created = await tools[0].execute('1', { action: 'create', title: 'Ship feature' }, undefined, undefined, ctx);
    expect(created.isError).toBeUndefined();
    expect(created.details.agent_todo.state.active_todo.title).toBe('Ship feature');
    expect(setWidget).toHaveBeenCalledWith('agent-todo', expect.any(Array));

    const failed = await tools[0].execute('2', { action: 'create', title: 'Second task' }, undefined, undefined, ctx);
    expect(failed.isError).toBe(true);
    expect(failed.details.agent_todo.error.code).toBe('active_todo_exists');
  });
});
