import { describe, expect, it } from 'vitest';

import { AGENT_TODO_ERROR_CODES, AGENT_TODO_VERSION, type AgentTodoToolInput } from '../src/types.js';
import { applyAgentTodoAction } from '../src/reducer.js';

function deps() {
  const ids = ['todo-1', 'step-1', 'step-2', 'todo-2', 'step-3'];
  let index = 0;
  return {
    now: () => '2026-06-10T00:00:00.000Z',
    idGenerator: () => ids[index++] ?? `generated-${index}`,
  };
}

function create(input: AgentTodoToolInput = { action: 'create', title: 'Ship feature', steps: ['Write tests', 'Implement'] }) {
  return applyAgentTodoAction({ active_todo: null, current_todo: null }, input, deps());
}

describe('applyAgentTodoAction', () => {
  it('exposes the version 1 details contract and supported error codes', () => {
    expect(AGENT_TODO_VERSION).toBe(1);
    expect(AGENT_TODO_ERROR_CODES).toEqual([
      'unsupported_action',
      'invalid_input',
      'active_todo_exists',
      'no_active_todo',
      'step_not_found',
    ]);

    const result = create();
    expect(result.details.agent_todo.version).toBe(1);
    expect(result.details.agent_todo.ok).toBe(true);
    expect(result.details.agent_todo.state.active_todo?.id).toBe('todo-1');
    expect(result.details.agent_todo.state.current_todo?.steps.map((step) => step.id)).toEqual(['step-1', 'step-2']);
    expect(result.details.agent_todo.state.current_todo?.created_at).toBe('2026-06-10T00:00:00.000Z');
    expect(result.details.agent_todo.state.current_todo?.updated_at).toBe('2026-06-10T00:00:00.000Z');
  });

  it('creates an active todo with explicit steps', () => {
    const result = create();

    expect(result.isError).toBeUndefined();
    expect(result.nextState.active_todo?.title).toBe('Ship feature');
    expect(result.nextState.active_todo?.steps).toEqual([
      { id: 'step-1', text: 'Write tests', status: 'open' },
      { id: 'step-2', text: 'Implement', status: 'open' },
    ]);
  });

  it('creates a default step from the title when steps are omitted', () => {
    const result = create({ action: 'create', title: 'Investigate failing test' });

    expect(result.nextState.active_todo?.steps).toEqual([
      { id: 'step-1', text: 'Investigate failing test', status: 'open' },
    ]);
  });

  it('rejects invalid create input and more than 20 steps', () => {
    const blankTitle = create({ action: 'create', title: '   ' });
    expect(blankTitle.isError).toBe(true);
    expect(blankTitle.details.agent_todo.error?.code).toBe('invalid_input');
    expect(blankTitle.nextState.active_todo).toBeNull();

    const blankBody = create({ action: 'create', title: 'Ship feature', body: '   ' });
    expect(blankBody.isError).toBe(true);
    expect(blankBody.details.agent_todo.error?.code).toBe('invalid_input');

    const tooManySteps = create({
      action: 'create',
      title: 'Ship feature',
      steps: Array.from({ length: 21 }, (_, index) => `Step ${index + 1}`),
    });
    expect(tooManySteps.isError).toBe(true);
    expect(tooManySteps.details.agent_todo.error?.code).toBe('invalid_input');
  });

  it('returns unsupported_action without mutating state and keeps details action schema-compatible', () => {
    const initial = create();
    const snapshot = JSON.parse(JSON.stringify(initial.nextState));

    const result = applyAgentTodoAction(initial.nextState, { action: 'archive' }, deps());

    expect(result.isError).toBe(true);
    expect(result.details.agent_todo.action).toBe('show');
    expect(result.details.agent_todo.error?.code).toBe('unsupported_action');
    expect(result.details.agent_todo.error?.message).toContain('archive');
    expect(result.nextState).toEqual(snapshot);
    expect(initial.nextState).toEqual(snapshot);
  });

  it('shows the current projected state without mutating it and reports visible step ids in text output', () => {
    const initial = create();

    const result = applyAgentTodoAction(initial.nextState, { action: 'show' }, deps());

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Ship feature');
    expect(result.content[0]?.text).toContain('0/2');
    expect(result.content[0]?.text).toContain('[ ] 1. Write tests');
    expect(result.content[0]?.text).toContain('[ ] 2. Implement');
    expect(result.nextState).toEqual(initial.nextState);
    expect(result.details.agent_todo.state.active_todo?.title).toBe('Ship feature');
  });

  it('completes and reopens steps, auto-completing the todo when the last step closes', () => {
    const initial = create();

    const oneStepDone = applyAgentTodoAction(initial.nextState, { action: 'complete_step', step_id: 'step-1' }, deps());
    expect(oneStepDone.nextState.active_todo?.steps[0]?.status).toBe('completed');
    expect(oneStepDone.nextState.active_todo?.status).toBe('active');

    const fullyDone = applyAgentTodoAction(oneStepDone.nextState, { action: 'complete_step', step_id: 'step-2' }, deps());
    expect(fullyDone.nextState.active_todo).toBeNull();
    expect(fullyDone.nextState.current_todo?.status).toBe('completed');
    expect(fullyDone.nextState.current_todo?.completed_at).toBe('2026-06-10T00:00:00.000Z');

    const reopened = applyAgentTodoAction(fullyDone.nextState, { action: 'reopen_step', step_id: 'step-2' }, deps());
    expect(reopened.nextState.active_todo?.status).toBe('active');
    expect(reopened.nextState.current_todo?.steps[1]?.status).toBe('open');
  });

  it('fails loudly for missing or unknown step ids without mutating state', () => {
    const initial = create();
    const snapshot = JSON.parse(JSON.stringify(initial.nextState));

    const missing = applyAgentTodoAction(initial.nextState, { action: 'complete_step' }, deps());
    expect(missing.isError).toBe(true);
    expect(missing.details.agent_todo.error?.code).toBe('invalid_input');
    expect(missing.nextState).toEqual(snapshot);

    const unknown = applyAgentTodoAction(initial.nextState, { action: 'complete_step', step_id: 'missing' }, deps());
    expect(unknown.isError).toBe(true);
    expect(unknown.details.agent_todo.error?.code).toBe('step_not_found');
    expect(unknown.nextState).toEqual(snapshot);
  });

  it('clears the current todo and allows future create actions', () => {
    const initial = create();
    const cleared = applyAgentTodoAction(initial.nextState, { action: 'clear' }, deps());

    expect(cleared.nextState.active_todo).toBeNull();
    expect(cleared.nextState.current_todo?.status).toBe('cleared');
    expect(cleared.nextState.current_todo?.cleared_at).toBe('2026-06-10T00:00:00.000Z');

    const recreated = applyAgentTodoAction(cleared.nextState, { action: 'create', title: 'Next task' }, deps());
    expect(recreated.isError).toBeUndefined();
    expect(recreated.nextState.active_todo?.title).toBe('Next task');
  });

  it('enforces a single active todo until completion or clear', () => {
    const initial = create();
    const snapshot = JSON.parse(JSON.stringify(initial.nextState));

    const secondCreate = applyAgentTodoAction(initial.nextState, { action: 'create', title: 'Second task' }, deps());
    expect(secondCreate.isError).toBe(true);
    expect(secondCreate.details.agent_todo.error?.code).toBe('active_todo_exists');
    expect(secondCreate.details.agent_todo.error?.active_todo_id).toBe('todo-1');
    expect(secondCreate.nextState).toEqual(snapshot);
  });

  it('includes immutable agent_todo details snapshots on success and failure', () => {
    const created = create();
    created.details.agent_todo.state.current_todo!.title = 'Mutated';
    created.details.agent_todo.state.current_todo!.steps[0]!.text = 'Mutated step';

    expect(created.nextState.current_todo?.title).toBe('Ship feature');
    expect(created.nextState.current_todo?.steps[0]?.text).toBe('Write tests');

    const failed = applyAgentTodoAction(created.nextState, { action: 'create', title: 'Blocked' }, deps());
    expect(failed.isError).toBe(true);
    expect(failed.details.agent_todo.ok).toBe(false);
    expect(failed.details.agent_todo.state.active_todo?.title).toBe('Ship feature');
  });
});
