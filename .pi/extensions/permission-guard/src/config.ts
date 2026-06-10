import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { homedir } from 'node:os';
import { builtInPermissionPolicy } from './defaults.js';
import type { PermissionPolicyConfig, PolicyDecision, ToolMode } from './types.js';

export interface LoadPermissionConfigOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

export interface PermissionConfigPaths {
  globalConfigPath: string;
  projectConfigPath: string;
}

export interface PermissionConfigLoadResult extends PermissionConfigPaths {
  config: PermissionPolicyConfig;
  loadedConfigPaths: string[];
  warnings: string[];
}

type JsonObject = Record<string, unknown>;

const secretLikeKeyPattern = /(?:api[_-]?key|token|secret|password|credential)/i;
const optionalConfigPaths = new Set(['workspace.root', 'audit.path']);
const policyDecisionPaths = new Set([
  'workspace.allowRead',
  'workspace.allowWrite',
  'workspace.allowCreate',
  'workspace.list',
  'workspace.search',
  'outsideWorkspace.read',
  'outsideWorkspace.list',
  'outsideWorkspace.search',
  'outsideWorkspace.write',
  'outsideWorkspace.create',
  'bash.default',
  'bash.network',
  'bash.workspaceReadOnly',
  'bash.outsideWorkspaceFilesystem',
]);
const toolModePaths = new Set(['tools.read', 'tools.write', 'tools.edit', 'tools.grep', 'tools.find', 'tools.ls', 'tools.bash']);
const stringArrayPaths = new Set([
  'workspace.ask',
  'workspace.deny',
  'secrets.denyPaths',
  'secrets.denyKeyPatterns',
  'bash.safeCommands',
  'bash.denyCommands',
  'bash.askCommands',
]);

function isScopedApprovalRoot(value: unknown): value is PermissionPolicyConfig['bash']['scopedApprovals'][number]['allowedRoots'][number] {
  return isPlainObject(value)
    && (value.kind === 'workspace' || value.kind === 'directory')
    && typeof value.raw === 'string'
    && typeof value.normalizedAbsolute === 'string'
    && (value.resolvedRealpath === undefined || typeof value.resolvedRealpath === 'string');
}

