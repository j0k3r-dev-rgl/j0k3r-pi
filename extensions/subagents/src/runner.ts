import { writeSubagentsDebugLog } from './debug.js';
import { resolveEffectiveSubagentProfile } from './profile-resolver.js';
import { consumeLatestPermissionRequest, resolvePermissionRequest, sanitizePermissionTransportText } from './permission-channel.js';
import { boundThreadSnapshot } from './thread-view.js';
import type { PermissionRequiredPayload } from './permission-channel.js';
import type { EffectiveSubagentProfile, ModelRef, SubagentDefinition, SubagentRunner, SubagentsConfig, UsageStats, ThinkingEffort, SubagentThreadItem, SubagentThreadSnapshot, SubagentToolItem, SubagentToolResultPayload } from './types.js';

function modelLabel(model: any): string | undefined {
  if (!model) return undefined;
  return `${model.provider ?? 'unknown'}/${model.id ?? model.name ?? 'unknown'}`;
}

function modelRefLabel(ref: ModelRef | undefined): string | undefined {
  return ref ? `${ref.provider}/${ref.id}` : undefined;
}

function resolveModel(ctx: any, ref?: ModelRef): any | undefined {
  if (!ref) return undefined;
  return ctx?.modelRegistry?.find?.(ref.provider, ref.id);
}

const MEMORY_WRITE_TOOLS = new Set(['memory_add', 'memory_update', 'memory_archive', 'memory_project_profile']);

function memoryConstraintLines(tools: string[]): string[] {
  const canWriteMemory = tools.some((tool) => MEMORY_WRITE_TOOLS.has(tool));
  if (!canWriteMemory) {
    return [
      '- use memory tools read-only when project context or previous decisions matter.',
      '- do not save durable memory; report memory candidates to the orchestrator instead.',
    ];
  }
  return [
    '- you may create or update memory only for the active sdd flow or when the delegated task explicitly asks for memory maintenance.',
    '- search for the existing sdd flow memory before writing; update it when it exists instead of creating duplicates.',
    '- keep sdd flow memory as a compact state/index/handoff when OpenSpec files exist; when artifact_store is memory, include enough phase artifact detail in that single flow memory for downstream phases to continue without files.',
    '- do not save secrets, raw logs, speculative findings, or unrelated project-wide decisions as durable memory.',
    '- report every memory id you created or updated in your final response.',
  ];
}

export function buildPrompt(definition: SubagentDefinition, task: string, context?: string, tools: string[] = definition.tools): string {
  return [
    definition.instructions,
    '',
    '## operating constraints',
    '- you are a delegated subagent working for the main orchestrator.',
    ...memoryConstraintLines(tools),
    '- do not edit or write files unless explicitly allowed by your agent definition.',
    '- do not delegate to other subagents or call subagent_* tools; only the main orchestrator delegates.',
    '- produce a concise structured result for the orchestrator.',
    '',
    context ? `## orchestrator context\n${context}\n` : '',
    `## delegated task\n${task}`,
  ].join('\n');
}

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

function summarizePermissionCarrier(value: unknown): unknown {
  if (!value || typeof value !== 'object') return { type: typeof value };
  const record = value as Record<string, unknown>;
  return {
    keys: Object.keys(record),
    hasPermissionRequest: Object.hasOwn(record, 'permissionRequest'),
    hasPermissionRequestSnake: Object.hasOwn(record, 'permission_request'),
    details: record.details && typeof record.details === 'object' ? summarizePermissionCarrier(record.details) : undefined,
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

const SNAPSHOT_TEXT_LIMIT = 4000;

function debugLog(cwd: string | undefined, scope: string, data: unknown): void {
  writeSubagentsDebugLog(cwd, scope, data);
}

function truncateSnapshotText(text: string | undefined, limit = SNAPSHOT_TEXT_LIMIT): string | undefined {
  if (text === undefined) return undefined;
  const sanitized = sanitizePermissionTransportText(text);
  return sanitized.length > limit ? `${sanitized.slice(0, limit - 1)}…` : sanitized;
}

function eventToolCallId(event: any): string | undefined {
  return event?.toolCallId ?? event?.tool_call_id ?? event?.toolUseId ?? event?.id;
}

function resultTextFromContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const record = part as Record<string, unknown>;
      return typeof record.text === 'string' ? record.text : typeof record.data === 'string' ? record.data : '';
    })
    .filter(Boolean)
    .join('\n');
  return text || undefined;
}

