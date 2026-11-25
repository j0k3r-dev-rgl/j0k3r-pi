import { resolve } from 'node:path';
import { checkWorkflow } from '../core/flow-check.ts';
import { diagnosticPage } from './diagnostic.ts';

const phases = ['plan', 'apply', 'verify', 'deliver', 'snapshot', 'surface'];

function formatJsonLinesArray(items) {
  if (!items.length) return '[]';
  return `[\n${items.map((item) => JSON.stringify(item)).join(',\n')}\n]`;
}

function formatSnapshotDiagnostic(status, validation) {
  const lines = [
    `flow-check: ${status} snapshot`,
    `Continuity: ${validation.continuity_status}`,
    `Contracts: ${validation.contracts_status}`,
    `Candidate SHA-256: ${validation.candidate_sha256}`,
    `Recorded Candidate SHA-256: ${validation.recorded_candidate_sha256}`,
    `Snapshot SHA-256: ${validation.snapshot_sha256}`,
    `Record Count: ${validation.snapshot_records.length}`,
  ];
  if (validation.drift.length > 0) {
    lines.push('Drift Details:', formatJsonLinesArray(validation.drift));
  }
  lines.push('Snapshot Records JSON:', formatJsonLinesArray(validation.snapshot_records));
  return lines.join('\n');
}

function formatSurfaceDiagnostic(status, validation) {
  const lines = [
    `flow-check: ${status} surface`,
    `Baseline: ${validation.baseline_id}${validation.baseline_label ? ` (${validation.baseline_label})` : ''}`,
    `Surface Status: ${validation.surface_status}`,
    `Contracts: ${validation.contracts_status}`,
    `Deltas: created=${validation.created.length}, modified=${validation.modified.length}, deleted=${validation.deleted.length}`,
    `Violations: ${validation.violations.length}`,
  ];
  if (validation.violations.length > 0) {
    lines.push('Violation Details:', formatJsonLinesArray(validation.violations));
  }
  const ownerEntries = Object.keys(validation.by_owner).sort().map((owner) => [owner, validation.by_owner[owner]]);
  lines.push('Attributed Deltas By Owner:', JSON.stringify(Object.fromEntries(ownerEntries)));
  lines.push('Candidate Files JSON:', formatJsonLinesArray(validation.candidate_files));
  return lines.join('\n');
}

