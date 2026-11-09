import { Text } from '@earendil-works/pi-tui';
import { formatTaskLabel } from './tools/formatting.js';
import type { SubagentTask } from '../types.js';

export function sendSubagentReportMessage(pi: any, task: SubagentTask, report: string): void {
  if (typeof pi.sendMessage !== 'function') throw new Error('Parent report delivery is unavailable.');
  pi.sendMessage({
    customType: 'subagent-report',
    content: [
      `Subagent ${formatTaskLabel(task)} · informational progress report`,
      `task_id: ${task.id} · attempt: ${task.attempt ?? 1}`,
      `model: ${task.model ?? 'unresolved'} · effort: ${task.effort ?? 'unresolved'}`,
      '',
      report,
      '',
      'The subagent continues working in the same attempt. No answer is required. This report is not completion, acceptance, approval, or a request to advance a workflow phase.',
    ].join('\n'),
    display: true,
    details: { task_id: task.id, agent: task.agent, attempt: task.attempt ?? 1, informational: true },
  }, { triggerTurn: true, deliverAs: 'steer' });
}

export function renderSubagentReportMessage(message: any, options: any, theme: any) {
  const content = typeof message.content === 'string' ? message.content : 'No report content.';
  if (options?.expanded) return new Text(content, 0, 0);
  return new Text(theme.fg('accent', `Subagent ${message.details?.agent ?? 'unknown'} · progress report · continuing`)
    + ` (${options.keyHint('app.tools.expand', 'to expand')})`, 0, 0);
}