function resultPayload(result: unknown, isError = false): SubagentToolResultPayload {
  let text = '';
  let details: unknown;
  if (typeof result === 'string') text = result;
  else if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    details = record.details;
    const candidate = resultTextFromContent(record.content) ?? record.output ?? record.text ?? record.error ?? record.stderr ?? record.stdout;
    text = typeof candidate === 'string' ? candidate : shortJson(result, SNAPSHOT_TEXT_LIMIT);
  } else if (result !== undefined) text = String(result);
  const bounded = truncateSnapshotText(text, SNAPSHOT_TEXT_LIMIT) ?? '';
  return { content: bounded ? [{ type: 'text', text: bounded }] : [], details, isError, preview: bounded };
}

function isBashTool(name: string): boolean {
  return name === 'bash' || name === 'shell' || name === 'command' || name === 'exec';
}

function permissionRequestFromCandidate(value: unknown): PermissionRequiredPayload | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === 'permission_required') return candidate as unknown as PermissionRequiredPayload;
  const payload = candidate.payload;
  if (payload && typeof payload === 'object' && (payload as Record<string, unknown>).type === 'permission_required') {
    return payload as PermissionRequiredPayload;
  }
  const handle = candidate.handle;
  if (typeof handle === 'string') return resolvePermissionRequest(handle);
  return undefined;
}

function extractStructuredPermissionRequest(value: unknown, seen = new Set<unknown>()): PermissionRequiredPayload | undefined {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);

  const direct = value as Record<string, unknown>;
  for (const key of ['permissionRequest', 'permission_request']) {
    const found = permissionRequestFromCandidate(direct[key]);
    if (found) return found;
  }

  const directFound = permissionRequestFromCandidate(value);
  if (directFound) return directFound;

  for (const child of Object.values(direct)) {
    const found = extractStructuredPermissionRequest(child, seen);
    if (found) return found;
  }

  return undefined;
}

