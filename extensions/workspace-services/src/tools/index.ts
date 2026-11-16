import { type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  getServiceLogs,
  getServicesStatus,
  listServices,
  restartService,
  startService,
  stopService,
} from '../core/manager.js';
import { renderWorkspaceServiceCall, renderWorkspaceServiceResult } from '../render/index.js';
import type { WorkspaceServiceOutcome } from '../types.js';
import {
  EMPTY_PARAMETERS,
  LOGS_PARAMETERS,
  SERVICE_PARAMETERS,
  START_PARAMETERS,
  STOP_PARAMETERS,
  serviceName,
  textResult,
  timeoutMs,
  trustFailure,
} from './common.js';

export const WORKSPACE_SERVICE_TOOL_NAMES = [
  'workspace_services_list',
  'workspace_service_start',
  'workspace_service_stop',
  'workspace_service_logs',
  'workspace_services_status',
  'workspace_service_restart',
] as const;

export interface RegisterWorkspaceServicesToolsOptions { cwd?: string }

function cwdFrom(ctx: ExtensionContext | undefined, options: RegisterWorkspaceServicesToolsOptions): string {
  return options.cwd ?? ctx?.cwd ?? process.cwd();
}

function renderToolPresentation(toolName: string) {
  return {
    compactToolRenderingVersion: 1 as const,
    renderShell: 'self' as const,
    renderCall: (args: any, theme: any, context: any) => renderWorkspaceServiceCall(toolName, args, theme, context),
    renderResult: (result: any, renderOptions: any, theme: any, context: any) =>
      renderWorkspaceServiceResult(toolName, result as any, renderOptions, theme as any, context),
  };
}

async function ensureTrusted(ctx: ExtensionContext | undefined): Promise<boolean> {
  return Boolean(ctx?.isProjectTrusted());
}

function formatTrustFailureText(toolName: string, failure: WorkspaceServiceOutcome): string {
  const lines = [`${toolName}: ${failure.summary}`, `status=${failure.status}`];
  if (failure.nextAction) lines.push(`nextAction: ${failure.nextAction}`);
  return lines.join('\n');
}

function formatSourcesLine(result: { jsonExists?: boolean; configPath: string; composeFile?: string }): string {
  const sources: string[] = [];
  if (result.jsonExists) sources.push(`json=${result.configPath}`);
  if (result.composeFile) sources.push(`compose=${result.composeFile}`);
  return `sources: ${sources.length > 0 ? sources.join(', ') : 'none'}`;
}

function formatListOutcome(result: Awaited<ReturnType<typeof listServices>>): { outcome: WorkspaceServiceOutcome; text: string } {
  const status: WorkspaceServiceOutcome['status'] = result.partial ? 'partial' : 'ok';
  const summary = !result.exists
    ? `no config found at ${result.configPath} or standard Compose files`
    : result.services.length === 0
      ? result.partial
        ? '0 services listed (partial: Compose discovery incomplete)'
        : 'config found, 0 services declared'
      : result.partial
        ? `${result.services.length} service(s) listed (partial)`
        : `${result.services.length} service(s) listed`;

  const lines = [`workspace_services_list: ${summary}`];
  if (result.exists) {
    lines.push(formatSourcesLine(result));
  }
  if (result.warnings?.length) {
    for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  }
  if (result.nextAction) lines.push(`nextAction: ${result.nextAction}`);
  if (result.services.length > 0) {
    for (const service of result.services) {
      lines.push(
        `- ${service.name}: declared_type=${service.type} path=${service.path} command=${service.command} env_file=${String(service.env_file)} env_file_present=${String(service.env_file_present)} log=${service.log_path}`,
      );
    }
  } else if (result.exists && !result.partial) {
    lines.push('services: none');
  }

  return {
    outcome: {
      ok: true,
      status,
      summary,
      ...(result.warnings ? { warnings: result.warnings } : {}),
      ...(result.nextAction ? { nextAction: result.nextAction } : {}),
      data: result as any,
    },
    text: lines.join('\n'),
  };
}

