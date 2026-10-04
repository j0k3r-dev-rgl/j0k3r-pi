import { readSubagentsConfig } from '../config.js';
import type { SubagentTask } from '../types.js';
import { truncateToWidth } from '../completion-message.js';
import { resolveExpandHint } from './expansion-hint.js';

export const SUBAGENT_RESUME_GUIDANCE = [
  '## optional resume',
  'This task can be resumed with `subagent_continue` by sending a continuation prompt with the same `task_id`.',
  'Ask the user before resuming. The user may keep the currently configured model and effort or explicitly choose a different model, effort, or both for the next attempt.',
  "Do not resume or override the model or effort without the user's explicit decision. Never switch models automatically.",
].join('\n');

export function appendSubagentResumeGuidance(text: string, tasks: Array<Pick<SubagentTask, 'status'>>, cwd = process.cwd()): string {
  return readSubagentsConfig(cwd).enable_continue
    && tasks.some((task) => task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted' || task.status === 'stopping')
    ? `${text}\n\n${SUBAGENT_RESUME_GUIDANCE}`
    : text;
}

export function clip(text: string | undefined, limit = 240): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return truncateToWidth(normalized, limit, '…');
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsage(task: SubagentTask): string {
  const usage = task.usage;
  if (!usage) return '';
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? 's' : ''}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  return parts.join(' ');
}

export function modelEffortLine(task: SubagentTask): string {
  return [`model: ${task.model ?? 'default/current'}`, `effort: ${task.effort ?? 'default/current'}`].join(' · ');
}

export function formatTaskLabel(task: Pick<SubagentTask, 'agent' | 'display_name' | 'task'> | undefined): string {
  if (!task) return 'subagent';
  const displayName = task.display_name?.trim();
  if (displayName) return displayName;
  const taskSnippet = clip(task.task, 40);
  return taskSnippet ? `${task.agent} · ${taskSnippet}` : (task.agent || 'subagent');
}

export function hasAgentResponse(task?: Pick<SubagentTask, 'result'>, result?: any): boolean {
  if (typeof result?.details?.full_result === 'string' && result.details.full_result.trim().length > 0) {
    return true;
  }
  if (typeof task?.result === 'string' && task.result.trim().length > 0) {
    return true;
  }
  return false;
}

export function taskResponseText(task?: Pick<SubagentTask, 'result'>, result?: any): string {
  if (typeof result?.details?.full_result === 'string' && result.details.full_result.trim().length > 0) {
    return result.details.full_result;
  }
  if (typeof task?.result === 'string' && task.result.trim().length > 0) {
    return task.result;
  }
  return '';
}

export function formatTask(task: SubagentTask): string {
  const when = task.last_activity_at ?? task.started_at ?? task.created_at;
  const usage = formatUsage(task);
  const taskLabel = formatTaskLabel(task);
  const lines = [
    `task: ${taskLabel} · task_id: ${task.id} · status: ${task.status} · attempt: ${task.attempt ?? 1}`,
    task.effective_mode ? `effective mode: ${task.effective_mode}` : undefined,
    modelEffortLine(task),
    usage ? `usage: ${usage}` : undefined,
    task.status === 'queued' || task.status === 'running' || task.status === 'stopping'
      ? `pending messages: ${task.pending_message_count ?? 0}`
      : `undelivered messages: ${task.undelivered_message_count ?? 0}`,
    `last: ${task.last_activity ?? 'n/a'}${when ? ` at ${when}` : ''}`,
  ].filter(Boolean) as string[];
  const response = taskResponseText(task);
  if (response) {
    lines.push(`preview: ${clip(response)}`);
  } else if (task.error) {
    lines.push(`error: ${clip(task.error)}`);
  }
  return lines.join('\n');
}

