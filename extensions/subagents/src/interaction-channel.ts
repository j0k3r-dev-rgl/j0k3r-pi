import { randomUUID } from 'node:crypto';

export type InteractionStatus = 'answered' | 'cancelled' | 'failed';

export type InteractionRequester = {
  subagentId?: string;
  subagentName?: string;
  taskId?: string;
  description?: string;
  [key: string]: unknown;
};

export type InteractionPrompt = {
  title?: string;
  message?: string;
  choices?: string[];
  defaultValue?: string;
  placeholder?: string;
  safeTarget?: string;
  safeCommandSummary?: string;
  workspaceRoot?: string;
  limitations?: string[];
  [key: string]: unknown;
};

export type InteractionResponseExpectation = {
  expected?: 'boolean' | 'choice' | 'string' | 'json' | 'unknown';
  required?: boolean;
  instructions?: string;
  [key: string]: unknown;
};

export type SubagentInteractionRequest = {
  type: 'interaction_required';
  requestId: string;
  kind: string;
  origin?: string;
  requester?: InteractionRequester;
  reason?: string;
  reasonCode?: string;
  riskLevel?: string;
  prompt?: InteractionPrompt;
  payload?: unknown;
  response?: InteractionResponseExpectation;
  [key: string]: unknown;
};

export type SubagentInteractionResponse = {
  type: 'interaction_response';
  requestId: string;
  status: InteractionStatus;
  value?: unknown;
  error?: string;
  responder?: 'parent' | string;
  answeredAt?: string;
  [key: string]: unknown;
};

export interface PublishedInteractionRequest {
  handle: string;
  payload: SubagentInteractionRequest;
  createdAt: string;
  consumed?: boolean;
}

const INTERACTION_CHANNEL_KEY = Symbol.for('pi.subagents.interactionChannel');
const INTERACTION_RESPONSE_CHANNEL_KEY = Symbol.for('pi.subagents.interactionResponses');

function requestRegistry(): Map<string, PublishedInteractionRequest> {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[INTERACTION_CHANNEL_KEY];
  if (existing instanceof Map) return existing as Map<string, PublishedInteractionRequest>;
  const registry = new Map<string, PublishedInteractionRequest>();
  holder[INTERACTION_CHANNEL_KEY] = registry;
  return registry;
}

function responseRegistry(): Map<string, SubagentInteractionResponse> {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[INTERACTION_RESPONSE_CHANNEL_KEY];
  if (existing instanceof Map) return existing as Map<string, SubagentInteractionResponse>;
  const registry = new Map<string, SubagentInteractionResponse>();
  holder[INTERACTION_RESPONSE_CHANNEL_KEY] = registry;
  return registry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestIdFrom(value: Record<string, unknown>): string | undefined {
  const requestId = value.requestId ?? value.request_id;
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : undefined;
}

function promptFrom(value: Record<string, unknown>): InteractionPrompt | undefined {
  return isRecord(value.prompt) ? value.prompt as InteractionPrompt : undefined;
}

function findInteractionRequest(value: unknown, seen: Set<unknown>): SubagentInteractionRequest | undefined {
  if (!isRecord(value) || seen.has(value)) return undefined;
  seen.add(value);

  const directRequestId = requestIdFrom(value);
  if (value.type === 'interaction_required' && directRequestId) {
    return {
      ...value,
      type: 'interaction_required',
      requestId: directRequestId,
      kind: typeof value.kind === 'string' && value.kind.length > 0 ? value.kind : 'custom',
      prompt: promptFrom(value),
      requester: isRecord(value.requester) ? value.requester as InteractionRequester : undefined,
    } as SubagentInteractionRequest;
  }

  const handle = value.handle;
  if (typeof handle === 'string') {
    const resolved = resolveInteractionRequest(handle);
    if (resolved) return resolved;
  }

  for (const child of Object.values(value)) {
    const found = findInteractionRequest(child, seen);
    if (found) return found;
  }

  return undefined;
}

export function interactionRequestFromCandidate(value: unknown): SubagentInteractionRequest | undefined {
  return findInteractionRequest(value, new Set());
}

export function publishInteractionRequest(payload: SubagentInteractionRequest): PublishedInteractionRequest {
  const published: PublishedInteractionRequest = {
    handle: `interaction_${randomUUID().replace(/-/g, '')}`,
    payload,
    createdAt: new Date().toISOString(),
  };
  requestRegistry().set(published.handle, published);
  return published;
}

export function resolveInteractionRequest(handle: string): SubagentInteractionRequest | undefined {
  return requestRegistry().get(handle)?.payload;
}

export function consumeInteractionRequest(handle: string): SubagentInteractionRequest | undefined {
  const registry = requestRegistry();
  const published = registry.get(handle);
  if (!published) return undefined;
  registry.delete(handle);
  return published.payload;
}

export function consumeLatestInteractionRequest(options: { maxAgeMs?: number; origin?: string } = {}): SubagentInteractionRequest | undefined {
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  const now = Date.now();
  const candidates = [...requestRegistry().entries()]
    .map(([handle, published]) => ({ handle, published, timestamp: Date.parse(published.createdAt) }))
    .filter(({ published, timestamp }) => Number.isFinite(timestamp)
      && now - timestamp <= maxAgeMs
      && (!options.origin || published.payload.origin === options.origin))
    .sort((a, b) => b.timestamp - a.timestamp);
  const latest = candidates[0];
  if (!latest) return undefined;
  requestRegistry().delete(latest.handle);
  return latest.published.payload;
}

export function publishInteractionResponse(response: SubagentInteractionResponse): SubagentInteractionResponse {
  const normalized: SubagentInteractionResponse = {
    responder: 'parent',
    answeredAt: new Date().toISOString(),
    ...response,
    type: 'interaction_response',
  };
  responseRegistry().set(normalized.requestId, normalized);
  return normalized;
}

export function resolveInteractionResponse(requestId: string): SubagentInteractionResponse | undefined {
  return responseRegistry().get(requestId);
}

export function consumeInteractionResponse(requestId: string): SubagentInteractionResponse | undefined {
  const registry = responseRegistry();
  const response = registry.get(requestId);
  if (!response) return undefined;
  registry.delete(requestId);
  return response;
}

export function sanitizeInteractionTransportText(text: string): string {
  if (!text) return text;
  return text.replace(/interaction_required:[^\r\n]*/g, '[interaction request hidden]');
}
