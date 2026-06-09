import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, isAbsolute, relative, sep } from 'node:path';
import { builtInPermissionPolicy } from './defaults.js';
import type { PermissionDecisionDetails, PermissionDecisionResult, PermissionPolicyConfig, PermissionRequest } from './types.js';

type ClassifiedPathTarget = NonNullable<PermissionRequest['target']>;

export interface SecretPathMatch {
  matched: boolean;
  pattern?: string;
}

export interface SecretMatchOptions {
  homeDir?: string;
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function expandBraceAlternatives(pattern: string): string[] {
  const match = /^(.*)\{([^{}]+)\}(.*)$/.exec(pattern);
  if (!match) return [pattern];
  const [, before, alternatives, after] = match;
  return alternatives.split(',').flatMap((alternative) => expandBraceAlternatives(`${before}${alternative}${after}`));
}

function globToRegExp(pattern: string): RegExp {
  let source = '';
  const normalized = toPosixPath(pattern).replace(/^\.\//, '');

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    const afterNext = normalized[index + 2];

    if (char === '*' && next === '*' && afterNext === '/') {
      source += '(?:.*/)?';
      index += 2;
    } else if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`^${source}$`, 'i');
}

function matchesGlob(candidate: string, pattern: string): boolean {
  return expandBraceAlternatives(pattern).some((expanded) => globToRegExp(expanded).test(candidate));
}

function candidatesForTarget(target: ClassifiedPathTarget, options: SecretMatchOptions): string[] {
  const candidates = new Set<string>();
  const normalizedAbsolute = toPosixPath(target.normalizedAbsolute);
  candidates.add(normalizedAbsolute);
  candidates.add(basename(normalizedAbsolute));

  if (target.resolvedRealpath) candidates.add(toPosixPath(target.resolvedRealpath));
  if (target.workspaceRelative) candidates.add(target.workspaceRelative === '.' ? '' : target.workspaceRelative);

  const home = options.homeDir ?? homedir();
  if (home) {
    const homeRelative = relative(home, target.normalizedAbsolute);
    if (homeRelative === '' || (!homeRelative.startsWith('..') && !isAbsolute(homeRelative))) {
      candidates.add(`~/${toPosixPath(homeRelative)}`);
    }

    if (target.resolvedRealpath) {
      const realHomeRelative = relative(home, target.resolvedRealpath);
      if (realHomeRelative === '' || (!realHomeRelative.startsWith('..') && !isAbsolute(realHomeRelative))) {
        candidates.add(`~/${toPosixPath(realHomeRelative)}`);
      }
    }
  }

  return [...candidates];
}

export function isSecretPathTarget(
  target: ClassifiedPathTarget,
  patterns: string[],
  options: SecretMatchOptions = {},
): SecretPathMatch {
  const candidates = candidatesForTarget(target, options);

  for (const pattern of patterns) {
    if (candidates.some((candidate) => matchesGlob(candidate, pattern))) {
      return { matched: true, pattern };
    }
  }

  return { matched: false };
}

export function isSecretLikeConfigKey(
  key: string,
  patterns: string[] = builtInPermissionPolicy.secrets.denyKeyPatterns,
): boolean {
  const effectivePatterns = [...new Set([...builtInPermissionPolicy.secrets.denyKeyPatterns, ...patterns])];
  return effectivePatterns.some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(key);
    } catch {
      return key.toLowerCase().includes(pattern.toLowerCase());
    }
  });
}

export function redactSecretPath(path: string): string {
  const digest = createHash('sha256').update(path).digest('hex').slice(0, 12);
  return `[REDACTED_PATH:${digest}]`;
}

export function sanitizeSecretPromptDetails(
  request: PermissionRequest,
  options: { matchedRule?: string } = {},
): Pick<PermissionDecisionDetails, 'safeTarget' | 'matchedRule' | 'matchedLayer' | 'noPreview'> {
  return {
    safeTarget: request.target ? redactSecretPath(request.target.normalizedAbsolute) : undefined,
    matchedRule: options.matchedRule,
    matchedLayer: 'secret',
    noPreview: true,
  };
}

export function evaluateSecretDeny(
  config: PermissionPolicyConfig,
  request: PermissionRequest,
  options: SecretMatchOptions = {},
): PermissionDecisionResult | undefined {
  if (!request.target || config.secrets.mode !== 'deny') return undefined;

  const match = isSecretPathTarget(request.target, config.secrets.denyPaths, options);
  if (!match.matched) return undefined;

  return {
    decision: 'deny',
    finalDecision: 'deny',
    reason: 'Access to a configured secret or credential path is denied by policy.',
    reasonCode: 'secret_path_denied',
    riskLevel: 'critical',
    details: {
      ...sanitizeSecretPromptDetails(request, { matchedRule: match.pattern }),
      workspaceRoot: request.target.workspaceRoot,
    },
    audit: config.audit.enabled && config.audit.logDenied,
  };
}