function parseRawToolJson(text: string): { keys: string[]; kind: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed || !((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return undefined;
    return { kind: Array.isArray(parsed) ? 'array' : 'object', keys: Array.isArray(parsed) ? [] : Object.keys(parsed).slice(0, 20) };
  } catch {
    return undefined;
  }
}

export class ThreadSnapshotBuilder {
  private cwd?: string;
  private readonly createdAt = new Date().toISOString();
  private readonly items: SubagentThreadItem[] = [];
  private readonly toolIndex = new Map<string, number>();
  private streamingAssistantSequence = 0;

  constructor(prompt?: string, context?: string, cwd?: string) {
    this.cwd = cwd;
    if (prompt?.trim()) this.items.push({ type: 'user', id: 'delegated-prompt', label: 'delegated_task', text: truncateSnapshotText(prompt) ?? '' });
    if (context?.trim()) this.items.push({ type: 'user', id: 'delegated-context', label: 'context', text: truncateSnapshotText(context) ?? '' });
  }

  update(event: any): void {
    const now = new Date().toISOString();
    const messageEvent = event?.assistantMessageEvent;
    const textDelta = event?.type === 'message_update' && messageEvent?.type !== 'thinking_delta'
      ? typeof messageEvent?.delta === 'string'
        ? messageEvent.delta
        : messageEvent?.type === 'text_delta' && typeof messageEvent.delta === 'string'
          ? messageEvent.delta
          : undefined
      : undefined;
    const thinkingDelta = event?.type === 'message_update' && messageEvent?.type === 'thinking_delta' && typeof messageEvent.delta === 'string'
      ? messageEvent.delta
      : undefined;
    if (textDelta !== undefined || thinkingDelta !== undefined) {
      this.appendAssistantDelta(textDelta, thinkingDelta);
      return;
    }
    if (event?.type === 'tool_execution_start') {
      const name = event.toolName ?? event.name ?? 'tool';
      const tool_call_id = eventToolCallId(event);
      this.dropTrailingRawToolJson(name, tool_call_id);
      if (isBashTool(name)) {
        const command = String((event.args ?? event.input ?? {}).command ?? formatToolCall(name, event.args ?? event.input ?? {}));
        const item: any = { type: 'bash', id: tool_call_id, tool_call_id, command: truncateSnapshotText(command) ?? '', status: 'running' };
        this.toolIndex.set(tool_call_id ?? `item-${this.items.length}`, this.items.length);
        this.items.push(item);
        return;
      }
      const item: SubagentToolItem = { type: 'tool', id: tool_call_id, tool_call_id, name, arguments: event.args ?? event.input ?? {}, status: 'running', started_at: now };
      this.toolIndex.set(tool_call_id ?? `item-${this.items.length}`, this.items.length);
      this.items.push(item);
      return;
    }
    if (event?.type === 'tool_execution_update') {
      const id = eventToolCallId(event);
      const index = id ? this.toolIndex.get(id) : undefined;
      if (index === undefined) return;
      const item: any = this.items[index];
      const payload = resultPayload(event.partialResult, false);
      if (item.type === 'bash') item.output = truncateSnapshotText([item.output, payload.preview].filter(Boolean).join('\n'));
      else if (item.type === 'tool') item.result = payload;
      if (item.type === 'tool') item.status = 'partial';
      return;
    }
    if (event?.type === 'tool_execution_end') {
      const id = eventToolCallId(event);
      const name = event.toolName ?? event.name ?? 'tool';
      const index = id ? this.toolIndex.get(id) : undefined;
      const payload = resultPayload(event.result ?? event.output ?? event.error, Boolean(event.isError));
      if (index === undefined) {
        this.items.push({ type: 'tool_result', id, tool_call_id: id, name, result: payload });
        return;
      }
      const item: any = this.items[index];
      if (item.type === 'bash') {
        const result = event.result && typeof event.result === 'object' ? event.result as Record<string, unknown> : {};
        const output = payload.preview ?? '';
        item.output = truncateSnapshotText(output);
        item.truncated = typeof output === 'string' && output.endsWith('…');
        item.exitCode = typeof result.exitCode === 'number' ? result.exitCode : undefined;
        item.status = event.isError ? 'failed' : 'completed';
      } else if (item.type === 'tool') {
        item.status = event.isError ? 'failed' : 'completed';
        item.result = payload;
        item.ended_at = now;
      }
    }
  }

  snapshot(source: SubagentThreadSnapshot['source'] = 'events'): SubagentThreadSnapshot | undefined {
    return boundThreadSnapshot({ version: 1, created_at: this.createdAt, updated_at: new Date().toISOString(), source, items: this.items }, { textLimit: SNAPSHOT_TEXT_LIMIT });
  }

  finalize(messages: any[]): SubagentThreadSnapshot | undefined {
    const messageItems = assistantItemsFromMessages(messages);
    const initialItems: SubagentThreadItem[] = this.items.filter((item) => item.type === 'user');
    const finalMessagesAlreadyHaveThinking = messageItems.some((item) => item.type === 'assistant' && item.message.content.some((part) => part.type === 'thinking'));
    const eventItems = this.items
      .filter((item) => item.type !== 'user')
      .map((item) => this.finalizeEventItem(item, messageItems.length > 0, finalMessagesAlreadyHaveThinking))
      .filter((item): item is SubagentThreadItem => Boolean(item));
    const items: SubagentThreadItem[] = [...initialItems, ...(messageItems.length ? interleaveMessagesWithToolRows(messageItems, eventItems) : eventItems)];
    const source = messageItems.length && eventItems.length ? 'mixed' : messageItems.length ? 'session_messages' : 'events';
    return boundThreadSnapshot({ version: 1, created_at: this.createdAt, updated_at: new Date().toISOString(), source, items }, { textLimit: SNAPSHOT_TEXT_LIMIT });
  }

  private dropTrailingRawToolJson(toolName?: string, toolCallId?: string): void {
    const item = this.items.at(-1) as SubagentThreadItem | undefined;
    if (item?.type !== 'assistant' || !item.id?.startsWith('streaming-assistant-')) return;
    const textParts = item.message.content.filter((part): part is { type: 'text'; text: string } => part.type === 'text');
    const hasNonText = item.message.content.some((part) => part.type !== 'text');
    if (hasNonText || !textParts.length) return;
    const text = textParts.map((part) => part.text).join('');
    const parsed = parseRawToolJson(text);
    if (!parsed) return;
    this.items.pop();
    debugLog(this.cwd, 'live_raw_tool_json_dropped', { toolName, toolCallId, jsonKind: parsed.kind, keys: parsed.keys, textLength: text.length });
  }

  private appendAssistantDelta(textDelta?: string, thinkingDelta?: string): void {
    let item = this.items.at(-1) as SubagentThreadItem | undefined;
    if (item?.type !== 'assistant' || !item.id?.startsWith('streaming-assistant-')) {
      item = { type: 'assistant', id: `streaming-assistant-${++this.streamingAssistantSequence}`, message: { role: 'assistant', content: [] } };
      this.items.push(item);
    }
    const content = item.message.content as any[];
    if (thinkingDelta) {
      let thinkingPart = content.find((part) => part.type === 'thinking');
      if (!thinkingPart) {
        thinkingPart = { type: 'thinking', text: '', thinking: '' };
        const firstText = content.findIndex((part) => part.type === 'text');
        if (firstText >= 0) content.splice(firstText, 0, thinkingPart);
        else content.push(thinkingPart);
      }
      const thinking = truncateSnapshotText(`${thinkingPart.thinking ?? thinkingPart.text ?? ''}${thinkingDelta}`) ?? '';
      thinkingPart.text = thinking;
      thinkingPart.thinking = thinking;
    }
    if (textDelta) {
      let textPart = content.find((part) => part.type === 'text');
      if (!textPart) {
        textPart = { type: 'text', text: '' };
        content.push(textPart);
      }
      textPart.text = truncateSnapshotText(`${textPart.text ?? ''}${textDelta}`) ?? '';
    }
  }

  private finalizeEventItem(item: SubagentThreadItem, hasFinalMessages: boolean, finalMessagesAlreadyHaveThinking: boolean): SubagentThreadItem | undefined {
    if (item.type !== 'assistant' || !item.id?.startsWith('streaming-assistant-')) return item;
    if (!hasFinalMessages) return item;
    if (finalMessagesAlreadyHaveThinking) return undefined;
    const thinkingContent = item.message.content
      .filter((part): part is { type: 'thinking'; text?: string; thinking?: string } => part.type === 'thinking' && Boolean((part.thinking ?? part.text)?.trim()))
      .map((part) => ({ type: 'thinking' as const, text: truncateSnapshotText(part.text), thinking: truncateSnapshotText(part.thinking ?? part.text) }));
    return thinkingContent.length ? { ...item, message: { ...item.message, content: thinkingContent } } : undefined;
  }
}

function assistantToolCallIds(item: SubagentThreadItem): Set<string> {
  const ids = new Set<string>();
  if (item.type !== 'assistant') return ids;
  for (const part of item.message.content) if (part.type === 'toolCall') ids.add(part.id);
  return ids;
}

function toolRowId(item: SubagentThreadItem): string | undefined {
  if (item.type === 'tool' || item.type === 'tool_result') return item.tool_call_id ?? item.id;
  if (item.type === 'bash') return item.tool_call_id ?? item.id;
  return undefined;
}

function interleaveMessagesWithToolRows(messageItems: SubagentThreadItem[], eventItems: SubagentThreadItem[]): SubagentThreadItem[] {
  const used = new Set<number>();
  const ordered: SubagentThreadItem[] = [];
  const deferredMessages: SubagentThreadItem[] = [];
  for (const messageItem of messageItems) {
    const ids = assistantToolCallIds(messageItem);
    if (!ids.size) {
      deferredMessages.push(messageItem);
      continue;
    }
    for (let index = 0; index < eventItems.length; index++) {
      if (used.has(index)) continue;
      const id = toolRowId(eventItems[index]!);
      if (id && ids.has(id)) break;
      ordered.push(eventItems[index]!);
      used.add(index);
    }
    ordered.push(messageItem);
    for (let index = 0; index < eventItems.length; index++) {
      if (used.has(index)) continue;
      const id = toolRowId(eventItems[index]!);
      if (id && ids.has(id)) {
        ordered.push(eventItems[index]!);
        used.add(index);
      }
    }
  }
  for (let index = 0; index < eventItems.length; index++) if (!used.has(index)) ordered.push(eventItems[index]!);
  ordered.push(...deferredMessages);
  return ordered;
}

function assistantItemsFromMessages(messages: any[]): SubagentThreadItem[] {
  const items: SubagentThreadItem[] = [];
  for (const msg of messages) {
    if (msg?.role !== 'assistant') continue;
    if (typeof msg.content === 'string') {
      if (msg.content.trim()) items.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: truncateSnapshotText(msg.content) ?? '' }], usage: msg.usage } });
      continue;
    }
    if (!Array.isArray(msg.content)) continue;
    const content = msg.content.flatMap((part: any) => {
      if (part?.type === 'text' && typeof part.text === 'string') return [{ type: 'text' as const, text: truncateSnapshotText(part.text) ?? '' }];
      if (part?.type === 'thinking') {
        const thinking = typeof part.thinking === 'string' ? part.thinking : typeof part.text === 'string' ? part.text : '';
        return thinking ? [{ type: 'thinking' as const, text: truncateSnapshotText(thinking), thinking: truncateSnapshotText(thinking) }] : [];
      }
      if ((part?.type === 'toolCall' || part?.type === 'tool_call') && typeof part.name === 'string') return [{ type: 'toolCall' as const, id: String(part.id ?? part.toolCallId ?? part.tool_call_id ?? part.name), name: part.name, arguments: part.arguments ?? part.args ?? part.input ?? {} }];
      return [];
    });
    if (content.length) items.push({ type: 'assistant', id: msg.id, message: { role: 'assistant', content, stopReason: msg.stopReason, errorMessage: msg.errorMessage, usage: msg.usage } });
  }
  return items;
}

