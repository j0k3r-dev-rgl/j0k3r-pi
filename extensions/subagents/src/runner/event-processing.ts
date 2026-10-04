import { writeSubagentsDebugLog } from '../debug.js';
import { consumeLatestInteractionRequest, interactionRequestFromCandidate, sanitizeInteractionTransportText } from '../interaction-channel.js';
import { registerSubagentRuntimeToolDefinition, resolveSubagentExternalToolDefinitionFromInfo } from '../thread-view.js';
import { SubagentStructuredError, classifyAssistantFailure, classifyThrownError, normalizeErrorMetadata } from '../error-metadata.js';
import type { SubagentInteractionRequest } from '../interaction-channel.js';
import type { ThinkingEffort, SubagentErrorMetadata, SubagentLiveActivity, SubagentLiveActivityProjection, SubagentThreadSnapshot, UsageStats } from '../types.js';
import { ThreadSnapshotBuilder } from './snapshot-builder.js';

function emptyUsage(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function addUsage(total: UsageStats, usage: any): UsageStats {
  return {
    input: total.input + (usage?.input ?? 0),
    output: total.output + (usage?.output ?? 0),
    cacheRead: total.cacheRead + (usage?.cacheRead ?? 0),
    cacheWrite: total.cacheWrite + (usage?.cacheWrite ?? 0),
    cost: total.cost + (usage?.cost?.total ?? usage?.cost ?? 0),
    contextTokens: usage?.totalTokens ?? total.contextTokens,
    turns: total.turns + 1,
  };
}

function summarizeInteractionCarrier(value: unknown): unknown {
  if (!value || typeof value !== 'object') return { type: typeof value };
  const record = value as Record<string, unknown>;
  return {
    keys: Object.keys(record),
    hasInteractionRequest: Object.hasOwn(record, 'interactionRequest'),
    hasInteractionRequestSnake: Object.hasOwn(record, 'interaction_request'),
    details: record.details && typeof record.details === 'object' ? summarizeInteractionCarrier(record.details) : undefined,
  };
}

function shortJson(value: unknown, limit = 900): string {
  try {
    const text = JSON.stringify(value, (_key, val) => typeof val === 'string' && val.length > 300 ? `${val.slice(0, 300)}…` : val);
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch {
    return '[unserializable]';
  }
}

function debugLog(cwd: string | undefined, scope: string, data: unknown): void {
  writeSubagentsDebugLog(cwd, scope, data);
}

function formatToolCall(name: string, args: any): string {
  const input = args ?? {};
  if (name === 'read') {
    const file = input.path ?? input.file_path ?? input.file ?? '';
    const offset = input.offset ?? 1;
    const limit = input.limit;
    const range = limit ? `:${offset}-${offset + limit - 1}` : offset && offset !== 1 ? `:${offset}` : '';
    return `read ${file}${range}`.trim();
  }
  if (name === 'bash') return `bash ${String(input.command ?? '').split('\n')[0] ?? ''}`.trim();
  if (name === 'edit') return `edit ${input.path ?? input.file_path ?? ''}`.trim();
  if (name === 'write') return `write ${input.path ?? input.file_path ?? ''}`.trim();
  if (name.startsWith('memory_')) return name;
  return `${name} ${shortJson(input)}`.trim();
}

function eventTranscript(event: any): string {
  const messageEvent = event?.assistantMessageEvent;
  const delta = messageEvent?.type === 'text_delta' && typeof messageEvent.delta === 'string'
    ? messageEvent.delta
    : undefined;
  if (event?.type === 'message_update' && typeof delta === 'string') return sanitizeInteractionTransportText(delta);

  if (event?.type === 'tool_execution_start') {
    const name = event.toolName ?? 'tool';
    return `\n\n${formatToolCall(name, event.args ?? event.input ?? {})}\n`;
  }
  if (event?.type === 'tool_execution_update') return event.partialResult ? `\n${sanitizeInteractionTransportText(shortJson(event.partialResult, 500))}\n` : '';
  if (event?.type === 'tool_execution_end') return `\n${event.isError ? 'failed' : 'done'}\n`;
  if (event?.type === 'message_start' && event.message?.role === 'assistant') return '\n\nPreparing for response\n\n';
  if (event?.type === 'auto_retry_start') return '\n\nauto retry start\n';
  if (event?.type === 'auto_retry_end') return '\n\nauto retry end\n';
  if (event?.type === 'agent_settled') return '\n\nagent settled\n';
  return '';
}

function activityMessage(event: any, transcriptChunk: string): string | undefined {
  if (!transcriptChunk.trim()) return undefined;
  if (event?.type === 'message_start' && event.message?.role === 'assistant') return 'preparing response';
  if (event?.type === 'tool_execution_start') return formatToolCall(event.toolName ?? 'tool', event.args ?? event.input ?? {});
  if (event?.type === 'tool_execution_end') return event.isError ? 'tool failed' : 'tool completed';
  if (event?.type === 'tool_execution_update') return 'tool update';
  if (event?.type === 'auto_retry_start') return 'auto retry start';
  if (event?.type === 'auto_retry_end') return 'auto retry end';
  if (event?.type === 'agent_settled') return 'agent settled';
  return undefined;
}

function extractStructuredInteractionRequest(value: unknown): SubagentInteractionRequest | undefined {
  return interactionRequestFromCandidate(value);
}

function lastAssistantFailure(messages: any[]): { stopReason?: string; errorMessage?: string } | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    if (message?.stopReason === 'error' || message?.stopReason === 'aborted' || typeof message?.errorMessage === 'string') {
      return { stopReason: message.stopReason, errorMessage: message.errorMessage };
    }
  }
  return undefined;
}

