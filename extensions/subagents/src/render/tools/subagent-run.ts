import { loadSubagents, readSubagentsConfig, resolveEffectiveSubagentMode } from '../config.js';
import type { SubagentMode, SubagentTask } from '../types.js';
import { boxedComponent, emptyComponent, textComponent } from './components.js';
import { collapsedResultHint, formatTaskLabel, formatUsage, hasAgentResponse, taskFinalText, taskResponseText } from './formatting.js';
import { resolveExpandHint } from './expansion-hint.js';
import { progressText } from './progress.js';
import { taskFromDetails } from '../result-details.js';
import { ARCH_ICON, themeAccent, themeBold, themeDim, themeError, themeStatus, themeSuccess, themeTitle, themeWarning } from '../completion-message.js';
import { openSubagentsPanel } from '../panel-opener.js';

export function renderSubagentTaskCall(_agent?: string, _mode?: 'task' | 'background', _theme?: any, _detail?: string) {
  return emptyComponent();
}

function resolveRenderedSubagentRunMode(args: any, cwd: string): SubagentMode {
  if (args.mode === 'task' || args.mode === 'background') return args.mode;
  const config = readSubagentsConfig(cwd);
  const definitions = new Map(loadSubagents(cwd).map((definition) => [definition.name, definition]));
  return resolveEffectiveSubagentMode({
    invocationMode: args.mode,
    definition: args.agent ? definitions.get(String(args.agent).toLowerCase()) : undefined,
    config,
  });
}

export function renderSubagentRunCall(_args: any, _theme: any) {
  return emptyComponent();
}

export function renderSubagentRunResult(result: any, { expanded, isPartial }: any, theme: any, context?: any) {
  const task = taskFromDetails(result);
  const archPrefix = themeAccent(theme, ARCH_ICON);
  const isBg = task?.mode === 'background' || task?.effective_mode === 'background' || result?.details?.mode === 'background';
  const bgSuffix = isBg ? ' (background)' : '';

  if (isPartial) {
    const frame = result?.details?.frame ?? 0;
    const raw = task
      ? progressText([task], frame, { backgroundable: Boolean(result?.details?.backgroundable), backgroundShortcut: result?.details?.backgroundShortcut })
      : progressText([], frame, { backgroundable: Boolean(result?.details?.backgroundable), backgroundShortcut: result?.details?.backgroundShortcut });
    const lines = raw.split('\n');
    const activityCount = task?.live_activity?.trail?.length ?? 0;
    const activityStartIndex = 2;
    const currentActivityIndex = activityCount ? activityStartIndex + activityCount - 1 : -1;
    const styled = lines.map((line: string, index: number) => {
      if (index === 0) return themeWarning(theme, line);
      if (index === currentActivityIndex) return themeBold(theme, themeAccent(theme, line));
      return themeDim(theme, line);
    }).filter(Boolean) as string[];
    const agentOrName = task?.display_name || task?.agent || 'subagent';
    const title = `${archPrefix} ${themeTitle(theme, `subagent · ${agentOrName} · running${bgSuffix}`)}`;
    return boxedComponent(styled, {
      title,
      theme,
      wrapped: true,
      onClick: task?.id ? () => openSubagentsPanel(task.id) : undefined,
    });
  }
  const failed = Boolean(result?.isError || task?.status === 'failed' || task?.status === 'cancelled');
  const isRunning = task?.status === 'running' || task?.status === 'queued';
  const status = task ? themeStatus(theme, task.status ?? (failed ? 'failed' : 'done')) : (failed ? themeError(theme, 'failed') : themeSuccess(theme, 'done'));
  const taskLabel = formatTaskLabel(task);
  const hasResp = hasAgentResponse(task, result);
  const responseText = taskResponseText(task, result);

  let title: string;
  if (isRunning) {
    const agentOrName = task?.display_name || task?.agent || 'subagent';
    title = `${archPrefix} ${themeTitle(theme, `subagent · ${agentOrName} · ${task?.status ?? 'running'}${bgSuffix}`)}`;
  } else if (hasResp) {
    title = `${archPrefix} ${themeTitle(theme, `subagent result · ${taskLabel}`)}`;
  } else {
    title = `${archPrefix} ${themeTitle(theme, `subagent · ${taskLabel}`)}`;
  }

  const historyShortcut = readSubagentsConfig(process.cwd()).history_panel_shortcut ?? 'ctrl+,';
  const detailsHint = `(click to view execution) · (${historyShortcut} or /subagents for details)`;
  const usage = task ? formatUsage(task as SubagentTask) : '';

  if (expanded === false) {
    const expandHint = resolveExpandHint('to expand', context);
    const metaLines = task
      ? [
        `subagent: ${themeAccent(theme, task.agent)} · model: ${task.model ?? 'default/current'} · effort: ${themeAccent(theme, task.effort ?? 'default/current')} · status: ${status}`,
        usage ? themeDim(theme, `usage: ${usage}`) : undefined,
        themeDim(theme, `${detailsHint} · ${expandHint}`),
      ].filter(Boolean) as string[]
      : [status, themeDim(theme, `${detailsHint} · ${expandHint}`)];
    return boxedComponent(metaLines, {
      title,
      theme,
      wrapped: true,
      onClick: task?.id ? () => openSubagentsPanel(task.id) : undefined,
    });
  }

  const metaLines = task
    ? [
      `subagent: ${themeAccent(theme, task.agent)} · status: ${status} · attempt: ${themeAccent(theme, String(task.attempt ?? 1))} · effort: ${themeAccent(theme, task.effort ?? 'default/current')}`,
      themeDim(theme, `model: ${task.model ?? 'default/current'}`),
      usage ? themeDim(theme, `usage: ${usage}`) : undefined,
      themeDim(theme, detailsHint),
    ].filter(Boolean) as string[]
    : [status, themeDim(theme, detailsHint)];
  const contentLines = [...metaLines];
  if (hasResp && responseText) {
    contentLines.push(themeTitle(theme, 'Subagent response'), ...responseText.split('\n'));
  } else if (failed && task?.error) {
    contentLines.push(themeError(theme, 'Subagent error'), ...task.error.split('\n'));
  }
  return boxedComponent(contentLines, {
    title,
    theme,
    wrapped: true,
    onClick: task?.id ? () => openSubagentsPanel(task.id) : undefined,
  });
}