const SUBAGENT_SESSION_REGISTRY_KEY = Symbol.for('pi.permissionGuard.subagentSessions');

type SubagentPermissionSessionMetadata = {
  origin: 'subagent';
  requester: { subagentName: string; description?: string };
};

function subagentPermissionRegistry(): Map<string, SubagentPermissionSessionMetadata> {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[SUBAGENT_SESSION_REGISTRY_KEY];
  if (existing instanceof Map) return existing as Map<string, SubagentPermissionSessionMetadata>;
  const registry = new Map<string, SubagentPermissionSessionMetadata>();
  holder[SUBAGENT_SESSION_REGISTRY_KEY] = registry;
  return registry;
}

function registerPermissionSubagentSession(session: any, definition: SubagentDefinition): () => void {
  const sessionId = session?.sessionManager?.getSessionId?.() ?? session?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return () => undefined;
  const registry = subagentPermissionRegistry();
  const previous = registry.get(sessionId);
  registry.set(sessionId, {
    origin: 'subagent',
    requester: { subagentName: definition.name, description: definition.description },
  });
  return () => {
    if (previous) registry.set(sessionId, previous);
    else registry.delete(sessionId);
  };
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
  const delta = messageEvent?.type !== 'thinking_delta' && typeof messageEvent?.delta === 'string'
    ? messageEvent.delta
    : messageEvent?.type === 'text_delta' && typeof messageEvent.delta === 'string'
      ? messageEvent.delta
      : undefined;
  if (event?.type === 'message_update' && typeof delta === 'string') return sanitizePermissionTransportText(delta);

  if (event?.type === 'tool_execution_start') {
    const name = event.toolName ?? 'tool';
    return `\n\n${formatToolCall(name, event.args ?? event.input ?? {})}\n`;
  }
  if (event?.type === 'tool_execution_update') return event.partialResult ? `\n${sanitizePermissionTransportText(shortJson(event.partialResult, 500))}\n` : '';
  if (event?.type === 'tool_execution_end') return `\n${event.isError ? 'failed' : 'done'}\n`;
  if (event?.type === 'message_start' && event.message?.role === 'assistant') return '\n\nPreparing for response\n\n';
  return '';
}

