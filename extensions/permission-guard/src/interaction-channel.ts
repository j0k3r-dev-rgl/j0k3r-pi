import { randomUUID } from 'node:crypto';
import type { ApprovalChoice, PermissionRequiredPayload } from './types.js';

export interface InteractionRequest {
  type: 'interaction_required';
  requestId: string;
  kind: string;
  origin: 'subagent';
  requester?: PermissionRequiredPayload['requester'];
  prompt: PermissionRequiredPayload['prompt'];
  payload: Record<string, unknown>;
  response: { expected: 'choice' };
}

export interface PublishedInteractionRequest {
  handle: string;
  payload: InteractionRequest;
  createdAt: string;
  consumed?: boolean;
}

export interface InteractionResponse {
  requestId?: string;
  choice?: ApprovalChoice;
  value?: ApprovalChoice;
  response?: ApprovalChoice | { choice?: ApprovalChoice; value?: ApprovalChoice };
}

const INTERACTION_CHANNEL_KEY = Symbol.for('pi.subagents.interactionChannel');
const INTERACTION_RESPONSES_KEY = Symbol.for('pi.subagents.interactionResponses');

function isApprovalChoice(value: unknown): value is ApprovalChoice {
  return value === 'Allow once'
    || value === 'Allow for session'
    || value === 'Allow for project'
    || value === 'Allow this file for project'
    || value === 'Allow this folder for project'
    || value === 'Deny';
}

function interactionChannelRegistry(): Map<string, PublishedInteractionRequest> {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[INTERACTION_CHANNEL_KEY];
  if (existing instanceof Map) return existing as Map<string, PublishedInteractionRequest>;
  const registry = new Map<string, PublishedInteractionRequest>();
  holder[INTERACTION_CHANNEL_KEY] = registry;
  return registry;
}

function interactionResponsesRegistry(): Map<string, unknown> | undefined {
  const existing = (globalThis as Record<symbol, unknown>)[INTERACTION_RESPONSES_KEY];
  return existing instanceof Map ? existing : undefined;
}

function redactedScope(payload: PermissionRequiredPayload): Pick<PermissionRequiredPayload, 'sessionScope' | 'projectScope'> {
  const safeCommand = payload.prompt.safeCommandSummary;
  const sessionScope = payload.sessionScope
    ? {
        ...payload.sessionScope,
        commandPattern: payload.sessionScope.commandPattern ? safeCommand ?? '[redacted command]' : undefined,
        bashApproval: payload.sessionScope.bashApproval
          ? { ...payload.sessionScope.bashApproval, normalizedCommand: safeCommand ?? '[redacted command]' }
          : undefined,
      }
    : undefined;
  const projectScope = payload.projectScope
    ? {
        ...payload.projectScope,
        safeCommandPattern: payload.projectScope.safeCommandPattern ? safeCommand ?? '[redacted command]' : undefined,
        bashApproval: payload.projectScope.bashApproval
          ? { ...payload.projectScope.bashApproval, normalizedCommand: safeCommand ?? '[redacted command]' }
          : undefined,
      }
    : undefined;
  return { sessionScope, projectScope };
}

export function buildInteractionRequest(payload: PermissionRequiredPayload): InteractionRequest {
  const scope = redactedScope(payload);
  return {
    type: 'interaction_required',
    requestId: payload.requestId,
    kind: `permission:${payload.tool}:${payload.action}`,
    origin: 'subagent',
    requester: payload.requester,
    prompt: payload.prompt,
    payload: {
      permission: {
        tool: payload.tool,
        action: payload.action,
        reason: payload.reason,
        reasonCode: payload.reasonCode,
        riskLevel: payload.riskLevel,
        sessionScope: scope.sessionScope,
        projectScope: scope.projectScope,
      },
    },
    response: { expected: 'choice' },
  };
}

export function publishInteractionRequest(payload: InteractionRequest): PublishedInteractionRequest {
  const published: PublishedInteractionRequest = {
    handle: `interaction_${randomUUID().replace(/-/g, '')}`,
    payload,
    createdAt: new Date().toISOString(),
  };
  interactionChannelRegistry().set(published.handle, published);
  return published;
}

export function resolveInteractionRequest(handle: string): InteractionRequest | undefined {
  return interactionChannelRegistry().get(handle)?.payload;
}

function choiceFromResponse(value: unknown): ApprovalChoice | undefined {
  if (isApprovalChoice(value)) return value;
  if (!value || typeof value !== 'object') return undefined;
  const response = value as InteractionResponse;
  if (isApprovalChoice(response.choice)) return response.choice;
  if (isApprovalChoice(response.value)) return response.value;
  if (isApprovalChoice(response.response)) return response.response;
  if (response.response && typeof response.response === 'object') {
    if (isApprovalChoice(response.response.choice)) return response.response.choice;
    if (isApprovalChoice(response.response.value)) return response.response.value;
  }
  return undefined;
}

export function consumeInteractionResponse(requestId: string): ApprovalChoice | undefined {
  const registry = interactionResponsesRegistry();
  if (!registry) return undefined;
  const value = registry.get(requestId);
  const choice = choiceFromResponse(value);
  if (choice) registry.delete(requestId);
  return choice;
}
