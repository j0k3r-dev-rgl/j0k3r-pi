import { Type } from 'typebox';
import type { SubagentManager } from '../manager.js';
import { formatTask } from '../render/tools/formatting.js';
import { renderSubagentStatusCall, renderSubagentStatusResult } from '../render/tools/subagent-status.js';
import { compactTaskForToolResult } from './result-details.js';
import { ok, fail } from './tool-response.js';

export function createSubagentStatusTool(manager: SubagentManager) {
  return {
    name: 'subagent_status',
    label: 'Subagent Status',
    description: 'Get status for a delegated subagent task.',
    parameters: Type.Object({ task_id: Type.String() }),
    renderShell: 'self',
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const task = manager.getTask(params.task_id, ctx?.cwd ?? process.cwd());
        if (!task) throw new Error('Subagent task not found');
        return ok(formatTask(task), { task: compactTaskForToolResult(task) });
      } catch (e) { return fail(e); }
    },
    renderCall: renderSubagentStatusCall,
    renderResult: renderSubagentStatusResult,
  };
}
