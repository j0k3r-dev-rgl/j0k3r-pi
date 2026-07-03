import {
  getServiceLogs,
  getServicesStatus,
  listServices,
  restartService,
  startService,
  stopService,
} from './manager.js';

export const WORKSPACE_SERVICE_TOOL_NAMES = [
  'workspace_services_list',
  'workspace_service_start',
  'workspace_service_stop',
  'workspace_service_logs',
  'workspace_services_status',
  'workspace_service_restart',
] as const;

export interface RegisterWorkspaceServicesToolsOptions {
  cwd?: string;
}

const EMPTY_PARAMETERS = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

const SERVICE_PARAMETERS = {
  type: 'object',
  properties: {
    service: { type: 'string', description: 'Configured service name from .pi/workspace-services.json.' },
  },
  required: ['service'],
  additionalProperties: false,
} as const;

const STOP_PARAMETERS = {
  type: 'object',
  properties: {
    service: { type: 'string', description: 'Configured service name from .pi/workspace-services.json.' },
    timeout_ms: { type: 'number', description: 'Milliseconds to wait after SIGTERM before SIGKILL. Default 5000.' },
  },
  required: ['service'],
  additionalProperties: false,
} as const;

const LOGS_PARAMETERS = {
  type: 'object',
  properties: {
    service: { type: 'string', description: 'Configured service name from .pi/workspace-services.json.' },
    lines: { type: 'number', description: 'Maximum log lines to return. Default 200, max 2000.' },
    max_bytes: { type: 'number', description: 'Maximum log bytes to inspect. Default 51200, max 204800.' },
  },
  required: ['service'],
  additionalProperties: false,
} as const;

function cwdFrom(ctx: any, options: RegisterWorkspaceServicesToolsOptions): string {
  return options.cwd ?? ctx?.cwd ?? process.cwd();
}

function serviceName(params: Record<string, unknown>): string {
  if (typeof params.service !== 'string' || params.service.trim().length === 0) {
    throw new Error('A configured service name is required.');
  }
  return params.service.trim();
}

