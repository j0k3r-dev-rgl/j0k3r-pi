import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type {
  PermissionPolicyConfig,
  ShellAnalysisResult,
  ShellOperator,
  ShellRedirection,
  ShellSegmentAnalysis,
  ShellUnsupportedKind,
} from './types.js';

export interface AnalyzeShellCommandOptions {
  command: string;
  cwd: string;
  config: PermissionPolicyConfig;
}

interface SplitResult {
  segments: string[];
  operators: ShellOperator[];
  unsupported: ShellUnsupportedKind[];
}

function normalizeWhitespace(command: string): string {
  return command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/[ \t]+/g, ' ');
}

function signatureFor(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function pushUnsupported(list: ShellUnsupportedKind[], value: ShellUnsupportedKind): void {
  if (!list.includes(value)) list.push(value);
}

function splitSegments(command: string): SplitResult {
  const segments: string[] = [];
  const operators: ShellOperator[] = [];
  const unsupported: ShellUnsupportedKind[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    const next = command[i + 1];

    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '`' || (char === '$' && next === '(')) pushUnsupported(unsupported, 'command_substitution');
    if ((char === '<' || char === '>') && next === '(') pushUnsupported(unsupported, 'process_substitution');
    if (char === '(' || char === ')') pushUnsupported(unsupported, 'subshell');
    if (char === '<' && next === '<') pushUnsupported(unsupported, 'here_doc');
    if (char === '|' && next !== '|') pushUnsupported(unsupported, 'pipe');
    if (char === '&' && next !== '&') pushUnsupported(unsupported, 'background');

    if (char === '&' && next === '&') {
      if (current.trim()) segments.push(current.trim());
      operators.push('&&');
      current = '';
      i += 1;
      continue;
    }
    if (char === '|' && next === '|') {
      if (current.trim()) segments.push(current.trim());
      operators.push('||');
      current = '';
      i += 1;
      continue;
    }
    if (char === ';') {
      if (current.trim()) segments.push(current.trim());
      operators.push(';');
      current = '';
      continue;
    }
    if (char === '\n') {
      if (current.trim()) segments.push(current.trim());
      operators.push('newline');
      current = '';
      continue;
    }

    current += char;
  }

  if (quote) pushUnsupported(unsupported, 'malformed_quote');
  if (current.trim()) segments.push(current.trim());
  return { segments, operators, unsupported };
}

function tokenize(segment: string): { tokens: string[]; unsupported: ShellUnsupportedKind[]; redirections: ShellRedirection[] } {
  const tokens: string[] = [];
  const unsupported: ShellUnsupportedKind[] = [];
  const redirections: ShellRedirection[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;

  const flush = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };

  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i]!;
    const next = segment[i + 1];

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        if (quote === '"' && char === '$') pushUnsupported(unsupported, 'parameter_expansion');
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      flush();
      continue;
    }

    if (char === '$') pushUnsupported(unsupported, 'parameter_expansion');
    if (char === '~') pushUnsupported(unsupported, 'tilde_expansion');
    if (char === '*' || char === '?') pushUnsupported(unsupported, 'glob_expansion');

    if (char === '<' || char === '>') {
      flush();
      const op = char === '>' && next === '>' ? '>>' : char;
      if ((char === '<' && next === '<') || op === '>>>' as never) pushUnsupported(unsupported, 'unsupported_redirection');
      if (op === '>>') i += 1;
      while (/\s/.test(segment[i + 1] ?? '')) i += 1;
      let target = '';
      let innerQuote: "'" | '"' | undefined;
      for (i += 1; i < segment.length; i += 1) {
        const inner = segment[i]!;
        if (innerQuote) {
          if (inner === innerQuote) innerQuote = undefined;
          else target += inner;
          continue;
        }
        if (inner === "'" || inner === '"') {
          innerQuote = inner;
          continue;
        }
        if (/\s/.test(inner)) break;
        target += inner;
      }
      if (innerQuote) pushUnsupported(unsupported, 'malformed_quote');
      redirections.push({ operator: op as '<' | '>' | '>>', rawTarget: target });
      continue;
    }

    current += char;
  }

  if (quote) pushUnsupported(unsupported, 'malformed_quote');
  flush();
  return { tokens, unsupported, redirections };
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function classifyRisk(commandName: string | undefined, unsupported: ShellUnsupportedKind[]): string[] {
  const classes = new Set<string>();
  if (unsupported.length > 0) classes.add('unsupported');
  if (!commandName) classes.add('unknown');
  if (commandName && /^(curl|wget|ssh|scp|rsync)$/.test(commandName)) classes.add('network');
  if (commandName && /^(rm|mv|cp)$/.test(commandName)) classes.add('state-change');
  return [...classes];
}

