import { cloneAgentTodo, normalizeProjection } from './details.js';
import type { AgentTodoProjection, AgentTodoProvider, AgentTodoProviderValueV1 } from './types.js';
import { AGENT_TODO_GLOBAL_PROVIDER_KEY, AGENT_TODO_PROVIDER_NAME } from './types.js';

export function createAgentTodoProvider(getProjection: () => AgentTodoProjection): AgentTodoProvider {
  return {
    name: AGENT_TODO_PROVIDER_NAME,
    async getActiveTodo() {
      const projection = normalizeProjection(getProjection());
      const active = cloneAgentTodo(projection.active_todo);
      if (!active) return null;
      const value: AgentTodoProviderValueV1 = {
        version: 1,
        source: 'agent-todo',
        active_todo: {
          id: active.id,
          title: active.title,
          body: active.body,
          steps: active.steps.map((step) => ({ ...step })),
          updated_at: active.updated_at,
        },
      };
      return value;
    },
  };
}

export function publishAgentTodoProvider(
  provider: AgentTodoProvider,
  targets: { pi?: Record<string, unknown>; ctx?: Record<string, unknown>; globalTarget?: Record<string, unknown> },
): void {
  if (targets.pi) targets.pi.agentTodo = provider;
  if (targets.ctx) targets.ctx.agentTodo = provider;
  (targets.globalTarget ?? globalThis as Record<string, unknown>)[AGENT_TODO_GLOBAL_PROVIDER_KEY] = provider;
}

export function cleanupAgentTodoProvider(
  provider: AgentTodoProvider,
  targets: { pi?: Record<string, unknown>; ctx?: Record<string, unknown>; globalTarget?: Record<string, unknown> },
): void {
  if (targets.pi?.agentTodo === provider) delete targets.pi.agentTodo;
  if (targets.ctx?.agentTodo === provider) delete targets.ctx.agentTodo;
  const globalTarget = targets.globalTarget ?? globalThis as Record<string, unknown>;
  if (globalTarget[AGENT_TODO_GLOBAL_PROVIDER_KEY] === provider) delete globalTarget[AGENT_TODO_GLOBAL_PROVIDER_KEY];
}
