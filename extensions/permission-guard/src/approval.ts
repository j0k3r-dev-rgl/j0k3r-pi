import { buildProjectPathApproval, buildScopedBashApproval, projectSafeCommandPatternFor } from './project-approval.js';
import { buildSessionApprovalEntry, type SessionApprovalCache } from './session-cache.js';
import type {
  ApprovalChoice,
  PermissionDecisionResult,
  PermissionPolicyConfig,
  PermissionRequest,
  PermissionRequiredPayload,
  ScopedBashApproval,
} from './types.js';

export const APPROVAL_CHOICES = [
  'Allow once',
  'Allow for session',
  'Allow for project',
  'Allow this file for project',
  'Allow this folder for project',
  'Deny',
] as const satisfies readonly ApprovalChoice[];

export interface ApprovalPrompt {
  title: string;
  message: string;
  choices: ApprovalChoice[];
  safeTarget?: string;
  safeCommandSummary?: string;
  workspaceRoot?: string;
  limitations?: string[];
}

export interface ResolveApprovalOptions {
  prompt?: (prompt: ApprovalPrompt) => Promise<ApprovalChoice | undefined> | ApprovalChoice | undefined;
  sessionCache?: SessionApprovalCache;
  projectApproval?: (approval: unknown) => Promise<void> | void;
  requestPermissionApproval?: (payload: PermissionRequiredPayload) => Promise<ApprovalChoice | undefined> | ApprovalChoice | undefined;
  interactionChoice?: ApprovalChoice;
}

export interface ApprovalResolution {
  result: PermissionDecisionResult;
  permissionRequired?: PermissionRequiredPayload;
}

function pathProjectApprovalOptions(request: PermissionRequest) {
  return {
    file: buildProjectPathApproval(request, 'file'),
    folder: buildProjectPathApproval(request, 'folder'),
  };
}

function promptChoices(request: PermissionRequest): ApprovalChoice[] {
  const choices: ApprovalChoice[] = ['Allow once', 'Allow for session'];
  const pathOptions = pathProjectApprovalOptions(request);
  const hasExplicitPathProjectChoice = Boolean(pathOptions.file || pathOptions.folder);
  if (!hasExplicitPathProjectChoice) choices.push('Allow for project');
  if (pathOptions.file) choices.push('Allow this file for project');
  if (pathOptions.folder) choices.push('Allow this folder for project');
  choices.push('Deny');
  return choices;
}

function approvalPrompt(request: PermissionRequest, decision: PermissionDecisionResult): ApprovalPrompt {
  const targetOrCommand = decision.details.safeTarget ?? decision.details.safeCommandSummary ?? request.rawInputSummary;
  const scope = decision.details.approvalScope?.allowedRoots.map((root) => root.normalizedAbsolute).join(', ');
  const effectSummary = decision.details.pathEffects?.map((effect) => effect.safeTarget).filter(Boolean).join(', ');
  return {
    title: `Permission required for ${request.tool}`,
    message: `${decision.reason} (${decision.reasonCode}). Requested ${request.action}: ${targetOrCommand}${scope ? `. Scope: ${scope}` : ''}${effectSummary ? `. Effects: ${effectSummary}` : ''}`,
    choices: promptChoices(request),
    safeTarget: decision.details.safeTarget,
    safeCommandSummary: decision.details.safeCommandSummary,
    workspaceRoot: decision.details.workspaceRoot,
    limitations: ['The permission guard is an in-process guard, not a hard sandbox.'],
  };
}

function sessionScope(request: PermissionRequest, decision: PermissionDecisionResult, cacheKey: string): PermissionRequiredPayload['sessionScope'] {
  const commandPattern = request.command?.raw.trim().replace(/\s+/g, ' ');
  return {
    cacheKey,
    action: request.action,
    tool: request.tool,
    targetPattern: request.target?.normalizedAbsolute,
    commandPattern,
    policyIdentity: request.policyIdentity,
    bashApproval: buildScopedBashApproval(request, decision),
  };
}

function withApprovalResult(
  decision: PermissionDecisionResult,
  approved: boolean,
  reasonCode: 'approval_allow_once' | 'approval_allow_session' | 'approval_denied',
): PermissionDecisionResult {
  return {
    ...decision,
    decision: approved ? 'allow' : 'deny',
    finalDecision: approved ? 'allow' : 'deny',
    reason: approved ? 'User approved this permission request.' : 'User denied this permission request.',
    reasonCode,
    riskLevel: approved ? decision.riskLevel : 'high',
    audit: true,
  };
}

