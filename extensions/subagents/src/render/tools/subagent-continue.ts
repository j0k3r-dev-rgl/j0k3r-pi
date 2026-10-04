import { readSubagentsConfig } from '../config.js';
import { resolveContinuationEffectiveMode } from '../continuation-mode.js';
import type { SubagentTask } from '../types.js';
import { formatTaskLabel } from './formatting.js';
import { renderSubagentRunResult, renderSubagentTaskCall } from './subagent-run.js';

export function renderSubagentContinueCall(args: any, theme: any, task?: SubagentTask, cwd = process.cwd()) {
  const attempt = task ? (task.attempt ?? 1) + 1 : 'next';
  const detail = task
    ? `continue · attempt: ${attempt} · ${formatTaskLabel(task)}`
    : `continue · attempt: ${attempt}`;
  const mode = resolveContinuationEffectiveMode({ explicitMode: args?.mode, previousTask: task, config: readSubagentsConfig(cwd) });
  return renderSubagentTaskCall(task?.agent ?? 'continue', mode, theme, detail);
}

export function renderSubagentContinueResult(result: any, options: any, theme: any, context?: any) {
  return renderSubagentRunResult(result, options, theme, context);
}
