import { boxedComponent } from './components.js';
import { formatTaskLabel, formatUsage, hasAgentResponse, modelEffortLine, taskResponseText } from './formatting.js';
import { resolveExpandHint } from './expansion-hint.js';
import { taskFromDetails } from '../result-details.js';
import { ARCH_ICON, CYAN, themeFg } from '../completion-message.js';
import { openSubagentsPanel } from '../panel-opener.js';

export function renderSubagentResult(result: any, { expanded }: any, theme: any, context?: any) {
  const task = taskFromDetails(result);
  const failed = Boolean(result?.isError || task?.status === 'failed' || task?.status === 'cancelled');
  const isRunning = task?.status === 'running' || task?.status === 'queued';
  const hasResp = hasAgentResponse(task, result);
  const responseText = taskResponseText(task, result);
  const archPrefix = themeFg(theme, 'accent', ARCH_ICON, CYAN);

  if (!task) {
    const text = theme.fg?.(failed ? 'error' : 'dim', result?.content?.[0]?.text ?? '') ?? (result?.content?.[0]?.text ?? '');
    const titleText = hasResp ? 'Subagent result' : 'Subagent';
    const title = `${archPrefix} ${(theme.fg?.('toolTitle', titleText) ?? titleText)}`;
    return boxedComponent([text], {
      title,
      theme,
      wrapped: true,
    });
  }

  const status = failed ? (theme.fg?.('error', task.status) ?? task.status) : (theme.fg?.('success', task.status) ?? task.status);
  const taskLabel = formatTaskLabel(task);
  const isBg = task.mode === 'background' || task.effective_mode === 'background' || result?.details?.mode === 'background';
  const bgSuffix = isBg ? ' (background)' : '';
  let title: string;
  if (isRunning) {
    const agentOrName = task.display_name || task.agent || 'subagent';
    title = `${archPrefix} ${(theme.fg?.('toolTitle', `Subagent · ${agentOrName} · ${task.status}${bgSuffix}`) ?? `Subagent · ${agentOrName} · ${task.status}${bgSuffix}`)}`;
  } else if (hasResp) {
    title = `${archPrefix} ${(theme.fg?.('toolTitle', `Subagent result · ${taskLabel}`) ?? `Subagent result · ${taskLabel}`)}`;
  } else {
    title = `${archPrefix} ${(theme.fg?.('toolTitle', `Subagent · ${taskLabel}`) ?? `Subagent · ${taskLabel}`)}`;
  }

  if (!expanded) {
    const metaLine = `subagent: ${theme.fg?.('accent', task.agent) ?? task.agent} · model: ${task.model ?? 'default/current'} · effort: ${task.effort ?? 'default/current'} · status: ${status}`;
    const lines = [
      metaLine,
      theme.fg?.('dim', resolveExpandHint('to expand', context)) ?? resolveExpandHint('to expand', context),
    ];
    return boxedComponent(lines, {
      title,
      theme,
      wrapped: true,
    });
  }

  const usage = formatUsage(task);
  const summaryLines = [
    `subagent: ${theme.fg?.('accent', task.agent) ?? task.agent} · status: ${status} · attempt: ${task.attempt ?? 1}`,
    theme.fg?.('dim', modelEffortLine(task)) ?? modelEffortLine(task),
    usage ? (theme.fg?.('dim', `usage: ${usage}`) ?? `usage: ${usage}`) : undefined,
    task.undelivered_message_count ? (theme.fg?.('dim', `undelivered messages: ${task.undelivered_message_count}`) ?? `undelivered messages: ${task.undelivered_message_count}`) : undefined,
  ].filter(Boolean) as string[];

  const contentLines = [...summaryLines];
  if (hasResp && responseText) {
    contentLines.push(theme.fg?.('toolTitle', 'Subagent response') ?? 'Subagent response', ...responseText.split('\n'));
  } else if (failed && task.error) {
    contentLines.push(theme.fg?.('error', 'Subagent error') ?? 'Subagent error', ...task.error.split('\n'));
  }

  return boxedComponent(contentLines, {
    title,
    theme,
    wrapped: true,
    onClick: task?.id ? () => openSubagentsPanel(task.id) : undefined,
  });
}
