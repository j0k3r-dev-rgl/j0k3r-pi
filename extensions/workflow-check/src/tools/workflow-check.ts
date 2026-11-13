import { resolve } from 'node:path';
import { checkWorkflow } from '../core/flow-check.ts';

const phases = ['plan', 'apply', 'verify', 'deliver'];

import { diagnosticPage } from './diagnostic.ts';

export function createWorkflowCheckTool() {
  return {
    name: 'workflow_check',
    label: 'Workflow Check',
    description: 'Read-only Planned Workflow gate before handing off a plan or advancing phases. Checks the installed canonical validator, not tests or product acceptance. No shell commands, receipt writes, approvals, or repair. Diagnostics are paged at 4,000 characters/100 lines; use diagnostic_offset when next_offset is returned.',
    promptSnippet: 'Validate a Planned Workflow change using change_dir and phase, without a shell command',
    promptGuidelines: [
      'Use workflow_check with phase plan before a new plan READY handoff; fix structural defects in the assigned plan and recheck in the same invocation.',
      'Use workflow_check at the applicable orchestrator phase gate. PASS is structural/continuity evidence, never user consent or functional acceptance.',
    ],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['change_dir', 'phase'],
      properties: {
        change_dir: { type: 'string', minLength: 1, maxLength: 4096, description: 'Assigned change directory, absolute or relative to the current workspace.' },
        phase: { type: 'string', enum: phases, description: 'plan validates the plan; apply requires approval receipt; verify also requires candidate continuity; deliver also requires independent verification receipt.' },
        diagnostic_offset: { type: 'integer', minimum: 0, description: 'Continue a diagnostic using the returned next_offset; reruns the check, so keep artifacts unchanged between pages.' },
      },
    },
    async execute(_id, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!params || Object.keys(params).some((key) => !['change_dir', 'phase', 'diagnostic_offset'].includes(key)) ||
          typeof params.change_dir !== 'string' || !params.change_dir.trim() || params.change_dir.length > 4096 || params.change_dir.includes('\0') ||
          !phases.includes(params.phase) || (params.diagnostic_offset !== undefined && (!Number.isSafeInteger(params.diagnostic_offset) || params.diagnostic_offset < 0))) {
        throw new Error('Invalid workflow_check arguments: provide change_dir, phase, and optional diagnostic_offset only');
      }
      const path = params.change_dir.replace(/^@/, '');
      if (!path.trim()) throw new Error('Invalid workflow_check change_dir');
      const change_dir = resolve(ctx.cwd, path);
      let status = 'PASS';
      let validation = {};
      let diagnostic;
      try {
        validation = checkWorkflow(change_dir, params.phase);
        diagnostic = `flow-check: PASS ${params.phase} (${validation.contract_count} contracts)`;
      } catch (error) {
        signal?.throwIfAborted();
        status = 'BLOCKED';
        diagnostic = `flow-check: BLOCKED ${error instanceof Error ? error.message : String(error)}`;
      }
      signal?.throwIfAborted();
      const offset = params.diagnostic_offset ?? 0;
      const page = diagnosticPage(diagnostic, offset);
      const continuation = page.next === undefined ? '' : `\nMore diagnostic: call workflow_check with the same change_dir and phase, diagnostic_offset: ${page.next}.`;
      const next_action = status === 'BLOCKED' ? 'Stop dependent work; resolve the diagnostic within assigned authority and recheck. No automatic phase advancement.' : {
        plan: 'Orchestrator reviews the plan and applicable explicit implementation consent before workflow_record authorize.',
        apply: 'Capture the Surface Check baseline, then delegate authorized implementation; workers complete required tests and their apply summary.',
        verify: 'Independently verify every MINI and write verify.md before the orchestrator records verification.',
        deliver: 'Report verified completion; archive only with explicit approval and Archive Safety Checks.',
      }[params.phase];
      return {
        content: [{ type: 'text', text: `${page.text}\nDiagnostic range ${offset}-${page.end} of ${page.total}.${continuation}${validation.plan_sha256 ? `\nPlan SHA-256: ${validation.plan_sha256}` : ''}\nNext permitted action: ${next_action}` }],
        details: { status, phase: params.phase, change_dir, ...validation, next_action, diagnostic_offset: offset, diagnostic_end: page.end, diagnostic_total: page.total, next_offset: page.next },
        isError: status !== 'PASS',
      };
    },
  };
}
