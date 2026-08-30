import { resolve, relative, isAbsolute, join } from 'node:path';
import { deriveActiveWorkflows } from './state.js';
import type { ChangeWorkflowState, ExecutionScopeState } from '../types.js';

export type ScopeAction = 'read' | 'write' | 'edit' | 'bash';

export interface ScopeCheckInput {
  action: ScopeAction;
  paths?: string[];
  command?: string;
  cwd?: string;
}

export interface ScopeCheckResult {
  allowed: boolean;
  reason: string;
  evidence: string;
  next_permitted_action: string;
  violating_path?: string;
  command?: string;
}

function posixPath(path: string): string { return path.replaceAll('\\', '/'); }
function ensureTrailingSlash(path: string): string { return path.endsWith('/') ? path : `${path}/`; }

function normalizePattern(root: string, pattern: string): string | undefined {
  const raw = pattern.trim();
  if (!raw || raw === 'None') return undefined;
  const hasGlob = raw.endsWith('/**');
  const base = hasGlob ? raw.slice(0, -3) : raw;
  const absolute = isAbsolute(base) ? resolve(base) : resolve(root, base);
  const rel = relative(resolve(root), absolute);
  if (absolute !== '/tmp' && (rel === '..' || rel.startsWith('..') || isAbsolute(rel))) return undefined;
  return posixPath(hasGlob ? `${absolute}/**` : absolute);
}

function matchPattern(pattern: string, path: string): boolean {
  const normalized = posixPath(resolve(path));
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3);
    return normalized === base || normalized.startsWith(ensureTrailingSlash(base));
  }
  return normalized === pattern;
}

export function isTmpAllowed(path: string): boolean {
  const normalized = posixPath(resolve(path));
  return normalized === '/tmp' || normalized.startsWith('/tmp/');
}

export function pathMatches(patterns: string[], path: string): boolean {
  return isTmpAllowed(path) || patterns.some((pattern) => matchPattern(pattern, path));
}

function isRuntimeGuidanceRead(path: string): boolean {
  const normalized = posixPath(resolve(path));
  const root = '/home/j0k3r/.pi/agent';
  if (normalized === `${root}/AGENTS.md`) return true;
  const skillsPrefix = `${root}/skills/`;
  return normalized.startsWith(skillsPrefix) && normalized.endsWith('/SKILL.md');
}

function parseList(lines: string[], index: number): { values: string[]; next: number; error?: string } {
  const values: string[] = [];
  let i = index + 1;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^-\s+/.test(line)) break;
    const match = line.match(/^\s{2,}-\s+(.+)$/);
    if (!match) {
      if (line.trim() === '') continue;
      return { values, next: i, error: `Invalid indented list item: ${line.trim()}` };
    }
    values.push(match[1].trim());
  }
  return { values, next: i };
}

function isConcretePlainValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'None') return false;
  if (/^`.*`$/.test(trimmed) || /^['"].*['"]$/.test(trimmed)) return false;
  if (/[`]/.test(trimmed)) return false;
  if (/[<>]/.test(trimmed)) return false;
  return !/\b(?:as needed|tbd|todo|placeholder)\b/i.test(trimmed);
}

function invalidPlainValues(values: string[] | undefined): string[] {
  return (values ?? []).filter((value) => !isConcretePlainValue(value));
}

export function parseExecutionScope(markdown: string, authorityArtifact: string, workspaceRoot: string): ExecutionScopeState {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const unavailable = (reason: string): ExecutionScopeState => ({
    authority_artifact: authorityArtifact,
    root: resolve(workspaceRoot),
    allowed_paths: [],
    writable_paths: [],
    allowed_bash: [],
    tmp_always_allowed: true,
    status: 'BLOCKED',
    blockers: [reason],
    warnings,
  });

  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex((line) => line.trim() === '## Execution Scope');
  if (heading === -1) return unavailable(`Missing Execution Scope in ${authorityArtifact}.`);
  const block: string[] = [];
  for (const line of lines.slice(heading + 1)) {
    if (line.startsWith('#')) break;
    block.push(line);
  }
  while (block.length && block[block.length - 1].trim() === '') block.pop();

  let rootValue: string | undefined;
  let allowedRaw: string[] | undefined;
  let writableRaw: string[] | undefined;
  let bashRaw: string[] | undefined;
  let notesSeen = false;
  for (let i = 0; i < block.length; i += 1) {
    const line = block[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('- Root:')) rootValue = trimmed.slice('- Root:'.length).trim();
    else if (trimmed === '- Allowed Paths:') { const parsed = parseList(block, i); allowedRaw = parsed.values; if (parsed.error) blockers.push(parsed.error); i = parsed.next - 1; }
    else if (trimmed === '- Writable Paths:') { const parsed = parseList(block, i); writableRaw = parsed.values; if (parsed.error) blockers.push(parsed.error); i = parsed.next - 1; }
    else if (trimmed === '- Allowed Bash:') { const parsed = parseList(block, i); bashRaw = parsed.values.filter((value) => value !== 'None'); if (parsed.error) blockers.push(parsed.error); i = parsed.next - 1; }
    else if (trimmed.startsWith('- Notes:')) {
      const noteValue = trimmed.slice('- Notes:'.length).trim();
      notesSeen = true;
      if (!isConcretePlainValue(noteValue)) blockers.push('Execution Scope Notes must be concrete plain text.');
    }
    else if (trimmed !== '') blockers.push(`Unexpected Execution Scope line: ${trimmed}`);
  }

  if (!rootValue || !isAbsolute(rootValue)) blockers.push('Execution Scope Root must be an absolute path.');
  if (rootValue && !isConcretePlainValue(rootValue)) blockers.push('Execution Scope Root must be concrete plain text.');
  const root = resolve(rootValue || workspaceRoot);
  if (root !== resolve(workspaceRoot)) blockers.push(`Execution Scope Root must equal workspace root ${resolve(workspaceRoot)}.`);
  if (!allowedRaw || allowedRaw.length === 0) blockers.push('Execution Scope Allowed Paths must contain at least one path.');
  if (!writableRaw || writableRaw.length === 0) blockers.push('Execution Scope Writable Paths must contain at least one path.');
  if (!bashRaw) blockers.push('Execution Scope Allowed Bash is missing.');
  else if (bashRaw.length === 0) blockers.push('Execution Scope Allowed Bash must contain at least one concrete command.');
  if (!notesSeen) blockers.push('Execution Scope Notes is missing.');
  if (invalidPlainValues(allowedRaw).length) blockers.push('Execution Scope Allowed Paths must contain only concrete plain-text paths.');
  if (invalidPlainValues(writableRaw).length) blockers.push('Execution Scope Writable Paths must contain only concrete plain-text paths.');
  if (invalidPlainValues(bashRaw).length) blockers.push('Execution Scope Allowed Bash must contain only concrete plain-text commands.');

  const allowed_paths = (allowedRaw ?? []).map((value) => normalizePattern(root, value));
  const writable_paths = (writableRaw ?? []).map((value) => normalizePattern(root, value));
  if (allowed_paths.includes(undefined)) blockers.push('Execution Scope contains non-normalizable allowed path.');
  if (writable_paths.includes(undefined)) blockers.push('Execution Scope contains non-normalizable writable path.');
  const allowed = allowed_paths.filter(Boolean) as string[];
  const writable = writable_paths.filter(Boolean) as string[];
  for (const writablePath of writable) {
    const sample = writablePath.endsWith('/**') ? writablePath.slice(0, -3) : writablePath;
    if (!allowed.some((pattern) => matchPattern(pattern, sample))) blockers.push(`Writable path is outside Allowed Paths: ${writablePath}`);
  }

  return {
    authority_artifact: authorityArtifact,
    root,
    allowed_paths: allowed,
    writable_paths: writable,
    allowed_bash: bashRaw ?? [],
    tmp_always_allowed: true,
    status: blockers.length ? 'BLOCKED' : 'READY',
    blockers,
    warnings,
  };
}

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

export function isRiskyBash(command: string): boolean {
  return /(^|[\s;&|()])(?:uv\s+run\s+python|python3?|pytest|pip|poetry|tox)(?=$|[\s;&|()])/.test(command);
}

function commandMatchesAllowed(command: string, patterns: string[]): boolean {
  return patterns.some((pattern) => wildcardMatch(pattern, command));
}

function shellTokens(command: string): string[] {
  return [...command.matchAll(/(?:^|\s)(\.?\.?\/?[\w./-]+|\/[^\s'"`;&|<>]+)/g)].map((match) => match[1]);
}

function referencedPaths(command: string, cwd: string): string[] {
  return shellTokens(command)
    .filter((token) => token.startsWith('/') || token.startsWith('./') || token.startsWith('../') || token.startsWith('openspec/') || token.startsWith('extensions/'))
    .map((token) => resolve(cwd, token));
}

