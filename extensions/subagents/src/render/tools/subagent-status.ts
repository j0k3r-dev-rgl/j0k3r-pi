import type { SubagentTask } from '../types.js';
import { boxedComponent, emptyComponent } from './components.js';
import { clip, formatTaskLabel, formatUsage, hasAgentResponse, modelEffortLine, taskResponseText } from './formatting.js';
import { resolveExpandHint } from './expansion-hint.js';
import { taskFromDetails } from '../result-details.js';
import { ARCH_ICON, CYAN, themeAccent, themeDim, themeError, themeFg, themeStatus, themeTitle } from '../completion-message.js';
import { openSubagentsPanel } from '../panel-opener.js';

export function renderSubagentStatusCall(_args?: any, _theme?: any) {
  return emptyComponent();
}

export function renderSubagentStatusResult(result: any, options: any, theme: any, context?: any) {
  const expanded = Boolean(typeof options === 'object' && options !== null ? options.expanded : options);
  const task = taskFromDetails(result);
  const failed = Boolean(result?.isError || task?.status === 'failed' || task?.status === 'cancelled');
  const archPrefix = themeFg(theme, 'accent', ARCH_ICON, CYAN);

  if (!task) {
    const title = `${archPrefix} ${themeTitle(theme, failed ? 'subagent status · failed' : 'subagent status')}`;
    const text = result?.content?.[0]?.text ?? (failed ? 'Subagent task not found' : '');
    return boxedComponent([failed ? themeError(theme, text) : themeDim(theme, text)], {
      title,
      theme,
      wrapped: true,
    });
  }

  const taskLabel = formatTaskLabel(task);
  const statusText = task.status ?? (failed ? 'failed' : 'unknown');
  const status = failed ? themeError(theme, statusText) : themeStatus(theme, statusText);
  const isBg = task.mode === 'background' || task.effective_mode === 'background' || result?.details?.mode === 'background';
  const bgSuffix = isBg ? ' (background)' : '';
  const title = `${archPrefix} ${themeTitle(theme, `subagent status · ${taskLabel} · ${statusText}${bgSuffix}`)}`;

  if (!expanded) {
    const metaLine = `subagent: ${themeAccent(theme, task.agent)} · model: ${task.model ?? 'default/current'} · effort: ${themeAccent(theme, task.effort ?? 'default/current')} · status: ${status}`;
    const lines = [
      metaLine,
      themeDim(theme, resolveExpandHint('to expand', context)),
    ];
    return boxedComponent(lines, {
      title,
      theme,
      wrapped: true,
    });
  }

  const usage = formatUsage(task as SubagentTask);
  const when = task.last_activity_at ?? task.started_at ?? task.created_at;
  const metaLines = [
    `subagent: ${themeAccent(theme, task.agent)} · status: ${status} · attempt: ${themeAccent(theme, String(task.attempt ?? 1))} · effort: ${themeAccent(theme, task.effort ?? 'default/current')}`,
    themeDim(theme, `model: ${task.model ?? 'default/current'}`),
    usage ? themeDim(theme, `usage: ${usage}`) : undefined,
    task.pending_message_count ? themeDim(theme, `pending messages: ${task.pending_message_count}`) : undefined,
    task.undelivered_message_count ? themeDim(theme, `undelivered messages: ${task.undelivered_message_count}`) : undefined,
    task.last_activity ? themeDim(theme, `last: ${task.last_activity}${when ? ` at ${when}` : ''}`) : undefined,
  ].filter(Boolean) as string[];

  const contentLines = [...metaLines];
  const hasResp = hasAgentResponse(task, result);
  const responseText = taskResponseText(task, result);

  if (hasResp && responseText) {
    contentLines.push(themeTitle(theme, 'Subagent response'), ...responseText.split('\n'));
  } else if (failed && task.error) {
    contentLines.push(themeError(theme, 'Subagent error'), ...task.error.split('\n'));
  } else if (task.output_preview) {
    contentLines.push(themeDim(theme, `preview: ${clip(task.output_preview)}`));
  }

  return boxedComponent(contentLines, {
    title,
    theme,
    wrapped: true,
    onClick: task?.id ? () => openSubagentsPanel(task.id) : undefined,
  });
}
