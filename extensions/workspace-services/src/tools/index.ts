import { keyHint, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import {
  getServiceLogs,
  getServicesStatus,
  listServices,
  restartService,
  startService,
  stopService,
} from '../core/manager.js';
import { renderWorkspaceServiceResult } from '../render/index.js';
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
  return (args: any, theme: any, context: any) => {
    const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0);
    const service = typeof args.service === 'string' ? ` ${args.service}` : '';
    text.setText(`${theme.fg('toolTitle', theme.bold(toolName))}${theme.fg('toolOutput', service)}`);
    return text;
  };
}

async function ensureTrusted(ctx: ExtensionContext | undefined): Promise<boolean> {
  return Boolean(ctx?.isProjectTrusted());
}

function safeExpandHint(): string {
  try { return keyHint('app.tools.expand' as any, 'expand'); } catch { return 'ctrl+o expand'; }
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
    renderCall: renderCall('workspace_services_list'),
    renderResult: (result, renderOptions, theme) => renderWorkspaceServiceResult(result as any, renderOptions, theme as any),
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
    renderCall: renderCall('workspace_service_start'),
    renderResult: (result, renderOptions, theme) => renderWorkspaceServiceResult(result as any, renderOptions, theme as any),
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
    renderCall: renderCall('workspace_service_stop'),
    renderResult: (result, renderOptions, theme) => renderWorkspaceServiceResult(result as any, renderOptions, theme as any),
  });

  pi.registerTool({
    name: 'workspace_service_logs',
    label: 'Workspace Service Logs',
    description: 'Read a bounded tail of one configured service log from .pi/workspace-services/logs/<service>.log.',
    promptSnippet: 'Read bounded logs for one configured workspace service.',
    promptGuidelines: ['Use workspace_service_logs instead of bash tail for managed service logs.'],
    parameters: LOGS_PARAMETERS,
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      if (!(await ensureTrusted(ctx))) return textResult(trustFailure(), trustFailure().summary);
      const outcome = await getServiceLogs(cwdFrom(ctx, options), serviceName(params), {
        lines: typeof params.lines === 'number' ? params.lines : undefined,
        maxBytes: typeof params.max_bytes === 'number' ? params.max_bytes : undefined,
      });
      return textResult(outcome, `workspace_service_logs: ${outcome.summary}`);
    },
    renderCall: renderCall('workspace_service_logs'),
    renderResult: (result, renderOptions, theme) => renderWorkspaceServiceResult(result as any, renderOptions, theme as any),
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
      return textResult({ ok: true, status: 'running', summary: `workspace_services_status: ${result.services.length} configured service(s)`, data: result as any }, `workspace_services_status: ${result.services.length} configured service(s)`);
    },
    renderCall: renderCall('workspace_services_status'),
    renderResult: (result, renderOptions, theme, context) => {
      const details = (result as any).details;
      if (details?.data?.services && !renderOptions.expanded) {
        const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0);
        text.setText(`${theme.fg('toolTitle', theme.bold('workspace_services_status'))}\n${theme.fg('toolOutput', `${details.data.services.length} service(s) · ${safeExpandHint()}`)}`);
        return text;
      }
      return renderWorkspaceServiceResult(result as any, renderOptions, theme as any);
    },
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
    renderCall: renderCall('workspace_service_restart'),
    renderResult: (result, renderOptions, theme) => renderWorkspaceServiceResult(result as any, renderOptions, theme as any),
  });
}
