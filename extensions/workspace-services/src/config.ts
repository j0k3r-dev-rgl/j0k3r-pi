import { constants as fsConstants } from 'node:fs';
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { WorkspaceServiceDefinition, WorkspaceServicesConfig, WorkspaceServiceType } from './types.js';

export const CONFIG_RELATIVE_PATH = join('.pi', 'workspace-services.json');
export const RUNTIME_RELATIVE_DIR = join('.pi', 'workspace-services');
export const LOGS_RELATIVE_DIR = join(RUNTIME_RELATIVE_DIR, 'logs');
export const STATE_RELATIVE_PATH = join(RUNTIME_RELATIVE_DIR, 'state.json');
export const GITIGNORE_ENTRY = '.pi/workspace-services/';

const SERVICE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
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
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new Error(`Invalid ${field} for service "${name}". Expected a non-empty string.`);
}

function assertBooleanField(value: unknown, field: string, name: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error(`Invalid ${field} for service "${name}". Expected a boolean.`);
}

function assertInsideWorkspace(workspaceRoot: string, candidatePath: string, serviceName: string): void {
  const rel = relative(workspaceRoot, candidatePath);
  if (rel === '') return;
  if (rel.startsWith('..') || rel.includes(`..${sep}`) || rel === '..' || resolve(candidatePath) === resolve(workspaceRoot, '..')) {
    throw new Error(`Configured path for service "${serviceName}" escapes workspace root.`);
  }
}

function buildEmptyConfig(cwd: string): WorkspaceServicesConfig {
  const workspaceRoot = resolve(cwd);
  const runtimeDir = join(workspaceRoot, RUNTIME_RELATIVE_DIR);
  return {
    exists: false,
    workspaceRoot,
    configPath: join(workspaceRoot, CONFIG_RELATIVE_PATH),
    runtimeDir,
    logsDir: join(workspaceRoot, LOGS_RELATIVE_DIR),
    statePath: join(workspaceRoot, STATE_RELATIVE_PATH),
    services: {},
  };
}

export async function loadWorkspaceServicesConfig(cwd: string): Promise<WorkspaceServicesConfig> {
  const base = buildEmptyConfig(cwd);
  if (!(await pathExists(base.configPath))) return base;

  const rawText = await readFile(base.configPath, 'utf8');
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
    assertInsideWorkspace(base.workspaceRoot, serviceCwd, name);

    services[name] = {
      name,
      type,
      relativePath,
      cwd: serviceCwd,
      command,
      envFile,
      envFilePath: join(serviceCwd, '.env'),
      logPath: join(base.logsDir, `${name}.log`),
    };
  }

  return { ...base, exists: true, services };
}

export async function ensureRuntimeDirs(config: WorkspaceServicesConfig): Promise<void> {
  await mkdir(config.logsDir, { recursive: true });
}

export async function ensureRuntimeGitignore(cwd: string): Promise<void> {
  const gitignorePath = join(resolve(cwd), '.gitignore');
  const entry = GITIGNORE_ENTRY;

  if (!(await pathExists(gitignorePath))) {
    await writeFile(gitignorePath, `${entry}\n`, 'utf8');
    return;
  }

  const current = await readFile(gitignorePath, 'utf8');
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(entry) || lines.includes(entry.replace(/\/$/, ''))) return;

  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  await appendFile(gitignorePath, `${prefix}${entry}\n`, 'utf8');
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export async function parseEnvFile(envPath: string): Promise<Record<string, string>> {
  const text = await readFile(envPath, 'utf8');
  const env: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    if (!ENV_KEY_PATTERN.test(key)) continue;

    const value = line.slice(equalsIndex + 1);
    env[key] = unquoteEnvValue(value);
  }

  return env;
}

export async function loadServiceEnv(service: WorkspaceServiceDefinition): Promise<Record<string, string>> {
  if (!service.envFile) return {};
  if (!(await pathExists(service.envFilePath))) {
    throw new Error(`Service "${service.name}" has env_file=true but ${service.relativePath}/.env does not exist.`);
  }
  return parseEnvFile(service.envFilePath);
}
