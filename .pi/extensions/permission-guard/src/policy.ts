import { isAbsolute, relative } from 'node:path';
import { classifyBashCommand } from './bash-policy.js';
import { matchesWorkspaceGlob } from './path-policy.js';
import type { ScopedBashApproval } from './types.js';
import { evaluateSecretDeny } from './secrets.js';
import type { Action, PermissionDecisionResult, PermissionPolicyConfig, PermissionRequest, PolicyDecision, RiskLevel, ToolMode } from './types.js';

export interface SessionApprovalEntry {
  cacheKey: string;
  action: Action;
  tool: string;
  targetPattern?: string;
  commandPattern?: string;
  policyIdentity: string;
  bashApproval?: ScopedBashApproval;
}

export interface SessionApprovalSnapshot {
  entries?: SessionApprovalEntry[];
}

type Target = NonNullable<PermissionRequest['target']>;

function toolPolicyKey(tool: PermissionRequest['tool']): keyof PermissionPolicyConfig['tools'] {
  return tool === 'user_bash' ? 'bash' : tool;
}

function safeTarget(target: Target): string {
  if (target.insideWorkspace && target.workspaceRelative) {
    return target.workspaceRelative === '.' ? '<workspace>' : `<workspace>/${target.workspaceRelative}`;
  }
  return target.normalizedAbsolute;
}

function finalDecisionFor(decision: PolicyDecision): PermissionDecisionResult['finalDecision'] {
  return decision === 'allow' ? 'allow' : decision === 'deny' ? 'deny' : 'requires_approval';
}

function riskFor(decision: PolicyDecision, outside = false): RiskLevel {
  if (decision === 'allow') return outside ? 'medium' : 'low';
  if (decision === 'deny') return outside ? 'high' : 'medium';
  return outside ? 'medium' : 'low';
}

function cacheKeyFor(request: PermissionRequest): string | undefined {
  if (request.target) return `target:${request.policyIdentity}:${request.tool}:${request.action}:${request.target.normalizedAbsolute}`;
  if (request.command) return `command:${request.policyIdentity}:${request.tool}:${request.action}:${request.command.raw.trim().replace(/\s+/g, ' ')}`;
  return undefined;
}

function decisionResult(params: {
  config: PermissionPolicyConfig;
  request: PermissionRequest;
  decision: PolicyDecision;
  reason: string;
  reasonCode: string;
  riskLevel: RiskLevel;
  matchedLayer: PermissionDecisionResult['details']['matchedLayer'];
  matchedRule?: string;
  noPreview?: boolean;
  target?: Target;
  cacheKey?: string;
}): PermissionDecisionResult {
  const details: PermissionDecisionResult['details'] = {
    matchedLayer: params.matchedLayer,
    noPreview: params.noPreview ?? false,
  };
  if (params.target) {
    details.safeTarget = safeTarget(params.target);
    details.workspaceRoot = params.target.workspaceRoot;
  }
  if (params.matchedRule) details.matchedRule = params.matchedRule;

  const result: PermissionDecisionResult = {
    decision: params.decision,
    finalDecision: finalDecisionFor(params.decision),
    reason: params.reason,
    reasonCode: params.reasonCode,
    riskLevel: params.riskLevel,
    details,
    audit:
      params.decision === 'deny'
        ? params.config.audit.enabled && params.config.audit.logDenied
        : params.decision === 'allow'
          ? params.config.audit.enabled && params.config.audit.logAllowed
          : false,
  };
  const cacheKey = params.decision === 'ask' ? params.cacheKey ?? cacheKeyFor(params.request) : undefined;
  if (cacheKey) result.cacheKey = cacheKey;
  return result;
}

function directToolDecision(config: PermissionPolicyConfig, request: PermissionRequest, mode: ToolMode): PermissionDecisionResult | undefined {
  if (mode === 'policy') return undefined;
  return decisionResult({
    config,
    request,
    decision: mode,
    reason: mode === 'allow' ? 'Tool is allowed by per-tool policy mode.' : 'Tool is denied by per-tool policy mode.',
    reasonCode: mode === 'allow' ? 'tool_mode_allow' : 'tool_mode_deny',
    riskLevel: mode === 'allow' ? 'low' : 'high',
    matchedLayer: 'tool',
    matchedRule: `tools.${toolPolicyKey(request.tool)}`,
    target: request.target,
  });
}