function formatStatusOutcome(result: Awaited<ReturnType<typeof getServicesStatus>>): { outcome: WorkspaceServiceOutcome; text: string } {
  const status: WorkspaceServiceOutcome['status'] = result.partial ? 'partial' : 'ok';
  const summary = !result.exists
    ? `no config found at ${result.configPath} or standard Compose files`
    : result.services.length === 0
      ? result.partial
        ? '0 services checked (partial: Compose observation incomplete)'
        : 'config found, 0 services declared'
      : result.partial
        ? `${result.services.length} service(s) checked (partial)`
        : `${result.services.length} service(s) checked`;

  const lines = [`workspace_services_status: ${summary}`];
  if (result.exists) {
    lines.push(formatSourcesLine(result));
  }
  if (result.warnings?.length) {
    for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  }
  if (result.nextAction) lines.push(`nextAction: ${result.nextAction}`);
  for (const service of result.services) {
    const extras: string[] = [];
    if (service.compose_state) extras.push(`compose_state=${service.compose_state}`);
    if (service.pid !== undefined) extras.push(`pid=${service.pid}`);
    if (service.container_id) extras.push(`container=${service.container_id.slice(0, 12)}`);
    if (service.health) extras.push(`health=${service.health}`);
    if (service.exit_code !== undefined) extras.push(`exit_code=${service.exit_code}`);
    if (service.ports) extras.push(`ports=${service.ports}`);
    if (service.started_at) extras.push(`started_at=${service.started_at}`);
    const extraPart = extras.length > 0 ? ` ${extras.join(' ')}` : '';
    lines.push(
      `- ${service.name}: ${service.status}${extraPart} declared_type=${service.type} path=${service.path} command=${service.command} log=${service.log_path}`,
    );
  }

  return {
    outcome: {
      ok: true,
      status,
      summary,
      ...(result.warnings ? { warnings: result.warnings } : {}),
      ...(result.nextAction ? { nextAction: result.nextAction } : {}),
      data: result as any,
    },
    text: lines.join('\n'),
  };
}

function formatLogsText(outcome: WorkspaceServiceOutcome): string {
  const data = (outcome.data ?? {}) as Record<string, any>;
  const lines = [`workspace_service_logs: ${outcome.summary}`];
  const service = data.service ? `service=${data.service} ` : '';
  if (!outcome.ok) {
    lines.push(`${service}status=${outcome.status}`);
    if (data.error) lines.push(`error: ${data.error}`);
    if (outcome.nextAction) lines.push(`nextAction: ${outcome.nextAction}`);
    return lines.join('\n');
  }

  lines.push(`${service}status=${outcome.status}${data.logPath ? ` log_path=${data.logPath}` : ''}`);
  if (data.scope === 'recent-window-only') {
    lines.push(
      `scope=recent-window-only returned_lines=${outcome.truncation?.returned ?? data.lines ?? 0} max_lines=${data.maxLines ?? 100} bytes_returned=${data.bytesReturned ?? 0} max_bytes=${data.maxBytes ?? 51200} has_more=false (Compose does not support offset/until pagination)`,
    );
    if (data.limitReached) lines.push(`limit: ${data.limitReached}`);
    if (outcome.nextAction) lines.push(`nextAction: ${outcome.nextAction}`);
  } else {
    const totalDesc = outcome.truncation?.total !== undefined
      ? `total_lines=${outcome.truncation.total}`
      : `inspected_window_lines=${data.inspectedWindowLines ?? data.lines ?? 0} total_lines=unknown (inspected byte window only)`;
    lines.push(
      `returned_lines=${outcome.truncation?.returned ?? data.lines ?? 0} offset=${data.offset ?? 0}${data.until !== undefined ? ` until=${data.until}` : ''} bytes_returned=${data.bytesReturned ?? 0} bytes_inspected=${data.bytesRead ?? 0} file_bytes=${data.totalBytes ?? 0} ${totalDesc} has_more=${String(Boolean(outcome.truncation?.hasMore))}`,
    );
    if (data.liveConsistency) {
      lines.push('note: logs are live; appends or truncation can shift newest-relative offsets between calls.');
    }
    if (data.byteTruncated) {
      lines.push('note: output was bounded to fit max_bytes after redaction.');
    }
    if (data.limitReached) lines.push(`limit: ${data.limitReached}`);
    if (outcome.truncation?.continuation) lines.push(`continuation: ${outcome.truncation.continuation}`);
    else if (outcome.nextAction) lines.push(`nextAction: ${outcome.nextAction}`);
  }

  if (typeof data.text === 'string' && data.text.length > 0) {
    lines.push(data.text);
  } else {
    lines.push('(no log lines returned; an absent or empty log file does not imply the service is stopped)');
  }
  return lines.join('\n');
}

