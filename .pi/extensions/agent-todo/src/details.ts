import type { AgentTodo, AgentTodoAction, AgentTodoDetailsEnvelope, AgentTodoError, AgentTodoProjection } from './types.js';
import { AGENT_TODO_VERSION } from './types.js';

export function cloneAgentTodo(todo: AgentTodo | null): AgentTodo | null {
  if (!todo) return null;
  return {
    ...todo,
    steps: todo.steps.map((step) => ({ ...step })),
  };
}

export function cloneProjection(state: AgentTodoProjection): AgentTodoProjection {
  const current = cloneAgentTodo(state.current_todo);
  const active = current && current.status === 'active'
    ? current
    : cloneAgentTodo(state.active_todo);
  return {
    active_todo: active && active.status === 'active' ? active : null,
    current_todo: current,
  };
}

export function normalizeProjection(state: AgentTodoProjection): AgentTodoProjection {
  const current = cloneAgentTodo(state.current_todo) ?? cloneAgentTodo(state.active_todo);
  const active = current?.status === 'active'
    ? current
    : cloneAgentTodo(state.active_todo);
  return {
    active_todo: active?.status === 'active' ? active : null,
    current_todo: current,
  };
}

export function buildAgentTodoDetails(options: {
  action: AgentTodoAction;
  ok: boolean;
  state: AgentTodoProjection;
  error?: AgentTodoError;
}): AgentTodoDetailsEnvelope {
  return {
    agent_todo: {
      version: AGENT_TODO_VERSION,
      action: options.action,
      ok: options.ok,
      error: options.error ? { ...options.error } : undefined,
      state: cloneProjection(normalizeProjection(options.state)),
    },
  };
}
