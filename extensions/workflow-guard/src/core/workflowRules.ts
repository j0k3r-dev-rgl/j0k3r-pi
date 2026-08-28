import type { ArtifactState, ChangeWorkflowState, WorkflowKind, WorkflowStatus } from '../types.js';

const formalNames = ['proposal.md', 'spec.md', 'design.md', 'tasks.md'];

export function detectWorkflow(artifacts: Record<string, ArtifactState>): WorkflowKind {
  const hasMini = artifacts['mini-sdd.md']?.exists === true;
  const hasFormal = formalNames.some((name) => artifacts[name]?.exists);
  if (hasMini && hasFormal) return 'conflict';
  if (hasMini) return 'mini-sdd';
  if (hasFormal) return 'formal-sdd';
  return 'unknown';
}

function artifactBlockers(name: string, artifact?: ArtifactState): string[] {
  if (!artifact?.exists) return [];
  const blockers = [...artifact.blockers];
  if (artifact.status === 'BLOCKED' || artifact.status === 'FAILED') blockers.push(`${name} is ${artifact.status}.`);
  blockers.push(...artifact.warnings.map((warning) => `${name}: ${warning}`));
  return blockers;
}

function ready(artifacts: Record<string, ArtifactState>, name: string): boolean {
  return artifacts[name]?.exists === true && artifacts[name].status === 'READY';
}

export function deriveStateFields(workflow: WorkflowKind, artifacts: Record<string, ArtifactState>): Pick<ChangeWorkflowState, 'phase' | 'status' | 'freshness' | 'next_allowed' | 'blockers' | 'warnings'> {
  const warnings = Object.entries(artifacts).flatMap(([name, artifact]) => artifact.warnings.map((warning) => `${name}: ${warning}`));
  const blockers = Object.entries(artifacts).flatMap(([name, artifact]) => artifactBlockers(name, artifact));

  if (workflow === 'conflict') {
    return { phase: 'workflow-conflict', status: 'BLOCKED', freshness: 'CONFLICT', next_allowed: ['notify-user', 'ask-user-decision'], blockers: ['Change contains both Mini-SDD and Formal SDD signatures.'], warnings };
  }
  if (workflow === 'unknown') {
    return { phase: 'contract-missing', status: 'BLOCKED', freshness: 'UNKNOWN', next_allowed: ['create-contract'], blockers: ['No Mini-SDD or Formal SDD contract artifact found.'], warnings };
  }

  if (workflow === 'mini-sdd') {
    if (!artifacts['mini-sdd.md']?.exists) return { phase: 'contract-missing', status: 'BLOCKED', freshness: 'CURRENT', next_allowed: ['create-mini-sdd'], blockers, warnings };
    if (!ready(artifacts, 'mini-sdd.md')) return { phase: 'contract-blocked', status: 'BLOCKED', freshness: 'CURRENT', next_allowed: ['return-to-mini-sdd'], blockers, warnings };
    return deriveApplyVerifyArchive(artifacts, blockers, warnings);
  }

  const formalChain: Array<[string, string, string]> = [
    ['proposal.md', 'proposal-missing', 'proposal-blocked'],
    ['spec.md', 'ready-for-spec', 'spec-blocked'],
    ['design.md', 'ready-for-design', 'design-blocked'],
    ['tasks.md', 'ready-for-tasks', 'tasks-blocked'],
  ];
  for (const [name, missingPhase, blockedPhase] of formalChain) {
    if (!artifacts[name]?.exists) return { phase: missingPhase, status: 'BLOCKED', freshness: 'CURRENT', next_allowed: [`create-${name.replace('.md', '')}`], blockers, warnings };
    if (!ready(artifacts, name)) return { phase: blockedPhase, status: 'BLOCKED', freshness: 'CURRENT', next_allowed: [`return-to-${name.replace('.md', '')}`], blockers, warnings };
  }
  return deriveApplyVerifyArchive(artifacts, blockers, warnings);
}

function deriveApplyVerifyArchive(artifacts: Record<string, ArtifactState>, blockers: string[], warnings: string[]): Pick<ChangeWorkflowState, 'phase' | 'status' | 'freshness' | 'next_allowed' | 'blockers' | 'warnings'> {
  if (!artifacts['apply.md']?.exists) return { phase: 'ready-for-apply', status: 'READY', freshness: 'CURRENT', next_allowed: ['sdd-apply'], blockers, warnings };
  if (!ready(artifacts, 'apply.md')) return { phase: 'apply-blocked', status: 'BLOCKED', freshness: 'CURRENT', next_allowed: ['return-to-apply-after-user-decision'], blockers, warnings };
  if (!artifacts['verify.md']?.exists) return { phase: 'ready-for-verify', status: 'READY', freshness: 'CURRENT', next_allowed: ['sdd-verify'], blockers, warnings };
  const verify = artifacts['verify.md'];
  if (verify.status !== 'READY' || verify.verification_result !== 'PASS') {
    const extra = verify.verification_result === undefined ? ['verify.md lacks Verification Result: PASS.'] : [`verify.md Verification Result is ${verify.verification_result}, not PASS.`];
    return { phase: 'verify-blocked', status: 'BLOCKED', freshness: 'CURRENT', next_allowed: ['return-to-verify'], blockers: [...blockers, ...extra], warnings };
  }
  return { phase: 'ready-for-archive', status: 'READY', freshness: 'CURRENT', next_allowed: ['sdd-archive'], blockers, warnings };
}

export function worstStatus(states: WorkflowStatus[]): WorkflowStatus {
  if (states.includes('BLOCKED')) return 'BLOCKED';
  if (states.includes('FAILED')) return 'FAILED';
  if (states.includes('CONFLICT')) return 'CONFLICT';
  if (states.includes('STALE')) return 'STALE';
  if (states.includes('UNKNOWN')) return 'UNKNOWN';
  return 'READY';
}