function workspaceDecision(config: PermissionPolicyConfig, request: PermissionRequest, target: Target): PermissionDecisionResult {
  if (matchesWorkspaceGlob(target, config.workspace.deny ?? [])) {
    return decisionResult({
      config,
      request,
      decision: 'deny',
      reason: 'Workspace path is denied by policy.',
      reasonCode: 'workspace_path_denied',
      riskLevel: 'high',
      matchedLayer: 'workspace',
      matchedRule: 'workspace.deny',
      target,
    });
  }

  if (matchesWorkspaceGlob(target, config.workspace.ask ?? [])) {
    return decisionResult({
      config,
      request,
      decision: 'ask',
      reason: 'Workspace path requires approval by policy.',
      reasonCode: 'workspace_path_requires_approval',
      riskLevel: 'medium',
      matchedLayer: 'workspace',
      matchedRule: 'workspace.ask',
      target,
    });
  }

  const action = request.action === 'edit' ? 'write' : request.action;
  const decision = action === 'read'
    ? config.workspace.allowRead
    : action === 'list'
      ? config.workspace.list ?? config.workspace.allowRead
      : action === 'search'
        ? config.workspace.search ?? config.workspace.allowRead
        : action === 'create'
          ? config.workspace.allowCreate
          : config.workspace.allowWrite;
  const label = action === 'write' ? 'write' : action;
  return decisionResult({
    config,
    request,
    decision,
    reason: `Workspace ${label} is ${decision === 'ask' ? 'subject to approval' : decision === 'deny' ? 'denied' : 'allowed'} by policy.`,
    reasonCode: `workspace_${label}_${decision === 'ask' ? 'requires_approval' : decision === 'deny' ? 'denied' : 'allowed'}`,
    riskLevel: riskFor(decision),
    matchedLayer: 'workspace',
    target,
  });
}

function outsideDecision(config: PermissionPolicyConfig, request: PermissionRequest, target: Target): PermissionDecisionResult {
  const action = request.action === 'edit' ? 'write' : request.action;
  const decision = action === 'list'
    ? config.outsideWorkspace.list
    : action === 'search'
      ? config.outsideWorkspace.search ?? config.outsideWorkspace.read
      : action === 'create'
        ? config.outsideWorkspace.create
        : action === 'write'
          ? config.outsideWorkspace.write
          : config.outsideWorkspace.read;
  const label = action === 'write' ? 'write' : action;

  return decisionResult({
    config,
    request,
    decision,
    reason: `Outside-workspace ${label} is ${decision === 'ask' ? 'subject to approval' : decision === 'deny' ? 'denied' : 'allowed'} by policy.`,
    reasonCode: `outside_workspace_${label}_${decision === 'ask' ? 'requires_approval' : decision === 'deny' ? 'denied' : 'allowed'}`,
    riskLevel: riskFor(decision, true),
    matchedLayer: 'outsideWorkspace',
    target,
  });
}