function nonInteractiveFallback(config: PermissionPolicyConfig, decision: PermissionDecisionResult): PermissionDecisionResult {
  const allow = config.nonInteractive.onAsk === 'allow';
  return {
    ...decision,
    decision: allow ? 'allow' : 'deny',
    finalDecision: allow ? 'allow' : 'deny',
    reason: allow
      ? 'Approval could not be collected, and non-interactive policy allows ask decisions.'
      : 'Approval could not be collected, so the request is denied by non-interactive policy.',
    reasonCode: allow ? 'non_interactive_ask_allowed' : 'non_interactive_ask_denied',
    riskLevel: allow ? decision.riskLevel : 'high',
    details: { ...decision.details, matchedLayer: 'nonInteractive' },
    audit: allow ? config.audit.enabled && config.audit.logAllowed : config.audit.enabled && config.audit.logDenied,
  };
}

export function buildPermissionRequiredPayload(
  request: PermissionRequest,
  decision: PermissionDecisionResult,
): PermissionRequiredPayload {
  const cacheKey = decision.cacheKey ?? `approval:${request.policyIdentity}:${request.tool}:${request.action}:${request.target?.normalizedAbsolute ?? request.command?.raw.trim().replace(/\s+/g, ' ') ?? request.id}`;
  const bashApproval = buildScopedBashApproval(request, decision);
  const pathApprovalOptions = pathProjectApprovalOptions(request);
  return {
    type: 'interaction_required',
    requestId: request.id,
    tool: request.tool,
    action: request.action,
    origin: request.origin,
    requester: request.requester,
    reason: decision.reason,
    reasonCode: decision.reasonCode,
    riskLevel: decision.riskLevel,
    prompt: approvalPrompt(request, decision),
    sessionScope: sessionScope(request, decision, cacheKey),
    projectScope: {
      safeCommandPattern: projectSafeCommandPatternFor(request, decision),
      bashApproval,
      pathApprovalOptions: pathApprovalOptions.file || pathApprovalOptions.folder ? pathApprovalOptions : undefined,
    },
  };
}

export async function resolveApproval(
  config: PermissionPolicyConfig,
  request: PermissionRequest,
  decision: PermissionDecisionResult,
  options: ResolveApprovalOptions = {},
): Promise<ApprovalResolution> {
  if (decision.decision !== 'ask' && decision.finalDecision !== 'requires_approval') {
    return { result: decision };
  }

  if (request.origin === 'subagent' && !options.interactionChoice) {
    const payload = buildPermissionRequiredPayload(request, decision);
    return {
      result: {
        ...decision,
        decision: 'ask',
        finalDecision: 'requires_approval',
        reason: 'Human interaction must be collected by the main thread.',
        reasonCode: 'interaction_required',
        audit: false,
      },
      permissionRequired: payload,
    };
  }

  if (!request.hasUI && !options.interactionChoice) {
    return { result: nonInteractiveFallback(config, decision) };
  }

  const approvalPayload = buildPermissionRequiredPayload(request, decision);
  const resolveChoice = async (): Promise<ApprovalChoice | undefined> => {
    if (options.requestPermissionApproval) {
      const choice = await options.requestPermissionApproval(approvalPayload);
      if (choice) return choice;
    }

    if (!options.prompt) return undefined;
    return options.prompt(approvalPrompt(request, decision));
  };

  const choice = options.interactionChoice ?? await resolveChoice();
  if (!choice) {
    return { result: nonInteractiveFallback(config, decision) };
  }

  if (choice === 'Deny') return { result: withApprovalResult(decision, false, 'approval_denied') };
  if (choice === 'Allow once') return { result: withApprovalResult(decision, true, 'approval_allow_once') };
  if (choice === 'Allow for project') {
    const bashApproval = buildScopedBashApproval(request, decision);
    const pattern = projectSafeCommandPatternFor(request, decision);
    if (options.projectApproval) {
      if (bashApproval) await options.projectApproval(bashApproval);
      else if (pattern) await options.projectApproval(pattern);
    }
    return { result: withApprovalResult(decision, true, 'approval_allow_once') };
  }
  if (choice === 'Allow this file for project' || choice === 'Allow this folder for project') {
    const approval = choice === 'Allow this file for project'
      ? buildProjectPathApproval(request, 'file')
      : buildProjectPathApproval(request, 'folder');
    if (approval && options.projectApproval) await options.projectApproval(approval);
    return { result: withApprovalResult(decision, true, 'approval_allow_once') };
  }

  const cacheEnabled = config.approvals.sessionCache && config.approvals.allowForSession && Boolean(options.sessionCache);
  const entry = cacheEnabled ? buildSessionApprovalEntry(request, decision, options.sessionCache!.sessionId) : undefined;
  if (entry) {
    options.sessionCache!.add(entry);
    return { result: { ...withApprovalResult(decision, true, 'approval_allow_session'), cacheKey: entry.cacheKey } };
  }

  return { result: withApprovalResult(decision, true, 'approval_allow_once') };
}
