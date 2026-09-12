import { keyHint, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  getServiceLogs,
  getServicesStatus,
  listServices,
  restartService,
  startService,
  stopService,
} from '../core/manager.js';
import { renderWorkspaceServiceCall, renderWorkspaceServiceResult } from '../render/index.js';
import {
  EMPTY_PARAMETERS,
  LOGS_PARAMETERS,
  SERVICE_PARAMETERS,
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

function renderCall(toolName: string) {
  return (args: any, theme: any, context: any) => renderWorkspaceServiceCall(toolName, args, theme, context);
}

function renderResult(toolName: string) {
  return (result: any, renderOptions: any, theme: any, context: any) =>
    renderWorkspaceServiceResult(toolName, result as any, renderOptions, theme as any, context);
}

async function ensureTrusted(ctx: ExtensionContext | undefined): Promise<boolean> {
  return Boolean(ctx?.isProjectTrusted());
}

function safeExpandHint(): string {
  try { return keyHint('app.tools.expand' as any, 'expand'); } catch { return 'ctrl+o expand'; }
}

function formatStatusText(result: Awaited<ReturnType<typeof getServicesStatus>>): string {
  if (!result.exists) return `workspace_services_status: no config found at ${result.configPath}`;
  if (result.services.length === 0) return `workspace_services_status: config found at ${result.configPath}, but no services are configured.`;
  const lines = [
    `workspace_services_status: ${result.services.length} configured service(s)`,
    `config: ${result.configPath}`,
  ];
  for (const service of result.services) {
    const pid = service.pid ? ` pid=${service.pid}` : '';
    lines.push(`- ${service.name}: ${service.status}${pid} type=${service.type} path=${service.path} command=${service.command} log=${service.log_path}`);
  }
  return lines.join('\n');
}

export function registerWorkspaceServicesTools(pi: ExtensionAPI, options: RegisterWorkspaceServicesToolsOptions = {}): void {
  pi.registerTool({
    name: 'workspace_services_list',
    label: 'Workspace Services List',
    description: 'List manually configured monorepo services from .pi/workspace-services.json. Does not auto-discover services or read .env contents.',
    promptSnippet: 'List manually configured workspace services from .pi/workspace-services.json.',
    promptGuidelines: [
      'Use workspace_services_list before starting services when you need the configured service names.',
      'workspace_services_list never guesses services; it only reads the manual .pi/workspace-services.json configuration.',
    ],
    parameters: EMPTY_PARAMETERS,
    execute: async (_id, _params, _signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) return textResult(trustFailure(), trustFailure().summary);
      const result = await listServices(cwdFrom(ctx, options));
      const text = !result.exists
        ? `workspace_services_list: no manual workspace services config found at ${result.configPath}`
        : result.services.length === 0
          ? `workspace_services_list: config found at ${result.configPath}, but no services are configured.`
          : `workspace_services_list: ${result.services.length} configured service(s)`;
      return textResult({ ok: true, status: 'running', summary: text, data: result as any }, text);
    },
    renderShell: 'self' as const,
    renderCall: renderCall('workspace_services_list'),
    renderResult: renderResult('workspace_services_list'),
  });

  pi.registerTool({
    name: 'workspace_service_start',
    label: 'Workspace Service Start',
    description: 'Start one configured workspace service. Runs only the command declared for that service.',
    promptSnippet: 'Start one manually configured workspace service.',
    promptGuidelines: ['Use workspace_service_start only with configured service names.'],
    parameters: SERVICE_PARAMETERS,
    execute: async (_id, params, signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) return textResult(trustFailure(), trustFailure().summary);
      const outcome = await startService(cwdFrom(ctx, options), serviceName(params), { signal });
      return textResult(outcome, `workspace_service_start: ${outcome.summary}`);
    },
    renderShell: 'self' as const,
    renderCall: renderCall('workspace_service_start'),
    renderResult: renderResult('workspace_service_start'),
  });

  pi.registerTool({
    name: 'workspace_service_stop',
    label: 'Workspace Service Stop',
    description: 'Stop one configured workspace service previously started by workspace_service_start.',
    promptSnippet: 'Stop one configured workspace service started by the extension.',
    promptGuidelines: ['Use workspace_service_stop when the user asks to stop a managed service.'],
    parameters: STOP_PARAMETERS,
    execute: async (_id, params, signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) return textResult(trustFailure(), trustFailure().summary);
      const outcome = await stopService(cwdFrom(ctx, options), serviceName(params), { signal, timeoutMs: timeoutMs(params) });
      return textResult(outcome, `workspace_service_stop: ${outcome.summary}`);
    },
    renderShell: 'self' as const,
    renderCall: renderCall('workspace_service_stop'),
    renderResult: renderResult('workspace_service_stop'),
  });

  pi.registerTool({
    name: 'workspace_service_logs',
    label: 'Workspace Service Logs',
    description: 'Read the latest 100 lines of one configured service log by default, or a bounded older window with offset/until.',
    promptSnippet: 'Read bounded logs for one configured workspace service.',
    promptGuidelines: ['Use workspace_service_logs instead of bash tail for managed service logs.'],
    parameters: LOGS_PARAMETERS,
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) return textResult(trustFailure(), trustFailure().summary);
      const outcome = await getServiceLogs(cwdFrom(ctx, options), serviceName(params), {
        lines: typeof params.lines === 'number' ? params.lines : undefined,
        offset: typeof params.offset === 'number' ? params.offset : undefined,
        until: typeof params.until === 'number' ? params.until : undefined,
        maxBytes: typeof params.max_bytes === 'number' ? params.max_bytes : undefined,
      });
      return textResult(outcome, `workspace_service_logs: ${outcome.summary}`);
    },
    renderShell: 'self' as const,
    renderCall: renderCall('workspace_service_logs'),
    renderResult: renderResult('workspace_service_logs'),
  });

  pi.registerTool({
    name: 'workspace_services_status',
    label: 'Workspace Services Status',
    description: 'Show status for configured workspace services and the PIDs managed by this extension.',
    promptSnippet: 'Show managed process status for configured workspace services.',
    promptGuidelines: ['Use workspace_services_status to see which configured workspace services are currently managed and running.'],
    parameters: EMPTY_PARAMETERS,
    execute: async (_id, _params, signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) return textResult(trustFailure(), trustFailure().summary);
      const result = await getServicesStatus(cwdFrom(ctx, options), signal);
      const text = formatStatusText(result);
      return textResult({ ok: true, status: 'running', summary: text.split('\n')[0] ?? 'workspace_services_status', data: result as any }, text);
    },
    renderShell: 'self' as const,
    renderCall: renderCall('workspace_services_status'),
    renderResult: renderResult('workspace_services_status'),
  });

  pi.registerTool({
    name: 'workspace_service_restart',
    label: 'Workspace Service Restart',
    description: 'Restart one configured workspace service.',
    promptSnippet: 'Restart one configured workspace service and truncate its managed log first.',
    promptGuidelines: ['Use workspace_service_restart when the user asks to restart a managed service.'],
    parameters: STOP_PARAMETERS,
    execute: async (_id, params, signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) return textResult(trustFailure(), trustFailure().summary);
      const outcome = await restartService(cwdFrom(ctx, options), serviceName(params), { signal, timeoutMs: timeoutMs(params) });
      return textResult(outcome, `workspace_service_restart: ${outcome.summary}`);
    },
    renderShell: 'self' as const,
    renderCall: renderCall('workspace_service_restart'),
    renderResult: renderResult('workspace_service_restart'),
  });
}
