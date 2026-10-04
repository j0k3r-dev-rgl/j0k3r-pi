import { Type } from 'typebox';
import { loadSubagents, readSubagentsConfig, resolveEffectiveSubagentMode } from '../config.js';
import type { SubagentManager } from '../manager.js';
import type { SubagentTask } from '../types.js';
import { appendSubagentResumeGuidance, formatTask, backgroundLaunchContent, formatTaskModeContent } from '../render/tools/formatting.js';
import { progressText } from '../render/tools/progress.js';
import { renderSubagentRunCall, renderSubagentRunResult } from '../render/tools/subagent-run.js';
import { installBackgroundHandoffShortcut } from './background-handoff-state.js';
import { compactResultDetails, compactTaskForToolResult } from './result-details.js';
import { ok, fail } from './tool-response.js';

export function installDoubleEscapeCancel(ctx: any, manager: SubagentManager, onCancel: () => void, getTaskIds: () => string[] = () => []): () => void {
  let lastEscapeAt = 0;
  const unsubscribe = ctx?.ui?.onTerminalInput?.((data: string) => {
    if (data !== '\u001b') return undefined;
    const now = Date.now();
    const isDoubleEscape = now - lastEscapeAt <= 600;
    lastEscapeAt = now;
    if (!isDoubleEscape) return { consume: true };
    onCancel();
    const ids = getTaskIds();
    const cancelled = ids.length
      ? ids.map((id) => {
        try { return manager.cancel(id, 'cancelled by double escape'); }
        catch { return undefined; }
      }).filter(Boolean)
      : manager.cancelRunning('cancelled by double escape');
    ctx?.abort?.();
    ctx?.ui?.notify?.(
      cancelled.length ? `Cancelled ${cancelled.length} subagent task(s).` : 'Requested subagent/main cancellation.',
      'warning',
    );
    lastEscapeAt = 0;
    return { consume: true };
  });
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}

export function createSubagentRunTool(manager: SubagentManager, pi: any) {
  return {
    name: 'subagent_run',
    label: 'Subagent Run',
    description: 'Delegate a task to exactly one markdown-defined subagent. Always omit mode unless the user explicitly requested task or background; the manager will choose automatically. Use mode=task to wait. Use mode=background only when the user explicitly asked for background; after launch, respond to the user and wait for the automatic completion notification instead of sleeping, polling status, or fetching results just to wait.',
    promptSnippet: 'Delegate analysis/review/test/design tasks to one subagent. Always omit mode unless the user explicitly requested task or background. If launched in background, respond immediately and wait for the automatic completion notification; do not sleep or poll status just to wait.',
    parameters: Type.Object({
      agent: Type.String(),
      task: Type.String(),
      name: Type.Optional(Type.String()),
      display_name: Type.Optional(Type.String()),
      context: Type.Optional(Type.String()),
      mode: Type.Optional(Type.Union([Type.Literal('task'), Type.Literal('background')])),
    }),
    renderShell: 'self',
    async execute(_id: string, params: any, _signal: any, onUpdate: any, ctx: any) {
      if (Array.isArray(params?.agents) || typeof params?.agent !== 'string' || !params.agent.trim()) {
        return fail('subagent_run accepts exactly one agent. Use the `agent` string parameter, not `agents`.');
      }

      let cancelledByDoubleEscape = false;
      let frame = 0;
      let active = true;
      let latestTasks: SubagentTask[] = [];
      const cwd = ctx?.cwd ?? process.cwd();
      const subagentsConfig = readSubagentsConfig(cwd);
      const definition = loadSubagents(cwd).find((candidate) => candidate.name === params.agent.toLowerCase());
      const effectiveMode = resolveEffectiveSubagentMode({ invocationMode: params.mode, definition, config: subagentsConfig });
      const isBackground = effectiveMode === 'background';
      const canBackgroundInTaskMode = effectiveMode === 'task';
      const backgroundShortcut = subagentsConfig.background_handoff_shortcut ?? 'ctrl+h';
      let resolveBackground: ((value: { mode: 'background'; task_ids: string[] }) => void) | undefined;
      const backgroundPromise = canBackgroundInTaskMode
        ? new Promise<{ mode: 'background'; task_ids: string[] }>((resolve) => { resolveBackground = resolve; })
        : undefined;
      const emit = () => {
        if (!active || isBackground) return;
        try {
          onUpdate?.({
            content: [{ type: 'text', text: progressText(latestTasks, frame, { backgroundable: canBackgroundInTaskMode, backgroundShortcut }) }],
            details: { tasks: latestTasks.map(compactTaskForToolResult), frame: frame++, backgroundable: canBackgroundInTaskMode, backgroundShortcut },
          });
        } catch {
          active = false;
        }
      };
      const uninstallCancel = isBackground ? () => {} : installDoubleEscapeCancel(ctx, manager, () => { cancelledByDoubleEscape = true; }, () => latestTasks.map((task) => task.id));
      const uninstallBackground = canBackgroundInTaskMode
        ? installBackgroundHandoffShortcut(ctx, manager, () => latestTasks.map((task) => task.id), (tasks) => {
          active = false;
          resolveBackground?.({ mode: 'background', task_ids: tasks.map((task) => task.id) });
        })
        : () => {};
      try {
        emit();
        const runPromise = manager.run(params, { ...ctx, pi }, _signal, isBackground ? undefined : (tasks) => { latestTasks = tasks; emit(); });
        const result = backgroundPromise ? await Promise.race([runPromise, backgroundPromise]) : await runPromise;
        if (cancelledByDoubleEscape) throw new Error('Subagent run cancelled by double escape');
        if (!('results' in result)) {
          const launchedTasks = result.task_ids.map((id) => manager.getTask(id)).filter(Boolean) as SubagentTask[];
          const details = compactResultDetails({ ...result, tasks: launchedTasks } as any);
          const tasksForLaunch = latestTasks.length ? latestTasks : (launchedTasks.length ? launchedTasks : result.task_ids);
          const response = ok(backgroundLaunchContent(tasksForLaunch, 'Sent'), details);
          return isBackground ? response : { ...response, terminate: true };
        }
        const failedTasks = (result.results ?? []).filter((task) => task.status === 'failed' || task.status === 'cancelled');
        const tasksForLaunch = latestTasks.length ? latestTasks : (result.results ?? result.task_ids);
        const text = result.mode === 'background'
          ? backgroundLaunchContent(tasksForLaunch, 'Started')
          : formatTaskModeContent(result.results ?? [], ctx?.cwd ?? process.cwd());
        const details = compactResultDetails(result as any);
        const failureText = appendSubagentResumeGuidance(
          `${failedTasks.length} subagent task(s) failed or were cancelled.\n\n${failedTasks.map(formatTask).join('\n\n')}`,
          failedTasks,
          ctx?.cwd ?? process.cwd(),
        );
        return failedTasks.length ? { ...fail(failureText), details } : ok(text, details);
      } catch (e) {
        if (!cancelledByDoubleEscape) return fail(e);
        const message = e instanceof Error ? e.message : String(e);
        return fail(appendSubagentResumeGuidance(message, latestTasks.length ? latestTasks : [{ status: 'cancelled' }], ctx?.cwd ?? process.cwd()));
      }
      finally {
        active = false;
        uninstallCancel();
        uninstallBackground();
      }
    },
    renderCall: renderSubagentRunCall,
    renderResult: renderSubagentRunResult,
  };
}
