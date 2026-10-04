import { Type } from 'typebox';
import type { SubagentManager } from '../manager.js';
import { emptyComponent } from '../render/tools/components.js';
import { formatTaskListSummary } from '../render/tools/formatting.js';
import { renderSubagentListTasksResult } from '../render/tools/subagent-list-tasks.js';
import { compactTaskWithoutFinalText, sessionIdFromToolContext } from './result-details.js';
import { ok, fail } from './tool-response.js';

export function createSubagentListTasksTool(manager: SubagentManager) {
  return {
    name: 'subagent_list_tasks',
    label: 'Subagent List Tasks',
    description: 'List delegated subagent tasks.',
    parameters: Type.Object({}),
    async execute(_id: string, _params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const tasks = manager.listSessionTasks(cwd, sessionIdFromToolContext(ctx));
        const compactTasks = tasks.map(compactTaskWithoutFinalText);
        return ok(formatTaskListSummary(compactTasks as any), { tasks: compactTasks });
      } catch (e) { return fail(e); }
    },
    renderShell: 'self',
    renderCall: () => emptyComponent(),
    renderResult: renderSubagentListTasksResult,
  };
}
