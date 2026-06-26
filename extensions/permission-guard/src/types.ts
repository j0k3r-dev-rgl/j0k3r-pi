export type PolicyDecision = 'allow' | 'ask' | 'deny';
export type ToolMode = 'allow' | 'deny' | 'policy';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type Action = 'read' | 'list' | 'search' | 'write' | 'create' | 'edit' | 'bash';
export type ApprovalChoice = 'Allow once' | 'Allow for session' | 'Allow for project' | 'Allow this file for project' | 'Allow this folder for project' | 'Deny';
export type PermissionSource = 'tool_call' | 'user_bash';
export type RequestOrigin = 'main' | 'subagent' | 'unknown';
export type ProjectPathApprovalScope = 'file' | 'folder';
export type ProjectPathApprovalTool = 'read' | 'ls' | 'find' | 'grep';
export type ProjectPathApprovalSource = 'project' | 'subagent';

export interface BashExecutionContext {
  cwd: string;
  workspaceRoot: string;
  policyIdentity: string;
}

export type ShellOperator = '&&' | '||' | ';' | 'newline';
export type ShellUnsupportedKind =
  | 'pipe'
  | 'background'
  | 'command_substitution'
  | 'process_substitution'
  | 'subshell'
  | 'here_doc'
  | 'glob_expansion'
  | 'tilde_expansion'
  | 'parameter_expansion'
  | 'alias_or_function'
  | 'source_script'
  | 'malformed_quote'
  | 'unsupported_redirection'
  | 'unknown_path_effects';

export interface ShellRedirection {
  fd?: number;
  operator: '<' | '>' | '>>';
  rawTarget: string;
}

export interface ShellSegmentAnalysis {
  index: number;
  raw: string;
  commandName?: string;
  argv: string[];
  envAssignments: Record<string, string>;
  effectiveCwd: string;
  nextCwd?: string;
  unsupported: ShellUnsupportedKind[];
  riskClasses: string[];
  redirections: ShellRedirection[];
}

export type BashPathEffectIntent = 'read' | 'write' | 'create' | 'delete' | 'execute' | 'cwd' | 'unknown';

export interface BashApprovalRootScope {
  kind: 'workspace' | 'directory';
  raw: string;
  normalizedAbsolute: string;
  resolvedRealpath?: string;
}

export interface ScopedBashApproval {
  version: 1;
  id: string;
  createdAt: string;
  commandSignature: string;
  effectSignature: string;
  normalizedCommand: string;
  allowedRoots: BashApprovalRootScope[];
  reasonCode?: string;
  source?: 'session' | 'project' | 'subagent';
}

export interface ProjectPathApproval {
  version: 1;
  id: string;
  createdAt: string;
  scope: ProjectPathApprovalScope;
  raw: string;
  normalizedAbsolute: string;
  resolvedRealpath?: string;
  tools: ProjectPathApprovalTool[];
  reasonCode?: string;
  source?: ProjectPathApprovalSource;
}

export interface ProjectPathApprovalOptions {
  file?: ProjectPathApproval;
  folder?: ProjectPathApproval;
}

export interface BashPathEffect {
  segmentIndex: number;
  raw: string;
  source: 'argument' | 'option' | 'redirection' | 'cd' | 'fallback_scan';
  intent: BashPathEffectIntent;
  forCreate?: boolean;
  classified?: PermissionRequest['target'];
  ambiguous?: boolean;
  reason?: string;
}

export interface ShellAnalysisResult {
  ok: boolean;
  normalizedCommand: string;
  commandSignature: string;
  effectSignature: string;
  segments: ShellSegmentAnalysis[];
  operators: ShellOperator[];
  pathEffects: BashPathEffect[];
  unsupported: ShellUnsupportedKind[];
  effectsComplete: boolean;
  riskClasses: string[];
  summary: {
    command: string;
    operators?: string;
    paths?: string[];
    unsupported?: string[];
  };
}

export interface PermissionPolicyConfig {
  enabled: boolean;
  bypassAll: boolean;
  bypassWorkspace: boolean;
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
    scopedApprovals: ScopedBashApproval[];
    denyCommands: string[];
    askCommands: string[];
    network: PolicyDecision;
    workspaceReadOnly: PolicyDecision;
    outsideWorkspaceFilesystem: PolicyDecision;
    envSecretExposure: 'deny' | 'ask';
    maxCommandPreviewChars: number;
  };
  pathApprovals: {
    scopedApprovals: ProjectPathApproval[];
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
    kind?: 'file' | 'directory' | 'other' | 'missing';
  };
  command?: { raw: string; summary: string; tokens?: string[] };
  executionContext?: BashExecutionContext;
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
  matchedLayer: 'disabled' | 'tool' | 'secret' | 'workspace' | 'outsideWorkspace' | 'trustedSkill' | 'trustedDocumentation' | 'bash' | 'session' | 'project' | 'nonInteractive';
  noPreview: boolean;
  shellAnalysis?: Pick<ShellAnalysisResult, 'commandSignature' | 'effectSignature' | 'effectsComplete' | 'riskClasses' | 'summary'>;
  pathEffects?: Array<{
    intent: BashPathEffectIntent;
    safeTarget?: string;
    insideWorkspace?: boolean;
    symlinkEscapesWorkspace?: boolean;
  }>;
  approvalScope?: {
    commandSignature: string;
    effectSignature: string;
    allowedRoots: BashApprovalRootScope[];
  };
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
    choices: ApprovalChoice[];
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
    bashApproval?: ScopedBashApproval;
  };
  projectScope?: {
    safeCommandPattern?: string;
    bashApproval?: ScopedBashApproval;
    pathApprovalOptions?: ProjectPathApprovalOptions;
  };
}

export interface AuditEvent {
  version: 1;
  timestamp: string;
  requestId: string;
  origin: RequestOrigin;
  requester?: PermissionRequest['requester'];
  decision: 'allow' | 'deny' | 'ask' | 'approval_allow_once' | 'approval_allow_session' | 'approval_deny' | 'permission_required';
  tool: string;
  action: Action;
  reasonCode: string;
  riskLevel: RiskLevel;
  mode: string;
  target?: { redactedPath: string; insideWorkspace?: boolean; symlinkEscapesWorkspace?: boolean };
  command?: { redactedSummary: string; classes?: string[] };
  auditError?: string;
}
