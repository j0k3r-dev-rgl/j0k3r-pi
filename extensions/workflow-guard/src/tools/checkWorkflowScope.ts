import { Type, type Static } from 'typebox';
import { deriveActiveWorkflows } from '../core/state.js';
import { blockMessage, checkScope } from '../core/scope.js';
import { boundedJson } from '../render/index.js';

export const checkWorkflowScopeSchema = Type.Object({
  slug: Type.String({ description: 'OpenSpec active change slug whose declared Execution Scope should be used.' }),
  action: Type.Union([Type.Literal('read'), Type.Literal('write'), Type.Literal('edit'), Type.Literal('bash')], { description: 'Proposed tool action to preflight.' }),
  paths: Type.Optional(Type.Array(Type.String({ description: 'Candidate path touched by read/write/edit, relative to cwd or absolute.' }))),
  command: Type.Optional(Type.String({ description: 'Candidate bash command to check without executing.' })),
});
export type CheckWorkflowScopeInput = Static<typeof checkWorkflowScopeSchema>;

export function createCheckWorkflowScopeTool() {
  return {
    name: 'workflow_scope_check',
    label: 'Check Workflow Scope',
    description: 'Preflight a proposed read, write, edit, or bash action against one change Execution Scope and return allow/block with evidence and next permitted action without executing it.',
    promptSnippet: 'Preflight scoped file or bash actions before using read/write/edit/bash on an OpenSpec SDD change.',
    promptGuidelines: ['Use workflow_scope_check before uncertain file access or Python/bash commands; it returns actionable block evidence without executing anything.'],
    parameters: checkWorkflowScopeSchema,
    async execute(_toolCallId: string, params: CheckWorkflowScopeInput, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) {
      const result = await deriveActiveWorkflows(ctx.cwd);
      const state = result.states.find((entry) => entry.slug === params.slug);
      if (!state) throw new Error(`No active OpenSpec change found for slug: ${params.slug}`);
      if (!state.execution_scope) throw new Error(`No execution scope is available for slug: ${params.slug}`);
      const check = checkScope(state.execution_scope, { action: params.action, paths: params.paths, command: params.command, cwd: ctx.cwd });
      const summary = check.allowed ? 'workflow scope check allowed' : blockMessage(check);
      return { content: [{ type: 'text', text: `${summary}\n${boundedJson(check)}` }], details: check };
    },
  };
}
