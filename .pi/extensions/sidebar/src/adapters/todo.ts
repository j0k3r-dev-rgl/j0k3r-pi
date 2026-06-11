import type { SectionState, SidebarAdapterContext, SidebarTodoModel } from '../model.js';

type AgentTodoProvider = {
  getActiveTodo?: () => unknown | Promise<unknown>;
};

type AgentTodoProviderValueV1 = {
  version: 1;
  source: 'agent-todo';
  active_todo: {
    id: string;
    title: string;
    body?: string;
    steps: Array<{
      id: string;
      text: string;
      status: 'open' | 'completed';
    }>;
    updated_at: string;
  };
};

export type TodoAdapter = {
  load(context: SidebarAdapterContext): Promise<SectionState<SidebarTodoModel>>;
};

export function createTodoAdapter(): TodoAdapter {
  return {
    async load(context) {
      try {
        const provider = discoverProvider(context);
        if (!provider || typeof provider.getActiveTodo !== 'function') {
          return { kind: 'empty', message: 'todo unavailable' };
        }

        const value = await provider.getActiveTodo();
        if (!isProviderValue(value)) return { kind: 'empty', message: 'todo unavailable' };

        const completedSteps = value.active_todo.steps.filter((step) => step.status === 'completed').length;
        const totalSteps = value.active_todo.steps.length;
        return {
          kind: 'ready',
          refreshedAt: context.now().toISOString(),
          data: {
            id: value.active_todo.id,
            title: value.active_todo.title,
            body: value.active_todo.body,
            completedSteps,
            totalSteps,
            progressLabel: `${completedSteps}/${totalSteps}`,
            steps: value.active_todo.steps.map((step) => ({ ...step })),
            updatedAt: value.active_todo.updated_at,
          },
        };
      } catch {
        return { kind: 'empty', message: 'todo unavailable' };
      }
    },
  };
}

function discoverProvider(context: SidebarAdapterContext): AgentTodoProvider | undefined {
  const ctxProviders = context.ctx?.providers;
  const piProviders = context.pi?.providers;
  const candidates = [
    context.ctx?.agentTodo,
    context.pi?.agentTodo,
    typeof ctxProviders?.get === 'function' ? ctxProviders.get('agent-todo.activeTodo') : undefined,
    typeof piProviders?.get === 'function' ? piProviders.get('agent-todo.activeTodo') : undefined,
    (globalThis as Record<string, unknown>).__PI_AGENT_TODO_PROVIDER__,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && typeof (candidate as AgentTodoProvider).getActiveTodo === 'function') {
      return candidate as AgentTodoProvider;
    }
  }

  return undefined;
}

function isProviderValue(value: unknown): value is AgentTodoProviderValueV1 {
  if (!isRecord(value) || value.version !== 1 || value.source !== 'agent-todo') return false;
  const active = value.active_todo;
  if (!isRecord(active)) return false;
  if (typeof active.id !== 'string' || typeof active.title !== 'string') return false;
  if (active.body !== undefined && typeof active.body !== 'string') return false;
  if (typeof active.updated_at !== 'string' || !Number.isFinite(Date.parse(active.updated_at))) return false;
  if (!Array.isArray(active.steps) || active.steps.length === 0) return false;
  return active.steps.every((step) => isRecord(step)
    && typeof step.id === 'string'
    && typeof step.text === 'string'
    && (step.status === 'open' || step.status === 'completed'));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
