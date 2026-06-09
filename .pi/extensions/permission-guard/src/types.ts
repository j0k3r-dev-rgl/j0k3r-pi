export type PolicyDecision = 'allow' | 'ask' | 'deny';
export type ToolMode = 'allow' | 'deny' | 'policy';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type Action = 'read' | 'list' | 'search' | 'write' | 'create' | 'edit' | 'bash';
export type ApprovalChoice = 'Allow once' | 'Allow for session' | 'Deny';
export type PermissionSource = 'tool_call' | 'user_bash';
export type RequestOrigin = 'main' | 'subagent' | 'unknown';

export interface PermissionPolicyConfig {
  enabled: boolean;
  workspace: {
    root?: string;
    allowRead: PolicyDecision;
    allowWrite: PolicyDecision;
    allowCreate: PolicyDecision;
    list?: PolicyDecision;
    search?: PolicyDecision;
    followSymlinks: 'realpath' | 'lexical';
    ask?: string[];
    deny?: string[];
  };
  outsideWorkspace: {
    read: PolicyDecision;
    list: PolicyDecision;
    search?: PolicyDecision;
    write: PolicyDecision;
    create: PolicyDecision;
    rememberApprovals: 'none' | 'session';
  };
  secrets: {
    mode: 'deny';
    denyPaths: string[];
    denyKeyPatterns: string[];
    maxPreviewBytesForPrompt: 0;
  };
  tools: Record<'read' | 'write' | 'edit' | 'grep' | 'find' | 'ls' | 'bash', ToolMode>;
  bash: {
    default: PolicyDecision;
    safeCommands: string[];
    denyCommands: string[];
    askCommands: string[];
    network: PolicyDecision;
    outsideWorkspaceFilesystem: PolicyDecision;
    envSecretExposure: 'deny' | 'ask';
    maxCommandPreviewChars: number;
  };
  nonInteractive: {
    onAsk: 'deny' | 'allow';
    allowSessionApprovals: boolean;
  };
  approvals: {
    sessionCache: boolean;
    allowForSession: boolean;
  };
  audit: {
    enabled: boolean;
    logAllowed: boolean;
    logDenied: boolean;
    logApprovals: boolean;
    redactPaths: boolean;
    path?: string;
    maxBytes: number;
    maxFiles: number;
  };
}

export interface PermissionRequest {
  id: string;
  source: PermissionSource;
  origin: RequestOrigin;
  requester?: { subagentId?: string; subagentName?: string; taskId?: string; description?: string };
  tool: 'read' | 'write' | 'edit' | 'grep' | 'find' | 'ls' | 'bash' | 'user_bash';
  action: Action;
  rawInputSummary: string;
  target?: {
    raw: string;
    normalizedAbsolute: string;
    resolvedRealpath?: string;
    exists: boolean;
    nearestExistingParent?: string;
    workspaceRoot: string;
    insideWorkspace: boolean;
    symlinkEscapesWorkspace: boolean;
    workspaceRelative?: string;
  };
  command?: { raw: string; summary: string; tokens?: string[] };
  mode: 'tui' | 'rpc' | 'json' | 'print' | string;
  hasUI: boolean;
  policyIdentity: string;
  timestamp: string;
}

export interface PermissionDecisionDetails {
  safeTarget?: string;
  safeCommandSummary?: string;
  workspaceRoot?: string;
  matchedRule?: string;
  matchedLayer: 'disabled' | 'tool' | 'secret' | 'workspace' | 'outsideWorkspace' | 'bash' | 'session' | 'nonInteractive';
  noPreview: boolean;
}

export interface PermissionDecisionResult {
  decision: PolicyDecision;
  finalDecision: 'allow' | 'deny' | 'requires_approval';
  reason: string;
  reasonCode: string;
  riskLevel: RiskLevel;
  details: PermissionDecisionDetails;
  cacheKey?: string;
  audit: boolean;
}

export interface PermissionRequiredPayload {
  type: 'permission_required';
  requestId: string;
  tool: string;
  action: Action;
  origin: RequestOrigin;
  requester?: PermissionRequest['requester'];
  reason: string;
  reasonCode: string;
  riskLevel: RiskLevel;
  prompt: {
    title: string;
    message: string;
    choices: ['Allow once', 'Allow for session', 'Deny'];
    safeTarget?: string;
    safeCommandSummary?: string;
    workspaceRoot?: string;
    limitations?: string[];
  };
  sessionScope?: {
    cacheKey: string;
    action: Action;
    tool: string;
    targetPattern?: string;
    commandPattern?: string;
    policyIdentity: string;
  };
}

export interface AuditEvent {
  version: 1;
  timestamp: string;
  requestId: string;
  origin: RequestOrigin;
  requester?: PermissionRequest['requester'];
  decision: 'allow' | 'deny' | 'ask' | 'approval_allow_once' | 'approval_allow_session' | 'approval_deny';
  tool: string;
  action: Action;
  reasonCode: string;
  riskLevel: RiskLevel;
  mode: string;
  target?: { redactedPath: string; insideWorkspace?: boolean; symlinkEscapesWorkspace?: boolean };
  command?: { redactedSummary: string; classes?: string[] };
  auditError?: string;
}
