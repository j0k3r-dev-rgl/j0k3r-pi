import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  MAX_ENV_ENTRIES,
  MAX_ENV_FILE_BYTES,
  MAX_ENV_KEY_CHARS,
  MAX_ENV_VALUE_CHARS,
  assertContainedRealPath,
  createWorkspaceSecurityContext,
  closePinnedDirectory,
  pathExists,
  pinContainedDirectory,
  pinRelativeWorkspaceDirectory,
  readBoundedTextFile,
  readPinnedTextFile,
} from './security.js';
import type { WorkspaceServiceDefinition, WorkspaceServicesConfig, WorkspaceServiceType } from './types.js';

export const CONFIG_RELATIVE_PATH = join('.pi', 'workspace-services.json');
export const RUNTIME_RELATIVE_DIR = join('.pi', 'workspace-services');
export const LOGS_RELATIVE_DIR = join(RUNTIME_RELATIVE_DIR, 'logs');
export const STATE_RELATIVE_PATH = join(RUNTIME_RELATIVE_DIR, 'state.json');
export const LAST_GOOD_STATE_RELATIVE_PATH = join(RUNTIME_RELATIVE_DIR, 'state.last-good.json');
export const OWNER_RELATIVE_PATH = join(RUNTIME_RELATIVE_DIR, 'transaction-owner.json');
export const QUARANTINE_RELATIVE_DIR = join(RUNTIME_RELATIVE_DIR, 'quarantine');
export const RUNNER_MODULE_PATH = new URL('./core/service-runner.mjs', import.meta.url).pathname;
export const GITIGNORE_ENTRY = '.pi/workspace-services/';

const SERVICE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertServiceName(name: string): void {
  if (!SERVICE_NAME_PATTERN.test(name) || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`Invalid service name "${name}". Service keys are also log file names and may only contain letters, numbers, dots, underscores, and dashes.`);
  }
}

function assertServiceType(value: unknown, name: string): WorkspaceServiceType {
  if (value === 'node' || value === 'spring') return value;
  throw new Error(`Invalid type for service "${name}". Expected "node" or "spring".`);
}

function assertStringField(value: unknown, field: string, name: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  throw new Error(`Invalid ${field} for service "${name}". Expected a non-empty string.`);
}

function assertBooleanField(value: unknown, field: string, name: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error(`Invalid ${field} for service "${name}". Expected a boolean.`);
}

function buildEmptyConfig(cwd: string, workspaceRealRoot: string): WorkspaceServicesConfig {
  const workspaceRoot = resolve(cwd);
  const runtimeDir = join(workspaceRoot, RUNTIME_RELATIVE_DIR);
  return {
    exists: false,
    workspaceRoot,
    workspaceRealRoot,
    configPath: join(workspaceRoot, CONFIG_RELATIVE_PATH),
    runtimeDir,
    logsDir: join(workspaceRoot, LOGS_RELATIVE_DIR),
    statePath: join(workspaceRoot, STATE_RELATIVE_PATH),
    lastGoodStatePath: join(workspaceRoot, LAST_GOOD_STATE_RELATIVE_PATH),
    ownerPath: join(workspaceRoot, OWNER_RELATIVE_PATH),
    quarantineDir: join(workspaceRoot, QUARANTINE_RELATIVE_DIR),
    runnerPath: RUNNER_MODULE_PATH,
    services: {},
  };
}