function formatLifecycleText(toolName: string, outcome: WorkspaceServiceOutcome): string {
  const data = (outcome.data ?? {}) as Record<string, any>;
  const lines = [`${toolName}: ${outcome.summary}`];
  const meta: string[] = [];
  if (data.service) meta.push(`service=${data.service}`);
  meta.push(`status=${outcome.status}`);
  if (data.pid !== undefined) meta.push(`pid=${data.pid}`);
  if (data.containerId) meta.push(`container=${String(data.containerId).slice(0, 12)}`);
  if (data.logPath) meta.push(`log_path=${data.logPath}`);
  if (data.startedAt) meta.push(`started_at=${data.startedAt}`);
  if (data.timeoutMs !== undefined) meta.push(`timeout_ms=${data.timeoutMs}`);
  if (data.exitCode !== undefined) meta.push(`exit_code=${data.exitCode}`);
  lines.push(meta.join(' '));
  if (data.reason) lines.push(`reason: ${data.reason}`);
  if (data.stderr) lines.push(`stderr: ${data.stderr}`);
  if (data.error) lines.push(`error: ${data.error}`);
  if (outcome.nextAction) lines.push(`nextAction: ${outcome.nextAction}`);
  return lines.join('\n');
}

export function registerWorkspaceServicesTools(pi: ExtensionAPI, options: RegisterWorkspaceServicesToolsOptions = {}): void {
  pi.registerTool({
    name: 'workspace_services_list',
    label: 'Workspace Services List',
    description: 'List declared workspace services from .pi/workspace-services.json and detected/configured Docker Compose services. type is a declared configuration/routing label (node, spring, or compose), not runtime technology detection. Does not read .env contents.',
    promptSnippet: 'List configured local services and discovered Docker Compose services.',
    promptGuidelines: [
      'Use workspace_services_list before starting services when you need the declared service names and configuration provenance.',
      'workspace_services_list only reads .pi/workspace-services.json and Compose service discovery; it never reads .env contents.',
    ],
    parameters: EMPTY_PARAMETERS,
    execute: async (_id, _params, signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) {
        const failure = trustFailure();
        return textResult(failure, formatTrustFailureText('workspace_services_list', failure));
      }
      const result = await listServices(cwdFrom(ctx, options), signal);
      const { outcome, text } = formatListOutcome(result);
      return textResult(outcome, text);
    },
    ...renderToolPresentation('workspace_services_list'),
  });

  pi.registerTool({
    name: 'workspace_service_start',
    label: 'Workspace Service Start',
    description: 'Start one declared workspace service or a Compose target ("all" / "compose"). Runs only the declared service command or Compose service; redacts known env_file=true values (target service only, or configured env_file=true union for stack targets) from failure diagnostics.',
    promptSnippet: 'Start one configured local service, Compose service, or Compose stack.',
    promptGuidelines: ['Use workspace_service_start only with declared service names or "all" / "compose".'],
    parameters: START_PARAMETERS,
    execute: async (_id, params, signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) {
        const failure = trustFailure();
        return textResult(failure, formatTrustFailureText('workspace_service_start', failure));
      }
      const outcome = await startService(cwdFrom(ctx, options), serviceName(params), {
        signal,
        timeoutMs: timeoutMs(params),
      });
      return textResult(outcome, formatLifecycleText('workspace_service_start', outcome));
    },
    ...renderToolPresentation('workspace_service_start'),
  });

  pi.registerTool({
    name: 'workspace_service_stop',
    label: 'Workspace Service Stop',
    description: 'Stop one workspace service previously started by workspace_service_start, or stop a Compose service / stack ("all" / "compose"). Redacts known env_file=true values (target service only, or configured env_file=true union for stack targets) from failure diagnostics.',
    promptSnippet: 'Stop one managed workspace service or Compose target.',
    promptGuidelines: ['Use workspace_service_stop when the user asks to stop a managed service or Compose target.'],
    parameters: STOP_PARAMETERS,
    execute: async (_id, params, signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) {
        const failure = trustFailure();
        return textResult(failure, formatTrustFailureText('workspace_service_stop', failure));
      }
      const outcome = await stopService(cwdFrom(ctx, options), serviceName(params), { signal, timeoutMs: timeoutMs(params) });
      return textResult(outcome, formatLifecycleText('workspace_service_stop', outcome));
    },
    ...renderToolPresentation('workspace_service_stop'),
  });

  pi.registerTool({
    name: 'workspace_service_logs',
    label: 'Workspace Service Logs',
    description: 'Read bounded logs (default 100 lines / 51200 bytes; max 2000 lines / 204800 bytes). Host services support older windows with offset/until; Compose services support only a bounded recent window (offset and until are unsupported and rejected). Known env_file=true secrets are redacted; unknown free-text secrets in Compose logs/stderr are not guaranteed redacted.',
    promptSnippet: 'Read bounded redacted logs for one configured host or Compose service.',
    promptGuidelines: [
      'Use workspace_service_logs instead of bash tail for managed service logs.',
      'For Compose services, omit offset and until in workspace_service_logs because Compose only supports a bounded recent window.',
    ],
    parameters: LOGS_PARAMETERS,
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) {
        const failure = trustFailure();
        return textResult(failure, formatTrustFailureText('workspace_service_logs', failure));
      }
      const outcome = await getServiceLogs(cwdFrom(ctx, options), serviceName(params), {
        lines: typeof params.lines === 'number' ? params.lines : undefined,
        offset: typeof params.offset === 'number' ? params.offset : undefined,
        until: typeof params.until === 'number' ? params.until : undefined,
        maxBytes: typeof params.max_bytes === 'number' ? params.max_bytes : undefined,
      });
      return textResult(outcome, formatLogsText(outcome));
    },
    ...renderToolPresentation('workspace_service_logs'),
  });

  pi.registerTool({
    name: 'workspace_services_status',
    label: 'Workspace Services Status',
    description: 'Show observed status for declared local and Docker Compose services. Operation status=partial when Compose discovery or ps fails while preserving confirmed local states.',
    promptSnippet: 'Show observed status for configured local and Compose services.',
    promptGuidelines: ['Use workspace_services_status to inspect current observed states, PIDs, containers, and partial Docker warnings.'],
    parameters: EMPTY_PARAMETERS,
    execute: async (_id, _params, signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) {
        const failure = trustFailure();
        return textResult(failure, formatTrustFailureText('workspace_services_status', failure));
      }
      const result = await getServicesStatus(cwdFrom(ctx, options), signal);
      const { outcome, text } = formatStatusOutcome(result);
      return textResult(outcome, text);
    },
    ...renderToolPresentation('workspace_services_status'),
  });

  pi.registerTool({
    name: 'workspace_service_restart',
    label: 'Workspace Service Restart',
    description: 'Restart one configured workspace service (preparing runtime directories and truncating its managed log) or a Compose target ("all" / "compose"). Redacts known env_file=true values (target service only, or configured env_file=true union for stack targets) from failure diagnostics.',
    promptSnippet: 'Restart one workspace service or Compose target.',
    promptGuidelines: ['Use workspace_service_restart when the user asks to restart a managed service or Compose target.'],
    parameters: STOP_PARAMETERS,
    execute: async (_id, params, signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) {
        const failure = trustFailure();
        return textResult(failure, formatTrustFailureText('workspace_service_restart', failure));
      }
      const outcome = await restartService(cwdFrom(ctx, options), serviceName(params), { signal, timeoutMs: timeoutMs(params) });
      return textResult(outcome, formatLifecycleText('workspace_service_restart', outcome));
    },
    ...renderToolPresentation('workspace_service_restart'),
  });
}
