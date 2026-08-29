import { Type, type Static } from 'typebox';
import { deriveActiveWorkflows } from '../core/state.js';
import { scopeExamples } from '../core/scope.js';
import { boundedJson } from '../render/index.js';

export const getWorkflowScopeSchema = Type.Object({
  slug: Type.String({ description: 'OpenSpec active change slug whose Execution Scope should be inspected before read/write/edit/bash.' }),
});
export type GetWorkflowScopeInput = Static<typeof getWorkflowScopeSchema>;

export function createGetWorkflowScopeTool() {
  return {
    name: 'workflow_scope_get',
    label: 'Workflow Scope',
    description: 'Get the normalized Execution Scope for one OpenSpec change slug, including authority artifact, readiness, blockers, allowed/writable paths, Allowed Bash patterns, and /tmp allowance.',
    promptSnippet: 'Inspect declared OpenSpec Execution Scope before reading, writing, editing, or running bash for an SDD change.',
    promptGuidelines: ['Use workflow_scope_get when implementing or verifying an SDD change to discover allowed paths and bash patterns before acting.'],
    parameters: getWorkflowScopeSchema,
    async execute(_toolCallId: string, params: GetWorkflowScopeInput, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) {
      const result = await deriveActiveWorkflows(ctx.cwd);
      const state = result.states.find((entry) => entry.slug === params.slug);
      if (!state) throw new Error(`No active OpenSpec change found for slug: ${params.slug}`);
      const details = { slug: state.slug, workflow: state.workflow, execution_scope: state.execution_scope, examples: scopeExamples(state) };
      return { content: [{ type: 'text', text: `${state.slug} execution scope: ${state.execution_scope?.status ?? 'BLOCKED'}\n${boundedJson(details)}` }], details };
    },
  };
}
