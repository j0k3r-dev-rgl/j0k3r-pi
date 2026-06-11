import { Type } from 'typebox';

import { applyAgentTodoAction } from './reducer.js';
import { renderAgentTodoCall, renderAgentTodoResult } from './render.js';
import { syncAgentTodoWidget } from './widget.js';

export function registerAgentTodoTool(pi: any, runtime: any): void {
  pi.registerTool({
    name: 'agent_todo',
    label: 'Agent Todo',
    description: 'Manage the single active agent todo.',
    promptSnippet: 'Use agent_todo to manage the single active todo for the current branch.',
    promptGuidelines: [
      'Use agent_todo to create, show, complete_step, complete_all, complete_range, reopen_step, or clear the single active todo.',
      'Use agent_todo complete_all when all remaining todo steps are done instead of completing each step one by one.',
      'Use agent_todo complete_range with range like "2-4" when a contiguous set of steps is done.'
    ],
    parameters: Type.Object({
      action: Type.String({ description: 'create, show, complete_step, complete_all, complete_range, reopen_step, or clear' }),
      title: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
      steps: Type.Optional(Type.Array(Type.String())),
      step_id: Type.Optional(Type.String()),
      start_step_id: Type.Optional(Type.String()),
      end_step_id: Type.Optional(Type.String()),
      range: Type.Optional(Type.String({ description: 'Inclusive numeric range for complete_range, for example 2-4.' })),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const result = applyAgentTodoAction(runtime.projection, params, runtime.deps);
      if (!result.isError) runtime.projection = result.nextState;
      syncAgentTodoWidget(ctx, runtime.projection, { collapsed: runtime.widgetCollapsed === true, shortcut: 'ctrl+space' });
      return result;
    },
    renderCall(args: any, theme: any) {
      return renderAgentTodoCall(args, theme);
    },
    renderResult(result: any, options: any, theme: any) {
      return renderAgentTodoResult(result, options, theme);
    },
  });
}
