import type { AgentTodo, AgentTodoProjection, AgentTodoStep } from './types.js';

export function renderAgentTodoStepLine(step: AgentTodoStep, index: number): string {
  return `${step.status === 'completed' ? '[x]' : '[ ]'} ${index + 1}. ${step.text}`;
}

export function renderAgentTodoWidgetLines(todo: AgentTodo): string[] {
  const completed = todo.steps.filter((step) => step.status === 'completed').length;
  const total = todo.steps.length;
  return [
    `Agent Todo: ${todo.title}`,
    `Progress: ${completed}/${total} steps completed`,
    ...todo.steps.map((step, index) => renderAgentTodoStepLine(step, index)),
  ];
}

export function syncAgentTodoWidget(ctx: any, projection: AgentTodoProjection): void {
  if (typeof ctx?.ui?.setWidget !== 'function') return;
  if (!projection.active_todo) {
    ctx.ui.setWidget('agent-todo', undefined);
    return;
  }
  ctx.ui.setWidget('agent-todo', renderAgentTodoWidgetLines(projection.active_todo));
}