function eventToolCallId(event: any): string | undefined {
  return event?.toolCallId ?? event?.tool_call_id ?? event?.toolUseId ?? event?.id;
}

function toolDefinitionFromSession(session: any, name: string | undefined): unknown {
  if (!name) return undefined;
  const direct = session.getToolDefinition?.(name);
  if (direct) return direct;
  try {
    const allTools = session.getAllTools?.();
    if (Array.isArray(allTools)) {
      const info = allTools.find((tool) => tool?.name === name);
      return info ? (resolveSubagentExternalToolDefinitionFromInfo(name, info) ?? info) : undefined;
    }
  } catch {}
  return undefined;
}

function activityLabel(kind: SubagentLiveActivity['kind'], toolNames: string[] = []): string {
  if (kind === 'thinking') return 'thinking';
  if (kind === 'streaming_response') return 'streaming response';
  const suffix = toolNames.join(', ');
  if (kind === 'tool_running') return `running tool: ${suffix}`;
  if (kind === 'tool_completed') return `tool completed: ${suffix}`;
  return `tool failed: ${suffix}`;
}

class LiveActivityReducer {
  private trail: SubagentLiveActivity[] = [];
  private activeTools = new Map<string, string>();
  private current?: SubagentLiveActivity;

  project(): SubagentLiveActivityProjection | undefined {
    if (!this.trail.length && !this.current) return undefined;
    return { trail: this.trail.slice(-3), current: this.current };
  }

  thinking(): SubagentLiveActivityProjection | undefined {
    return this.push({ kind: 'thinking', label: activityLabel('thinking') });
  }

  streaming(): SubagentLiveActivityProjection | undefined {
    return this.push({ kind: 'streaming_response', label: activityLabel('streaming_response') });
  }

  toolStart(id: string | undefined, name: string): SubagentLiveActivityProjection | undefined {
    if (id) this.activeTools.set(id, name);
    return this.emitRunningTools();
  }

  toolUpdate(id: string | undefined): SubagentLiveActivityProjection | undefined {
    if (id && !this.activeTools.has(id)) return undefined;
    return this.emitRunningTools();
  }

  toolEnd(id: string | undefined, name: string, failed: boolean): SubagentLiveActivityProjection | undefined {
    if (id) this.activeTools.delete(id);
    this.push({ kind: failed ? 'tool_failed' : 'tool_completed', label: activityLabel(failed ? 'tool_failed' : 'tool_completed', [name]), tool_names: [name] });
    return this.activeTools.size ? this.emitRunningTools() : this.project();
  }

  private emitRunningTools(): SubagentLiveActivityProjection | undefined {
    const toolNames = [...this.activeTools.values()];
    return this.push({ kind: 'tool_running', label: activityLabel('tool_running', toolNames), tool_names: toolNames });
  }

  private push(next: SubagentLiveActivity): SubagentLiveActivityProjection | undefined {
    const last = this.trail.at(-1);
    if (!last || last.label !== next.label || last.kind !== next.kind) {
      this.trail.push(next);
      if (this.trail.length > 3) this.trail = this.trail.slice(-3);
    }
    this.current = next;
    return this.project();
  }
}

function failingToolNames(snapshot?: SubagentThreadSnapshot): string[] {
  if (!snapshot?.items?.length) return [];
  const names = new Set<string>();
  for (const item of snapshot.items) {
    if (item.type === 'tool' && item.status === 'failed' && item.name) names.add(item.name);
    if (item.type === 'tool_result' && item.result?.isError && item.name) names.add(item.name);
    if (item.type === 'bash' && item.status === 'failed') names.add('bash');
  }
  return [...names].slice(0, 3);
}

