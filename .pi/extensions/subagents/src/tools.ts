import { Type } from 'typebox';
import type { SubagentManager } from './manager.js';
import type { SubagentTask } from './types.js';

function ok(text: string, details: Record<string, unknown> = {}) { return { content: [{ type: 'text', text }], details }; }
function fail(error: unknown) { const msg = error instanceof Error ? error.message : String(error); return { content: [{ type: 'text', text: msg }], details: { error: msg }, isError: true }; }
function clip(text: string | undefined, limit = 240): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}
function formatUsage(task: SubagentTask): string {
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
function modelEffortLine(task: SubagentTask): string {
  return [`model: ${task.model ?? 'default/current'}`, `effort: ${task.effort ?? 'default/current'}`].join(' · ');
}
function formatTask(task: SubagentTask): string {
  const when = task.last_activity_at ?? task.started_at ?? task.created_at;
  const usage = formatUsage(task);
  const lines = [
    `agent: ${task.agent} · status: ${task.status} · id: ${task.id}`,
    modelEffortLine(task),
    usage ? `usage: ${usage}` : undefined,
    `last: ${task.last_activity ?? 'n/a'}${when ? ` at ${when}` : ''}`,
  ].filter(Boolean) as string[];
  const preview = clip(task.output_preview ?? task.result ?? task.error);
  if (preview) lines.push(`preview: ${preview}`);
  return lines.join('\n');
}

function progressText(tasks: SubagentTask[], frame = 0): string {
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][frame % 10];
  const active = tasks.find((task) => task.status === 'running') ?? tasks[0];
  if (!active) return `${spinner} Starting subagent…`;
  const usage = formatUsage(active);
  return [
    `${spinner} agent: ${active.agent} · status: ${active.status} · effort: ${active.effort ?? 'default/current'}`,
    `↳ model: ${active.model ?? 'starting'}${usage ? ` · usage: ${usage}` : ''}`,
    `↳ ${clip(active.last_activity ?? active.task ?? active.id, 160)}`,
  ].join('\n');
}