function mutationTargets(command: string, cwd: string): string[] {
  const targets: string[] = [];
  for (const match of command.matchAll(/(?:>|>>)\s*([^\s;&|]+)/g)) targets.push(resolve(cwd, match[1]));
  for (const match of command.matchAll(/\b(?:touch|mkdir|rm|rmdir)\b(?:\s+-[\w-]+)*\s+([^;&|]+)/g)) {
    for (const token of shellTokens(` ${match[1]}`)) targets.push(resolve(cwd, token));
  }
  for (const match of command.matchAll(/\b(?:cp|mv)\b(?:\s+-[\w-]+)*\s+([^;&|]+)\s+([^;&|\s]+)\b/g)) targets.push(resolve(cwd, match[2]));
  return targets;
}

export function checkScope(scope: ExecutionScopeState, input: ScopeCheckInput): ScopeCheckResult {
  const evidence = `${scope.authority_artifact} scope ${scope.status}`;
  if (scope.status !== 'READY') {
    return { allowed: false, reason: `Execution scope is BLOCKED: ${scope.blockers[0] ?? 'invalid scope'}`, evidence, next_permitted_action: 'fix the Execution Scope authority artifact before using scoped tools' };
  }
  const cwd = input.cwd ?? scope.root;
  const paths = (input.paths ?? []).map((path) => resolve(cwd, path));
  if (input.action === 'read') {
    const bad = paths.find((path) => !isRuntimeGuidanceRead(path) && !pathMatches(scope.allowed_paths, path));
    if (bad) return { allowed: false, reason: `read path is outside Allowed Paths: ${posixPath(bad)}`, evidence, next_permitted_action: 'read only declared Allowed Paths or update the Execution Scope', violating_path: posixPath(bad) };
  }
  if (input.action === 'write' || input.action === 'edit') {
    const bad = paths.find((path) => !pathMatches(scope.writable_paths, path));
    if (bad) return { allowed: false, reason: `${input.action} path is outside Writable Paths: ${posixPath(bad)}`, evidence, next_permitted_action: 'write only declared Writable Paths or update the Execution Scope', violating_path: posixPath(bad) };
  }
  if (input.action === 'bash') {
    const command = input.command ?? '';
    for (const path of referencedPaths(command, cwd)) {
      if (!pathMatches(scope.allowed_paths, path)) return { allowed: false, reason: `bash references path outside Allowed Paths: ${posixPath(path)}`, evidence, next_permitted_action: 'limit bash paths to declared Allowed Paths or update the Execution Scope', violating_path: posixPath(path), command };
    }
    for (const path of mutationTargets(command, cwd)) {
      if (!pathMatches(scope.writable_paths, path)) return { allowed: false, reason: `bash mutation target is outside Writable Paths: ${posixPath(path)}`, evidence, next_permitted_action: 'limit bash mutations to declared Writable Paths or update the Execution Scope', violating_path: posixPath(path), command };
    }
    if (isRiskyBash(command) && !commandMatchesAllowed(command, scope.allowed_bash)) return { allowed: false, reason: 'risky Python-related bash command lacks an explicit Allowed Bash pattern', evidence, next_permitted_action: 'add an explicit Allowed Bash pattern or use a non-risky command', command };
  }
  return { allowed: true, reason: 'action is inside the declared Execution Scope', evidence, next_permitted_action: 'proceed' };
}

export function blockMessage(result: ScopeCheckResult): string {
  return `workflow-guard blocked this action.\nReason: ${result.reason}.\nEvidence: ${result.evidence}.\nNext permitted action: ${result.next_permitted_action}.`;
}

export async function resolveScopeForToolCall(cwd: string, inputPaths: string[]): Promise<ExecutionScopeState | undefined> {
  const { states } = await deriveActiveWorkflows(cwd);
  const scoped = states.filter((state) => state.execution_scope);
  if (scoped.length === 1) return scoped[0].execution_scope;
  const absolutePaths = inputPaths.map((path) => resolve(cwd, path));
  for (const state of scoped) {
    const changeDir = resolve(cwd, 'openspec', 'changes', state.slug);
    if (absolutePaths.some((path) => path === changeDir || path.startsWith(`${changeDir}/`))) return state.execution_scope;
  }
  return undefined;
}

export function scopeExamples(state: ChangeWorkflowState): string[] {
  const scope = state.execution_scope;
  if (!scope) return [];
  const readExample = scope.allowed_paths[0] ? `read ${scope.allowed_paths[0]}` : undefined;
  const writeExample = scope.writable_paths[0] ? `write ${scope.writable_paths[0]}` : undefined;
  return [readExample, writeExample, 'write /tmp/example.txt'].filter(Boolean) as string[];
}
