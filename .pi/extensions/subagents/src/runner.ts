import type { ModelRef, SubagentDefinition, SubagentRunner, SubagentsConfig, UsageStats, ThinkingEffort } from './types.js';

function modelLabel(model: any): string | undefined {
  if (!model) return undefined;
  return `${model.provider ?? 'unknown'}/${model.id ?? model.name ?? 'unknown'}`;
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

function shortJson(value: unknown, limit = 900): string {
  try {
    const text = JSON.stringify(value, (_key, val) => typeof val === 'string' && val.length > 300 ? `${val.slice(0, 300)}…` : val);
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch {
    return '[unserializable]';
  }
}

const PERMISSION_REQUIRED_MARKER = 'permission_required:';
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

function extractPermissionRequiredText(value: unknown, seen = new Set<object>()): string | undefined {
  if (typeof value === 'string') {
    const index = value.indexOf(PERMISSION_REQUIRED_MARKER);
    if (index < 0) return undefined;
    const text = value.slice(index);
    const lineBreak = text.search(/\r?\n/);
    return lineBreak >= 0 ? text.slice(0, lineBreak) : text;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractPermissionRequiredText(item, seen);
      if (extracted) return extracted;
    }
    return undefined;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const extracted = extractPermissionRequiredText(item, seen);
    if (extracted) return extracted;
  }
  return undefined;
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
  const delta = event?.assistantMessageEvent?.delta;
  if (event?.type === 'message_update' && typeof delta === 'string') return delta;

  const permissionRequired = extractPermissionRequiredText(event);
  if (permissionRequired) return `\n${permissionRequired}\n`;

  if (event?.type === 'tool_execution_start') {
    const name = event.toolName ?? 'tool';
    return `\n\n${formatToolCall(name, event.args ?? event.input ?? {})}\n`;
  }
  if (event?.type === 'tool_execution_update') return event.partialResult ? `\n${shortJson(event.partialResult, 500)}\n` : '';
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
  onActivity?: (activity: { message: string; output?: string; prompt?: string; transcript?: string; usage?: UsageStats; effort?: ThinkingEffort }) => void,
): Promise<{ result: string; usage: UsageStats }> {
  let output = '';
  let permissionRequiredOutput = '';
  let usage = emptyUsage();
  let transcript = `# orchestrator prompt\n\n${prompt}\n\n# subagent execution\n`;
  let lastActivity = Date.now();
  onActivity?.({ message: 'session started', prompt, transcript, usage });
  const unsubscribe = session.subscribe?.((event: any) => {
    lastActivity = Date.now();
    const transcriptChunk = eventTranscript(event);
    transcript += transcriptChunk;
    const permissionRequired = extractPermissionRequiredText(event);
    if (permissionRequired && !permissionRequiredOutput.includes(permissionRequired)) {
      permissionRequiredOutput += `${permissionRequiredOutput ? '\n' : ''}${permissionRequired}`;
    }
    if (permissionRequired && !output.includes(permissionRequired)) {
      output += `${output ? '\n' : ''}${permissionRequired}`;
      onActivity?.({ message: 'permission required', output, transcript, usage });
    }
    const delta = event?.assistantMessageEvent?.delta;
    if (event?.type === 'message_end' && event.message?.role === 'assistant') usage = addUsage(usage, event.message.usage);
    if (event?.type === 'message_update' && typeof delta === 'string') {
      output += delta;
      onActivity?.({ message: 'streaming response', output, transcript, usage });
      return;
    }
    const message = activityMessage(event, transcriptChunk);
    if (message) onActivity?.({ message, transcript, usage });
  }) ?? (() => {});
  const interval = setInterval(() => {
    if (Date.now() - lastActivity > stallTimeoutMs) {
      transcript += `\n\n--- stall ---\nstalled for ${stallTimeoutMs}ms; aborting session\n`;
      onActivity?.({ message: `stalled for ${stallTimeoutMs}ms; aborting session`, output, transcript, usage });
      session.abort?.().catch?.(() => {});
    }
  }, Math.min(5000, Math.max(500, stallTimeoutMs / 4)));
  try {
    await session.prompt(prompt, { signal });
    let collected = collectAssistantText(session.messages ?? []) || output.trim();
    if (permissionRequiredOutput && !collected.includes(permissionRequiredOutput)) {
      collected = collected ? `${permissionRequiredOutput}\n\n${collected}` : permissionRequiredOutput;
    }
    transcript += `\n\n# final assistant text\n\n${collected}`;
    onActivity?.({ message: 'collected final response', output: collected, transcript, usage });
    return { result: collected, usage };
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

async function createSession(model: any, cwd: string, tools: string[], effort?: ThinkingEffort) {
  const moduleName = '@earendil-works/pi-coding-agent';
  const { createAgentSession, SessionManager } = await import(moduleName) as any;
  return createAgentSession({ cwd, model, thinkingLevel: effort, tools, sessionManager: SessionManager.inMemory() });
}

function currentEffort(ctx: any): ThinkingEffort | undefined {
  const effort = ctx?.pi?.getThinkingLevel?.() ?? ctx?.getThinkingLevel?.() ?? ctx?.thinkingLevel;
  return typeof effort === 'string' ? effort as ThinkingEffort : undefined;
}

export const sdkSubagentRunner: SubagentRunner = async ({ definition, task, context, cwd, ctx, config, signal, onActivity }) => {
  const preferredRef = definition.model ?? config.default_model;
  const preferred = resolveModel(ctx, preferredRef) ?? ctx?.model;
  const current = ctx?.model;
  const effort = definition.effort ?? config.default_effort ?? currentEffort(ctx);
  const tools = definition.tools?.length ? definition.tools : config.default_tools;
  const prompt = buildPrompt(definition, task, context, tools);
  onActivity?.({ message: 'orchestrator prompt prepared', prompt, transcript: `# orchestrator prompt\n\n${prompt}\n`, effort });

  async function attempt(model: any) {
    onActivity?.({ message: `starting ${definition.name} with model ${modelLabel(model) ?? 'unknown'}${effort ? ` effort ${effort}` : ''}`, prompt, effort });
    const { session } = await createSession(model, cwd, tools, effort);
    const unregisterPermissionSession = registerPermissionSubagentSession(session, definition);
    try {
      const { result, usage } = await promptWithInactivity(session, prompt, config.stall_timeout_ms, signal, onActivity);
      return { result, usage };
    } finally {
      unregisterPermissionSession();
    }
  }

  try {
    const { result, usage } = await attempt(preferred);
    return { result, usage, model: modelLabel(preferred), effort, fallback_used: false };
  } catch (error) {
    if (signal.aborted) throw new Error('Subagent was aborted');
    const preferredLabel = modelLabel(preferred) ?? 'unknown';
    const currentLabel = modelLabel(current) ?? 'unknown';
    onActivity?.({ message: `failed/stalled on ${preferredLabel}; falling back to ${currentLabel}`, effort });
    ctx?.ui?.notify?.(`Subagent ${definition.name} failed/stalled on ${preferredLabel}: ${error instanceof Error ? error.message : String(error)}. Falling back to current model ${currentLabel}.`, 'warning');
    if (!current || current === preferred) throw error;
    const { result, usage } = await attempt(current);
    return { result, usage, model: currentLabel, effort, fallback_used: true };
  }
};