function nextCwdFor(segment: ShellSegmentAnalysis, currentCwd: string): string | undefined {
  if (segment.commandName === 'cd') {
    const target = segment.argv[0];
    if (!target) return undefined;
    if (target === '~' || target.startsWith('~/')) return undefined;
    return resolve(currentCwd, target);
  }

  if (segment.commandName === 'pushd') {
    const target = segment.argv[0];
    if (!target) return undefined;
    if (target === '~' || target.startsWith('~/')) return undefined;
    return resolve(currentCwd, target);
  }

  return undefined;
}

function sourceScript(commandName: string | undefined): ShellUnsupportedKind[] {
  if (commandName === 'source' || commandName === '.') return ['source_script'];
  return [];
}

export function analyzeShellCommand(options: AnalyzeShellCommandOptions): ShellAnalysisResult {
  const normalizedCommand = normalizeWhitespace(options.command);
  const split = splitSegments(normalizedCommand);
  const segments: ShellSegmentAnalysis[] = [];
  const unsupported = [...split.unsupported];
  const riskClasses = new Set<string>();
  let effectiveCwd = options.cwd;

  split.segments.forEach((raw, index) => {
    const parsed = tokenize(raw);
    const envAssignments: Record<string, string> = {};
    let tokenIndex = 0;
    while (tokenIndex < parsed.tokens.length && isEnvAssignment(parsed.tokens[tokenIndex]!)) {
      const [key, ...value] = parsed.tokens[tokenIndex]!.split('=');
      envAssignments[key!] = value.join('=');
      tokenIndex += 1;
    }
    const commandName = parsed.tokens[tokenIndex];
    const argv = parsed.tokens.slice(tokenIndex + 1);
    const segmentUnsupported = [...parsed.unsupported, ...sourceScript(commandName)];
    segmentUnsupported.forEach((value) => pushUnsupported(unsupported, value));
    const segment: ShellSegmentAnalysis = {
      index,
      raw,
      commandName,
      argv,
      envAssignments,
      effectiveCwd,
      nextCwd: undefined,
      unsupported: [...segmentUnsupported],
      riskClasses: classifyRisk(commandName, segmentUnsupported),
      redirections: parsed.redirections,
    };
    segment.nextCwd = nextCwdFor(segment, effectiveCwd);
    segment.riskClasses.forEach((value) => riskClasses.add(value));
    segments.push(segment);
    if (segment.nextCwd) effectiveCwd = segment.nextCwd;
  });

  const ok = unsupported.length === 0;
  const summary = {
    command: normalizedCommand,
    operators: split.operators.length > 0 ? split.operators.join(' ') : undefined,
    unsupported: unsupported.length > 0 ? unsupported : undefined,
    paths: undefined,
  };

  return {
    ok,
    normalizedCommand,
    commandSignature: signatureFor(normalizedCommand),
    effectSignature: signatureFor(''),
    segments,
    operators: split.operators,
    pathEffects: [],
    unsupported,
    effectsComplete: ok,
    riskClasses: [...riskClasses],
    summary,
  };
}