function collectFinalizedAssistantText(messages: any[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    if (message?.stopReason === 'error' || message?.stopReason === 'aborted' || typeof message?.errorMessage === 'string') return '';
    const content = message?.content;
    const parts: string[] = [];
    if (typeof content === 'string') parts.push(content);
    if (Array.isArray(content)) {
      for (const part of content) if (part?.type === 'text' && typeof part.text === 'string') parts.push(part.text);
    }
    return parts.join('\n').trim();
  }
  return '';
}

export async function promptWithInactivity(
  session: any,
  prompt: string,
  stallTimeoutMs: number,
  signal: AbortSignal,
  onActivity?: (activity: { message: string; output?: string; prompt?: string; system_prompt?: string; transcript?: string; usage?: UsageStats; effort?: ThinkingEffort; thread_snapshot?: SubagentThreadSnapshot; interaction_request?: SubagentInteractionRequest; nested_session_path?: string; pi_retry_attempts?: number; live_activity?: SubagentLiveActivityProjection }) => void,
  delegatedContext?: string,
  cwd?: string,
  systemPrompt?: string,
  taskId?: string,
  promptLabel: 'delegated_task' | 'continuation' = 'delegated_task',
  displayPrompt = prompt,
  attempt = 1,
  onQueuedMessageStart?: () => void,
  previousSnapshot?: SubagentThreadSnapshot,
): Promise<{ result: string; usage: UsageStats; thread_snapshot?: SubagentThreadSnapshot; interaction_request?: SubagentInteractionRequest }> {
  let output = '';
  const snapshotBuilder = new ThreadSnapshotBuilder(displayPrompt, delegatedContext, cwd, previousSnapshot, promptLabel, attempt);
  const liveActivity = new LiveActivityReducer();
  let latestInteractionRequest: SubagentInteractionRequest | undefined;
  let usage = emptyUsage();
  let transcript = `${systemPrompt ? `# system prompt\n\n${systemPrompt}\n\n` : ''}# ${promptLabel === 'continuation' ? 'continuation prompt' : 'delegated prompt'}\n\n${prompt}\n\n# subagent execution\n`;
  let lastActivity = Date.now();
  let stalled = false;
  const initialMessagesLength = promptLabel === 'continuation' && Array.isArray(session.messages) ? session.messages.length : 0;
  let sawToolActivity = false;
  let piRetryAttempts = 0;
  let sawInitialUserMessage = false;
  const activeToolCalls = new Map<string, { startTime: number; lastUpdate: number }>();
  onActivity?.({ message: 'session started', prompt, system_prompt: systemPrompt, transcript, usage, thread_snapshot: snapshotBuilder.snapshot(), pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.project() });
  const unsubscribe = session.subscribe?.((event: any) => {
    lastActivity = Date.now();
    debugLog(cwd, 'runner_event', {
      type: event?.type,
      messageRole: event?.message?.role,
      assistantEventType: event?.assistantMessageEvent?.type,
      hasDelta: typeof event?.assistantMessageEvent?.delta === 'string',
      toolName: event?.toolName,
      toolCallId: event?.toolCallId,
      isError: event?.isError,
      resultKeys: event?.result && typeof event.result === 'object' ? Object.keys(event.result) : undefined,
      interactionCarrier: event?.type === 'tool_execution_end' ? summarizeInteractionCarrier(event?.result) : undefined,
    });
    if (event?.type === 'auto_retry_start') piRetryAttempts += 1;
    if (event?.type === 'message_start' && event?.message?.role === 'user') {
      if (sawInitialUserMessage) onQueuedMessageStart?.();
      sawInitialUserMessage = true;
    }
    if (typeof event?.type === 'string' && event.type.startsWith('tool_execution_')) {
      sawToolActivity = true;
      registerSubagentRuntimeToolDefinition(taskId, event?.toolName, toolDefinitionFromSession(session, event?.toolName));
      const toolCallId = eventToolCallId(event);
      if (event.type === 'tool_execution_start' && toolCallId) activeToolCalls.set(toolCallId, { startTime: Date.now(), lastUpdate: Date.now() });
      if (event.type === 'tool_execution_update' && toolCallId) {
        const toolCall = activeToolCalls.get(toolCallId);
        if (toolCall) toolCall.lastUpdate = Date.now();
      }
      if (event.type === 'tool_execution_end' && toolCallId) activeToolCalls.delete(toolCallId);
    }
    const snapshotUpdate = snapshotBuilder.update(event);
    const thread_snapshot = snapshotBuilder.snapshot();
    const transcriptChunk = eventTranscript(event);
    transcript += transcriptChunk;
    const interactionRequest = extractStructuredInteractionRequest(event?.result ?? event?.partialResult ?? event);
    if (interactionRequest) {
      latestInteractionRequest = interactionRequest;
      debugLog(cwd, 'interaction_bridge_payload_detected', {
        requestId: interactionRequest.requestId,
        kind: interactionRequest.kind,
        origin: interactionRequest.origin,
        requester: interactionRequest.requester,
        hasPrompt: Boolean(interactionRequest.prompt),
        hasPayload: interactionRequest.payload !== undefined,
      });
      onActivity?.({ message: 'interaction required', output, transcript, usage, thread_snapshot, interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.project() });
    } else if (event?.type === 'tool_execution_end' && event?.isError) {
      const latest = consumeLatestInteractionRequest({ origin: 'subagent' });
      if (latest) {
        latestInteractionRequest = latest;
        debugLog(cwd, 'interaction_bridge_payload_recovered_from_channel', {
          requestId: latest.requestId,
          kind: latest.kind,
          origin: latest.origin,
          requester: latest.requester,
          hasPrompt: Boolean(latest.prompt),
          hasPayload: latest.payload !== undefined,
          carrier: summarizeInteractionCarrier(event.result),
        });
        onActivity?.({ message: 'interaction required', output, transcript, usage, thread_snapshot, interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.project() });
      } else {
        debugLog(cwd, 'interaction_bridge_payload_missing', { toolName: event.toolName, carrier: summarizeInteractionCarrier(event.result) });
      }
    }
    if (snapshotUpdate.activityMessage) {
      onActivity?.({ message: snapshotUpdate.activityMessage, output, transcript, usage, thread_snapshot, interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.project() });
    }
    const messageEvent = event?.assistantMessageEvent;
    const delta = messageEvent?.type === 'text_delta' && typeof messageEvent.delta === 'string'
      ? messageEvent.delta
      : undefined;
    if (event?.type === 'message_end' && event.message?.role === 'assistant') usage = addUsage(usage, event.message.usage);
    if (event?.type === 'message_update' && typeof delta === 'string') {
      output += sanitizeInteractionTransportText(delta);
      onActivity?.({ message: 'streaming response', output, transcript, usage, thread_snapshot, interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.streaming() });
      return;
    }
    if (event?.type === 'message_update' && messageEvent?.type === 'thinking_delta') {
      onActivity?.({ message: 'streaming thinking', output, transcript, usage, thread_snapshot, interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.thinking() });
      return;
    }
    const message = activityMessage(event, transcriptChunk);
    if (!message) return;
    const toolCallId = eventToolCallId(event);
    const toolName = event?.toolName ?? event?.name ?? 'tool';
    const projection = event?.type === 'tool_execution_start'
      ? liveActivity.toolStart(toolCallId, toolName)
      : event?.type === 'tool_execution_update'
        ? liveActivity.toolUpdate(toolCallId)
        : event?.type === 'tool_execution_end'
          ? liveActivity.toolEnd(toolCallId, toolName, Boolean(event?.isError))
          : liveActivity.project();
    onActivity?.({ message, transcript, usage, thread_snapshot, interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: projection });
  }) ?? (() => {});
  const interval = setInterval(() => {
    if (stalled) return;
    if (activeToolCalls.size === 0) {
      if (Date.now() - lastActivity <= stallTimeoutMs) return;
    } else {
      const oldestToolUpdate = Math.min(...[...activeToolCalls.values()].map((entry) => entry.lastUpdate));
      if (Date.now() - oldestToolUpdate <= stallTimeoutMs) return;
    }
    stalled = true;
    transcript += `\n\n--- stall ---\nstalled for ${stallTimeoutMs}ms; aborting session\n`;
    onActivity?.({ message: `stalled for ${stallTimeoutMs}ms; aborting session`, output, transcript, usage, thread_snapshot: snapshotBuilder.snapshot(), interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.project() });
    session.abort?.().catch?.(() => {});
  }, Math.min(5000, Math.max(500, stallTimeoutMs / 4)));
  try {
    let promptError: unknown;
    try {
      if (signal.aborted) throw new Error('Subagent was aborted');
      await session.prompt(prompt);
    } catch (error) {
      promptError = error;
    }
    const currentMessages = (session.messages ?? []).slice(initialMessagesLength);
    const thread_snapshot = snapshotBuilder.finalize(currentMessages);
    debugLog(cwd, 'runner_final_snapshot', { source: thread_snapshot?.source, items: thread_snapshot?.items.map((item) => ({ type: item.type, label: (item as any).label, name: (item as any).name, status: (item as any).status, assistantContent: item.type === 'assistant' ? item.message.content.map((part: any) => part.type) : undefined })) });
    if (stalled) {
      const metadata = normalizeErrorMetadata({
        category: 'stall_timeout',
        phase: 'runner_session',
        message: `Subagent stalled for ${stallTimeoutMs}ms without final response.`,
        partial_result_available: Boolean(output.trim() || thread_snapshot?.items?.length),
        details: { stall_timeout_ms: String(stallTimeoutMs) },
      });
      transcript += `\n\n# subagent failure\n\n${metadata.message}`;
      onActivity?.({ message: `failed: ${metadata.message}`, output: '', transcript, usage, thread_snapshot, interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.project() });
      throw new SubagentStructuredError(metadata);
    }
    const assistantFailure = lastAssistantFailure(currentMessages);
    if (assistantFailure) {
      const metadata = assistantFailure.stopReason === 'aborted'
        ? normalizeErrorMetadata({
            category: 'interrupted',
            phase: 'assistant_final',
            message: 'Assistant aborted without a final response.',
            partial_result_available: false,
            details: { interrupt_reason: 'assistant_aborted' },
          })
        : classifyAssistantFailure({
            ...assistantFailure,
            sawToolActivity,
          });
      if (metadata) {
        transcript += `\n\n# subagent failure\n\n${metadata.message}`;
        onActivity?.({ message: `failed: ${metadata.message}`, output: '', transcript, usage, thread_snapshot, interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.project() });
        throw new SubagentStructuredError(metadata);
      }
    }
    const finalizedAssistantText = collectFinalizedAssistantText(currentMessages);
    if (promptError && finalizedAssistantText) {
      transcript += `\n\n# final assistant text\n\n${finalizedAssistantText}`;
      onActivity?.({ message: 'collected final response', output: finalizedAssistantText, transcript, usage, thread_snapshot, interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.project() });
      return { result: finalizedAssistantText, usage, thread_snapshot, interaction_request: latestInteractionRequest };
    }
    if (promptError) throw promptError;
    const messageText = collectAssistantText(currentMessages);
    const streamedFallback = sawToolActivity ? '' : output.trim();
    const collected = sanitizeInteractionTransportText(messageText || streamedFallback);
    if (!collected.trim()) {
      const toolNames = failingToolNames(thread_snapshot);
      const metadata = toolNames.length
        ? normalizeErrorMetadata({
            category: 'tool_failure',
            phase: 'tool_execution',
            message: 'Subagent terminated after tool failure without a final response.',
            partial_result_available: false,
            source: { tool: toolNames[0], operation: 'tool_execution' },
            details: { tool_names: toolNames.join(', '), tool_status: 'failed' },
          })
        : classifyAssistantFailure({ sawToolActivity }) ?? normalizeErrorMetadata({
            category: sawToolActivity ? 'empty_response_after_tools' : 'empty_response_no_tools',
            phase: 'assistant_final',
            message: sawToolActivity
              ? 'Subagent completed tool execution but did not produce a final response.'
              : 'Subagent finished without a final response.',
            partial_result_available: false,
          });
      transcript += `\n\n# subagent failure\n\n${metadata.message}`;
      onActivity?.({ message: `failed: ${metadata.message}`, output: '', transcript, usage, thread_snapshot, interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.project() });
      throw new SubagentStructuredError(metadata);
    }
    transcript += `\n\n# final assistant text\n\n${collected}`;
    onActivity?.({ message: 'collected final response', output: collected, transcript, usage, thread_snapshot, interaction_request: latestInteractionRequest, pi_retry_attempts: piRetryAttempts, live_activity: liveActivity.project() });
    return { result: collected, usage, thread_snapshot, interaction_request: latestInteractionRequest };
  } finally {
    clearInterval(interval);
    unsubscribe();
    await session.dispose?.();
  }
}

export function collectAssistantText(messages: any[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const content = msg.content;
    if (typeof content === 'string') parts.push(content);
    if (Array.isArray(content)) {
      for (const part of content) if (part?.type === 'text' && typeof part.text === 'string') parts.push(part.text);
    }
  }
  return parts.join('\n').trim();
}

export function structuredMetadataFromError(error: unknown, context: { provider?: string; model?: string; operation?: string; phase?: 'runner_invoke' | 'runner_session' | 'assistant_final' | 'tool_execution' }): SubagentErrorMetadata {
  if (error instanceof SubagentStructuredError) return error.error_metadata;
  return classifyThrownError(error, context);
}
