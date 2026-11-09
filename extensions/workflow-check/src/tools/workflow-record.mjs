import { resolve, join } from 'node:path';
import { recordWorkflow } from '../core/flow-check.mjs';
import { diagnosticPage } from './diagnostic.mjs';

const text = { type: 'string', minLength: 1, maxLength: 4096 };
const fields = {
  authorize: ['author', 'reference', 'plan_sha256'],
  candidate: ['executors', 'files'],
  verify: ['executor'],
};

export function createWorkflowRecordTool(withMutationQueue) {
  return {
    name: 'workflow_record',
    label: 'Workflow Record',
    description: 'Orchestrator-only Planned Workflow receipt operations: record already granted apply consent, capture the complete candidate, or record independent verification. Writes only flow.json. Never creates consent, implements code, runs tests, delegates, or archives. Use workflow_check before/after the applicable boundary.',
    promptSnippet: 'Record approved workflow authorization, candidate, or independent verification without shell commands',
    promptGuidelines: [
      'Use workflow_record only as the orchestrator after announcing the flow.json write; workers must use workflow_check, not workflow_record.',
      'For workflow_record authorize, supply explicit existing user consent and the plan_sha256 returned by workflow_check; never infer consent from READY or PASS.',
      'For workflow_record candidate, include every baseline-relative deliverable and all actual implementation session IDs. For verify use the actual independent verifier session ID.',
    ],
    executionMode: 'sequential',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    parameters: {
      type: 'object', additionalProperties: false, required: ['change_dir', 'action'],
      properties: {
        change_dir: { ...text, description: 'Assigned change directory, absolute or workspace-relative.' },
        action: { type: 'string', enum: ['authorize', 'candidate', 'verify'] },
        author: { ...text, description: 'authorize: user who explicitly approved implementation.' },
        reference: { ...text, description: 'authorize: actual approval message/time reference.' },
        plan_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'authorize: digest of the actual reviewed plan from workflow_check.' },
        executors: { type: 'array', minItems: 1, maxItems: 1000, items: text, description: 'candidate: actual implementation nested-session IDs, including every Parallel Unit.' },
        files: { type: 'array', minItems: 1, maxItems: 10000, items: text, description: 'candidate: complete absolute deliverable paths from the Surface Check, including deletions.' },
        executor: { ...text, description: 'verify: actual independent verification nested-session ID.' },
        diagnostic_offset: { type: 'integer', minimum: 0, description: 'Continue a failed operation diagnostic using next_offset; keep inputs and artifacts unchanged. Never retry successful writes for pagination.' },
      },
    },
    async execute(_id, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const required = Object.hasOwn(fields, params?.action) ? fields[params.action] : undefined;
      if (!required || typeof params.change_dir !== 'string' || !params.change_dir.trim() || params.change_dir.includes('\0') ||
          Object.keys(params).some((key) => !['change_dir', 'action', 'diagnostic_offset', ...required].includes(key)) ||
          required.some((key) => params[key] === undefined)) throw new Error('Invalid workflow_record action fields');
      for (const key of ['change_dir', ...required]) {
        const values = Array.isArray(params[key]) ? params[key] : [params[key]];
        if (!values.length || values.some((value) => typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0'))) throw new Error(`Invalid workflow_record ${key}`);
      }
      if ((params.action === 'candidate' && (!Array.isArray(params.executors) || !Array.isArray(params.files) || params.executors.length > 1000 || params.files.length > 10000)) ||
          (params.action === 'authorize' && (typeof params.plan_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(params.plan_sha256)))) throw new Error('Invalid workflow_record candidate arrays or plan digest');
      if (!params.change_dir.replace(/^@/, '').trim()) throw new Error('Invalid workflow_record change_dir');
      if (params.diagnostic_offset !== undefined && (!Number.isSafeInteger(params.diagnostic_offset) || params.diagnostic_offset < 0)) throw new Error('Invalid workflow_record diagnostic_offset');
      const change_dir = resolve(ctx.cwd, params.change_dir.replace(/^@/, ''));
      signal?.throwIfAborted();
      return withMutationQueue(join(change_dir, 'flow.json'), async () => {
        signal?.throwIfAborted();
        try {
          const validation = recordWorkflow(change_dir, params.action, params);
          const next_action = { authorize: 'Run workflow_check phase apply; capture the Surface Check baseline before delegating implementation.', candidate: 'Run workflow_check phase verify, then delegate independent verification.', verify: 'Run workflow_check phase deliver; archive still requires explicit approval and safety checks.' }[params.action];
          return {
            content: [{ type: 'text', text: `workflow_record: PASS ${params.action}\nReceipt: ${join(change_dir, 'flow.json')}\nNext permitted action: ${next_action}` }],
            details: { status: 'PASS', action: params.action, change_dir, ...validation, next_action },
            isError: false,
          };
        } catch (error) {
          signal?.throwIfAborted();
          const offset = params.diagnostic_offset ?? 0;
          const page = diagnosticPage(`workflow_record: BLOCKED ${error instanceof Error ? error.message : String(error)}`, offset);
          return {
            content: [{ type: 'text', text: `${page.text}\nDiagnostic range ${offset}-${page.end} of ${page.total}.${page.next === undefined ? '' : ` More diagnostic: repeat the failed operation with unchanged inputs/artifacts and diagnostic_offset: ${page.next}.`}\nNext permitted action: Stop dependent work and resolve the blocker within existing authority.` }],
            details: { status: 'BLOCKED', action: params.action, change_dir, diagnostic_offset: offset, diagnostic_end: page.end, diagnostic_total: page.total, next_offset: page.next },
            isError: true,
          };
        }
      });
    },
  };
}
