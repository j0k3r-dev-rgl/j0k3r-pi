import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { PermissionDecisionResult, PermissionPolicyConfig, PermissionRequest, PolicyDecision, RiskLevel } from './types.js';

export interface BashPolicyOptions {
  workspaceRoot?: string;
}

interface BashMatch {
  decision: PolicyDecision;
  reason: string;
  reasonCode: string;
  riskLevel: RiskLevel;
  matchedRule?: string;
  noPreview?: boolean;
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

function matchesExactSafeCommand(command: string, patterns: string[]): string | undefined {
  const normalized = normalizeCommand(command);
  return patterns.find((pattern) => !pattern.startsWith('regex:') && !pattern.includes('*') && normalizeCommand(pattern) === normalized);
}

function hasSuspiciousShellSyntax(command: string): boolean {
  return /[;&|`]|\$\(|<\(|>\(|\n|\r|>>?|<</.test(command);
}

function hasOnlyAndSeparators(command: string): boolean {
  return command.includes('&&') && !/[;|`]|\$\(|<\(|>\(|\n|\r|>>?|<</.test(command) && !/(^|[^&])&([^&]|$)/.test(command);
}

function firstToken(command: string): string {
  return normalizeCommand(command).split(' ')[0] ?? '';
}

function isSameOrInside(target: string, root: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function safeWorkspaceCdSegment(command: string, config: PermissionPolicyConfig, options: BashPolicyOptions): string | undefined {
  const root = workspaceRootFor(config, options);
  if (!root) return undefined;

  const match = normalizeCommand(command).match(/^cd\s+([A-Za-z0-9._/@+-]+)$/);
  if (!match) return undefined;

  const cdTarget = match[1]!;
  if (cdTarget === '..' || cdTarget.startsWith('../') || cdTarget === '~' || cdTarget.startsWith('~/') || cdTarget.split('/').includes('..')) return undefined;

  const targetPath = isAbsolute(cdTarget) ? cdTarget : resolve(root, cdTarget);
  if (!isSameOrInside(targetPath, root)) return undefined;

  return 'cd <workspace>';
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

function workspaceRootFor(config: PermissionPolicyConfig, options: BashPolicyOptions): string | undefined {
  return options.workspaceRoot ?? config.workspace.root;
}

function referencesOutsideWorkspace(command: string, config: PermissionPolicyConfig, options: BashPolicyOptions): boolean {
  const root = workspaceRootFor(config, options);
  const absolutePathMatches = command.match(/(?:^|\s|[><])((?:\/[A-Za-z0-9._~+@%:,=-]+)+)/g) ?? [];

  for (const match of absolutePathMatches) {
    const candidate = match.trim().replace(/^[><]+/, '');
    if (!candidate.startsWith('/')) continue;
    if (!root) return true;
    if (!isSameOrInside(candidate, root)) return true;
  }

  return false;
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
      matchedRule: firstToken(command),
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

function askMatch(config: PermissionPolicyConfig, request: PermissionRequest, options: BashPolicyOptions): BashMatch | undefined {
  const command = commandText(request);
  const normalized = normalizeCommand(command);
  if (/^(?:curl|wget|ssh|scp|rsync)(?:\s|$)/i.test(normalized) || /^git\s+(?:clone|fetch|pull)(?:\s|$)/i.test(normalized)) {
    return {
      decision: config.bash.network,
      reason: 'Network-related bash commands require approval by policy.',
      reasonCode: config.bash.network === 'deny' ? 'bash_network_denied' : config.bash.network === 'allow' ? 'bash_network_allowed' : 'bash_network_requires_approval',
      riskLevel: 'medium',
      matchedRule: 'network-command',
    };
  }

  if (/^(?:npm\s+(?:install|i)|pnpm\s+add|yarn\s+add|pip(?:3)?\s+install|cargo\s+install|gem\s+install|go\s+install)(?:\s|$)/i.test(normalized)) {
    return {
      decision: 'ask',
      reason: 'Package installation commands require approval by policy.',
      reasonCode: 'bash_package_install_requires_approval',
      riskLevel: 'medium',
      matchedRule: 'package-install',
    };
  }

  if (/^(?:rm|mv|cp)(?:\s|$)/i.test(normalized) || /^git\s+(?:clean|reset\s+--hard)(?:\s|$)/i.test(normalized)) {
    return {
      decision: 'ask',
      reason: 'Destructive or state-changing bash command requires approval by policy.',
      reasonCode: 'bash_state_change_requires_approval',
      riskLevel: 'high',
      matchedRule: 'state-changing-command',
    };
  }

  if (referencesOutsideWorkspace(command, config, options)) {
    return {
      decision: config.bash.outsideWorkspaceFilesystem,
      reason: 'Bash command references paths outside the workspace and requires approval by policy.',
      reasonCode: config.bash.outsideWorkspaceFilesystem === 'deny' ? 'bash_outside_workspace_denied' : config.bash.outsideWorkspaceFilesystem === 'allow' ? 'bash_outside_workspace_allowed' : 'bash_outside_workspace_requires_approval',
      riskLevel: 'medium',
      matchedRule: 'outside-workspace-path',
    };
  }

  if (hasSuspiciousShellSyntax(command)) {
    return {
      decision: 'ask',
      reason: 'Shell syntax or metacharacters require approval because the command cannot be proven safe.',
      reasonCode: 'bash_shell_syntax_requires_approval',
      riskLevel: 'medium',
      matchedRule: 'shell-syntax',
    };
  }

  const configuredAsk = matchesCommandPattern(command, config.bash.askCommands);
  if (configuredAsk) {
    return {
      decision: 'ask',
      reason: 'Bash command requires approval by configured policy.',
      reasonCode: 'bash_configured_ask',
      riskLevel: 'medium',
      matchedRule: configuredAsk,
    };
  }

  return undefined;
}

function segmentRequest(request: PermissionRequest, command: string): PermissionRequest {
  return {
    ...request,
    rawInputSummary: `bash ${command}`,
    command: { raw: command, summary: command },
  };
}

function segmentNotSafeMatch(config: PermissionPolicyConfig, request: PermissionRequest, options: BashPolicyOptions): BashMatch {
  return denyMatch(config, request, options) ?? askMatch(config, request, options) ?? {
    decision: 'ask',
    reason: 'Shell syntax or metacharacters require approval because the command cannot be proven safe.',
    reasonCode: 'bash_shell_syntax_requires_approval',
    riskLevel: 'medium',
    matchedRule: 'shell-syntax',
  };
}

function safeAndCompoundMatch(config: PermissionPolicyConfig, request: PermissionRequest, options: BashPolicyOptions): BashMatch | undefined {
  const command = commandText(request);
  if (!hasOnlyAndSeparators(command)) return undefined;

  const parts = command.split('&&').map((part) => normalizeCommand(part));
  if (parts.length < 2 || parts.some((part) => part.length === 0)) {
    return {
      decision: 'ask',
      reason: 'Shell syntax or metacharacters require approval because the command cannot be proven safe.',
      reasonCode: 'bash_shell_syntax_requires_approval',
      riskLevel: 'medium',
      matchedRule: 'shell-syntax',
    };
  }

  const labels: string[] = [];
  for (const part of parts) {
    const partRequest = segmentRequest(request, part);
    const cdLabel = safeWorkspaceCdSegment(part, config, options);
    if (cdLabel) {
      labels.push(cdLabel);
      continue;
    }

    const matchedSafeCommand = matchesCommandPattern(part, config.bash.safeCommands);
    if (matchedSafeCommand) {
      labels.push(part);
      continue;
    }

    return segmentNotSafeMatch(config, partRequest, options);
  }

  return {
    decision: 'allow',
    reason: 'Every command in the && chain is allowed by policy.',
    reasonCode: 'bash_safe_compound_command_allowed',
    riskLevel: 'low',
    matchedRule: labels.join(' && '),
  };
}

function allowMatch(config: PermissionPolicyConfig, request: PermissionRequest, options: BashPolicyOptions): BashMatch | undefined {
  const command = commandText(request);

  const compoundMatch = safeAndCompoundMatch(config, request, options);
  if (compoundMatch) return compoundMatch;

  if (command.includes('&&')) return undefined;

  const matchedSafeCommand = hasSuspiciousShellSyntax(command)
    ? matchesExactSafeCommand(command, config.bash.safeCommands)
    : matchesCommandPattern(command, config.bash.safeCommands);
  if (!matchedSafeCommand) return undefined;

  return {
    decision: 'allow',
    reason: 'Bash command matches a configured safe command.',
    reasonCode: 'bash_safe_command_allowed',
    riskLevel: 'low',
    matchedRule: matchedSafeCommand,
  };
}

function resultForMatch(config: PermissionPolicyConfig, request: PermissionRequest, match: BashMatch): PermissionDecisionResult {
  const finalDecision = match.decision === 'allow' ? 'allow' : match.decision === 'deny' ? 'deny' : 'requires_approval';
  const summary = commandSummary(config, commandText(request));

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
    },
    cacheKey: match.decision === 'ask' ? `bash:${request.policyIdentity}:${normalizeCommand(commandText(request))}` : undefined,
    audit: match.decision === 'deny' ? config.audit.enabled && config.audit.logDenied : false,
  };
}

function defaultMatch(config: PermissionPolicyConfig): BashMatch {
  return {
    decision: config.bash.default,
    reason: 'Bash command does not match a more specific allow or deny rule.',
    reasonCode: config.bash.default === 'allow' ? 'bash_default_allowed' : config.bash.default === 'deny' ? 'bash_default_denied' : 'bash_default_requires_approval',
    riskLevel: config.bash.default === 'allow' ? 'low' : 'medium',
    matchedRule: 'bash.default',
  };
}

export function classifyBashCommand(
  config: PermissionPolicyConfig,
  request: PermissionRequest,
  options: BashPolicyOptions = {},
): PermissionDecisionResult {
  const match =
    denyMatch(config, request, options) ??
    allowMatch(config, request, options) ??
    askMatch(config, request, options) ??
    defaultMatch(config);

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
  if (hasSuspiciousShellSyntax(command)) classes.push('shell-syntax');
  if (/\.env|~\/\.ssh|~\/\.aws|TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/i.test(command)) classes.push('secret-like');
  if (classes.length === 0) classes.push('unknown');
  return classes.map(toPosixPath);
}
