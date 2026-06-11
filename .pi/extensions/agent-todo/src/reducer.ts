import { buildAgentTodoDetails, cloneAgentTodo, normalizeProjection } from './details.js';
import type { AgentTodo, AgentTodoAction, AgentTodoProjection, AgentTodoReducerDeps, AgentTodoReducerResult, AgentTodoStep, AgentTodoToolInput } from './types.js';
import { AGENT_TODO_ACTIONS } from './types.js';

const ACTIONS = new Set<string>(AGENT_TODO_ACTIONS);

export function applyAgentTodoAction(
  projection: AgentTodoProjection,
  input: AgentTodoToolInput,
  deps: AgentTodoReducerDeps,
): AgentTodoReducerResult {
  const currentState = normalizeProjection(projection);
  const action = typeof input.action === 'string' ? input.action : '';

  if (!ACTIONS.has(action)) {
    return failure(currentState, 'show', 'unsupported_action', `Unsupported action: ${input.action ?? '(missing action)'}`);
  }

  const supportedAction = action as AgentTodoAction;

  switch (supportedAction) {
    case 'create':
      return createTodo(currentState, input, deps);
    case 'show':
      return success(currentState, supportedAction, currentState, describeShowResult(currentState), false);
    case 'complete_step':
      return completeStep(currentState, input, deps);
    case 'complete_all':
      return completeAll(currentState, deps);
    case 'complete_range':
      return completeRange(currentState, input, deps);
    case 'reopen_step':
      return reopenStep(currentState, input, deps);
    case 'clear':
      return clearTodo(currentState, deps);
  }
}

