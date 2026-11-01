import { readSubagentsConfig } from '../config.js';
import type { SubagentTask } from '../types.js';
import { boxedComponent, emptyComponent } from './components.js';
import { clip, formatTaskLabel, formatUsage, hasAgentResponse, taskResponseText } from './formatting.js';
import { resolveExpandHint } from './expansion-hint.js';
import { progressText } from './progress.js';
import { taskFromDetails } from '../result-details.js';
import { ARCH_ICON, themeAccent, themeBold, themeDim, themeError, themeStatus, themeSuccess, themeTitle, themeWarning } from '../completion-message.js';
import { openSubagentsPanel } from '../panel-opener.js';

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
  if (result?.details?.action === 'message') {
    const details = result.details;
    const status = details.status ?? (result.isError ? 'rejected' : 'queued');
    const acknowledgement = result.content?.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n') ?? details.message ?? '';
    const lines = [
      `status: ${status === 'rejected' ? themeError(theme, status) : themeSuccess(theme, status)}`,
      details.pending_message_count !== undefined ? `pending messages: ${details.pending_message_count}` : undefined,
      expanded !== false && details.reason ? `reason: ${details.reason}` : undefined,
      expanded === false && status === 'rejected' ? clip(acknowledgement, 160) : undefined,
      expanded === false ? resolveExpandHint('to expand', context) : acknowledgement,
    ].filter(Boolean) as string[];
    return boxedComponent(lines, {
      title: `${archPrefix} ${themeTitle(theme, `subagent message · ${formatTaskLabel(task)} · ${status}`)}`,
      theme, wrapped: true,
      onClick: task?.id ? () => openSubagentsPanel(task.id) : undefined,
    });
  }
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
  const failed = Boolean(result?.isError || task?.status === 'failed' || task?.status === 'cancelled' || task?.status === 'interrupted');
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

  const historyShortcut = readSubagentsConfig(task?.cwd ?? result?.details?.cwd ?? context?.cwd ?? process.cwd()).history_panel_shortcut ?? 'ctrl+,';
  const detailsHint = `(click to view execution) · (${historyShortcut} or /subagents for details)`;
  const usage = task ? formatUsage(task as SubagentTask) : '';
  const renderedModel = formatRenderedModel(task);

  if (expanded === false) {
    const expandHint = resolveExpandHint('to expand', context);
    const metaLines = task
      ? [
        `subagent: ${themeAccent(theme, task.agent)} · model: ${renderedModel} · effort: ${themeAccent(theme, task.effort ?? 'default/current')} · status: ${status}${(task.attempt ?? 1) > 1 ? ` · attempt: ${task.attempt}` : ''}`,
        usage ? themeDim(theme, `usage: ${usage}`) : undefined,
        themeDim(theme, `${detailsHint} · ${expandHint}`),
      ].filter(Boolean) as string[]
      : [status, ...(failed ? (result?.content ?? []).filter((part: any) => part.type === 'text').map((part: any) => clip(part.text, 240)) : []), themeDim(theme, `${detailsHint} · ${expandHint}`)];
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
  } else if (failed) {
    const errorText = task?.error ?? (result?.content ?? []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n');
    contentLines.push(themeError(theme, 'Subagent error'), ...errorText.split('\n'));
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
    if (result?.details?.action === 'message' || !rawTask?.id || !taskLookup) return rawTask;
    const liveTask = taskLookup(rawTask.id, taskWorkspace);
    if (!liveTask || (rawTask.attempt ?? 1) !== (liveTask.attempt ?? 1)) return rawTask;
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
    result?.details?.action !== 'message'
    && managerOrEmitter
    && typeof managerOrEmitter.onTaskUpdate === 'function'
    && initialTask
    && (rawTask?.attempt ?? 1) === (initialTask.attempt ?? 1)
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
      if (renderThrottleTimer) {
        clearTimeout(renderThrottleTimer);
        renderThrottleTimer = undefined;
      }
      pendingRender = false;
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

    let renderThrottleTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingRender = false;

    const doRender = () => {
      comp.invalidate();
      context?.requestRender?.();
      context?.ui?.requestRender?.();
      pi?.ui?.requestRender?.();
    };

    const scheduleThrottledRender = () => {
      if (!renderThrottleTimer) {
        doRender();
        renderThrottleTimer = setTimeout(() => {
          renderThrottleTimer = undefined;
          if (pendingRender) {
            pendingRender = false;
            scheduleThrottledRender();
          }
        }, 50);
        renderThrottleTimer.unref?.();
      } else {
        pendingRender = true;
      }
    };

    unsubscribeListener = managerOrEmitter!.onTaskUpdate!(() => {
      const current = taskLookup ? taskLookup(rawTask!.id, taskWorkspace) : undefined;
      const isTerminal = !current || isTerminalStatus(current.status);
      if (isTerminal) {
        if (renderThrottleTimer) {
          clearTimeout(renderThrottleTimer);
          renderThrottleTimer = undefined;
        }
        pendingRender = false;
        doRender();
        cleanup?.();
        return;
      }
      scheduleThrottledRender();
    });
  }

  return comp;
}