function rootContains(approvedRoot: string, requestedRoot: string): boolean {
  if (approvedRoot === requestedRoot) return true;
  const rel = relative(approvedRoot, requestedRoot);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function approvalInScope(approval: ScopedBashApproval | undefined, result: PermissionDecisionResult): boolean {
  if (!approval || !result.details.shellAnalysis || !result.details.approvalScope) return false;
  if (approval.commandSignature !== result.details.shellAnalysis.commandSignature) return false;
  if (approval.effectSignature !== result.details.shellAnalysis.effectSignature) return false;
  const approvedRoots = approval.allowedRoots.map((root) => root.resolvedRealpath ?? root.normalizedAbsolute);
  return result.details.approvalScope.allowedRoots.every((root) => {
    const requestedRoot = root.resolvedRealpath ?? root.normalizedAbsolute;
    return approvedRoots.some((approvedRoot) => rootContains(approvedRoot, requestedRoot));
  });
}

function findSessionApproval(
  config: PermissionPolicyConfig,
  request: PermissionRequest,
  result: PermissionDecisionResult,
  snapshot?: SessionApprovalSnapshot,
): SessionApprovalEntry | undefined {
  if (result.decision !== 'ask') return undefined;
  if (!config.approvals.sessionCache) return undefined;
  if (!request.hasUI && request.origin !== 'subagent' && !config.nonInteractive.allowSessionApprovals) return undefined;

  const entries = snapshot?.entries ?? [];
  const normalizedCommand = request.command?.raw.trim().replace(/\s+/g, ' ');
  return entries.find((entry) => {
    if (entry.policyIdentity !== request.policyIdentity) return false;
    if (entry.action !== request.action) return false;
    if (entry.tool !== request.tool) return false;
    if (request.action === 'bash') return approvalInScope(entry.bashApproval, result);
    if (request.target) return entry.targetPattern === request.target.normalizedAbsolute;
    if (normalizedCommand) return entry.commandPattern === normalizedCommand;
    return false;
  });
}

function applySessionApproval(config: PermissionPolicyConfig, result: PermissionDecisionResult, entry: SessionApprovalEntry): PermissionDecisionResult {
  return {
    ...result,
    decision: 'allow',
    finalDecision: 'allow',
    reason: 'A scoped session approval allows this request.',
    reasonCode: 'session_approval_allowed',
    riskLevel: result.riskLevel,
    details: {
      ...result.details,
      matchedLayer: 'session',
      matchedRule: entry.cacheKey,
    },
    cacheKey: entry.cacheKey,
    audit: config.audit.enabled && config.audit.logAllowed,
  };
}

function applyNonInteractiveFallback(
  config: PermissionPolicyConfig,
  result: PermissionDecisionResult,
  request: PermissionRequest,
): PermissionDecisionResult {
  if (result.decision !== 'ask' || request.hasUI || request.origin === 'subagent') return result;
  const allow = config.nonInteractive.onAsk === 'allow';
  return {
    ...result,
    decision: allow ? 'allow' : 'deny',
    finalDecision: allow ? 'allow' : 'deny',
    reason: allow
      ? 'Approval could not be collected, and non-interactive policy allows ask decisions.'
      : 'Approval could not be collected, so the request is denied by non-interactive policy.',
    reasonCode: allow ? 'non_interactive_ask_allowed' : 'non_interactive_ask_denied',
    riskLevel: allow ? result.riskLevel : 'high',
    details: {
      ...result.details,
      matchedLayer: 'nonInteractive',
    },
    audit: allow ? config.audit.enabled && config.audit.logAllowed : config.audit.enabled && config.audit.logDenied,
  };
}

export function evaluatePermission(
  config: PermissionPolicyConfig,
  request: PermissionRequest,
  sessionCacheSnapshot?: SessionApprovalSnapshot,
): PermissionDecisionResult {
  if (config.bypassAll) {
    return decisionResult({
      config,
      request,
      decision: 'allow',
      reason: 'Permission guard bypassAll is enabled by JSON policy.',
      reasonCode: 'permission_guard_bypass_all',
      riskLevel: 'critical',
      matchedLayer: 'disabled',
      target: request.target,
    });
  }

  if (!config.enabled) {
    return decisionResult({
      config,
      request,
      decision: 'allow',
      reason: 'Permission guard is disabled by JSON policy.',
      reasonCode: 'permission_guard_disabled',
      riskLevel: 'low',
      matchedLayer: 'disabled',
      target: request.target,
    });
  }

  const toolMode = config.tools[toolPolicyKey(request.tool)];
  const toolResult = directToolDecision(config, request, toolMode);
  if (toolResult) return toolResult;

  const secretResult = evaluateSecretDeny(config, request);
  if (secretResult) return secretResult;

  const baseResult = request.action === 'bash'
    ? classifyBashCommand(config, request, { workspaceRoot: config.workspace.root })
    : request.target?.insideWorkspace
      ? workspaceDecision(config, request, request.target)
      : request.target
        ? outsideDecision(config, request, request.target)
        : decisionResult({
            config,
            request,
            decision: 'deny',
            reason: 'Permission request is missing a policy target.',
            reasonCode: 'missing_policy_target_denied',
            riskLevel: 'high',
            matchedLayer: 'tool',
          });

  const projectApproval = request.action === 'bash'
    ? config.bash.scopedApprovals.find((entry) => approvalInScope(entry, baseResult))
    : undefined;
  if (projectApproval) {
    return {
      ...baseResult,
      decision: 'allow',
      finalDecision: 'allow',
      reason: 'A scoped project approval allows this request.',
      reasonCode: 'project_approval_allowed',
      details: { ...baseResult.details, matchedLayer: 'project', matchedRule: projectApproval.id },
      audit: config.audit.enabled && config.audit.logAllowed,
    };
  }

  const entry = findSessionApproval(config, request, baseResult, sessionCacheSnapshot);
  if (entry) return applySessionApproval(config, baseResult, entry);

  return applyNonInteractiveFallback(config, baseResult, request);
}
