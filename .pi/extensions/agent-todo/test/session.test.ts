import { describe, expect, it } from 'vitest';

import { reconstructAgentTodoProjection } from '../src/session.js';
import type { AgentTodo, AgentTodoProjection } from '../src/types.js';

function todo(overrides: Partial<AgentTodo> = {}): AgentTodo {
  return {
    id: 'todo-1',
    title: 'Ship feature',
    status: 'active',
    steps: [
      { id: 'step-1', text: 'Write tests', status: 'open' },
      { id: 'step-2', text: 'Implement', status: 'completed' },
    ],
    created_at: '2026-06-10T00:00:00.000Z',
    updated_at: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

function state(value: AgentTodoProjection) {
  return {
    agent_todo: {
      version: 1,
      action: 'show',
      ok: true,
      state: value,
    },
  };
}

function entry(details: unknown) {
  return {
    type: 'message',
    message: {
      role: 'toolResult',
      toolName: 'agent_todo',
      details,
    },
  };
}

describe('reconstructAgentTodoProjection', () => {
  it('rebuilds the latest successful version 1 state from branch order', () => {
    const active = todo();
    const completed = todo({ status: 'completed', completed_at: '2026-06-10T01:00:00.000Z' });
    const branch = [
      entry(state({ active_todo: active, current_todo: active })),
      entry(state({ active_todo: null, current_todo: completed })),
    ];

    expect(reconstructAgentTodoProjection(branch)).toEqual({
      active_todo: null,
      current_todo: completed,
    });
  });

  it('ignores failed, malformed, missing, unsupported-version, and non-agent_todo results', () => {
    const active = todo();
    const branch = [
      entry({ agent_todo: { version: 2, action: 'show', ok: true, state: { active_todo: null, current_todo: null } } }),
      entry({ agent_todo: { version: 1, action: 'create', ok: false, state: { active_todo: null, current_todo: null } } }),
      entry({ agent_todo: { version: 1, action: 'show', ok: true, state: { active_todo: { id: 1 }, current_todo: null } } }),
      { type: 'message', message: { role: 'toolResult', toolName: 'other_tool', details: state({ active_todo: null, current_todo: null }) } },
      entry(state({ active_todo: active, current_todo: active })),
    ];

    expect(reconstructAgentTodoProjection(branch)).toEqual({ active_todo: active, current_todo: active });
  });

  it('returns an empty projection when no valid current-branch results exist', () => {
    expect(reconstructAgentTodoProjection([])).toEqual({ active_todo: null, current_todo: null });
  });
});
