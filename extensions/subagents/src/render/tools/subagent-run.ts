import { readSubagentsConfig } from '../config.js';
import type { SubagentTask } from '../types.js';
import { emptyComponent, inlineComponent, type InlineBodyLine } from './components.js';
import { formatTaskLabel, formatUsage, hasAgentResponse, taskResponseText } from './formatting.js';
import { progressText } from './progress.js';
import { taskFromDetails } from '../result-details.js';
import { ARCH_ICON, themeAccent, themeDim, themeError, themeStatus, themeSuccess, themeTitle, themeWarning } from '../completion-message.js';

/**
 * Compact inline presentation for `subagent_run`.
 *
 * Contract (see extensions/subagents/README.md "Compact Tool Rendering & Panel Contracts (v1)"):
 * one inline row with identity/state/attempt, no enclosing card frame, no background fill and no
 * generated expansion hint. Pi keeps ownership of `app.tools.expand` and of click routing, so this
 * renderer never intercepts mouse input to open the history panel.
 */

const SEPARATOR = ' ─ ';

function compactHome(text: string | undefined): string {
  if (!text) return '';
  const home = process.env.HOME;
  let out = text;
  if (home && home !== '/') {
    out = out.replace(new RegExp(`(^|[\\s=:(\\[])${escapeRegExp(home)}(?=$|[/\\s:'"\`)\\]])`, 'g'), '$1~');
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeThemeCall<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function separator(theme: any): string {
  return safeThemeCall(() => themeDim(theme, SEPARATOR), SEPARATOR);
}

function segments(theme: any, parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(separator(theme));
}

function formatRenderedModel(task?: SubagentTask): string {
  if (task?.model) return compactHome(task.model);
  if (task?.status === 'queued' || task?.model_source === 'unresolved' || !task?.model) return 'pending';
  return 'default/current';
}

function statusLabel(task: SubagentTask | undefined, theme: any, fallback: string): string {
  if (!task) return safeThemeCall(() => themeStatus(theme, fallback), fallback);
  const value = task.status ?? fallback;
  return safeThemeCall(() => themeStatus(theme, value), value);
}

export function renderSubagentRunCall(_args: any, _theme: any, _context?: any) {
  // Pi composes the call slot and then the result slot; this row is fully described by the result
  // slot, so the call slot stays empty and a run never renders two rows.
  return emptyComponent();
}

function normalizeInlineText(text: string | undefined): string {
  return text ? text.replace(/\s+/g, ' ').trim() : '';
}

function mutedLines(text: string): InlineBodyLine[] {
  return text.split('\n').map((line) => ({ text: line, muted: true }));
}

function messageRow(result: any, { expanded, isPartial }: any, theme: any) {
  const details = result?.details ?? {};
  const status = details.status ?? (result?.isError ? 'rejected' : 'queued');
  const styledStatus = status === 'rejected' ? themeError(theme, status) : themeSuccess(theme, status);
  const acknowledgement = (result?.content ?? [])
    .filter((part: any) => part.type === 'text')
    .map((part: any) => part.text)
    .join('\n');
  // Raw task IDs stay out of the visible row; the task label is the human identity.
  const header = `${themeAccent(theme, ARCH_ICON)} ${segments(theme, [
    themeTitle(theme, 'subagent message'),
    themeAccent(theme, formatTaskLabel(details.task ?? { agent: 'subagent', task: '' })),
    styledStatus,
    details.pending_message_count !== undefined ? themeDim(theme, `pending ${details.pending_message_count}`) : undefined,
  ])}`;
  const body: InlineBodyLine[] = isPartial
    ? [themeDim(theme, 'sending…')]
    : [
      ...(details.pending_message_count !== undefined ? [themeDim(theme, `pending messages: ${details.pending_message_count}`)] : []),
      ...(details.reason ? [themeDim(theme, `reason: ${details.reason}`)] : []),
      ...(acknowledgement ? mutedLines(acknowledgement) : []),
    ];
  return inlineComponent({ header, body, expanded: expanded === true, theme });
}

function partialRow(result: any, { expanded }: any, theme: any, task?: SubagentTask) {
  const frame = result?.details?.frame ?? 0;
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][Math.abs(Math.floor(frame)) % 10];
  const bgShortcut = result?.details?.backgroundShortcut ?? 'ctrl+h';
  const backgroundable = Boolean(result?.details?.backgroundable);
  const options = {
    backgroundable,
    backgroundShortcut: bgShortcut,
  };
  const progress = progressText(task ? [task] : [], frame, options).split('\n');
  const agentOrName = task?.display_name || task?.agent || 'subagent';
  const currentActivity = task?.live_activity?.current?.label
    ?? task?.live_activity?.trail?.[task.live_activity.trail.length - 1]?.label
    ?? task?.last_activity;
  const isBg = task?.mode === 'background' || task?.effective_mode === 'background' || result?.details?.mode === 'background';
  const header = `${themeAccent(theme, ARCH_ICON)} ${segments(theme, [
    themeTitle(theme, `${spinner} subagent · ${agentOrName}`),
    themeWarning(theme, task?.status ?? 'running'),
    isBg ? themeDim(theme, 'background') : undefined,
    currentActivity ? normalizeInlineText(currentActivity) : undefined,
    backgroundable ? themeDim(theme, `${bgShortcut} to send to background`) : undefined,
    themeDim(theme, `model: ${formatRenderedModel(task)}`),
    themeDim(theme, `effort: ${task?.effort ?? 'default/current'}`),
    themeDim(theme, `attempt: ${task?.attempt ?? 1}`),
  ])}`;

  if (expanded !== true) return inlineComponent({ header, body: [], expanded: false, theme });

  // Expanded partial: full live activity trail without duplicating the header status/model row.
  const trailLines: InlineBodyLine[] = progress
    .slice(2)
    .map((line) => (line.startsWith('↳') ? themeDim(theme, line) : { text: line, muted: true }));
  return inlineComponent({ header, body: trailLines, expanded: true, theme });
}

function terminalRow(result: any, { expanded }: any, theme: any, context: any, task?: SubagentTask) {
  const failed = Boolean(result?.isError || task?.status === 'failed' || task?.status === 'cancelled' || task?.status === 'interrupted');
  const isRunning = task?.status === 'running' || task?.status === 'queued';
  const isBg = task?.mode === 'background' || task?.effective_mode === 'background' || result?.details?.mode === 'background';
  const hasResp = hasAgentResponse(task, result);
  const responseText = taskResponseText(task, result);
  const usage = task ? formatUsage(task) : '';
  const label = task?.display_name?.trim() || task?.agent || 'subagent';
  const identity = hasResp && !isRunning ? `subagent result · ${label}` : `subagent · ${label}`;

  // A custom display name replaces the agent in the identity label, so the agent stays explicit.
  const agentSegment = task && label !== task.agent ? themeDim(theme, `agent: ${task.agent}`) : undefined;
  // A failure without a resolved task (pre-launch rejection) still needs its reason visible in the
  // collapsed row; that text is the only information the row has.
  const preLaunchFailure = !task && failed
    ? normalizeInlineText((result?.content ?? []).filter((part: any) => part?.type === 'text').map((part: any) => part.text).join(' '))
    : '';

  const header = `${themeAccent(theme, ARCH_ICON)} ${segments(theme, [
    themeTitle(theme, identity),
    agentSegment,
    task ? `status: ${statusLabel(task, theme, failed ? 'failed' : 'done')}` : (failed ? themeError(theme, 'failed') : themeSuccess(theme, 'done')),
    preLaunchFailure || undefined,
    isBg ? themeDim(theme, 'background') : undefined,
    task ? themeDim(theme, `model: ${formatRenderedModel(task)}`) : undefined,
    task ? themeDim(theme, `effort: ${task.effort ?? 'default/current'}`) : undefined,
    task ? themeDim(theme, `attempt: ${task.attempt ?? 1}`) : undefined,
    usage ? themeDim(theme, `usage: ${usage}`) : undefined,
  ])}`;

  if (expanded !== true) return inlineComponent({ header, body: [], expanded: false, theme });

  const body: InlineBodyLine[] = [];
  if (task) {
    body.push(themeDim(theme, `task_id: ${task.id}`));
    body.push(themeDim(theme, `agent: ${task.agent} · mode: ${task.effective_mode ?? task.mode ?? 'task'}${isBg ? ' (background)' : ''}`));
    const taskLabel = formatTaskLabel(task);
    if (taskLabel !== label) body.push(themeDim(theme, `task: ${taskLabel}`));
  }
  body.push(themeDim(theme, `history: ${resolveHistoryRoute(task, result, context)}`));
  if (hasResp && responseText) {
    body.push(themeTitle(theme, 'Subagent response'), ...mutedLines(responseText));
  } else if (failed) {
    const errorText = task?.error
      ?? (result?.content ?? []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n');
    if (errorText) body.push(themeError(theme, 'Subagent error'), ...mutedLines(errorText));
  } else if (!task) {
    const text = (result?.content ?? []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n');
    if (text) body.push(...mutedLines(text));
  }
  return inlineComponent({ header, body, expanded: true, theme });
}

/** Expanded rows still surface the existing manual history route; no tool-row click hijack. */
function resolveHistoryRoute(task: SubagentTask | undefined, result: any, context: any): string {
  const shortcut = readSubagentsConfig(task?.cwd ?? result?.details?.cwd ?? context?.cwd ?? process.cwd()).history_panel_shortcut ?? 'ctrl+,';
  return `${shortcut} or /subagents`;
}

export function createSubagentRunComponent(
  result: any,
  options: any,
  theme: any,
  context?: any,
  task?: SubagentTask,
) {
  try {
    if (result?.details?.action === 'message') return messageRow(result, options ?? {}, theme);
    if (options?.isPartial) return partialRow(result, options ?? {}, theme, task);
    return terminalRow(result, options ?? {}, theme, context, task);
  } catch {
    const text = (result?.content ?? []).filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('\n');
    return inlineComponent({
      header: `${ARCH_ICON} subagent_run ─ ${result?.isError ? 'failed' : options?.isPartial ? 'running' : 'done'}`,
      body: text ? mutedLines(text) : [],
      expanded: options?.expanded === true,
      theme,
    });
  }
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
  if (context?.state && typeof context.state === 'object') {
    context.state.hasResult = true;
  }

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
    if (cachedInnerComp && cachedTaskSignature === sig) return cachedInnerComp;
    cachedTaskSignature = sig;
    cachedInnerComp = createSubagentRunComponent(result, options, theme, context, task);
    return cachedInnerComp;
  };

  const comp = {
    compactLeftMargin: 1,
    invalidate() {
      cachedInnerComp = undefined;
      cachedTaskSignature = '';
    },
    render(width: number): string[] {
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      try {
        return buildComponent().render(safeWidth);
      } catch {
        if (safeWidth === 1) return [' '];
        return [` ${ARCH_ICON} subagent_run`.slice(0, safeWidth)];
      }
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
    let renderThrottleTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingRender = false;

    cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (renderThrottleTimer) {
        clearTimeout(renderThrottleTimer);
        renderThrottleTimer = undefined;
      }
      pendingRender = false;
      if (context?.state?.cleanup === cleanup) context.state.cleanup = undefined;
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

    if (context?.state) context.state.cleanup = cleanup;

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
        unregisterShutdown = pi.on('session_shutdown', () => { cleanup?.(); });
      } catch {}
    }

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