function installDoubleEscapeCancel(ctx: any, manager: SubagentManager, onCancel: () => void): () => void {
  let lastEscapeAt = 0;
  const unsubscribe = ctx?.ui?.onTerminalInput?.((data: string) => {
    if (data !== '\u001b') return undefined;
    const now = Date.now();
    const isDoubleEscape = now - lastEscapeAt <= 600;
    lastEscapeAt = now;
    if (!isDoubleEscape) return { consume: true };
    onCancel();
    const cancelled = manager.cancelRunning('cancelled by double escape');
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

function textComponent(text: string) {
  return {
    invalidate() {},
    render(width: number) {
      return text.split('\n').map((line) => line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line);
    },
  };
}

function taskFromDetails(result: any): SubagentTask | undefined {
  return result?.details?.tasks?.[0] ?? result?.details?.results?.[0] ?? result?.details?.task;
}

function compactTaskForToolResult(task: SubagentTask): SubagentTask {
  const { thread_snapshot: _threadSnapshot, ...compact } = task;
  return compact;
}

function compactResultDetails<T extends Record<string, any>>(details: T): T {
  return {
    ...details,
    task: details.task ? compactTaskForToolResult(details.task) : details.task,
    tasks: Array.isArray(details.tasks) ? details.tasks.map(compactTaskForToolResult) : details.tasks,
    results: Array.isArray(details.results) ? details.results.map(compactTaskForToolResult) : details.results,
  };
}

export function registerSubagentTools(pi: any, manager: SubagentManager): void {
  pi.registerTool({
    name: 'subagent_list_agents',
    label: 'Subagent List Agents',
    description: 'List available markdown-defined subagents for delegation.',
    promptSnippet: 'List available subagents loaded from .pi/subagents/*.md.',
    parameters: Type.Object({}),
    async execute(_id: string, _params: any, _signal: any, _onUpdate: any, ctx: any) {
      try { const agents = manager.listAgents(ctx?.cwd ?? process.cwd()); return ok(`Found ${agents.length} subagent(s).`, { agents }); } catch (e) { return fail(e); }
    },
  });

  pi.registerTool({
    name: 'subagent_run',
    label: 'Subagent Run',
    description: 'Delegate a task to one or more markdown-defined subagents. Use mode=task to wait, mode=background to continue and poll later.',
    promptSnippet: 'Delegate analysis/review/test/design tasks to subagents. Supports one or many agents, task or background mode.',
    parameters: Type.Object({
      agent: Type.Optional(Type.String()),
      agents: Type.Optional(Type.Array(Type.String())),
      task: Type.String(),
      context: Type.Optional(Type.String()),
      mode: Type.Optional(Type.Union([Type.Literal('task'), Type.Literal('background')])),
    }),
    async execute(_id: string, params: any, _signal: any, onUpdate: any, ctx: any) {
      let cancelledByDoubleEscape = false;
      let frame = 0;
      let active = true;
      let latestTasks: SubagentTask[] = [];
      const isBackground = params.mode === 'background';
      const emit = () => {
        if (!active || isBackground) return;
        try {
          onUpdate?.({ content: [{ type: 'text', text: progressText(latestTasks, frame) }], details: { tasks: latestTasks.map(compactTaskForToolResult), frame: frame++ } });
        } catch {
          active = false;
        }
      };
      const interval = isBackground ? undefined : setInterval(emit, 500);
      const uninstallCancel = isBackground ? () => {} : installDoubleEscapeCancel(ctx, manager, () => { cancelledByDoubleEscape = true; });
      try {
        emit();
        const result = await manager.run(params, { ...ctx, pi }, _signal, isBackground ? undefined : (tasks) => { latestTasks = tasks; emit(); });
        if (cancelledByDoubleEscape) throw new Error('Subagent run cancelled by double escape');
        const failedTasks = (result.results ?? []).filter((task) => task.status === 'failed' || task.status === 'cancelled');
        const text = result.mode === 'background'
          ? `Started ${result.task_ids.length} background subagent task(s):\n${result.task_ids.join('\n')}`
          : `Completed ${result.task_ids.length} subagent task(s):\n${(result.results ?? []).map(formatTask).join('\n\n')}`;
        const details = compactResultDetails(result as any);
        return failedTasks.length ? { ...fail(`${failedTasks.length} subagent task(s) failed or were cancelled.\n\n${failedTasks.map(formatTask).join('\n\n')}`), details } : ok(text, details);
      } catch (e) { return fail(e); }
      finally {
        active = false;
        if (interval) clearInterval(interval);
        uninstallCancel();
      }
    },
    renderCall(args: any, theme: any) {
      const agents = args.agents?.length ? args.agents.join(', ') : args.agent ?? 'subagent';
      const mode = args.mode ?? 'task';
      const text = `${theme.fg?.('toolTitle', theme.bold?.('subagent ') ?? 'subagent ') ?? 'subagent '}${theme.fg?.('accent', agents) ?? agents}${theme.fg?.('dim', ` (${mode})`) ?? ` (${mode})`}`;
      return textComponent(text);
    },
    renderResult(result: any, { isPartial }: any, theme: any) {
      const task = taskFromDetails(result);
      if (isPartial) {
        const frame = result?.details?.frame ?? 0;
        const raw = task ? progressText([task], frame) : progressText([], frame);
        const lines = raw.split('\n');
        const styled = [
          theme.fg?.('warning', lines[0] ?? 'subagent running') ?? (lines[0] ?? 'subagent running'),
          theme.fg?.('dim', lines[1] ?? '') ?? (lines[1] ?? ''),
          theme.fg?.('dim', lines[2] ?? '') ?? (lines[2] ?? ''),
        ].filter(Boolean).join('\n');
        return textComponent(styled);
      }
      const failed = result?.isError || task?.status === 'failed' || task?.status === 'cancelled';
      const status = failed ? (theme.fg?.('error', task?.status ?? 'failed') ?? (task?.status ?? 'failed')) : (theme.fg?.('success', task?.status ?? 'done') ?? (task?.status ?? 'done'));
      const usage = task ? formatUsage(task) : '';
      const summary = task
        ? [
          `agent: ${theme.fg?.('accent', task.agent) ?? task.agent} · status: ${status} · effort: ${theme.fg?.('accent', task.effort ?? 'default/current') ?? (task.effort ?? 'default/current')}`,
          `${theme.fg?.('dim', `model: ${task.model ?? 'default/current'} · id: ${task.id}`) ?? `model: ${task.model ?? 'default/current'} · id: ${task.id}`}${usage ? `\n${theme.fg?.('dim', `usage: ${usage}`) ?? `usage: ${usage}`}` : ''}`,
        ].join('\n')
        : status;
      const preview = clip(task?.result ?? task?.error ?? task?.output_preview ?? result?.content?.[0]?.text, 220);
      return textComponent(preview ? `${summary}\n${theme.fg?.('dim', preview) ?? preview}` : summary);
    },
  });

  pi.registerTool({
    name: 'subagent_status',
    label: 'Subagent Status',
    description: 'Get status for a delegated subagent task.',
    parameters: Type.Object({ task_id: Type.String() }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const task = manager.getTask(params.task_id, ctx?.cwd ?? process.cwd());
        if (!task) throw new Error('Subagent task not found');
        return ok(formatTask(task), { task: compactTaskForToolResult(task) });
      } catch (e) { return fail(e); }
    },
  });

  pi.registerTool({
    name: 'subagent_result',
    label: 'Subagent Result',
    description: 'Read result for a delegated subagent task.',
    parameters: Type.Object({ task_id: Type.String() }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const task = manager.getTask(params.task_id, ctx?.cwd ?? process.cwd());
        if (!task) throw new Error('Subagent task not found');
        const text = task.result ?? task.error ?? task.output_preview ?? formatTask(task);
        return ok(text, { task: compactTaskForToolResult(task) });
      } catch (e) { return fail(e); }
    },
  });

  pi.registerTool({
    name: 'subagent_list_tasks',
    label: 'Subagent List Tasks',
    description: 'List delegated subagent tasks.',
    parameters: Type.Object({}),
    async execute(_id: string, _params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const tasks = manager.listTasks(ctx?.cwd ?? process.cwd());
        return ok(tasks.length ? `Listed ${tasks.length} subagent task(s):\n\n${tasks.map(formatTask).join('\n\n')}` : 'Listed 0 subagent task(s).', { tasks: tasks.map(compactTaskForToolResult) });
      } catch (e) { return fail(e); }
    },
  });

  pi.registerTool({
    name: 'subagent_cancel',
    label: 'Subagent Cancel',
    description: 'Cancel a running delegated subagent task.',
    parameters: Type.Object({ task_id: Type.String() }),
    async execute(_id: string, params: any) {
      try { const task = manager.cancel(params.task_id); return ok(formatTask(task), { task: compactTaskForToolResult(task) }); } catch (e) { return fail(e); }
    },
  });
}
