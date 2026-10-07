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

function formatRenderedModel(task?: SubagentTask): string {
  if (task?.model) return task.model;
  if (task?.status === 'queued' || task?.model_source === 'unresolved' || !task?.model) return 'pending';
  return 'default/current';
}

function createSubagentRunBoxedComponent(result: any, { expanded, isPartial }: any, theme: any, context?: any, task?: SubagentTask) {
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
  const renderedModel = formatRenderedModel(task);

  if (expanded === false) {
    const expandHint = resolveExpandHint('to expand', context);
    const metaLines = task
      ? [
        `subagent: ${themeAccent(theme, task.agent)} · model: ${renderedModel} · effort: ${themeAccent(theme, task.effort ?? 'default/current')} · status: ${status}`,
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
      themeDim(theme, `model: ${renderedModel}`),
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

export function renderSubagentRunResult(
  result: any,
  options: any,
  theme: any,
  context?: any,
  taskLookup?: (id: string, cwd?: string) => SubagentTask | undefined,
  managerOrEmitter?: { onTaskUpdate?: (listener: () => void) => () => void },
  pi?: any,
) {
  let cachedInnerComp: any = undefined;
  let cachedTaskSignature = '';

  const rawTask = taskFromDetails(result);
  const taskWorkspace = rawTask?.cwd ?? result?.details?.cwd ?? context?.cwd;

  const isTerminalStatus = (status?: string): boolean =>
    status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted';

  const getResolvedTask = (): SubagentTask | undefined => {
    if (!rawTask?.id || !taskLookup) return rawTask;
    const liveTask = taskLookup(rawTask.id, taskWorkspace);
    if (!liveTask) return rawTask;
    if (options?.isPartial) {
      return {
        ...rawTask,
        model: liveTask.model ?? rawTask.model,
        effort: liveTask.effort ?? rawTask.effort,
      };
    }
    return liveTask;
  };

  const buildComponent = () => {
    const task = getResolvedTask();
    const sig = `${task?.id}|${task?.status}|${task?.model}|${task?.effort}|${task?.attempt}|${Boolean(options?.expanded)}|${Boolean(options?.isPartial)}|${result?.details?.frame ?? 0}`;
    if (cachedInnerComp && cachedTaskSignature === sig) {
      return cachedInnerComp;
    }
    cachedTaskSignature = sig;
    cachedInnerComp = createSubagentRunBoxedComponent(result, options, theme, context, task);
    return cachedInnerComp;
  };

  const comp = {
    invalidate() {
      cachedInnerComp = undefined;
      cachedTaskSignature = '';
    },
    handleMouse(event: any) {
      return buildComponent().handleMouse(event);
    },
    render(width: number): string[] {
      return buildComponent().render(width);
    },
    dispose() {
      cleanup?.();
    },
  };

  let cleanup: (() => void) | undefined = undefined;

  const initialTask = rawTask?.id && taskLookup ? taskLookup(rawTask.id, taskWorkspace) : undefined;
  const shouldSubscribe = Boolean(
    managerOrEmitter
    && typeof managerOrEmitter.onTaskUpdate === 'function'
    && initialTask
    && !isTerminalStatus(initialTask.status),
  );

  if (shouldSubscribe) {
    if (context?.state && typeof context.state.cleanup === 'function') {
      try { context.state.cleanup(); } catch {}
      context.state.cleanup = undefined;
    }
    if (context?.lastComponent && typeof context.lastComponent.dispose === 'function') {
      try { context.lastComponent.dispose(); } catch {}
    }

    let cleanedUp = false;
    let unsubscribeListener: (() => void) | undefined;
    let unregisterShutdown: (() => void) | undefined;
    let abortListener: (() => void) | undefined;

    cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (context?.state?.cleanup === cleanup) {
        context.state.cleanup = undefined;
      }
      if (abortListener && context?.signal) {
        try { context.signal.removeEventListener('abort', abortListener); } catch {}
        abortListener = undefined;
      }
      if (typeof unregisterShutdown === 'function') {
        try { unregisterShutdown(); } catch {}
        unregisterShutdown = undefined;
      }
      if (typeof unsubscribeListener === 'function') {
        try { unsubscribeListener(); } catch {}
        unsubscribeListener = undefined;
      }
    };

    if (context?.state) {
      context.state.cleanup = cleanup;
    }

    if (context?.signal) {
      if (context.signal.aborted) {
        cleanup();
        return comp;
      }
      abortListener = () => { cleanup?.(); };
      try { context.signal.addEventListener('abort', abortListener, { once: true }); } catch {}
    }

    if (pi && typeof pi.on === 'function') {
      try {
        unregisterShutdown = pi.on('session_shutdown', () => {
          cleanup?.();
        });
      } catch {}
    }

    unsubscribeListener = managerOrEmitter!.onTaskUpdate!(() => {
      comp.invalidate();
      context?.requestRender?.();
      context?.ui?.requestRender?.();
      pi?.ui?.requestRender?.();
      const current = taskLookup ? taskLookup(rawTask!.id, taskWorkspace) : undefined;
      if (!current || isTerminalStatus(current.status)) {
        cleanup?.();
      }
    });
  }

  return comp;
}
