import { isAbsolute, relative, resolve, sep } from 'node:path';
import { analyzeShellCommand } from './shell-analyzer.js';
import { extractShellPathEffectsSync } from './shell-path-effects.js';
import type { PermissionDecisionResult, PermissionPolicyConfig, PermissionRequest, PolicyDecision, RiskLevel, ShellAnalysisResult } from './types.js';

export interface BashPolicyOptions {
  workspaceRoot?: string;
  bypassWorkspace?: boolean;
}

const BYPASS_DISALLOWED_REASON_CODES = new Set([
  'bash_network_denied',
  'bash_network_requires_approval',
  'bash_network_allowed',
  'bash_package_install_requires_approval',
  'bash_state_change_requires_approval',
  'bash_configured_ask',
  'bash_shell_syntax_requires_approval',
  'bash_default_denied',
  'bash_unsupported_shell_requires_approval',
  'bash_workspace_readonly_denied',
]);

interface BashMatch {
  decision: PolicyDecision;
  reason: string;
  reasonCode: string;
  riskLevel: RiskLevel;
  matchedRule?: string;
  noPreview?: boolean;
  analysis?: ShellAnalysisResult;
}

function commandText(request: PermissionRequest): string {
  return request.command?.raw ?? request.command?.summary ?? request.rawInputSummary;
}

