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
      'Use agent_todo to create, show, complete_step, reopen_step, or clear the single active todo.',
    ],
    parameters: Type.Object({
      action: Type.String({ description: 'create, show, complete_step, reopen_step, or clear' }),
      title: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
      steps: Type.Optional(Type.Array(Type.String())),
      step_id: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const result = applyAgentTodoAction(runtime.projection, params, runtime.deps);
      if (!result.isError) runtime.projection = result.nextState;
      syncAgentTodoWidget(ctx, runtime.projection);
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
