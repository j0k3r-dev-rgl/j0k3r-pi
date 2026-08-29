import { Type, type Static } from 'typebox';
import { validateWorkflows } from '../core/validate.js';
import { boundedJson, validationSummary } from '../render/index.js';

export const validateWorkflowSchema = Type.Object({
  slug: Type.Optional(Type.String({ description: 'OpenSpec active change slug to validate.' })),
  repairDerivedJson: Type.Optional(Type.Boolean({ default: false, description: 'Regenerate only derived workflow JSON under openspec/.' })),
  verbose: Type.Optional(Type.Boolean({ default: false, description: 'Include the full bounded validation JSON in the text response.' })),
});
export type ValidateWorkflowInput = Static<typeof validateWorkflowSchema>;

export function createValidateWorkflowTool() {
  return {
    name: 'workflow_validate',
    label: 'Validate Workflow',
    description: 'Validate OpenSpec workflow state and normalized execution_scope, and optionally repair only derived workflow JSON files.',
    promptSnippet: 'Validate OpenSpec workflow state, execution scope, and regenerate derived JSON when requested.',
    promptGuidelines: ['Use workflow_validate before advancing SDD phases or when workflow JSON or execution-scope state may be stale; it never edits semantic Markdown artifacts.'],
    parameters: validateWorkflowSchema,
    async execute(_toolCallId: string, params: ValidateWorkflowInput, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) {
      const validation = await validateWorkflows(ctx.cwd, params);
      const summary = validationSummary(validation);
      const text = params.verbose ? `${summary}\n${boundedJson(validation)}` : summary;
      return { content: [{ type: 'text', text }], details: validation };
    },
  };
}
