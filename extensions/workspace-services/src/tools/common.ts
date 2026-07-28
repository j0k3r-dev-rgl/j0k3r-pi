import { Type } from 'typebox';
import type { WorkspaceServiceOutcome } from '../types.js';

export const EMPTY_PARAMETERS = Type.Object({}, { additionalProperties: false });
export const SERVICE_PARAMETERS = Type.Object({
  service: Type.String({ description: 'Configured service name from .pi/workspace-services.json.' }),
}, { additionalProperties: false });
export const STOP_PARAMETERS = Type.Object({
  service: Type.String({ description: 'Configured service name from .pi/workspace-services.json.' }),
  timeout_ms: Type.Optional(Type.Number({ description: 'Milliseconds to wait after SIGTERM before SIGKILL. Default 5000.' })),
}, { additionalProperties: false });
export const LOGS_PARAMETERS = Type.Object({
  service: Type.String({ description: 'Configured service name from .pi/workspace-services.json.' }),
  lines: Type.Optional(Type.Number({ description: 'Maximum log lines to return. Default 200, max 2000.' })),
  max_bytes: Type.Optional(Type.Number({ description: 'Maximum log bytes to inspect. Default 51200, max 204800.' })),
}, { additionalProperties: false });

export function serviceName(params: Record<string, unknown>): string {
  if (typeof params.service !== 'string' || params.service.trim().length === 0) throw new Error('A configured service name is required.');
  return params.service.trim();
}

export function timeoutMs(params: Record<string, unknown>): number | undefined {
  return typeof params.timeout_ms === 'number' ? params.timeout_ms : undefined;
}

export function textResult(outcome: WorkspaceServiceOutcome, text: string) {
  return { content: [{ type: 'text' as const, text }], details: outcome };
}

export function trustFailure(): WorkspaceServiceOutcome {
  return {
    ok: false,
    status: 'trust_required',
    summary: 'Project trust is required before Workspace Services can read project configuration, state, logs, or manage processes.',
    nextAction: 'Trust the project and retry the requested Workspace Services tool.',
    data: {},
  };
}