function createTodo(state: AgentTodoProjection, input: AgentTodoToolInput, deps: AgentTodoReducerDeps): AgentTodoReducerResult {
  if (state.active_todo) {
    return failure(
      state,
      'create',
      'active_todo_exists',
      'An active todo already exists. Complete its steps or clear it before creating a new todo.',
      state.active_todo.id,
    );
  }

  const title = normalizeRequiredText(input.title);
  if (!title) return failure(state, 'create', 'invalid_input', 'title is required for create.');

  if (input.body !== undefined) {
    const body = normalizeOptionalText(input.body);
    if (body === undefined) return failure(state, 'create', 'invalid_input', 'body must be a non-empty string when provided.');
  }

  const steps = normalizeSteps(input.steps, title);
  if (!steps.ok) return failure(state, 'create', 'invalid_input', steps.message);

  const timestamp = deps.now();
  const todoId = deps.idGenerator('todo', 0);
  const todoSteps = steps.value.map((text, index) => ({ id: deps.idGenerator('step', index), text, status: 'open' as const }));
  const todo: AgentTodo = {
    id: todoId,
    title,
    body: normalizeOptionalText(input.body),
    status: 'active',
    steps: todoSteps,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const nextState = { active_todo: cloneAgentTodo(todo), current_todo: cloneAgentTodo(todo) };
  return success(nextState, 'create', nextState, `Created agent todo: ${title}.`, true);
}

function completeStep(state: AgentTodoProjection, input: AgentTodoToolInput, deps: AgentTodoReducerDeps): AgentTodoReducerResult {
  if (!state.active_todo) return failure(state, 'complete_step', 'no_active_todo', 'No active todo exists.');
  const stepId = normalizeRequiredText(input.step_id);
  if (!stepId) return failure(state, 'complete_step', 'invalid_input', 'step_id is required for complete_step.');

  const todo = cloneAgentTodo(state.active_todo)!;
  const step = todo.steps.find((candidate) => candidate.id === stepId);
  if (!step) return failure(state, 'complete_step', 'step_not_found', `Step not found: ${stepId}`);

  step.status = 'completed';
  todo.updated_at = deps.now();
  const allCompleted = todo.steps.every((candidate) => candidate.status === 'completed');
  if (allCompleted) {
    todo.status = 'completed';
    todo.completed_at = todo.updated_at;
    const nextState = { active_todo: null, current_todo: todo };
    return success(nextState, 'complete_step', nextState, `Completed final step for ${todo.title}.`, true);
  }

  const nextState = { active_todo: cloneAgentTodo(todo), current_todo: cloneAgentTodo(todo) };
  return success(nextState, 'complete_step', nextState, `Completed step for ${todo.title}.`, true);
}

function completeAll(state: AgentTodoProjection, deps: AgentTodoReducerDeps): AgentTodoReducerResult {
  if (!state.active_todo) return failure(state, 'complete_all', 'no_active_todo', 'No active todo exists.');

  const todo = cloneAgentTodo(state.active_todo)!;
  let changed = 0;
  for (const step of todo.steps) {
    if (step.status !== 'completed') {
      step.status = 'completed';
      changed += 1;
    }
  }
  todo.updated_at = deps.now();
  todo.status = 'completed';
  todo.completed_at = todo.updated_at;
  const nextState = { active_todo: null, current_todo: todo };
  const text = changed > 0
    ? `Completed all remaining steps for ${todo.title}.`
    : `All steps were already complete for ${todo.title}.`;
  return success(nextState, 'complete_all', nextState, text, changed > 0);
}

function completeRange(state: AgentTodoProjection, input: AgentTodoToolInput, deps: AgentTodoReducerDeps): AgentTodoReducerResult {
  if (!state.active_todo) return failure(state, 'complete_range', 'no_active_todo', 'No active todo exists.');

  const todo = cloneAgentTodo(state.active_todo)!;
  const range = resolveStepRange(todo.steps, input);
  if (!range.ok) return failure(state, 'complete_range', 'invalid_input', range.message);

  let changed = 0;
  for (let index = range.start; index <= range.end; index += 1) {
    const step = todo.steps[index]!;
    if (step.status !== 'completed') {
      step.status = 'completed';
      changed += 1;
    }
  }

  todo.updated_at = deps.now();
  const allCompleted = todo.steps.every((candidate) => candidate.status === 'completed');
  if (allCompleted) {
    todo.status = 'completed';
    todo.completed_at = todo.updated_at;
    const nextState = { active_todo: null, current_todo: todo };
    return success(nextState, 'complete_range', nextState, `Completed steps ${range.start + 1}-${range.end + 1} and finished ${todo.title}.`, true);
  }

  const nextState = { active_todo: cloneAgentTodo(todo), current_todo: cloneAgentTodo(todo) };
  return success(nextState, 'complete_range', nextState, `Completed steps ${range.start + 1}-${range.end + 1} for ${todo.title}.`, changed > 0);
}

function reopenStep(state: AgentTodoProjection, input: AgentTodoToolInput, deps: AgentTodoReducerDeps): AgentTodoReducerResult {
  const stepId = normalizeRequiredText(input.step_id);
  if (!stepId) return failure(state, 'reopen_step', 'invalid_input', 'step_id is required for reopen_step.');
  if (!state.current_todo || state.current_todo.status === 'cleared') {
    return failure(state, 'reopen_step', 'no_active_todo', 'No current todo exists to reopen.');
  }

  const todo = cloneAgentTodo(state.current_todo)!;
  const step = todo.steps.find((candidate) => candidate.id === stepId);
  if (!step) return failure(state, 'reopen_step', 'step_not_found', `Step not found: ${stepId}`);

  step.status = 'open';
  todo.status = 'active';
  todo.updated_at = deps.now();
  delete todo.completed_at;
  delete todo.cleared_at;
  const nextState = { active_todo: cloneAgentTodo(todo), current_todo: cloneAgentTodo(todo) };
  return success(nextState, 'reopen_step', nextState, `Reopened step for ${todo.title}.`, true);
}

function clearTodo(state: AgentTodoProjection, deps: AgentTodoReducerDeps): AgentTodoReducerResult {
  if (!state.current_todo) {
    const emptyState = { active_todo: null, current_todo: null };
    return success(emptyState, 'clear', emptyState, 'No todo to clear.', false);
  }

  const todo = cloneAgentTodo(state.current_todo)!;
  todo.status = 'cleared';
  todo.updated_at = deps.now();
  todo.cleared_at = todo.updated_at;
  delete todo.completed_at;
  const nextState = { active_todo: null, current_todo: todo };
  return success(nextState, 'clear', nextState, `Cleared agent todo: ${todo.title}.`, true);
}

function resolveStepRange(steps: AgentTodoStep[], input: AgentTodoToolInput): { ok: true; start: number; end: number } | { ok: false; message: string } {
  if (typeof input.range === 'string' && input.range.trim()) {
    const match = input.range.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) return { ok: false, message: 'range must use the form "start-end", for example "2-4".' };
    const start = Number(match[1]) - 1;
    const end = Number(match[2]) - 1;
    return validateStepRange(steps, start, end);
  }

  const startStepId = normalizeRequiredText(input.start_step_id ?? input.step_id);
  const endStepId = normalizeRequiredText(input.end_step_id ?? input.step_id);
  if (!startStepId || !endStepId) {
    return { ok: false, message: 'complete_range requires range or start_step_id and end_step_id.' };
  }

  const start = steps.findIndex((candidate) => candidate.id === startStepId);
  const end = steps.findIndex((candidate) => candidate.id === endStepId);
  if (start === -1 || end === -1) return { ok: false, message: `Step range not found: ${startStepId}-${endStepId}` };
  return validateStepRange(steps, start, end);
}

