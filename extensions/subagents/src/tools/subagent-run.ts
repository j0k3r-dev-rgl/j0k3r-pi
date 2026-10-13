import { Type } from 'typebox';
import { loadSubagents, readSubagentsConfig, resolveEffectiveSubagentMode } from '../config.js';
import type { SubagentManager } from '../manager.js';
import { resolveContinuationEffectiveMode } from '../continuation-mode.js';
import type { SubagentTask } from '../types.js';
import { appendSubagentResumeGuidance, backgroundLaunchContent, formatTaskModeContent } from '../render/tools/formatting.js';
import { progressText } from '../render/tools/progress.js';
import { renderSubagentRunCall, renderSubagentRunResult } from '../render/tools/subagent-run.js';
import { installBackgroundHandoffShortcut } from './background-handoff-state.js';
import { compactResultDetails, compactTaskForToolResult, compactTaskWithoutFinalText, sessionIdFromToolContext } from './result-details.js';
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
    description: 'Delegate a task to exactly one markdown-defined subagent. Always omit mode unless the user explicitly requested task or background; the manager will choose automatically. Use mode=task to wait. Use mode=background only when the user explicitly asked for background; after launch, respond to the user and wait for the automatic completion notification instead of sleeping, polling status, or fetching results just to wait. action defaults to run (requires agent). action=continue resumes a terminal task in its persisted session when enable_continue is enabled. action=message queues live instructions for a running background task owned by this parent session, independently of enable_continue; queue acceptance does not prove model consumption. Both require task_id and use task for instructions. Never turn a rejected message into a continuation.',
    promptSnippet: 'Delegate analysis/review/test/design tasks to one subagent. Always omit mode unless the user explicitly requested task or background. If launched in background, respond immediately and wait for the automatic completion notification; do not sleep or poll status just to wait. Use action=continue with task_id and task to resume when enabled; use action=message with task_id and task for live background steering. Never infer an action from task state.',
    parameters: Type.Object({
      action: Type.Optional(Type.Union([Type.Literal('run'), Type.Literal('continue'), Type.Literal('message')])),
      agent: Type.Optional(Type.String()),
      task_id: Type.Optional(Type.String()),
      task: Type.String({ description: 'Instructions for the new task, continuation, or live message.' }),
      name: Type.Optional(Type.String()),
      display_name: Type.Optional(Type.String()),
      context: Type.Optional(Type.String()),
      mode: Type.Optional(Type.Union([Type.Literal('task'), Type.Literal('background')])),
    }),
    renderShell: 'self',
    async execute(_id: string, params: any, _signal: any, onUpdate: any, ctx: any) {
      const action = params?.action ?? 'run';
      const cwd = ctx?.cwd ?? process.cwd();
      const subagentsConfig = readSubagentsConfig(cwd);
      const reject = (message: string) => ({ ...fail(message), details: { action, cwd } });
      if (!['run', 'continue', 'message'].includes(action)) return reject('Unknown action. Use run, continue, or message.');
      if (typeof params?.task !== 'string' || !params.task.trim()) return reject('task must contain non-empty instructions.');
      if (Array.isArray(params?.agents)) return reject('subagent_run accepts exactly one agent. Use the `agent` string parameter, not `agents`.');
      if (action === 'run' && (typeof params?.agent !== 'string' || !params.agent.trim())) {
        return reject('subagent_run accepts exactly one agent. Use the `agent` string parameter, not `agents`.');
      }
      if (action === 'run' && params.task_id !== undefined) return reject('task_id requires an explicit action: continue or message.');
      if (action !== 'run' && (typeof params.task_id !== 'string' || !params.task_id.trim())) return reject(`${action} requires task_id.`);
      if (action !== 'run' && ['agent', 'name', 'display_name', 'context'].some((key) => params[key] !== undefined)) {
        return reject(`${action} uses the existing task identity; omit agent, name, display_name, and context.`);
      }
      if (action === 'message' && params.mode !== undefined) return reject('message does not change execution mode; omit mode.');
      if (action === 'continue' && !subagentsConfig.enable_continue) return reject('Subagent continuation is disabled in Subagents configuration (enable_continue).');
      const existing = action !== 'run' ? manager.getTask(params.task_id, cwd) : undefined;
      if (existing?.cwd && existing.cwd !== cwd) return reject('Subagent task is not available in this workspace.');
      if (action === 'message') {
        try {
          const acknowledgement = manager.sendMessage({ task_id: params.task_id, message: params.task, session_id: sessionIdFromToolContext(ctx) });
          const details = {
            ...acknowledgement, action, cwd,
            task: existing && acknowledgement.status === 'queued' ? compactTaskWithoutFinalText(existing) : undefined,
          };
          const text = `${acknowledgement.status}: ${acknowledgement.message}`;
          return acknowledgement.status === 'queued' ? ok(text, details) : { ...fail(text), details };
        } catch (error) {
          return { ...fail(error), details: { action, cwd } };
        }
      }
      const definitions = action === 'run' ? loadSubagents(cwd) : [];
      const definition = action === 'run' ? definitions.find((candidate) => candidate.name === params.agent.trim().toLowerCase()) : undefined;
      if (action === 'run' && !definition) return reject(`Subagent not found: ${params.agent}. Available agents: ${definitions.map((candidate) => `${candidate.name} (${candidate.description})`).join(', ') || 'none'}.`);

      let cancelledByDoubleEscape = false;
      let frame = 0;
      let active = true;
      let latestTasks: SubagentTask[] = [];
      const effectiveMode = action === 'continue'
        ? resolveContinuationEffectiveMode({ explicitMode: params.mode, previousTask: existing, config: subagentsConfig })
        : resolveEffectiveSubagentMode({ invocationMode: params.mode, definition, config: subagentsConfig });
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
            details: { action, tasks: latestTasks.map(compactTaskForToolResult), cwd, frame: frame++, backgroundable: canBackgroundInTaskMode, backgroundShortcut },
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
        const update = isBackground ? undefined : (tasks: SubagentTask[]) => { latestTasks = tasks; emit(); };
        const runPromise = action === 'continue'
          ? manager.continueTask({ task_id: params.task_id, prompt: params.task, mode: params.mode }, { ...ctx, pi }, _signal, update)
          : manager.run({ ...params, agent: definition!.name }, { ...ctx, pi }, _signal, update);
        const result = backgroundPromise ? await Promise.race([runPromise, backgroundPromise]) : await runPromise;
        if (cancelledByDoubleEscape) throw new Error('Subagent run cancelled by double escape');
        if (!('results' in result)) {
          const launchedTasks = result.task_ids.map((id) => manager.getTask(id, cwd)).filter(Boolean) as SubagentTask[];
          const details = compactResultDetails({ ...result, action, tasks: launchedTasks, cwd } as any);
          const tasksForLaunch = latestTasks.length ? latestTasks : (launchedTasks.length ? launchedTasks : result.task_ids);
          const response = ok(backgroundLaunchContent(tasksForLaunch, action === 'continue' ? 'Continued' : 'Sent'), details);
          return isBackground ? response : { ...response, terminate: true };
        }
        const failedTasks = (result.results ?? []).filter((task) => task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted');
        const tasksForLaunch = latestTasks.length ? latestTasks : (result.results ?? result.task_ids);
        const text = result.mode === 'background'
          ? backgroundLaunchContent(tasksForLaunch, 'Started')
          : formatTaskModeContent(result.results ?? [], ctx?.cwd ?? process.cwd());
        const details = compactResultDetails({ ...result, action, task: result.results?.[0], cwd } as any);
        return failedTasks.length ? { ...fail(text), details } : ok(text, details);
      } catch (e) {
        if (!cancelledByDoubleEscape) return { ...fail(e), details: { action, cwd } };
        const message = e instanceof Error ? e.message : String(e);
        return { ...fail(appendSubagentResumeGuidance(message, latestTasks.length ? latestTasks : [{ status: 'cancelled' }], cwd)), details: compactResultDetails({ action, cwd, tasks: latestTasks }) };
      }
      finally {
        active = false;
        uninstallCancel();
        uninstallBackground();
      }
    },
    renderCall: renderSubagentRunCall,
    renderResult: (result: any, options: any, theme: any, context?: any) =>
      renderSubagentRunResult(result, options, theme, context, (id: string, cwd?: string) => manager.getTask(id, cwd), manager, pi),
  };
}
