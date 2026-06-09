import { buildSessionApprovalEntry, type SessionApprovalCache } from './session-cache.js';
import type {
  ApprovalChoice,
  PermissionDecisionResult,
  PermissionPolicyConfig,
  PermissionRequest,
  PermissionRequiredPayload,
} from './types.js';

export const APPROVAL_CHOICES = ['Allow once', 'Allow for session', 'Deny'] as const satisfies readonly ApprovalChoice[];

export interface ApprovalPrompt {
  title: string;
  message: string;
  choices: ['Allow once', 'Allow for session', 'Deny'];
  safeTarget?: string;
  safeCommandSummary?: string;
  workspaceRoot?: string;
  limitations?: string[];
}

export interface ResolveApprovalOptions {
  prompt?: (prompt: ApprovalPrompt) => Promise<ApprovalChoice> | ApprovalChoice;
  sessionCache?: SessionApprovalCache;
}

export interface ApprovalResolution {
  result: PermissionDecisionResult;
  permissionRequired?: PermissionRequiredPayload;
}

function approvalPrompt(request: PermissionRequest, decision: PermissionDecisionResult): ApprovalPrompt {
  const targetOrCommand = decision.details.safeTarget ?? decision.details.safeCommandSummary ?? request.rawInputSummary;
  return {
    title: `Permission required for ${request.tool}`,
    message: `${decision.reason} (${decision.reasonCode}). Requested ${request.action}: ${targetOrCommand}`,
    choices: [...APPROVAL_CHOICES],
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
  return {
    type: 'permission_required',
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

  if (request.origin === 'subagent') {
    const payload = buildPermissionRequiredPayload(request, decision);
    return {
      result: {
        ...decision,
        decision: 'ask',
        finalDecision: 'requires_approval',
        reason: 'Permission approval must be collected by the main thread.',
        reasonCode: 'permission_required',
        audit: false,
      },
      permissionRequired: payload,
    };
  }

  if (!request.hasUI) {
    return { result: nonInteractiveFallback(config, decision) };
  }

  if (!options.prompt) {
    return { result: nonInteractiveFallback(config, decision) };
  }

  const choice = await options.prompt(approvalPrompt(request, decision));
  if (choice === 'Deny') return { result: withApprovalResult(decision, false, 'approval_denied') };
  if (choice === 'Allow once') return { result: withApprovalResult(decision, true, 'approval_allow_once') };

  const cacheEnabled = config.approvals.sessionCache && config.approvals.allowForSession && Boolean(options.sessionCache);
  const entry = cacheEnabled ? buildSessionApprovalEntry(request, decision, options.sessionCache!.sessionId) : undefined;
  if (entry) {
    options.sessionCache!.add(entry);
    return { result: { ...withApprovalResult(decision, true, 'approval_allow_session'), cacheKey: entry.cacheKey } };
  }

  return { result: withApprovalResult(decision, true, 'approval_allow_once') };
}