export function createWorkflowCheckTool() {
  return {
    name: 'workflow_check',
    label: 'Workflow Check',
    description: 'Read-only Planned Workflow gate and continuity/surface inspector. Checks the installed canonical validator, computes canonical continuity snapshots (phase="snapshot"), or attributes baseline-relative Surface Check deltas (phase="surface"). No shell commands, receipt writes, approvals, or repair. Outputs and diagnostics are losslessly paged at 4,000 characters/100 lines; use diagnostic_offset when next_offset is returned.',
    promptSnippet: 'Validate a Planned Workflow change, compute continuity snapshot, or run baseline-relative Surface Check using change_dir and phase',
    promptGuidelines: [
      'Use workflow_check with phase plan before a new plan READY handoff; fix structural defects in the assigned plan and recheck in the same invocation.',
      'Use workflow_check with phase snapshot during independent verification or pre-archive continuity checks instead of ad-hoc hashing scripts; page with diagnostic_offset when next_offset is returned.',
      'Use workflow_check with phase surface after apply against a captured baseline to attribute deltas and obtain exact candidate_files.',
      'Use workflow_check at the applicable orchestrator phase gate. PASS is structural/continuity evidence, never user consent or functional acceptance.',
    ],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['change_dir', 'phase'],
      properties: {
        change_dir: { type: 'string', minLength: 1, maxLength: 4096, description: 'Assigned change directory, absolute or relative to the current workspace.' },
        phase: { type: 'string', enum: phases, description: 'plan validates the plan; apply requires approval receipt; verify also requires candidate continuity; deliver also requires independent verification receipt; snapshot computes read-only continuity snapshot against flow.json; surface compares current workspace against a captured baseline.' },
        baseline_id: { type: 'string', minLength: 1, maxLength: 256, description: 'surface only: optional baseline ID or label from flow.json (defaults to the latest captured baseline).' },
        diagnostic_offset: { type: 'integer', minimum: 0, description: 'Continue a diagnostic or paged report using the returned next_offset; reruns the check, so keep artifacts unchanged between pages.' },
      },
    },
    async execute(_id, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!params || Object.keys(params).some((key) => !['change_dir', 'phase', 'baseline_id', 'diagnostic_offset'].includes(key)) ||
          typeof params.change_dir !== 'string' || !params.change_dir.trim() || params.change_dir.length > 4096 || params.change_dir.includes('\0') ||
          !phases.includes(params.phase) ||
          (params.baseline_id !== undefined && (params.phase !== 'surface' || typeof params.baseline_id !== 'string' || !params.baseline_id.trim() || params.baseline_id.length > 256 || params.baseline_id.includes('\0'))) ||
          (params.diagnostic_offset !== undefined && (!Number.isSafeInteger(params.diagnostic_offset) || params.diagnostic_offset < 0))) {
        throw new Error('Invalid workflow_check arguments: provide change_dir, phase, optional baseline_id (surface only), and optional diagnostic_offset only');
      }
      const path = params.change_dir.replace(/^@/, '');
      if (!path.trim()) throw new Error('Invalid workflow_check change_dir');
      const change_dir = resolve(ctx.cwd, path);
      let status = 'PASS';
      let validation = {};
      let diagnostic;
      try {
        const checkOptions = params.baseline_id !== undefined ? { baseline_id: params.baseline_id.trim() } : undefined;
        validation = checkWorkflow(change_dir, params.phase, checkOptions);
        if (params.phase === 'snapshot') {
          status = validation.continuity_status === 'MATCH' ? 'PASS' : 'BLOCKED';
          validation = {
            ...validation,
            record_count: validation.snapshot_records.length,
            drift_count: validation.drift.length,
          };
          diagnostic = formatSnapshotDiagnostic(status, validation);
        } else if (params.phase === 'surface') {
          status = validation.surface_status === 'CLEAN' ? 'PASS' : 'BLOCKED';
          validation = {
            ...validation,
            delta_count: validation.deltas.length,
            violation_count: validation.violations.length,
          };
          diagnostic = formatSurfaceDiagnostic(status, validation);
        } else {
          diagnostic = `flow-check: PASS ${params.phase} (${validation.contract_count} contracts)`;
        }
      } catch (error) {
        signal?.throwIfAborted();
        status = 'BLOCKED';
        diagnostic = `flow-check: BLOCKED ${error instanceof Error ? error.message : String(error)}`;
      }
      signal?.throwIfAborted();
      const offset = params.diagnostic_offset ?? 0;
      const page = diagnosticPage(diagnostic, offset);
      const baselineHint = params.baseline_id !== undefined ? `, baseline_id: ${JSON.stringify(params.baseline_id.trim())}` : '';
      const continuation = page.next === undefined ? '' : `\nMore diagnostic: call workflow_check with the same change_dir and phase${baselineHint}, diagnostic_offset: ${page.next}.`;
      const next_action = status === 'BLOCKED' ? 'Stop dependent work; resolve the diagnostic within assigned authority and recheck. No automatic phase advancement.' : {
        plan: 'Orchestrator reviews the plan and applicable explicit implementation consent before workflow_record authorize.',
        apply: 'Capture the Surface Check baseline via workflow_record action="baseline", then delegate authorized implementation; workers complete required tests and their apply summary.',
        verify: 'Independently verify every MINI, capture continuity via workflow_check phase="snapshot", and write verify.md before the orchestrator records verification.',
        deliver: 'Report verified completion; archive only with explicit approval via workflow_record action="archive".',
        snapshot: 'Record the returned continuity snapshot records and snapshot_sha256 in verify.md, then proceed to workflow_record verify or archive.',
        surface: 'Pass candidate_files and all actual implementation session IDs to workflow_record action="candidate".',
      }[params.phase];
      return {
        content: [{ type: 'text', text: `${page.text}\nDiagnostic range ${offset}-${page.end} of ${page.total}.${continuation}${validation.plan_sha256 ? `\nPlan SHA-256: ${validation.plan_sha256}` : ''}\nNext permitted action: ${next_action}` }],
        details: { status, phase: params.phase, change_dir, ...validation, next_action, diagnostic_offset: offset, diagnostic_end: page.end, diagnostic_total: page.total, next_offset: page.next },
        isError: status !== 'PASS',
      };
    },
  };
}