function formatTaskListItem(task: SubagentTask): string {
  const when = task.last_activity_at ?? task.started_at ?? task.created_at;
  const usage = formatUsage(task);
  const taskLabel = formatTaskLabel(task);
  const hasResp = hasAgentResponse(task);
  const hasPreview = Boolean(task.output_preview || hasResp);
  const lines = [
    `subagent: ${task.agent} · task: ${taskLabel} · status: ${task.status} · attempt: ${task.attempt ?? 1}`,
    modelEffortLine(task),
    usage ? `usage: ${usage}` : undefined,
    `last: ${task.last_activity ?? 'n/a'}${when ? ` at ${when}` : ''}`,
    hasPreview ? `preview: collapsed · ${resolveExpandHint('to expand')}` : undefined,
    task.error ? `error: ${clip(task.error)}` : undefined,
  ].filter(Boolean) as string[];
  return lines.join('\n');
}

function formatTaskListRow(task: SubagentTask): string {
  return [
    `subagent: ${task.agent}`,
    `model: ${task.model ?? 'default/current'}`,
    `effort: ${task.effort ?? 'default/current'}`,
    `status: ${task.status}`,
  ].join(' · ');
}

export function formatTaskListSummary(tasks: SubagentTask[], context?: any): string {
  if (!tasks.length) return 'Listed 0 subagent task(s).';
  const mostRecent = tasks[0]!;
  return [
    `Listed ${tasks.length} subagent task(s).`,
    `Most recent: ${formatTaskLabel(mostRecent)} · task_id: ${mostRecent.id} · model: ${mostRecent.model ?? 'default/current'} · effort: ${mostRecent.effort ?? 'default/current'} · status: ${mostRecent.status}`,
    `List view: collapsed · ${resolveExpandHint('to expand', context)}`,
  ].join('\n');
}

export function formatTaskListRender(tasks: SubagentTask[], expanded: boolean, context?: any): string {
  if (!tasks.length) return 'Listed 0 subagent task(s).';
  if (expanded) return `Listed ${tasks.length} subagent task(s):\n\n${tasks.map(formatTaskListItem).join('\n\n')}`;
  const mostRecent = tasks[0]!;
  const recentLabel = formatTaskLabel(mostRecent);
  return [
    `most recent: ${recentLabel} · status: ${mostRecent.status}`,
    resolveExpandHint('to expand', context),
  ].join('\n');
}

export function collapsedResultHint(_task: SubagentTask | undefined, _failed: boolean, context?: any): string {
  return resolveExpandHint('to expand', context);
}

export function taskFinalText(task: SubagentTask | undefined, result?: any): string {
  return taskResponseText(task, result);
}

export function formatTaskModeContent(tasks: SubagentTask[], cwd = process.cwd()): string {
  const content = [
    `Completed ${tasks.length} subagent task(s):`,
    ...tasks.map((task) => {
      const responseText = taskResponseText(task);
      return [
        formatTask(task),
        responseText ? `\n# response from ${formatTaskLabel(task)}\n${responseText}` : undefined,
      ].filter(Boolean).join('\n');
    }),
  ].join('\n\n');
  return appendSubagentResumeGuidance(content, tasks, cwd);
}

export function backgroundLaunchContent(tasksOrIds: Array<SubagentTask | string>, verb = 'Sent'): string {
  const lines = tasksOrIds.map((item) => {
    if (typeof item === 'object' && item !== null) {
      return `- ${formatTaskLabel(item)} · task_id: ${item.id}`;
    }
    const raw = String(item);
    const match = raw.match(/^subtask_([^_]+)_/);
    const label = match ? match[1] : raw;
    return `- ${label} · task_id: ${raw}`;
  });
  return [
    `${verb} ${tasksOrIds.length} subagent task(s) to background:`,
    ...lines,
    '',
    'Background behavior:',
    '- Do not call subagent_status or subagent_result just to wait.',
    '- The subagent will notify this chat automatically when it finishes.',
    '- Keep the chat available so the user can continue asking questions while it runs.',
  ].join('\n');
}