function activityMessage(event: any, transcriptChunk: string): string | undefined {
  if (!transcriptChunk.trim()) return undefined;
  if (event?.type === 'message_start' && event.message?.role === 'assistant') return 'preparing response';
  if (event?.type === 'tool_execution_start') return formatToolCall(event.toolName ?? 'tool', event.args ?? event.input ?? {});
  if (event?.type === 'tool_execution_end') return event.isError ? 'tool failed' : 'tool completed';
  if (event?.type === 'tool_execution_update') return 'tool update';
  return undefined;
}

async function promptWithInactivity(
  session: any,
  prompt: string,
  stallTimeoutMs: number,
  signal: AbortSignal,
  onActivity?: (activity: { message: string; output?: string; prompt?: string; transcript?: string; usage?: UsageStats; effort?: ThinkingEffort; thread_snapshot?: SubagentThreadSnapshot; permission_request?: PermissionRequiredPayload }) => void,
  delegatedContext?: string,
  cwd?: string,
): Promise<{ result: string; usage: UsageStats; thread_snapshot?: SubagentThreadSnapshot; permission_request?: PermissionRequiredPayload }> {
  let output = '';
  const snapshotBuilder = new ThreadSnapshotBuilder(prompt, delegatedContext, cwd);
  let latestPermissionRequest: PermissionRequiredPayload | undefined;
  let usage = emptyUsage();
  let transcript = `# orchestrator prompt\n\n${prompt}\n\n# subagent execution\n`;
  let lastActivity = Date.now();
  onActivity?.({ message: 'session started', prompt, transcript, usage, thread_snapshot: snapshotBuilder.snapshot() });
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
      permissionCarrier: event?.type === 'tool_execution_end' ? summarizePermissionCarrier(event?.result) : undefined,
    });
    snapshotBuilder.update(event);
    const thread_snapshot = snapshotBuilder.snapshot();
    const transcriptChunk = eventTranscript(event);
    transcript += transcriptChunk;
    const permissionRequest = extractStructuredPermissionRequest(event?.result ?? event?.partialResult ?? event);
    if (permissionRequest) {
      latestPermissionRequest = permissionRequest;
      debugLog(cwd, 'permission_bridge_payload_detected', {
        requestId: permissionRequest.requestId,
        tool: permissionRequest.tool,
        action: permissionRequest.action,
        origin: permissionRequest.origin,
        reasonCode: permissionRequest.reasonCode,
        hasSessionScope: Boolean(permissionRequest.sessionScope),
        hasProjectScope: Boolean(permissionRequest.projectScope),
      });
      onActivity?.({ message: 'permission required', output, transcript, usage, thread_snapshot, permission_request: latestPermissionRequest });
    } else if (event?.type === 'tool_execution_end' && event?.isError && /Permission approval must be collected by the main thread/i.test(shortJson(event.result, 1000))) {
      const latest = consumeLatestPermissionRequest({ origin: 'subagent' });
      if (latest) {
        latestPermissionRequest = latest;
        debugLog(cwd, 'permission_bridge_payload_recovered_from_channel', {
          requestId: latest.requestId,
          tool: latest.tool,
          action: latest.action,
          origin: latest.origin,
          reasonCode: latest.reasonCode,
          hasSessionScope: Boolean(latest.sessionScope),
          hasProjectScope: Boolean(latest.projectScope),
          carrier: summarizePermissionCarrier(event.result),
        });
        onActivity?.({ message: 'permission required', output, transcript, usage, thread_snapshot, permission_request: latestPermissionRequest });
      } else {
        debugLog(cwd, 'permission_bridge_payload_missing', { toolName: event.toolName, carrier: summarizePermissionCarrier(event.result) });
      }
    }
    const messageEvent = event?.assistantMessageEvent;
    const delta = messageEvent?.type !== 'thinking_delta' && typeof messageEvent?.delta === 'string'
      ? messageEvent.delta
      : messageEvent?.type === 'text_delta' && typeof messageEvent.delta === 'string'
        ? messageEvent.delta
        : undefined;
    if (event?.type === 'message_end' && event.message?.role === 'assistant') usage = addUsage(usage, event.message.usage);
    if (event?.type === 'message_update' && typeof delta === 'string') {
      output += sanitizePermissionTransportText(delta);
      onActivity?.({ message: 'streaming response', output, transcript, usage, thread_snapshot, permission_request: latestPermissionRequest });
      return;
    }
    if (event?.type === 'message_update' && messageEvent?.type === 'thinking_delta') {
      onActivity?.({ message: 'streaming thinking', output, transcript, usage, thread_snapshot, permission_request: latestPermissionRequest });
      return;
    }
    const message = activityMessage(event, transcriptChunk);
    if (message) onActivity?.({ message, transcript, usage, thread_snapshot, permission_request: latestPermissionRequest });
  }) ?? (() => {});
  const interval = setInterval(() => {
    if (Date.now() - lastActivity > stallTimeoutMs) {
      transcript += `\n\n--- stall ---\nstalled for ${stallTimeoutMs}ms; aborting session\n`;
      onActivity?.({ message: `stalled for ${stallTimeoutMs}ms; aborting session`, output, transcript, usage, thread_snapshot: snapshotBuilder.snapshot(), permission_request: latestPermissionRequest });
      session.abort?.().catch?.(() => {});
    }
  }, Math.min(5000, Math.max(500, stallTimeoutMs / 4)));
  try {
    await session.prompt(prompt, { signal });
    let collected = sanitizePermissionTransportText(collectAssistantText(session.messages ?? []) || output.trim());
    transcript += `\n\n# final assistant text\n\n${collected}`;
    const thread_snapshot = snapshotBuilder.finalize(session.messages ?? []);
    debugLog(cwd, 'runner_final_snapshot', { source: thread_snapshot?.source, items: thread_snapshot?.items.map((item) => ({ type: item.type, label: (item as any).label, name: (item as any).name, status: (item as any).status, assistantContent: item.type === 'assistant' ? item.message.content.map((part: any) => part.type) : undefined })) });
    onActivity?.({ message: 'collected final response', output: collected, transcript, usage, thread_snapshot, permission_request: latestPermissionRequest });
    return { result: collected, usage, thread_snapshot, permission_request: latestPermissionRequest };
  } finally {
    clearInterval(interval);
    unsubscribe();
    await session.dispose?.();
  }
}

