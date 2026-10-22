import { readSubagentsConfig } from '../config.js';
import type { SubagentTask } from '../types.js';
import { truncateToWidth } from '../completion-message.js';

export const SUBAGENT_RESUME_GUIDANCE = [
  'Model and effort are resolved automatically for each attempt by the configured allocator or orchestrator fallback, with definition effort taking precedence.',
  'Do not ask the user to select model or effort, promise the same selection, or pass unsupported model/effort parameters.',
  'Preserve partial work and the approved scope. Do not start a new task to reset the retry limit.',
].join('\n');

export function appendSubagentResumeGuidance(text: string, tasks: Array<Pick<SubagentTask, 'status'> & Partial<Pick<SubagentTask, 'id' | 'attempt'>>>, cwd = process.cwd()): string {
  if (!readSubagentsConfig(cwd).enable_continue) return text;
  const guidance = tasks.flatMap((task) => {
    if (!['failed', 'cancelled', 'interrupted', 'stopping'].includes(task.status)) return [];
    const attempt = task.attempt ?? 1;
    const identity = `task_id: ${task.id ?? 'see task result'} · attempt: ${attempt}`;
    const instruction = task.status !== 'failed'
      ? 'Do not automatically resume a cancelled, interrupted, or stopping task. Ask the user before resuming.'
      : attempt >= 2
        ? 'Stop and inform the user that the retry failed, including the error and any partial work. Do not retry again without explicit user approval.'
        : 'Automatically retry this task once without asking the user, using `subagent_run` with `action: "continue"`, instructions in `task`, and the same `task_id`. If continuation is unavailable or unsafe, stop and inform the user instead.';
    return [`${identity}\n${instruction}`];
  });
  return guidance.length ? `${text}\n\n## recovery\n${guidance.join('\n\n')}\n\n${SUBAGENT_RESUME_GUIDANCE}` : text;
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

export function formatTaskModeContent(tasks: SubagentTask[], cwd = process.cwd()): string {
  const content = [
    `Completed ${tasks.length} subagent task(s):`,
    ...tasks.map((task) => {
      const responseText = taskResponseText(task);
      return [
        formatTask(task),
        responseText ? `\n# response from ${formatTaskLabel(task)}\n${responseText}` : undefined,
        task.error ? `\n# error from ${formatTaskLabel(task)}\n${task.error}` : undefined,
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
    '- Do not sleep or poll just to wait for this task.',
    '- The subagent will notify this chat automatically when it finishes.',
    '- Keep the chat available so the user can continue asking questions while it runs.',
  ].join('\n');
}
