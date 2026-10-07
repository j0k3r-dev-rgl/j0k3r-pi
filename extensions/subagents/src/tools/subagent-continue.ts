import { Type } from 'typebox';
import { readSubagentsConfig } from '../config.js';
import { resolveContinuationEffectiveMode } from '../continuation-mode.js';
import type { SubagentManager } from '../manager.js';
import type { SubagentTask } from '../types.js';
import { appendSubagentResumeGuidance, backgroundLaunchContent, formatTaskModeContent } from '../render/tools/formatting.js';
import { progressText } from '../render/tools/progress.js';
import { renderSubagentContinueCall, renderSubagentContinueResult } from '../render/tools/subagent-continue.js';
import { installBackgroundHandoffShortcut } from './background-handoff-state.js';
import { compactResultDetails, compactTaskForToolResult } from './result-details.js';
import { installDoubleEscapeCancel } from './subagent-run.js';
import { ok, fail } from './tool-response.js';

export function createSubagentContinueTool(manager: SubagentManager, pi: any) {
  return {
    name: 'subagent_continue',
    label: 'Subagent Continue',
    description: 'Continue a completed, failed, or cancelled subagent task in its exact persisted nested Pi session.',
    promptSnippet: 'Continue an existing terminal subagent task under the same task_id.',
    parameters: Type.Object({
      task_id: Type.String(),
      prompt: Type.String(),
      mode: Type.Optional(Type.Union([Type.Literal('task'), Type.Literal('background')])),
    }),
    renderShell: 'self',
    async execute(_id: string, params: any, _signal: any, onUpdate: any, ctx: any) {
      let cancelledByDoubleEscape = false;
      let frame = 0;
      let active = true;
      let latestTasks: SubagentTask[] = [];
      const cwd = ctx?.cwd ?? process.cwd();
      const existing = manager.getTask(params.task_id, cwd);
      const config = readSubagentsConfig(cwd);
      const effectiveMode = resolveContinuationEffectiveMode({ explicitMode: params.mode, previousTask: existing, config });
      const isBackground = effectiveMode === 'background';
      const canBackgroundInTaskMode = effectiveMode === 'task';
      const backgroundShortcut = config.background_handoff_shortcut ?? 'ctrl+h';
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
        const continuePromise = manager.continueTask(params, { ...ctx, pi }, _signal, isBackground ? undefined : (tasks) => { latestTasks = tasks; emit(); });
        const result = backgroundPromise ? await Promise.race([continuePromise, backgroundPromise]) : await continuePromise;
        if (cancelledByDoubleEscape) throw new Error('Subagent continuation cancelled by double escape');
        if (!('results' in result)) {
          const response = ok(backgroundLaunchContent(result.task_ids, 'Continued'), compactResultDetails({ ...result, cwd } as any));
          return isBackground ? response : { ...response, terminate: true };
        }
        const tasks = result.results ?? [];
        const text = formatTaskModeContent(tasks, ctx?.cwd ?? process.cwd());
        const details = compactResultDetails({ task: tasks[0], ...result, cwd });
        return tasks.some((task) => task.status === 'failed' || task.status === 'cancelled')
          ? { ...fail(text), details }
          : ok(text, details);
      } catch (e) {
        if (!cancelledByDoubleEscape) return fail(e);
        const message = e instanceof Error ? e.message : String(e);
        return fail(appendSubagentResumeGuidance(message, latestTasks.length ? latestTasks : [{ status: 'cancelled' }], ctx?.cwd ?? process.cwd()));
      } finally {
        active = false;
        uninstallCancel();
        uninstallBackground();
      }
    },
    renderCall: (args: any, theme: any) => renderSubagentContinueCall(args, theme, args?.task_id ? manager.getTask(args.task_id, process.cwd()) : undefined, process.cwd()),
    renderResult: (result: any, options: any, theme: any, context?: any) =>
      renderSubagentContinueResult(result, options, theme, context, (id: string, cwd?: string) => manager.getTask(id, cwd), manager, pi),
  };
}
