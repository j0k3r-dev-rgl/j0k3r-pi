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
    expect(tools[0].renderShell).toBe('self');
    expect(tools[0].promptSnippet).toBe('Manage a single active todo for substantial multi-step work.');
    expect(tools[0].promptGuidelines).toContain('Use agent_todo only for long, tedious, multi-phase, or high-coordination tasks where a checklist adds value.');
    expect(tools[0].promptGuidelines).toContain('Do not use agent_todo for direct answers, tiny inspections, small approved edits, or simple commit/push operations.');
    expect(tools[0].parameters.properties.action.type).toBe('string');
    expect(tools[0].parameters.properties.range.type).toBe('string');

    const setWidget = vi.fn();
    const ctx = { ui: { setWidget } };
    const created = await tools[0].execute('1', { action: 'create', title: 'Ship feature' }, undefined, undefined, ctx);
    expect(created.isError).toBeUndefined();
    expect(created.details.agent_todo.state.active_todo.title).toBe('Ship feature');
    expect(setWidget).toHaveBeenCalledWith('agent-todo', expect.any(Array));

    const completed = await tools[0].execute('2', { action: 'complete_all' }, undefined, undefined, ctx);
    expect(completed.isError).toBeUndefined();
    expect(completed.details.agent_todo.state.active_todo).toBeNull();
    expect(completed.details.agent_todo.state.current_todo.status).toBe('completed');
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', undefined);

    const failed = await tools[0].execute('3', { action: 'create', title: 'Second task' }, undefined, undefined, ctx);
    expect(failed.isError).toBeUndefined();
    expect(failed.details.agent_todo.state.active_todo.title).toBe('Second task');
  });

  it('forwards context to renderCall and renderResult', () => {
    const tools: any[] = [];
    const runtime = createRuntime();
    registerAgentTodoTool({ registerTool: (tool: any) => tools.push(tool) }, runtime as any);

    const context: any = { state: {}, isError: false };
    const theme = { fg: (_token: string, text: string) => text, bold: (text: string) => text };

    const callComp = tools[0].renderCall({ action: 'create' }, theme, context);
    expect(callComp).toBeDefined();

    const resultComp = tools[0].renderResult({
      details: {
        agent_todo: {
          version: 1,
          action: 'create',
          ok: true,
          state: { active_todo: null, current_todo: null },
        },
      },
      content: [{ type: 'text', text: 'No active agent todo.' }],
    }, { expanded: false }, theme, context);

    expect(resultComp).toBeDefined();
    expect(context.state.hasResult).toBe(true);
  });
});