function isScopedApproval(value: unknown): value is PermissionPolicyConfig['bash']['scopedApprovals'][number] {
  return isPlainObject(value)
    && value.version === 1
    && typeof value.id === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.commandSignature === 'string'
    && typeof value.effectSignature === 'string'
    && typeof value.normalizedCommand === 'string'
    && Array.isArray(value.allowedRoots)
    && value.allowedRoots.every(isScopedApprovalRoot)
    && (value.reasonCode === undefined || typeof value.reasonCode === 'string')
    && (value.source === undefined || value.source === 'session' || value.source === 'project' || value.source === 'subagent');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function clonePolicy(policy: PermissionPolicyConfig): PermissionPolicyConfig {
  return structuredClone(policy);
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function resolveAgentHome(env: Record<string, string | undefined>, homeDir: string): string {
  return resolve(env.PI_CODING_AGENT_DIR ?? join(homeDir, '.pi', 'agent'));
}

async function findNearestProjectConfigPath(cwd: string): Promise<string | undefined> {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, '.pi', 'permissions.json');
    if (await exists(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return undefined;
    current = parent;
  }
}

function hasKnownConfigKey(base: unknown, keyPath: string, key: string): boolean {
  return (isPlainObject(base) && Object.hasOwn(base, key)) || optionalConfigPaths.has(keyPath);
}

function warnUnsupportedKey(keyPath: string, key: string, warnings: string[]): void {
  const label = secretLikeKeyPattern.test(key)
    ? 'unsupported secret-like permission config key'
    : 'unsupported permission config key';
  warnings.push(`${label} ignored at ${keyPath}`);
}

function warnUnknownTree(value: unknown, keyPath: string, key: string, warnings: string[]): void {
  warnUnsupportedKey(keyPath, key, warnings);
  if (!isPlainObject(value)) return;

  for (const [childKey, childValue] of Object.entries(value)) {
    const childPath = formatPath(keyPath, childKey);
    if (secretLikeKeyPattern.test(childKey)) {
      warnUnsupportedKey(childPath, childKey, warnings);
    }
    if (isPlainObject(childValue)) warnUnknownTree(childValue, childPath, childKey, warnings);
  }
}

function filterUnknownKeys(raw: JsonObject, base: unknown, warnings: string[], parentPath = ''): JsonObject {
  const filtered: JsonObject = {};

  for (const [key, value] of Object.entries(raw)) {
    const keyPath = formatPath(parentPath, key);
    if (!hasKnownConfigKey(base, keyPath, key)) {
      warnUnknownTree(value, keyPath, key, warnings);
      continue;
    }

    const baseValue = isPlainObject(base) ? base[key] : undefined;
    if (isPlainObject(value) && (isPlainObject(baseValue) || optionalConfigPaths.has(keyPath))) {
      filtered[key] = filterUnknownKeys(value, baseValue ?? {}, warnings, keyPath);
    } else {
      filtered[key] = value;
    }
  }

  return filtered;
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return base;
  const result: JsonObject = { ...base } as JsonObject;

  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (Array.isArray(value)) {
      result[key] = [...value];
    } else if (isPlainObject(value) && isPlainObject(current)) {
      result[key] = deepMerge(current, value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

function isPolicyDecision(value: unknown): value is PolicyDecision {
  return value === 'allow' || value === 'ask' || value === 'deny';
}

function isToolMode(value: unknown): value is ToolMode {
  return value === 'allow' || value === 'deny' || value === 'policy';
}

function validateLeaf(value: unknown, defaultValue: unknown, keyPath: string, warnings: string[]): unknown {
  if (policyDecisionPaths.has(keyPath)) {
    if (isPolicyDecision(value)) return value;
    warnings.push(`invalid policy value at ${keyPath}; using built-in safe default`);
    return defaultValue;
  }

  if (toolModePaths.has(keyPath)) {
    if (isToolMode(value)) return value;
    warnings.push(`invalid tool mode at ${keyPath}; using built-in safe default`);
    return defaultValue;
  }

  if (stringArrayPaths.has(keyPath)) {
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return [...value];
    warnings.push(`invalid string array at ${keyPath}; using built-in safe default`);
    return defaultValue;
  }

  switch (keyPath) {
    case 'workspace.root':
    case 'audit.path':
      if (typeof value === 'string' && value.length > 0) return value;
      warnings.push(`invalid path value at ${keyPath}; using built-in safe default`);
      return undefined;
    case 'workspace.followSymlinks':
      if (value === 'realpath' || value === 'lexical') return value;
      warnings.push(`invalid symlink mode at ${keyPath}; using built-in safe default`);
      return defaultValue;
    case 'outsideWorkspace.rememberApprovals':
      if (value === 'none' || value === 'session') return value;
      warnings.push(`invalid remember approvals mode at ${keyPath}; using built-in safe default`);
      return defaultValue;
    case 'secrets.mode':
      if (value === 'deny') return value;
      warnings.push(`invalid secrets mode at ${keyPath}; using built-in safe default`);
      return defaultValue;
    case 'secrets.maxPreviewBytesForPrompt':
      if (value === 0) return value;
      warnings.push(`invalid secret preview value at ${keyPath}; using built-in safe default`);
      return defaultValue;
    case 'bash.envSecretExposure':
      if (value === 'deny' || value === 'ask') return value;
      warnings.push(`invalid env secret exposure mode at ${keyPath}; using built-in safe default`);
      return defaultValue;
    case 'bash.scopedApprovals':
      if (Array.isArray(value)) {
        const valid = value.filter(isScopedApproval);
        if (valid.length !== value.length) warnings.push('invalid scoped approval entries at bash.scopedApprovals; ignoring malformed entries');
        return valid;
      }
      warnings.push(`invalid scoped approval array at ${keyPath}; using built-in safe default`);
      return defaultValue;
    case 'nonInteractive.onAsk':
      if (value === 'deny' || value === 'allow') return value;
      warnings.push(`invalid non-interactive fallback at ${keyPath}; using built-in safe default`);
      return defaultValue;
    default:
      break;
  }

  if (typeof defaultValue === 'boolean') {
    if (typeof value === 'boolean') return value;
    warnings.push(`invalid boolean at ${keyPath}; using built-in safe default`);
    return defaultValue;
  }

  if (typeof defaultValue === 'number') {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    warnings.push(`invalid number at ${keyPath}; using built-in safe default`);
    return defaultValue;
  }

  if (typeof defaultValue === 'string') {
    if (typeof value === 'string') return value;
    warnings.push(`invalid string at ${keyPath}; using built-in safe default`);
    return defaultValue;
  }

  return value;
}

function validateConfigObject(value: JsonObject, defaults: JsonObject, warnings: string[], parentPath = ''): JsonObject {
  const validated: JsonObject = {};
  const keys = new Set([...Object.keys(value), ...Object.keys(defaults)]);
  if (parentPath === 'workspace') keys.add('root');
  if (parentPath === 'audit') keys.add('path');

  for (const key of keys) {
    const keyPath = formatPath(parentPath, key);
    const hasValue = Object.hasOwn(value, key);
    const hasDefault = Object.hasOwn(defaults, key);
    if (!hasValue && !hasDefault) continue;
    const candidate = hasValue ? value[key] : defaults[key];
    const defaultValue = defaults[key];

    if (isPlainObject(defaultValue)) {
      validated[key] = validateConfigObject(isPlainObject(candidate) ? candidate : {}, defaultValue, warnings, keyPath);
      if (!isPlainObject(candidate)) warnings.push(`invalid object at ${keyPath}; using built-in safe defaults`);
    } else {
      const nextValue = validateLeaf(candidate, defaultValue, keyPath, warnings);
      if (nextValue !== undefined) validated[key] = nextValue;
    }
  }

  return validated;
}

function validateConfig(value: PermissionPolicyConfig, warnings: string[]): PermissionPolicyConfig {
  return validateConfigObject(value as unknown as JsonObject, builtInPermissionPolicy as unknown as JsonObject, warnings) as unknown as PermissionPolicyConfig;
}

function resolveWorkspaceRootOverride(config: PermissionPolicyConfig, cwd: string): PermissionPolicyConfig {
  if (!config.workspace.root) return config;
  return {
    ...config,
    workspace: {
      ...config.workspace,
      root: isAbsolute(config.workspace.root) ? resolve(config.workspace.root) : resolve(cwd, config.workspace.root),
    },
  };
}

export async function resolvePermissionConfigPaths(options: LoadPermissionConfigOptions = {}): Promise<PermissionConfigPaths> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const home = options.homeDir ?? env.HOME ?? homedir();
  const agentHome = resolveAgentHome(env, home);
  const discoveredProjectPath = await findNearestProjectConfigPath(cwd);

  return {
    globalConfigPath: join(agentHome, 'extensions', 'permission-guard.json'),
    projectConfigPath: discoveredProjectPath ?? join(cwd, '.pi', 'permissions.json'),
  };
}

async function readJsonConfig(path: string, warnings: string[]): Promise<JsonObject | 'malformed' | undefined> {
  if (!(await exists(path))) return undefined;
  const raw = await readFile(path, 'utf8');
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      warnings.push(`permission config at ${path} must be a JSON object; ignoring it`);
      return {};
    }
    return parsed;
  } catch {
    warnings.push(`malformed json in permission config at ${path}; using built-in safe defaults`);
    return 'malformed';
  }
}

export async function loadPermissionConfig(options: LoadPermissionConfigOptions = {}): Promise<PermissionConfigLoadResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const paths = await resolvePermissionConfigPaths({ ...options, cwd });
  const warnings: string[] = [];
  const loadedConfigPaths: string[] = [];
  let merged = clonePolicy(builtInPermissionPolicy);

  for (const candidate of [paths.globalConfigPath, paths.projectConfigPath]) {
    const parsed = await readJsonConfig(candidate, warnings);
    if (parsed === undefined) continue;
    loadedConfigPaths.push(candidate);
    if (parsed === 'malformed') {
      return {
        ...paths,
        config: clonePolicy(builtInPermissionPolicy),
        loadedConfigPaths,
        warnings,
      };
    }

    const filtered = filterUnknownKeys(parsed, builtInPermissionPolicy, warnings);
    merged = deepMerge(merged, filtered);
  }

  const config = resolveWorkspaceRootOverride(validateConfig(merged, warnings), cwd);
  return {
    ...paths,
    config,
    loadedConfigPaths,
    warnings,
  };
}