function collectAssistantText(messages: any[]): string {
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

let piSdkModulePromise: Promise<any> | undefined;

async function loadPiSdkModule(): Promise<any> {
  const moduleName = '@earendil-works/pi-coding-agent';
  piSdkModulePromise ??= import(moduleName) as Promise<any>;
  return piSdkModulePromise;
}

async function createSession(model: any, cwd: string, tools: string[], effort: ThinkingEffort | undefined, config: SubagentsConfig, ctx: any) {
  const piSdk = await loadPiSdkModule();
  const { createAgentSession, SessionManager } = piSdk;
  const options: Record<string, unknown> = {
    cwd,
    model,
    thinkingLevel: effort,
    tools,
    sessionManager: SessionManager.inMemory(cwd),
  };
  if (ctx?.authStorage) options.authStorage = ctx.authStorage;
  if (ctx?.modelRegistry) options.modelRegistry = ctx.modelRegistry;
  if (ctx?.settingsManager) options.settingsManager = ctx.settingsManager;
  if (config.session_resources === 'lean') {
    const DefaultResourceLoader = piSdk.DefaultResourceLoader;
    const agentDir = typeof piSdk.getAgentDir === 'function' ? piSdk.getAgentDir() : undefined;
    if (typeof DefaultResourceLoader !== 'function') throw new Error('Subagent lean session resources require DefaultResourceLoader from Pi SDK.');
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: ctx?.settingsManager,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    options.agentDir = agentDir;
    options.resourceLoader = resourceLoader;
  }
  return createAgentSession(options);
}

function selectedModel(input: { ctx: any; definition: SubagentDefinition; profile: EffectiveSubagentProfile }): any | undefined {
  const ref = input.profile.model.value;
  if (!ref) return input.ctx?.model;
  if (input.profile.model.source === 'orchestrator') return input.ctx?.model ?? resolveModel(input.ctx, ref);
  const resolved = resolveModel(input.ctx, ref);
  if (!resolved) throw new Error(`Subagent ${input.definition.name} could not resolve selected model ${modelRefLabel(ref)} (${input.profile.model.source}).`);
  return resolved;
}

export const sdkSubagentRunner: SubagentRunner = async ({ definition, task, context, cwd, ctx, config, signal, effectiveProfile, onActivity }) => {
  const profile = effectiveProfile ?? resolveEffectiveSubagentProfile({ agentName: definition.name, definition, config, ctx });
  const preferred = selectedModel({ ctx, definition, profile });
  const current = ctx?.model;
  const effort = profile.effort.value;
  const tools = definition.tools?.length ? definition.tools : config.default_tools;
  const prompt = buildPrompt(definition, task, context, tools);
  onActivity?.({ message: 'orchestrator prompt prepared', prompt, transcript: `# orchestrator prompt\n\n${prompt}\n`, effort });

  async function attempt(model: any) {
    onActivity?.({ message: `starting ${definition.name} with model ${modelLabel(model) ?? 'unknown'}${effort ? ` effort ${effort}` : ''}`, prompt, effort });
    const { session } = await createSession(model, cwd, tools, effort, config, ctx);
    const unregisterPermissionSession = registerPermissionSubagentSession(session, definition);
    try {
      const { result, usage, thread_snapshot, permission_request } = await promptWithInactivity(session, prompt, config.stall_timeout_ms, signal, onActivity, context, cwd);
      return { result, usage, thread_snapshot, permission_request };
    } finally {
      unregisterPermissionSession();
    }
  }

  try {
    const { result, usage, thread_snapshot, permission_request } = await attempt(preferred);
    return { result, usage, thread_snapshot, permission_request, model: modelLabel(preferred) ?? modelRefLabel(profile.model.value), effort, fallback_used: false };
  } catch (error) {
    if (signal.aborted) throw new Error('Subagent was aborted');
    const preferredLabel = modelLabel(preferred) ?? modelRefLabel(profile.model.value) ?? 'unknown';
    const currentLabel = modelLabel(current) ?? 'unknown';
    onActivity?.({ message: `failed/stalled on ${preferredLabel}; falling back to ${currentLabel}`, effort });
    const message = error instanceof Error ? error.message : String(error);
    ctx?.ui?.notify?.(`Subagent ${definition.name} failed/stalled on selected model ${preferredLabel}: ${message}. Falling back to current model ${currentLabel}.`, 'warning');
    if (!current || current === preferred) throw new Error(`Subagent ${definition.name} failed on selected model ${preferredLabel}: ${message}`);
    const { result, usage, thread_snapshot, permission_request } = await attempt(current);
    return { result, usage, thread_snapshot, permission_request, model: currentLabel, effort, fallback_used: true };
  }
};
