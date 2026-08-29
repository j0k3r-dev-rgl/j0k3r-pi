import { Type, type Static } from 'typebox';
import { validateWorkflows } from '../core/validate.js';
import { boundedJson } from '../render/index.js';

export const validateWorkflowSchema = Type.Object({
  slug: Type.Optional(Type.String({ description: 'OpenSpec active change slug to validate.' })),
  repairDerivedJson: Type.Optional(Type.Boolean({ default: false, description: 'Regenerate only derived workflow JSON under openspec/.' })),
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
      const summary = validation.pass ? 'workflow validation passed' : `workflow validation failed: ${validation.violations.length} violation(s), ${validation.conflicts.length} conflict(s)`;
      return { content: [{ type: 'text', text: `${summary}\nDerived JSON regenerated: ${validation.regenerated_files.length}\n${boundedJson(validation)}` }], details: validation };
    },
  };
}
