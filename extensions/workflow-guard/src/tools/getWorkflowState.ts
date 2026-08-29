import { Type, type Static } from 'typebox';
import { deriveActiveWorkflows } from '../core/state.js';
import { boundedJson, stateSummary, workspaceSummary } from '../render/index.js';

export const getWorkflowStateSchema = Type.Object({
  slug: Type.Optional(Type.String({ description: 'OpenSpec active change slug to inspect.' })),
  includeArtifacts: Type.Optional(Type.Boolean({ default: true })),
  includeNextAction: Type.Optional(Type.Boolean({ default: true })),
  verbose: Type.Optional(Type.Boolean({ default: false, description: 'Include the full bounded JSON detail in the text response.' })),
});
export type GetWorkflowStateInput = Static<typeof getWorkflowStateSchema>;

export function createGetWorkflowStateTool() {
  return {
    name: 'workflow_state_get',
    label: 'Workflow State',
    description: 'Read bounded derived OpenSpec workflow state, including normalized execution_scope when a slug is available, for one active change slug or all active changes.',
    promptSnippet: 'Read OpenSpec Mini-SDD/Formal SDD workflow state and execution-scope readiness for active changes.',
    promptGuidelines: ['Use workflow_state_get when the user asks about OpenSpec change status, readiness, blockers, execution scope, or next permitted SDD action.'],
    parameters: getWorkflowStateSchema,
    async execute(_toolCallId: string, params: GetWorkflowStateInput, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) {
      const result = await deriveActiveWorkflows(ctx.cwd);
      if (params.slug) {
        const state = result.states.find((entry) => entry.slug === params.slug);
        if (!state) throw new Error(`No active OpenSpec change found for slug: ${params.slug}`);
        const view: any = { ...state };
        if (params.includeArtifacts === false) delete view.artifacts;
        if (params.includeNextAction === false) delete view.next_allowed;
        const text = params.verbose ? `${stateSummary(state)}\n${boundedJson(view)}` : stateSummary(state);
        return { content: [{ type: 'text', text }], details: { state: view } };
      }
      const text = params.verbose ? `${workspaceSummary(result.states)}\n${boundedJson(result.index)}` : workspaceSummary(result.states);
      return { content: [{ type: 'text', text }], details: { index: result.index, states: result.states } };
    },
  };
}