function commandSummary(config: PermissionPolicyConfig, command: string): string {
  const capped = command.length > config.bash.maxCommandPreviewChars
    ? `${command.slice(0, Math.max(0, config.bash.maxCommandPreviewChars - 1))}…`
    : command;
  return capped
    .replace(/\b([A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL)[A-Z_]*)=([^\s]+)/gi, '$1=[REDACTED]')
    .replace(/\$\{?([A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL)[A-Z_]*)\}?/gi, '$$$1');
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function wildcardPatternToRegExp(pattern: string): RegExp {
  const normalized = normalizeCommand(pattern);
  const source = [...normalized].map((char) => (char === '*' ? '.*' : escapeRegExp(char))).join('');
  return new RegExp(`^${source}$`, 'i');
}

function commandPatternToRegExp(pattern: string): RegExp | undefined {
  if (pattern.startsWith('regex:')) {
    try {
      return new RegExp(pattern.slice('regex:'.length), 'i');
    } catch {
      return undefined;
    }
  }
  return wildcardPatternToRegExp(pattern);
}

function matchesCommandPattern(command: string, patterns: string[]): string | undefined {
  const normalized = normalizeCommand(command);
  return patterns.find((pattern) => commandPatternToRegExp(pattern)?.test(normalized));
}

function referencesOutsideWorkspace(command: string, config: PermissionPolicyConfig, options: BashPolicyOptions): boolean {
  const root = options.workspaceRoot ?? config.workspace.root;
  const absolutePathMatches = command.match(/(?:^|\s|[><])((?:\/[A-Za-z0-9._~+@%:,=-]+)+)/g) ?? [];

  for (const match of absolutePathMatches) {
    const candidate = match.trim().replace(/^[><]+/, '');
    if (!candidate.startsWith('/')) continue;
    if (!root) return true;
    const rel = relative(root, candidate);
    if (rel.startsWith('..') || isAbsolute(rel)) return true;
  }

  return false;
}

function workspaceRootFor(config: PermissionPolicyConfig, request: PermissionRequest, options: BashPolicyOptions): string {
  return request.executionContext?.workspaceRoot ?? options.workspaceRoot ?? config.workspace.root ?? process.cwd();
}

function denyMatch(config: PermissionPolicyConfig, request: PermissionRequest, options: BashPolicyOptions): BashMatch | undefined {
  const command = commandText(request);
  const normalized = normalizeCommand(command);

  if (/^(sudo|su)(?:\s|$)/i.test(normalized)) {
    return {
      decision: 'deny',
      reason: 'Privilege escalation commands are denied by policy.',
      reasonCode: 'bash_privilege_escalation_denied',
      riskLevel: 'critical',
      matchedRule: normalized.split(' ')[0],
    };
  }

  if (/\b(curl|wget)\b[\s\S]*(\||>\s*\()\s*(?:sudo\s+)?(?:sh|bash)\b/i.test(command)) {
    return {
      decision: 'deny',
      reason: 'Remote script execution through a shell pipe is denied by policy.',
      reasonCode: 'bash_remote_script_pipe_denied',
      riskLevel: 'critical',
      matchedRule: 'remote-script-pipe',
      noPreview: true,
    };
  }

  if (/^(?:env|printenv)(?:\s|$)/i.test(normalized) || /\becho\s+[^\n]*\$\{?[A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL)[A-Z_]*\}?/i.test(command)) {
    return {
      decision: 'deny',
      reason: 'Environment secret exposure is denied by policy.',
      reasonCode: 'bash_env_secret_exposure_denied',
      riskLevel: 'critical',
      matchedRule: 'environment-secret-exposure',
      noPreview: true,
    };
  }

  if (/\b(?:cat|grep|awk|sed|tail|head|less|more)\b[\s\S]*(?:\.env(?:\.|\b)|~\/\.ssh\/|~\/\.aws\/|~\/\.gnupg\/|id_rsa|id_ed25519|\.(?:pem|key|p12|pfx)\b|credential)/i.test(command)) {
    return {
      decision: 'deny',
      reason: 'Obvious secret or credential reads are denied by policy.',
      reasonCode: 'bash_secret_read_denied',
      riskLevel: 'critical',
      matchedRule: 'secret-read',
      noPreview: true,
    };
  }

  if (/\brm\s+-[^\n]*(?:r[^\s]*f|f[^\s]*r)[^\n]*(?:\s\/\s*$|\s~(?:\s|$)|\s\$HOME(?:\s|$))/i.test(command)) {
    return {
      decision: 'deny',
      reason: 'Destructive root or home deletion is denied by policy.',
      reasonCode: 'bash_destructive_delete_denied',
      riskLevel: 'critical',
      matchedRule: 'destructive-root-or-home-delete',
    };
  }

  if (/\bchmod\s+777\b/i.test(command)) {
    return {
      decision: 'deny',
      reason: 'Broad permission changes are denied by policy.',
      reasonCode: 'bash_permission_broadening_denied',
      riskLevel: 'critical',
      matchedRule: 'chmod-777',
    };
  }

  if (config.bash.outsideWorkspaceFilesystem === 'deny' && referencesOutsideWorkspace(command, config, options)) {
    return {
      decision: 'deny',
      reason: 'Bash command references paths outside the workspace, which is denied by policy.',
      reasonCode: 'bash_outside_workspace_denied',
      riskLevel: 'high',
      matchedRule: 'outside-workspace-path',
    };
  }

  const configuredDeny = matchesCommandPattern(command, config.bash.denyCommands);
  if (configuredDeny) {
    return {
      decision: 'deny',
      reason: 'Bash command is denied by configured policy.',
      reasonCode: 'bash_configured_deny',
      riskLevel: 'critical',
      matchedRule: configuredDeny,
    };
  }

  return undefined;
}

function safeCommandCandidate(command: string, config: PermissionPolicyConfig): string | undefined {
  return matchesCommandPattern(command, config.bash.safeCommands);
}

function outsideEffectDecision(config: PermissionPolicyConfig): Pick<BashMatch, 'decision' | 'reasonCode' | 'reason' | 'riskLevel'> {
  const decision = config.bash.outsideWorkspaceFilesystem;
  return {
    decision,
    reason: decision === 'deny'
      ? 'Bash command has path effects outside the workspace, which is denied by policy.'
      : decision === 'allow'
        ? 'Bash command has outside-workspace path effects that are allowed by policy after structured analysis.'
        : 'Bash command has path effects outside the workspace and requires approval by policy.',
    reasonCode: decision === 'deny' ? 'bash_outside_workspace_denied' : decision === 'allow' ? 'bash_outside_workspace_allowed' : 'bash_outside_workspace_requires_approval',
    riskLevel: 'high',
  };
}

function segmentSafeCompound(analysis: ShellAnalysisResult, config: PermissionPolicyConfig): string | undefined {
  if (analysis.operators.length === 0) return undefined;
  for (const segment of analysis.segments) {
    if (segment.commandName === 'cd') {
      if (!analysis.pathEffects.some((effect) => effect.segmentIndex === segment.index && effect.intent === 'cwd' && effect.classified?.insideWorkspace)) {
        return undefined;
      }
      continue;
    }
    if (!safeCommandCandidate(segment.raw, config)) return undefined;
  }
  return analysis.segments.map((segment) => (segment.commandName === 'cd' ? 'cd <workspace>' : segment.raw)).join(' && ');
}

const READ_ONLY_PIPE_SOURCES = new Set(['find', 'grep', 'rg', 'ls', 'cat', 'head', 'tail']);
const READ_ONLY_PIPE_SINKS = new Set(['sort', 'head', 'tail', 'wc', 'uniq']);

function splitPipelineCommands(command: string): string[] | undefined {
  const parts = command.split('|').map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : undefined;
}

function firstCommandName(segment: string): string | undefined {
  const match = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*([A-Za-z0-9_.-]+)/.exec(segment);
  return match?.[1];
}

function isWorkspaceReadOnlyPipeline(analysis: ShellAnalysisResult): boolean {
  const unsupported = new Set(analysis.unsupported);
  if (unsupported.size !== 1 || !unsupported.has('pipe')) return false;
  const parts = splitPipelineCommands(analysis.normalizedCommand);
  if (!parts || parts.length !== 2) return false;
  const source = firstCommandName(parts[0]);
  const sink = firstCommandName(parts[1]);
  if (!source || !sink || !READ_ONLY_PIPE_SOURCES.has(source) || !READ_ONLY_PIPE_SINKS.has(sink)) return false;
  if (!analysis.pathEffects.length) return false;
  return analysis.pathEffects.every((effect) =>
    effect.intent === 'read'
    && !effect.ambiguous
    && effect.classified?.insideWorkspace === true
  );
}

function isWorkspaceReadOnlySimpleCommand(analysis: ShellAnalysisResult): boolean {
  if (analysis.unsupported.length > 0 || analysis.operators.length > 0) return false;
  const command = analysis.segments[0]?.commandName;
  if (!command || !['find', 'ls', 'cat', 'grep', 'head', 'tail', 'less', 'more'].includes(command)) return false;
  if (!analysis.pathEffects.length) return false;
  return analysis.pathEffects.every((effect) =>
    effect.intent === 'read'
    && !effect.ambiguous
    && effect.classified?.insideWorkspace === true
  );
}

function isWorkspaceBypassCandidate(analysis: ShellAnalysisResult): boolean {
  if (analysis.pathEffects.length === 0) return false;
  return analysis.pathEffects.every((effect) =>
    effect.intent !== 'cwd'
    && !effect.ambiguous
    && effect.classified !== undefined
    && effect.classified.insideWorkspace
    && effect.classified.symlinkEscapesWorkspace !== true
  );
}

function pathContextBypassBlock(analysis: ShellAnalysisResult, options: BashPolicyOptions): BashMatch | undefined {
  if (!options.bypassWorkspace) return undefined;
  const hasPathContextEffect = analysis.pathEffects.some((effect) => effect.intent === 'cwd');
  if (!hasPathContextEffect) return undefined;
  return {
    decision: 'ask',
    reason: 'Bash command changes cwd or path context and requires approval when bypassWorkspace is enabled.',
    reasonCode: 'bash_path_context_requires_approval',
    riskLevel: 'medium',
    matchedRule: 'bypassWorkspace:path-context',
    analysis,
  };
}

function hasDisallowedBypassReason(match: BashMatch): boolean {
  return match.decision !== 'allow' && BYPASS_DISALLOWED_REASON_CODES.has(match.reasonCode) && match.reasonCode !== 'bash_network_allowed';
}

function workspaceReadOnlyMatch(config: PermissionPolicyConfig, analysis: ShellAnalysisResult): BashMatch | undefined {
  if (!isWorkspaceReadOnlyPipeline(analysis) && !isWorkspaceReadOnlySimpleCommand(analysis)) return undefined;
  const decision = config.bash.workspaceReadOnly;
  return {
    decision,
    reason: decision === 'allow'
      ? 'Read-only bash command is limited to workspace paths and is allowed by workspace read/list/search policy.'
      : decision === 'deny'
        ? 'Read-only bash command is limited to workspace paths but is denied by bash.workspaceReadOnly policy.'
        : 'Read-only bash command is limited to workspace paths and requires approval by bash.workspaceReadOnly policy.',
    reasonCode: decision === 'allow'
      ? 'bash_workspace_readonly_allowed'
      : decision === 'deny'
        ? 'bash_workspace_readonly_denied'
        : 'bash_workspace_readonly_requires_approval',
    riskLevel: decision === 'deny' ? 'medium' : 'low',
    matchedRule: 'workspace-readonly-bash',
    analysis,
  };
}

function compoundRiskMatch(analysis: ShellAnalysisResult, config: PermissionPolicyConfig): BashMatch | undefined {
  if (analysis.operators.length === 0) return undefined;
  for (const segment of analysis.segments) {
    const raw = segment.raw;
    if (/^(?:npm\s+(?:install|i)|pnpm\s+add|yarn\s+add|pip(?:3)?\s+install|cargo\s+install|gem\s+install|go\s+install)(?:\s|$)/i.test(raw)) {
      return { decision: 'ask', reason: 'Package installation commands require approval by policy.', reasonCode: 'bash_package_install_requires_approval', riskLevel: 'medium', matchedRule: 'package-install', analysis };
    }
    if (/^(?:rm|mv|cp)(?:\s|$)/i.test(raw) || /^git\s+(?:clean|reset\s+--hard)(?:\s|$)/i.test(raw)) {
      return { decision: 'ask', reason: 'Destructive or state-changing bash command requires approval by policy.', reasonCode: 'bash_state_change_requires_approval', riskLevel: 'high', matchedRule: 'state-changing-command', analysis };
    }
    const configuredAsk = matchesCommandPattern(raw, config.bash.askCommands);
    if (configuredAsk) {
      return { decision: 'ask', reason: 'Bash command requires approval by configured policy.', reasonCode: 'bash_configured_ask', riskLevel: 'medium', matchedRule: configuredAsk, analysis };
    }
  }
  return undefined;
}

function analysisMatch(config: PermissionPolicyConfig, request: PermissionRequest, options: BashPolicyOptions): BashMatch {
  const command = commandText(request);
  const workspaceRoot = workspaceRootFor(config, request, options);
  const cwd = request.executionContext?.cwd ?? workspaceRoot;
  const analysis = extractShellPathEffectsSync({
    analysis: analyzeShellCommand({ command, cwd, config }),
    context: { cwd, workspaceRoot, policyIdentity: request.policyIdentity },
    config,
  });

  const pathContextBlock = pathContextBypassBlock(analysis, options);
  if (pathContextBlock) return pathContextBlock;

  const workspaceReadOnly = workspaceReadOnlyMatch(config, analysis);
  if (workspaceReadOnly) {
    const canBypassWorkspace = options.bypassWorkspace && isWorkspaceBypassCandidate(analysis) && !hasDisallowedBypassReason(workspaceReadOnly);
    if (!canBypassWorkspace) return workspaceReadOnly;
    return {
      decision: 'allow',
      reason: 'Workspace-local filesystem effects are fully classified and bypassWorkspace is enabled.',
      reasonCode: 'bash_workspace_bypass_allowed',
      riskLevel: 'low',
      matchedRule: 'bypassWorkspace',
      analysis,
    };
  }

  if (analysis.unsupported.length > 0 || !analysis.effectsComplete) {
    const hasOutsideEffect = analysis.pathEffects.some((effect) => effect.classified && !effect.classified.insideWorkspace);
    const fallback = (config.bash.outsideWorkspaceFilesystem === 'deny' && referencesOutsideWorkspace(command, config, options)) || hasOutsideEffect
      ? outsideEffectDecision(config)
      : {
          decision: 'ask' as const,
          reason: 'Unsupported shell syntax or ambiguous path effects require approval by policy.',
          reasonCode: 'bash_unsupported_shell_requires_approval',
          riskLevel: 'medium' as const,
        };
    return { ...fallback, matchedRule: analysis.unsupported.join(','), analysis };
  }

  const compoundSafeRule = segmentSafeCompound(analysis, config);
  if (compoundSafeRule) {
    const match: BashMatch = {
      decision: 'allow',
      reason: 'Every command in the compound sequence is allowed by policy after structured analysis.',
      reasonCode: 'bash_safe_compound_command_allowed',
      riskLevel: 'low',
      matchedRule: compoundSafeRule,
      analysis,
    };
    if (options.bypassWorkspace && isWorkspaceBypassCandidate(analysis) && !hasDisallowedBypassReason(match)) return {
      decision: 'allow',
      reason: 'Workspace-local filesystem effects are fully classified and bypassWorkspace is enabled.',
      reasonCode: 'bash_workspace_bypass_allowed',
      riskLevel: 'low',
      matchedRule: 'bypassWorkspace',
      analysis,
    };
    return match;
  }

  const compoundRisk = compoundRiskMatch(analysis, config);
  if (compoundRisk) return compoundRisk;

  const hasOutsideEffect = analysis.pathEffects.some((effect) => effect.classified && !effect.classified.insideWorkspace);
  if (hasOutsideEffect) {
    return { ...outsideEffectDecision(config), matchedRule: 'outside-workspace-path-effect', analysis };
  }

  const safeMatch = safeCommandCandidate(command, config);
  const simpleAllow = analysis.unsupported.length === 0 && analysis.pathEffects.every((effect) => effect.classified?.insideWorkspace ?? !effect.ambiguous);
  const fallbackToSafeMatch = safeMatch && simpleAllow && analysis.operators.length === 0;

  if (fallbackToSafeMatch) {
    const match: BashMatch = {
      decision: 'allow',
      reason: 'Bash command matches a configured safe command after structured analysis.',
      reasonCode: 'bash_safe_command_allowed',
      riskLevel: 'low',
      matchedRule: safeMatch,
      analysis,
    };
    if (options.bypassWorkspace && isWorkspaceBypassCandidate(analysis) && !hasDisallowedBypassReason(match)) return {
      decision: 'allow',
      reason: 'Workspace-local filesystem effects are fully classified and bypassWorkspace is enabled.',
      reasonCode: 'bash_workspace_bypass_allowed',
      riskLevel: 'low',
      matchedRule: 'bypassWorkspace',
      analysis,
    };
    return match;
  }

  if (/^(?:npm\s+(?:install|i)|pnpm\s+add|yarn\s+add|pip(?:3)?\s+install|cargo\s+install|gem\s+install|go\s+install)(?:\s|$)/i.test(analysis.normalizedCommand)) {
    return {
      decision: 'ask',
      reason: 'Package installation commands require approval by policy.',
      reasonCode: 'bash_package_install_requires_approval',
      riskLevel: 'medium',
      matchedRule: 'package-install',
      analysis,
    };
  }

  if (/^(?:rm|mv|cp)(?:\s|$)/i.test(analysis.normalizedCommand) || /^git\s+(?:clean|reset\s+--hard)(?:\s|$)/i.test(analysis.normalizedCommand)) {
    return {
      decision: 'ask',
      reason: 'Destructive or state-changing bash command requires approval by policy.',
      reasonCode: 'bash_state_change_requires_approval',
      riskLevel: 'high',
      matchedRule: 'state-changing-command',
      analysis,
    };
  }

  const network = /^(?:curl|wget|ssh|scp|rsync)(?:\s|$)/i.test(analysis.normalizedCommand) || /^git\s+(?:clone|fetch|pull)(?:\s|$)/i.test(analysis.normalizedCommand);
  if (network) {
    const match: BashMatch = {
      decision: config.bash.network,
      reason: 'Network-related bash commands require approval by policy.',
      reasonCode: config.bash.network === 'deny' ? 'bash_network_denied' : config.bash.network === 'allow' ? 'bash_network_allowed' : 'bash_network_requires_approval',
      riskLevel: 'medium',
      matchedRule: 'network-command',
      analysis,
    };
    if (options.bypassWorkspace && isWorkspaceBypassCandidate(analysis) && !hasDisallowedBypassReason(match)) return {
      decision: 'allow',
      reason: 'Workspace-local filesystem effects are fully classified and bypassWorkspace is enabled.',
      reasonCode: 'bash_workspace_bypass_allowed',
      riskLevel: 'low',
      matchedRule: 'bypassWorkspace',
      analysis,
    };
    return match;
  }

  const configuredAsk = matchesCommandPattern(command, config.bash.askCommands);
  if (configuredAsk) {
    const match: BashMatch = {
      decision: 'ask',
      reason: 'Bash command requires approval by configured policy.',
      reasonCode: 'bash_configured_ask',
      riskLevel: 'medium',
      matchedRule: configuredAsk,
      analysis,
    };
    if (options.bypassWorkspace && isWorkspaceBypassCandidate(analysis) && !hasDisallowedBypassReason(match)) return {
      decision: 'allow',
      reason: 'Workspace-local filesystem effects are fully classified and bypassWorkspace is enabled.',
      reasonCode: 'bash_workspace_bypass_allowed',
      riskLevel: 'low',
      matchedRule: 'bypassWorkspace',
      analysis,
    };
    return match;
  }

  const fallback = {
    decision: config.bash.default === 'deny' ? 'deny' : 'ask',
    reason: analysis.operators.length > 0
      ? 'Compound shell syntax requires approval unless every segment is proven safe.'
      : 'Bash command does not match a more specific allow or deny rule.',
    reasonCode: config.bash.default === 'deny' ? 'bash_default_denied' : analysis.operators.length > 0 ? 'bash_shell_syntax_requires_approval' : 'bash_default_requires_approval',
    riskLevel: config.bash.default === 'deny' ? 'high' : 'medium',
    matchedRule: 'bash.default',
    analysis,
  } as BashMatch;
  if (options.bypassWorkspace && isWorkspaceBypassCandidate(analysis) && !hasDisallowedBypassReason(fallback) && simpleAllow) {
    return {
      decision: 'allow',
      reason: 'Workspace-local filesystem effects are fully classified and bypassWorkspace is enabled.',
      reasonCode: 'bash_workspace_bypass_allowed',
      riskLevel: 'low',
      matchedRule: 'bypassWorkspace',
      analysis,
    };
  }

  if (config.bash.default === 'allow' && simpleAllow) {
    return {
      decision: 'allow',
      reason: 'Bash command does not match a more specific rule and passes structured safety gates.',
      reasonCode: 'bash_default_allowed',
      riskLevel: 'low',
      matchedRule: 'bash.default',
      analysis,
    };
  }

  return fallback;
}

function approvalRootsFor(request: PermissionRequest, analysis: ShellAnalysisResult | undefined): NonNullable<PermissionDecisionResult['details']['approvalScope']>['allowedRoots'] | undefined {
  if (!analysis) return undefined;
  const effectRoots = analysis.pathEffects
    .filter((effect) => effect.classified && !effect.ambiguous)
    .map((effect) => ({
      kind: 'directory' as const,
      raw: effect.classified!.normalizedAbsolute,
      normalizedAbsolute: effect.classified!.normalizedAbsolute,
      resolvedRealpath: effect.classified!.resolvedRealpath ?? effect.classified!.normalizedAbsolute,
    }));

  if (effectRoots.length > 0) {
    const deduped = new Map<string, (typeof effectRoots)[number]>();
    for (const root of effectRoots) {
      deduped.set(root.resolvedRealpath ?? root.normalizedAbsolute, root);
    }
    return [...deduped.values()];
  }

  const workspaceRoot = request.executionContext?.workspaceRoot ?? analysis.pathEffects[0]?.classified?.workspaceRoot ?? process.cwd();
  return [{
    kind: 'workspace',
    raw: workspaceRoot,
    normalizedAbsolute: workspaceRoot,
    resolvedRealpath: workspaceRoot,
  }];
}

function resultForMatch(config: PermissionPolicyConfig, request: PermissionRequest, match: BashMatch): PermissionDecisionResult {
  const finalDecision = match.decision === 'allow' ? 'allow' : match.decision === 'deny' ? 'deny' : 'requires_approval';
  const summary = commandSummary(config, commandText(request));
  const allowedRoots = approvalRootsFor(request, match.analysis);

  return {
    decision: match.decision,
    finalDecision,
    reason: match.reason,
    reasonCode: match.reasonCode,
    riskLevel: match.riskLevel,
    details: {
      safeCommandSummary: summary,
      matchedRule: match.matchedRule,
      matchedLayer: 'bash',
      noPreview: match.noPreview ?? false,
      shellAnalysis: match.analysis ? {
        commandSignature: match.analysis.commandSignature,
        effectSignature: match.analysis.effectSignature,
        effectsComplete: match.analysis.effectsComplete,
        riskClasses: match.analysis.riskClasses,
        summary: match.analysis.summary,
      } : undefined,
      workspaceRoot: request.executionContext?.workspaceRoot ?? match.analysis?.pathEffects[0]?.classified?.workspaceRoot,
      pathEffects: match.analysis?.pathEffects.map((effect) => ({
        intent: effect.intent,
        safeTarget: effect.classified?.workspaceRelative ?? effect.classified?.normalizedAbsolute,
        insideWorkspace: effect.classified?.insideWorkspace,
        symlinkEscapesWorkspace: effect.classified?.symlinkEscapesWorkspace,
      })),
      approvalScope: match.analysis && allowedRoots ? {
        commandSignature: match.analysis.commandSignature,
        effectSignature: match.analysis.effectSignature,
        allowedRoots,
      } : undefined,
    },
    cacheKey: match.decision === 'ask' && match.analysis
      ? `bash:${request.policyIdentity}:${match.analysis.commandSignature}:${match.analysis.effectSignature}`
      : undefined,
    audit: match.decision === 'deny' ? config.audit.enabled && config.audit.logDenied : false,
  };
}

export function classifyBashCommand(
  config: PermissionPolicyConfig,
  request: PermissionRequest,
  options: BashPolicyOptions = {},
): PermissionDecisionResult {
  const mergedOptions: BashPolicyOptions = {
    ...options,
    workspaceRoot: options.workspaceRoot ?? config.workspace.root,
    bypassWorkspace: options.bypassWorkspace ?? config.bypassWorkspace,
  };
  const match = denyMatch(config, request, mergedOptions) ?? analysisMatch(config, request, mergedOptions);
  return resultForMatch(config, request, match);
}

export function applyNonInteractiveBashFallback(
  config: PermissionPolicyConfig,
  result: PermissionDecisionResult,
  request: PermissionRequest,
): PermissionDecisionResult {
  if (result.decision !== 'ask' || request.hasUI) return result;

  const allow = config.nonInteractive.onAsk === 'allow';
  return {
    ...result,
    decision: allow ? 'allow' : 'deny',
    finalDecision: allow ? 'allow' : 'deny',
    reason: allow
      ? 'Approval could not be collected, and non-interactive policy allows ask decisions.'
      : 'Approval could not be collected, so the bash command is denied by non-interactive policy.',
    reasonCode: allow ? 'non_interactive_ask_allowed' : 'non_interactive_ask_denied',
    riskLevel: allow ? result.riskLevel : 'high',
    details: {
      ...result.details,
      matchedLayer: 'nonInteractive',
    },
    audit: allow ? config.audit.enabled && config.audit.logAllowed : config.audit.enabled && config.audit.logDenied,
  };
}

export function evaluateBashPolicy(
  config: PermissionPolicyConfig,
  request: PermissionRequest,
  options: BashPolicyOptions = {},
): PermissionDecisionResult {
  return applyNonInteractiveBashFallback(config, classifyBashCommand(config, request, options), request);
}

export function commandClassSummary(request: PermissionRequest): string[] {
  const command = commandText(request);
  const classes: string[] = [];
  if (/^(?:curl|wget|ssh|scp|rsync)(?:\s|$)/i.test(command) || /^git\s+(?:clone|fetch|pull)(?:\s|$)/i.test(command)) classes.push('network');
  if (/^(?:npm\s+(?:install|i)|pnpm\s+add|pip(?:3)?\s+install|cargo\s+install)(?:\s|$)/i.test(command)) classes.push('package-install');
  if (/[;&|`]|\$\(|<\(|>\(|\n|\r|>>?|<</.test(command)) classes.push('shell-syntax');
  if (/\.env|~\/\.ssh|~\/\.aws|TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/i.test(command)) classes.push('secret-like');
  if (classes.length === 0) classes.push('unknown');
  return classes.map((value) => value.split(sep).join('/'));
}
