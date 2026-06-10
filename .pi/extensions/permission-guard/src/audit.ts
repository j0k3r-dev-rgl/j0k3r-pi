import { constants } from 'node:fs';
import { mkdir, open, rename, rm, stat, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { commandClassSummary } from './bash-policy.js';
import { isSecretPathTarget, redactSecretPath } from './secrets.js';
import type { AuditEvent, PermissionDecisionResult, PermissionPolicyConfig, PermissionRequest } from './types.js';

export interface AuditPathOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  homeDir?: string;
}

export interface RecordAuditOptions extends AuditPathOptions {
  auditDecision?: AuditEvent['decision'];
}

export interface RecordAuditResult {
  result: PermissionDecisionResult;
  event?: AuditEvent;
  skipped: boolean;
  auditError?: string;
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

function isSameOrInside(target: string, root: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function bestEffortError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveAuditFilePath(config: PermissionPolicyConfig, options: AuditPathOptions = {}): string {
  if (config.audit.path) return isAbsolute(config.audit.path) ? config.audit.path : resolve(config.audit.path);
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const stateRoot = env.XDG_STATE_HOME && env.XDG_STATE_HOME.trim() ? env.XDG_STATE_HOME : join(home, '.local', 'state');
  return join(stateRoot, 'pi', 'permission-guard', 'audit.ndjson');
}

export function redactAuditPath(
  request: PermissionRequest,
  config: PermissionPolicyConfig,
  options: AuditPathOptions = {},
): string | undefined {
  const target = request.target;
  if (!target) return undefined;
  if (!config.audit.redactPaths) return target.normalizedAbsolute;

  if (isSecretPathTarget(target, config.secrets.denyPaths, { homeDir: options.homeDir }).matched) {
    return redactSecretPath(target.normalizedAbsolute);
  }

  const home = options.homeDir ?? homedir();
  if (home && isSameOrInside(target.normalizedAbsolute, home)) {
    const homeRelative = toPosixPath(relative(home, target.normalizedAbsolute));
    return homeRelative === '' ? '~' : `~/${homeRelative}`;
  }

  if (target.insideWorkspace && target.workspaceRelative) {
    return target.workspaceRelative === '.' ? '<workspace>' : `<workspace>/${target.workspaceRelative}`;
  }

  return target.normalizedAbsolute;
}

export function redactAuditCommandSummary(command: string, config: PermissionPolicyConfig): string {
  const capped = command.length > config.bash.maxCommandPreviewChars
    ? `${command.slice(0, Math.max(0, config.bash.maxCommandPreviewChars - 1))}…`
    : command;

  return capped
    .replace(/\b([A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL)[A-Z_]*)=([^\s&]+)/gi, '$1=[REDACTED]')
    .replace(/([?&](?:token|secret|password|api[_-]?key|credential)=)([^\s&]+)/gi, '$1[REDACTED]')
    .replace(/(--(?:token|secret|password|api-key|credential)(?:=|\s+))([^\s]+)/gi, '$1[REDACTED]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/\$\{?([A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL)[A-Z_]*)\}?/gi, '$$$1');
}

function shouldAudit(config: PermissionPolicyConfig, decision: AuditEvent['decision']): boolean {
  if (!config.audit.enabled) return false;
  if (decision === 'deny') return config.audit.logDenied;
  if (decision === 'approval_allow_once' || decision === 'approval_allow_session' || decision === 'approval_deny' || decision === 'permission_required') return config.audit.logApprovals;
  if (decision === 'allow') return config.audit.logAllowed;
  return false;
}

function auditDecisionFor(result: PermissionDecisionResult, explicit?: AuditEvent['decision']): AuditEvent['decision'] {
  if (explicit) return explicit;
  if (result.reasonCode === 'approval_allow_once') return 'approval_allow_once';
  if (result.reasonCode === 'approval_allow_session') return 'approval_allow_session';
  if (result.reasonCode === 'approval_denied') return 'approval_deny';
  return result.decision;
}

export function buildAuditEvent(
  config: PermissionPolicyConfig,
  request: PermissionRequest,
  result: PermissionDecisionResult,
  options: RecordAuditOptions = {},
): AuditEvent {
  const decision = auditDecisionFor(result, options.auditDecision);
  const event: AuditEvent = {
    version: 1,
    timestamp: new Date().toISOString(),
    requestId: request.id,
    origin: request.origin,
    requester: request.requester,
    decision,
    tool: request.tool,
    action: request.action,
    reasonCode: result.reasonCode,
    riskLevel: result.riskLevel,
    mode: request.mode,
  };

  const redactedPath = redactAuditPath(request, config, options);
  if (redactedPath) {
    event.target = {
      redactedPath,
      insideWorkspace: request.target?.insideWorkspace,
      symlinkEscapesWorkspace: request.target?.symlinkEscapesWorkspace,
    };
  }

  if (request.command) {
    event.command = {
      redactedSummary: redactAuditCommandSummary(request.command.summary || request.command.raw, config),
      classes: commandClassSummary(request),
    };
  }

  return event;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return false;
    return false;
  }
}

async function rotateIfNeeded(path: string, config: PermissionPolicyConfig): Promise<void> {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    return;
  }

  if (fileStat.size <= config.audit.maxBytes) return;

  const maxFiles = Math.max(1, config.audit.maxFiles);
  await rm(`${path}.${maxFiles}`, { force: true });
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const from = `${path}.${index}`;
    const to = `${path}.${index + 1}`;
    if (await exists(from)) await rename(from, to);
  }
  await rename(path, `${path}.1`);
}

async function appendAuditLine(path: string, config: PermissionPolicyConfig, event: AuditEvent): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700).catch(() => undefined);
  await rotateIfNeeded(path, config);

  const handle = await open(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600).catch(() => undefined);
}

export async function recordPermissionRequiredAudit(
  config: PermissionPolicyConfig,
  request: PermissionRequest,
  result: PermissionDecisionResult,
  options: RecordAuditOptions = {},
): Promise<RecordAuditResult> {
  return recordAuditDecision(config, request, result, { ...options, auditDecision: 'permission_required' });
}

export async function recordAuditDecision(
  config: PermissionPolicyConfig,
  request: PermissionRequest,
  result: PermissionDecisionResult,
  options: RecordAuditOptions = {},
): Promise<RecordAuditResult> {
  const event = buildAuditEvent(config, request, result, options);
  if (!shouldAudit(config, event.decision)) {
    return { result, event, skipped: true };
  }

  try {
    await appendAuditLine(resolveAuditFilePath(config, options), config, event);
    return { result, event, skipped: false };
  } catch (error) {
    const auditError = bestEffortError(error);
    return {
      result: { ...result, audit: result.audit, reason: result.reason },
      event: { ...event, auditError },
      skipped: false,
      auditError,
    };
  }
}
