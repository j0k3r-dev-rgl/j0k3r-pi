import { resolve, join } from 'node:path';
import { recordWorkflow } from '../core/flow-check.ts';
import { diagnosticPage } from './diagnostic.ts';

const text = { type: 'string', minLength: 1, maxLength: 4096 };
const actionSchema = {
  authorize: { required: ['author', 'reference', 'plan_sha256'], optional: [] },
  baseline: { required: [], optional: ['label'] },
  candidate: { required: ['executors', 'files'], optional: [] },
  verify: { required: ['executor'], optional: [] },
  archive: { required: ['author', 'reference'], optional: ['date'] },
};

export function createWorkflowRecordTool(withMutationQueue) {
  return {
    name: 'workflow_record',
    label: 'Workflow Record',
    description: 'Orchestrator-only Planned Workflow receipt and archive operations: record already granted apply consent (authorize), capture metadata-only Surface Check baselines in flow.json (baseline), capture the complete candidate (candidate), record independent verification (verify), or safely atomic-archive a verified change to openspec/archive/YYYY-MM-DD/<slug>/ with explicit archive approval (archive). Never creates consent, implements code, runs tests, or delegates. Use workflow_check before/after the applicable boundary.',
    promptSnippet: 'Record approved workflow authorization, baseline, candidate, independent verification, or atomic archive without shell commands',
    promptGuidelines: [
      'Use workflow_record only as the orchestrator after announcing the flow.json or archive write; workers must use workflow_check, not workflow_record.',
      'For workflow_record authorize, supply explicit existing user consent and the plan_sha256 returned by workflow_check; never infer consent from READY or PASS.',
      'For workflow_record baseline, capture a metadata-only pre-apply baseline in flow.json before delegating implementation; then use workflow_check phase="surface".',
      'For workflow_record candidate, include every baseline-relative deliverable (from workflow_check phase="surface") and all actual implementation session IDs. For verify use the actual independent verifier session ID.',
      'For workflow_record archive, require explicit user archive approval (author and reference); executes deliver + continuity + symlink/same-filesystem checks and atomic rename with no copy/delete fallback.',
    ],
    executionMode: 'sequential',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    parameters: {
      type: 'object', additionalProperties: false, required: ['change_dir', 'action'],
      properties: {
        change_dir: { ...text, description: 'Assigned change directory, absolute or workspace-relative.' },
        action: { type: 'string', enum: ['authorize', 'baseline', 'candidate', 'verify', 'archive'] },
        author: { ...text, description: 'authorize / archive: user who explicitly approved implementation or archive.' },
        reference: { ...text, description: 'authorize / archive: actual approval message/time reference.' },
        plan_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'authorize: digest of the actual reviewed plan from workflow_check.' },
        label: { type: 'string', minLength: 1, maxLength: 256, description: 'baseline: optional human-readable label for this baseline entry.' },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'archive: optional archive date YYYY-MM-DD (defaults to UTC today).' },
        executors: { type: 'array', minItems: 1, maxItems: 1000, items: text, description: 'candidate: actual implementation nested-session IDs, including every Parallel Unit.' },
        files: { type: 'array', minItems: 1, maxItems: 10000, items: text, description: 'candidate: complete absolute deliverable paths from the Surface Check, including deletions.' },
        executor: { ...text, description: 'verify: actual independent verification nested-session ID.' },
        diagnostic_offset: { type: 'integer', minimum: 0, description: 'Continue a failed operation diagnostic using next_offset; keep inputs and artifacts unchanged. Never retry successful writes for pagination.' },
      },
    },
    async execute(_id, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const spec = Object.hasOwn(actionSchema, params?.action) ? actionSchema[params.action] : undefined;
      if (!spec || typeof params.change_dir !== 'string' || !params.change_dir.trim() || params.change_dir.includes('\0') ||
          Object.keys(params).some((key) => !['change_dir', 'action', 'diagnostic_offset', ...spec.required, ...spec.optional].includes(key)) ||
          spec.required.some((key) => params[key] === undefined)) throw new Error('Invalid workflow_record action fields');
      const presentFields = [...spec.required, ...spec.optional.filter((key) => params[key] !== undefined)];
      for (const key of ['change_dir', ...presentFields]) {
        const values = Array.isArray(params[key]) ? params[key] : [params[key]];
        const maxLen = key === 'label' ? 256 : 4096;
        if (!values.length || values.some((value) => typeof value !== 'string' || !value.trim() || value.length > maxLen || value.includes('\0'))) throw new Error(`Invalid workflow_record ${key}`);
      }
      if ((params.action === 'candidate' && (!Array.isArray(params.executors) || !Array.isArray(params.files) || params.executors.length > 1000 || params.files.length > 10000)) ||
          (params.action === 'authorize' && (typeof params.plan_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(params.plan_sha256))) ||
          (params.action === 'archive' && params.date !== undefined && (typeof params.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(params.date)))) {
        throw new Error('Invalid workflow_record candidate arrays, plan digest, or archive date');
      }
      if (!params.change_dir.replace(/^@/, '').trim()) throw new Error('Invalid workflow_record change_dir');
      if (params.diagnostic_offset !== undefined && (!Number.isSafeInteger(params.diagnostic_offset) || params.diagnostic_offset < 0)) throw new Error('Invalid workflow_record diagnostic_offset');
      const change_dir = resolve(ctx.cwd, params.change_dir.replace(/^@/, ''));
      signal?.throwIfAborted();
      return withMutationQueue(join(change_dir, 'flow.json'), async () => {
        signal?.throwIfAborted();
        try {
          const validation = recordWorkflow(change_dir, params.action, params);
          const next_action = {
            authorize: 'Run workflow_check phase apply; capture the Surface Check baseline via workflow_record action="baseline" before delegating implementation.',
            baseline: 'Delegate authorized implementation; after apply completes, run workflow_check phase="surface" against this baseline.',
            candidate: 'Run workflow_check phase verify, then delegate independent verification.',
            verify: 'Run workflow_check phase deliver; archive only with explicit user archive approval via workflow_record action="archive".',
            archive: 'Report the archive destination to the user. No further workflow mutation.',
          }[params.action];
          let body;
          if (params.action === 'baseline') {
            const labelPart = validation.baseline_label ? ` (${validation.baseline_label})` : '';
            body = `workflow_record: PASS baseline\nBaseline ID: ${validation.baseline_id}${labelPart}\nFiles Captured: ${validation.file_count}\nBaseline SHA-256: ${validation.baseline_sha256}\nReceipt: ${join(change_dir, 'flow.json')}\nNext permitted action: ${next_action}`;
          } else if (params.action === 'archive') {
            body = `workflow_record: PASS archive\nSource: ${validation.source}\nDestination: ${validation.destination}\nArchived Files: ${validation.archived_files}\nReceipt: ${join(validation.destination, 'flow.json')}\nNext permitted action: ${next_action}`;
          } else {
            body = `workflow_record: PASS ${params.action}\nReceipt: ${join(change_dir, 'flow.json')}\nNext permitted action: ${next_action}`;
          }
          return {
            content: [{ type: 'text', text: body }],
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
