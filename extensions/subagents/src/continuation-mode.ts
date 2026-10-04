import type { SubagentMode, SubagentsConfig, SubagentTask } from './types.js';

function isSubagentMode(value: unknown): value is SubagentMode {
  return value === 'task' || value === 'background';
}

export function resolveContinuationEffectiveMode(input: {
  explicitMode?: unknown;
  previousTask?: Pick<SubagentTask, 'effective_mode' | 'mode'> | undefined;
  config?: Pick<SubagentsConfig, 'default_mode'> | undefined;
}): SubagentMode {
  return isSubagentMode(input.explicitMode)
    ? input.explicitMode
    : isSubagentMode(input.previousTask?.effective_mode)
      ? input.previousTask.effective_mode
      : isSubagentMode(input.previousTask?.mode)
        ? input.previousTask.mode
        : isSubagentMode(input.config?.default_mode)
          ? input.config.default_mode
          : 'task';
}
