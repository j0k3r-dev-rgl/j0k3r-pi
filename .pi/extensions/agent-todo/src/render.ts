import type { AgentTodo, AgentTodoToolResult } from './types.js';
import { renderAgentTodoWidgetLines } from './widget.js';

function textComponent(text: string) {
  return {
    invalidate() {},
    render(width: number) {
      return text.split('\n').map((line) => line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line);
    },
  };
}

function progress(todo: AgentTodo): string {
  const completed = todo.steps.filter((step) => step.status === 'completed').length;
  return `${completed}/${todo.steps.length}`;
}

export function renderAgentTodoCall(args: any, theme: any) {
  const title = typeof args?.title === 'string' && args.title.trim() ? ` ${theme?.fg?.('accent', args.title.trim()) ?? args.title.trim()}` : '';
  const step = typeof args?.step_id === 'string' && args.step_id.trim() ? ` ${theme?.fg?.('dim', args.step_id.trim()) ?? args.step_id.trim()}` : '';
  const text = `${theme?.fg?.('toolTitle', theme?.bold?.('agent_todo') ?? 'agent_todo') ?? 'agent_todo'} ${theme?.fg?.('muted', args?.action ?? 'show') ?? (args?.action ?? 'show')}${title}${step}`;
  return textComponent(text);
}

export function renderAgentTodoResult(result: AgentTodoToolResult, _options: { isPartial?: boolean }, theme: any) {
  const details = result?.details?.agent_todo;
  if (!details) return textComponent(result?.content?.[0]?.text ?? 'agent todo');

  if (details.ok === false) {
    const base = theme?.fg?.('error', `Error: ${details.error?.message ?? 'agent todo failed'}`) ?? `Error: ${details.error?.message ?? 'agent todo failed'}`;
    const active = details.state.active_todo;
    return textComponent(active ? `${base}\n${renderAgentTodoWidgetLines(active).join('\n')}` : base);
  }

  const active = details.state.active_todo;
  if (active) {
    return textComponent(renderAgentTodoWidgetLines(active).join('\n'));
  }

  const current = details.state.current_todo;
  if (current?.status === 'completed') {
    return textComponent(`${theme?.fg?.('success', 'completed') ?? 'completed'} ${current.title} · ${progress(current)}`);
  }
  if (current?.status === 'cleared') {
    return textComponent(`${theme?.fg?.('dim', 'cleared') ?? 'cleared'} ${current.title}`);
  }

  return textComponent(result?.content?.[0]?.text ?? 'No active agent todo.');
}