function validateStepRange(steps: AgentTodoStep[], start: number, end: number): { ok: true; start: number; end: number } | { ok: false; message: string } {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0 || start >= steps.length || end >= steps.length) {
    return { ok: false, message: `range must be within 1-${steps.length}.` };
  }
  if (start > end) return { ok: false, message: 'range start must be before or equal to range end.' };
  return { ok: true, start, end };
}

function normalizeRequiredText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeSteps(steps: unknown, title: string): { ok: true; value: string[] } | { ok: false; message: string } {
  if (steps === undefined) return { ok: true, value: [title] };
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, message: 'steps must be a non-empty array when provided.' };
  }
  if (steps.length > 20) return { ok: false, message: 'steps cannot contain more than 20 items.' };

  const normalized: string[] = [];
  for (const step of steps) {
    if (typeof step !== 'string' || !step.trim()) {
      return { ok: false, message: 'steps must contain only non-empty strings.' };
    }
    normalized.push(step.trim());
  }
  return { ok: true, value: normalized };
}

function describeShowResult(state: AgentTodoProjection): string {
  const activeTodo = state.active_todo;
  if (!activeTodo) return 'No active agent todo.';

  const completedSteps = activeTodo.steps.filter((candidate) => candidate.status === 'completed').length;
  const lines = [
    `Active agent todo: ${activeTodo.title} (${completedSteps}/${activeTodo.steps.length} steps completed).`,
    ...activeTodo.steps.map((step, index) => `${step.status === 'completed' ? '[x]' : '[ ]'} ${index + 1}. ${step.text}`),
  ];
  return lines.join('\n');
}

function success(
  nextState: AgentTodoProjection,
  action: AgentTodoAction,
  detailsState: AgentTodoProjection,
  text: string,
  mutated: boolean,
): AgentTodoReducerResult {
  const normalizedState = normalizeProjection(nextState);
  return {
    content: [{ type: 'text', text }],
    details: buildAgentTodoDetails({ action, ok: true, state: detailsState }),
    nextState: normalizedState,
    mutated,
  };
}

function failure(
  nextState: AgentTodoProjection,
  action: AgentTodoAction,
  code: 'unsupported_action' | 'invalid_input' | 'active_todo_exists' | 'no_active_todo' | 'step_not_found',
  message: string,
  activeTodoId?: string,
): AgentTodoReducerResult {
  const normalizedState = normalizeProjection(nextState);
  return {
    content: [{ type: 'text', text: message }],
    details: buildAgentTodoDetails({
      action,
      ok: false,
      error: { code, message, active_todo_id: activeTodoId },
      state: normalizedState,
    }),
    isError: true,
    nextState: normalizedState,
    mutated: false,
  };
}
