import type { SubagentTask } from '../types.js';
import { boxedComponent } from './components.js';
import { formatTaskListRender } from './formatting.js';
import { ARCH_ICON, CYAN, themeFg, themeTitle } from '../completion-message.js';

export function renderSubagentListTasksResult(result: any, options: any, theme: any, context?: any) {
  const isExpanded = Boolean(typeof options === 'object' && options !== null ? options.expanded : options);
  const tasks: SubagentTask[] = Array.isArray(result?.details?.tasks) ? result.details.tasks : [];
  const archPrefix = themeFg(theme, 'accent', ARCH_ICON, CYAN);
  const title = `${archPrefix} ${themeTitle(theme, tasks.length ? `subagent tasks · ${tasks.length} listed` : 'subagent tasks')}`;

  const text = formatTaskListRender(tasks, isExpanded, context);
  const lines = isExpanded ? text.split('\n') : (theme?.fg?.('dim', text) ?? text).split('\n');

  return boxedComponent(lines, {
    title,
    theme,
    wrapped: true,
  });
}