function timeoutMs(params: Record<string, unknown>): number | undefined {
  return typeof params.timeout_ms === 'number' ? params.timeout_ms : undefined;
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

function listText(result: Awaited<ReturnType<typeof listServices>>): string {
  if (!result.exists) {
    return [
      'workspace_services_list: no manual workspace services config found.',
      `expected_config: ${result.configPath}`,
      'create .pi/workspace-services.json with an explicit services object.',
    ].join('\n');
  }

  if (result.services.length === 0) {
    return `workspace_services_list: config found at ${result.configPath}, but no services are configured.`;
  }

  const lines = result.services.map((service) => {
    const env = service.env_file ? (service.env_file_present ? 'env_file=true,present' : 'env_file=true,missing') : 'env_file=false';
    return `- ${service.name} (${service.type}) path=${service.path} command=${service.command} ${env} log=${service.log_path}`;
  });
  return [`workspace_services_list: ${result.services.length} configured service(s)`, ...lines].join('\n');
}

function statusText(result: Awaited<ReturnType<typeof getServicesStatus>>): string {
  const lines = result.services.map((service) => {
    const pid = service.pid ? ` pid=${service.pid}` : '';
    const started = service.started_at ? ` started_at=${service.started_at}` : '';
    return `- ${service.name}: ${service.status}${pid}${started} log=${service.log_path}`;
  });
  return [`workspace_services_status: ${result.services.length} configured service(s)`, ...lines].join('\n');
}

export function registerWorkspaceServicesTools(pi: any, options: RegisterWorkspaceServicesToolsOptions = {}): void {
  if (!pi || typeof pi.registerTool !== 'function') return;

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
    execute: async (_id: string, _params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) => {
      const result = await listServices(cwdFrom(ctx, options));
      return textResult(listText(result), result as unknown as Record<string, unknown>);
    },
  });

  pi.registerTool({
    name: 'workspace_service_start',
    label: 'Workspace Service Start',
    description: 'Start one configured workspace service. Runs only the command declared for that service. Logs go to .pi/workspace-services/logs/<service>.log. Loads service .env only when env_file=true.',
    promptSnippet: 'Start one manually configured workspace service and write logs under .pi/workspace-services/logs/.',
    promptGuidelines: [
      'Use workspace_service_start only with service names from workspace_services_list or .pi/workspace-services.json.',
      'workspace_service_start must not be used as an arbitrary command runner; it runs only configured service commands.',
    ],
    parameters: SERVICE_PARAMETERS,
    execute: async (_id: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) => {
      const result = await startService(cwdFrom(ctx, options), serviceName(params));
      const verb = result.status === 'already_running' ? 'already running' : 'started';
      return textResult(`workspace_service_start: ${result.service} ${verb} pid=${result.pid} log=${result.logPath}`, result as unknown as Record<string, unknown>);
    },
  });

  pi.registerTool({
    name: 'workspace_service_stop',
    label: 'Workspace Service Stop',
    description: 'Stop one configured workspace service previously started by workspace_service_start.',
    promptSnippet: 'Stop one configured workspace service started by the extension.',
    promptGuidelines: ['Use workspace_service_stop before changing service configuration or when the user asks to stop a managed service.'],
    parameters: STOP_PARAMETERS,
    execute: async (_id: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) => {
      const result = await stopService(cwdFrom(ctx, options), serviceName(params), { timeoutMs: timeoutMs(params) });
      return textResult(`workspace_service_stop: ${result.service} ${result.status}${result.pid ? ` pid=${result.pid}` : ''}`, result as unknown as Record<string, unknown>);
    },
  });

  pi.registerTool({
    name: 'workspace_service_logs',
    label: 'Workspace Service Logs',
    description: 'Read a bounded tail of one configured service log from .pi/workspace-services/logs/<service>.log. Output is bounded by lines and max_bytes.',
    promptSnippet: 'Read bounded logs for one configured workspace service.',
    promptGuidelines: ['Use workspace_service_logs instead of bash tail for logs created by workspace_service_start or workspace_service_restart.'],
    parameters: LOGS_PARAMETERS,
    execute: async (_id: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) => {
      const result = await getServiceLogs(cwdFrom(ctx, options), serviceName(params), {
        lines: typeof params.lines === 'number' ? params.lines : undefined,
        maxBytes: typeof params.max_bytes === 'number' ? params.max_bytes : undefined,
      });
      return textResult(`workspace_service_logs: ${result.service} ${result.logPath}\n${result.text}`, result as unknown as Record<string, unknown>);
    },
  });

  pi.registerTool({
    name: 'workspace_services_status',
    label: 'Workspace Services Status',
    description: 'Show status for configured workspace services and the PIDs managed by this extension.',
    promptSnippet: 'Show managed process status for configured workspace services.',
    promptGuidelines: ['Use workspace_services_status to see which configured workspace services are currently managed and running.'],
    parameters: EMPTY_PARAMETERS,
    execute: async (_id: string, _params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) => {
      const result = await getServicesStatus(cwdFrom(ctx, options));
      return textResult(statusText(result), result as unknown as Record<string, unknown>);
    },
  });

  pi.registerTool({
    name: 'workspace_service_restart',
    label: 'Workspace Service Restart',
    description: 'Restart one configured workspace service. Stops the previous managed process, truncates .pi/workspace-services/logs/<service>.log, then starts it again.',
    promptSnippet: 'Restart one configured workspace service and truncate its managed log first.',
    promptGuidelines: ['Use workspace_service_restart when the user asks to restart a managed service; it truncates that service log before starting.'],
    parameters: STOP_PARAMETERS,
    execute: async (_id: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) => {
      const result = await restartService(cwdFrom(ctx, options), serviceName(params), { timeoutMs: timeoutMs(params) });
      return textResult(`workspace_service_restart: ${result.service} restarted pid=${result.pid} log=${result.logPath}`, result as unknown as Record<string, unknown>);
    },
  });
}
