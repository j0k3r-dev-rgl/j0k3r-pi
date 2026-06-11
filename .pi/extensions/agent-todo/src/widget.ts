import type { AgentTodo, AgentTodoProjection, AgentTodoStep } from './types.js';

export type AgentTodoWidgetOptions = {
  collapsed?: boolean;
  shortcut?: string;
};

function dim(text: string): string {
  return `\u001b[2m${text}\u001b[22m`;
}

function progress(todo: AgentTodo): { completed: number; total: number; open: number } {
  const completed = todo.steps.filter((step) => step.status === 'completed').length;
  const total = todo.steps.length;
  return { completed, total, open: total - completed };
}

export function renderAgentTodoStepLine(step: AgentTodoStep, index: number): string {
  return `${step.status === 'completed' ? '[x]' : '[ ]'} ${index + 1}. ${step.text}`;
}

export function renderAgentTodoWidgetLines(todo: AgentTodo, options: AgentTodoWidgetOptions = {}): string[] {
  const { completed, total, open } = progress(todo);
  const shortcut = options.shortcut?.trim();
  if (options.collapsed) {
    return [
      `Agent Todo: ${todo.title} · ${completed}/${total} complete · ${open} open`,
      shortcut ? dim(`${shortcut} to expand`) : dim('expand to show steps'),
    ];
  }

  const lines = [
    `Agent Todo: ${todo.title}`,
    `Progress: ${completed}/${total} steps completed`,
    ...todo.steps.map((step, index) => renderAgentTodoStepLine(step, index)),
  ];
  if (shortcut) lines.push(dim(`${shortcut} to collapse`));
  return lines;
}

export function syncAgentTodoWidget(ctx: any, projection: AgentTodoProjection, options: AgentTodoWidgetOptions = {}): void {
  if (typeof ctx?.ui?.setWidget !== 'function') return;
  if (!projection.active_todo) {
    ctx.ui.setWidget('agent-todo', undefined);
    return;
  }
  ctx.ui.setWidget('agent-todo', renderAgentTodoWidgetLines(projection.active_todo, options));
}
