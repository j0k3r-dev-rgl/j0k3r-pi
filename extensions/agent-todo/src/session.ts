import { normalizeProjection } from './details.js';
import type { AgentTodo, AgentTodoDetailsV1, AgentTodoProjection, AgentTodoStep } from './types.js';

export function reconstructAgentTodoProjection(branch: readonly unknown[]): AgentTodoProjection {
  let projection: AgentTodoProjection = { active_todo: null, current_todo: null };

  for (const entry of branch) {
    const details = readAgentTodoDetails(entry);
    if (!details || details.version !== 1 || details.ok !== true) continue;
    if (!isProjection(details.state)) continue;
    projection = normalizeProjection(details.state);
  }

  return projection;
}

function readAgentTodoDetails(entry: unknown): AgentTodoDetailsV1 | undefined {
  if (!isRecord(entry) || entry.type !== 'message') return undefined;
  const message = entry.message;
  if (!isRecord(message) || message.role !== 'toolResult' || message.toolName !== 'agent_todo') return undefined;
  const details = isRecord(message.details) ? message.details : undefined;
  return details && isRecord(details.agent_todo) ? details.agent_todo as AgentTodoDetailsV1 : undefined;
}

function isProjection(value: unknown): value is AgentTodoProjection {
  if (!isRecord(value)) return false;
  return isTodoOrNull(value.active_todo) && isTodoOrNull(value.current_todo);
}

function isTodoOrNull(value: unknown): value is AgentTodo | null {
  return value === null || isTodo(value);
}

function isTodo(value: unknown): value is AgentTodo {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return false;
  if (value.body !== undefined && typeof value.body !== 'string') return false;
  if (value.status !== 'active' && value.status !== 'completed' && value.status !== 'cleared') return false;
  if (!Array.isArray(value.steps) || !value.steps.every(isStep)) return false;
  if (typeof value.created_at !== 'string' || typeof value.updated_at !== 'string') return false;
  if (value.completed_at !== undefined && typeof value.completed_at !== 'string') return false;
  if (value.cleared_at !== undefined && typeof value.cleared_at !== 'string') return false;
  return true;
}

function isStep(value: unknown): value is AgentTodoStep {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.text === 'string'
    && (value.status === 'open' || value.status === 'completed');
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