export async function loadWorkspaceServicesConfig(cwd: string): Promise<WorkspaceServicesConfig> {
  const securityContext = await createWorkspaceSecurityContext(cwd);
  const base = buildEmptyConfig(cwd, securityContext.workspaceRealRoot);
  if (!(await pathExists(base.configPath))) return base;

  const configDir = await pinRelativeWorkspaceDirectory(base.workspaceRealRoot, '.pi', 'Workspace Services config directory');
  let rawText: string;
  try {
    rawText = await readPinnedTextFile(configDir, 'workspace-services.json', MAX_ENV_FILE_BYTES, CONFIG_RELATIVE_PATH);
  } finally {
    await closePinnedDirectory(configDir);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse error';
    throw new Error(`Invalid JSON in ${CONFIG_RELATIVE_PATH}: ${message}`);
  }

  if (!isRecord(parsed)) throw new Error(`${CONFIG_RELATIVE_PATH} must contain a JSON object.`);
  if (!isRecord(parsed.services)) throw new Error(`${CONFIG_RELATIVE_PATH} must contain a "services" object.`);

  const services: Record<string, WorkspaceServiceDefinition> = {};
  for (const [name, serviceRaw] of Object.entries(parsed.services)) {
    assertServiceName(name);
    if (!isRecord(serviceRaw)) throw new Error(`Service "${name}" must be an object.`);
    const type = assertServiceType(serviceRaw.type, name);
    const relativePath = assertStringField(serviceRaw.path, 'path', name);
    const command = assertStringField(serviceRaw.command, 'command', name);
    const envFile = assertBooleanField(serviceRaw.env_file, 'env_file', name);
    const serviceCwd = resolve(base.workspaceRoot, relativePath);
    const safeCwd = await assertContainedRealPath(base.workspaceRealRoot, serviceCwd, `Configured path for service "${name}"`);
    services[name] = {
      name,
      type,
      relativePath,
      cwd: safeCwd,
      command,
      envFile,
      envFilePath: join(safeCwd, '.env'),
      logPath: join(base.logsDir, `${name}.log`),
    };
  }

  return { ...base, exists: true, services };
}

export async function ensureRuntimeDirs(config: WorkspaceServicesConfig): Promise<void> {
  await mkdir(config.logsDir, { recursive: true, mode: 0o700 });
  await mkdir(config.quarantineDir, { recursive: true, mode: 0o700 });
}

export async function ensureRuntimeGitignore(cwd: string): Promise<void> {
  const gitignorePath = join(resolve(cwd), '.gitignore');
  if (!(await pathExists(gitignorePath))) {
    await writeFile(gitignorePath, `${GITIGNORE_ENTRY}\n`, 'utf8');
    return;
  }
  const current = await readFile(gitignorePath, 'utf8');
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(GITIGNORE_ENTRY) || lines.includes(GITIGNORE_ENTRY.replace(/\/$/, ''))) return;
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  await appendFile(gitignorePath, `${prefix}${GITIGNORE_ENTRY}\n`, 'utf8');
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    if (!ENV_KEY_PATTERN.test(key) || key.length > MAX_ENV_KEY_CHARS) continue;
    const value = unquoteEnvValue(line.slice(equalsIndex + 1));
    if (value.length > MAX_ENV_VALUE_CHARS) throw new Error(`.env value for ${key} exceeds the supported size limit.`);
    env[key] = value;
    if (Object.keys(env).length > MAX_ENV_ENTRIES) throw new Error('.env contains too many entries.');
  }
  return env;
}

export async function parseEnvFile(envPath: string): Promise<Record<string, string>> {
  const text = await readBoundedTextFile(envPath, MAX_ENV_FILE_BYTES, '.env file');
  return parseEnvText(text);
}

export async function loadServiceEnv(service: WorkspaceServiceDefinition, workspaceRealRoot?: string): Promise<Record<string, string>> {
  if (!service.envFile) return {};
  if (!(await pathExists(service.envFilePath))) {
    throw new Error(`Service "${service.name}" has env_file=true but ${service.relativePath}/.env does not exist.`);
  }
  if (!workspaceRealRoot) return parseEnvFile(service.envFilePath);
  const serviceDir = await pinContainedDirectory(workspaceRealRoot, service.cwd, `Configured path for service "${service.name}"`);
  try {
    try {
      const text = await readPinnedTextFile(serviceDir, '.env', MAX_ENV_FILE_BYTES, `.env for service "${service.name}"`);
      return parseEnvText(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`.env for service "${service.name}" must remain a regular file inside the pinned service directory. ${message}`);
    }
  } finally {
    await closePinnedDirectory(serviceDir);
  }
}
