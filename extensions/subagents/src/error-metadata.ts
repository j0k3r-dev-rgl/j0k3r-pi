import { sanitizeInteractionTransportText } from './interaction-channel.js';
import type { SubagentErrorAttemptRole, SubagentErrorCategory, SubagentErrorMetadata, SubagentErrorPhase, UsageStats } from './types.js';

const MESSAGE_LIMIT = 1024;
const CODE_LIMIT = 128;
const SOURCE_LIMIT = 256;
const LAST_ACTIVITY_LIMIT = 512;
const DETAILS_KEY_LIMIT = 64;
const DETAILS_VALUE_LIMIT = 512;
const DETAILS_LIMIT = 16;
const ATTEMPTS_LIMIT = 2;
const CAUSE_DEPTH_LIMIT = 2;

const RETRYABLE_DEFAULTS: Record<SubagentErrorCategory, boolean> = {
  total_timeout: false,
  stall_timeout: false,
  cancelled: false,
  interrupted: false,
  empty_response_no_tools: false,
  empty_response_after_tools: false,
  context_overflow: false,
  provider_api_error: true,
  provider_auth_error: false,
  provider_rate_limit: true,
  provider_network_error: true,
  tool_failure: false,
  fallback_failed: false,
  unknown_fallback: false,
  malformed_thrown_value: false,
  serialization_failure: false,
  unknown: false,
};

const CATEGORY_SET = new Set<SubagentErrorCategory>(Object.keys(RETRYABLE_DEFAULTS) as SubagentErrorCategory[]);
const PHASE_SET = new Set<SubagentErrorPhase>(['runner_invoke', 'runner_session', 'assistant_final', 'tool_execution', 'manager', 'user', 'serializer']);
const ROLE_SET = new Set<SubagentErrorAttemptRole>(['primary', 'fallback']);

function limitCodePoints(value: string | undefined, limit: number): string | undefined {
  if (value === undefined) return undefined;
  const chars = Array.from(value);
  return chars.length > limit ? `${chars.slice(0, Math.max(0, limit - 1)).join('')}…` : value;
}

function asciiSafe(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  const bounded = limitCodePoints(value.replace(/[^\x20-\x7E]+/g, '_'), limit);
  return bounded || undefined;
}

function redactText(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  let text = sanitizeInteractionTransportText(String(value));
  text = text
    .replace(/authorization\s*:\s*bearer\s+[A-Za-z0-9._\-]+/gi, 'Authorization: [redacted]')
    .replace(/bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9._\-]+\b/g, '[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/(?:^|\s)(?:\/[A-Za-z0-9._-]+)+/g, (match) => match.replace(/\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/g, '[redacted]'))
    .replace(/\b(?:prompt|system prompt|user prompt|prompt text)\s*:[^|\n\r]*/gi, '[redacted]')
    .replace(/\b(?:system|user|assistant)\s*:[^|\n\r]*/gi, '[redacted]')
    .replace(/SECRET_FILE_BODY[\w-]*/g, '[redacted]')
    .replace(/file contents?[^|\n\r]*/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return limitCodePoints(text, limit);
}

function normalizeCategory(value: unknown): SubagentErrorCategory {
  return typeof value === 'string' && CATEGORY_SET.has(value as SubagentErrorCategory)
    ? value as SubagentErrorCategory
    : 'unknown';
}

function normalizePhase(value: unknown): SubagentErrorPhase | undefined {
  return typeof value === 'string' && PHASE_SET.has(value as SubagentErrorPhase)
    ? value as SubagentErrorPhase
    : undefined;
}

function normalizeRole(value: unknown): SubagentErrorAttemptRole | undefined {
  return typeof value === 'string' && ROLE_SET.has(value as SubagentErrorAttemptRole)
    ? value as SubagentErrorAttemptRole
    : undefined;
}

function normalizeUsage(value: unknown): UsageStats | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = value as Partial<UsageStats>;
  return {
    input: Number(usage.input ?? 0),
    output: Number(usage.output ?? 0),
    cacheRead: Number(usage.cacheRead ?? 0),
    cacheWrite: Number(usage.cacheWrite ?? 0),
    cost: Number(usage.cost ?? 0),
    contextTokens: Number(usage.contextTokens ?? 0),
    turns: Number(usage.turns ?? 0),
  };
}

function normalizeDetails(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const details: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, DETAILS_LIMIT)) {
    const key = asciiSafe(rawKey, DETAILS_KEY_LIMIT);
    const text = redactText(typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue), DETAILS_VALUE_LIMIT);
    if (!key || !text) continue;
    details[key] = text;
  }
  return Object.keys(details).length ? details : undefined;
}

function safeMessage(category: SubagentErrorCategory, details?: Record<string, string>): string {
  switch (category) {
    case 'total_timeout':
      return details?.timeout_ms ? `timed out after ${details.timeout_ms}ms` : 'timed out';
    case 'stall_timeout':
      return details?.stall_timeout_ms ? `Subagent stalled for ${details.stall_timeout_ms}ms without final response.` : 'Subagent stalled without final response.';
    case 'cancelled':
      return `Subagent cancelled: ${details?.cancel_reason ?? 'cancelled'}`;
    case 'interrupted':
      return `Subagent interrupted: ${details?.interrupt_reason ?? 'interrupted'}`;
    case 'empty_response_no_tools':
      return 'Subagent finished without a final response.';
    case 'empty_response_after_tools':
      return 'Subagent completed tool execution but did not produce a final response.';
    case 'fallback_failed':
      return 'Subagent fallback failed.';
    case 'unknown_fallback':
      return 'Subagent fallback unavailable after model failure.';
    case 'serialization_failure':
      return 'Subagent error metadata could not be serialized safely.';
    default:
      return category.replace(/_/g, ' ');
  }
}

export function normalizeErrorMetadata(input: Partial<SubagentErrorMetadata> & { category: SubagentErrorCategory } | Partial<SubagentErrorMetadata>): SubagentErrorMetadata {
  try {
    return normalizeErrorMetadataInternal(input, 0);
  } catch {
    return {
      version: 1,
      category: 'serialization_failure',
      message: 'Subagent error metadata could not be serialized safely.',
      retryable: false,
      phase: 'serializer',
      partial_result_available: false,
    };
  }
}

function normalizeErrorMetadataInternal(input: Partial<SubagentErrorMetadata> | undefined, depth: number): SubagentErrorMetadata {
  const category = normalizeCategory(input?.category);
  const details = normalizeDetails(input?.details);
  const message = redactText(typeof input?.message === 'string' ? input.message : safeMessage(category, details), MESSAGE_LIMIT)
    ?? safeMessage(category, details);
  const attempts = Array.isArray(input?.attempts)
    ? input.attempts
        .slice(0, ATTEMPTS_LIMIT)
        .map((attempt, index) => {
          const normalized = normalizeErrorMetadataInternal(attempt, depth + 1);
          const role = normalizeRole(attempt?.role) ?? (index === 0 ? 'primary' : 'fallback');
          return { ...normalized, role };
        })
    : undefined;
  const cause = depth < CAUSE_DEPTH_LIMIT && input?.cause
    ? normalizeErrorMetadataInternal(input.cause, depth + 1)
    : undefined;
  return {
    version: 1,
    category,
    message,
    retryable: typeof input?.retryable === 'boolean' ? input.retryable : RETRYABLE_DEFAULTS[category],
    phase: normalizePhase(input?.phase),
    code: asciiSafe(typeof input?.code === 'string' ? input.code : category, CODE_LIMIT),
    role: normalizeRole(input?.role),
    source: input?.source ? {
      provider: redactText(input.source.provider, SOURCE_LIMIT),
      model: redactText(input.source.model, SOURCE_LIMIT),
      tool: redactText(input.source.tool, SOURCE_LIMIT),
      operation: redactText(input.source.operation, SOURCE_LIMIT),
    } : undefined,
    cause,
    attempts: attempts?.length ? attempts : undefined,
    usage_at_failure: normalizeUsage(input?.usage_at_failure),
    last_activity: redactText(input?.last_activity, LAST_ACTIVITY_LIMIT),
    partial_result_available: Boolean(input?.partial_result_available),
    task_id: redactText(input?.task_id, SOURCE_LIMIT),
    parent_session_id: redactText(input?.parent_session_id, SOURCE_LIMIT),
    details,
  };
}

export function deriveErrorString(metadata: SubagentErrorMetadata): string {
  const normalized = normalizeErrorMetadata(metadata);
  return safeMessage(normalized.category, normalized.details) === 'unknown'
    ? normalized.message
    : safeMessage(normalized.category, normalized.details);
}

export function classifyThrownError(error: unknown, context: { phase?: SubagentErrorPhase; provider?: string; model?: string; operation?: string; retryable?: boolean } = {}): SubagentErrorMetadata {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
        ? String((error as { message: unknown }).message)
        : String(error);
  const message = rawMessage || 'Unknown subagent failure';
  const lower = message.toLowerCase();
  const errorClass = error instanceof Error ? error.constructor.name : typeof error;
  let category: SubagentErrorCategory = 'unknown';
  if (!(error instanceof Error) && typeof error !== 'string') category = 'malformed_thrown_value';
  else if (/auth|api key|invalid key|unauthori[sz]ed|forbidden|401|403|credential/.test(lower)) category = 'provider_auth_error';
  else if (/context|token|maximum|length/.test(lower)) category = 'context_overflow';
  else if (/rate.?limit|quota|429|too many requests/.test(lower)) category = 'provider_rate_limit';
  else if (/econnreset|enotfound|network|socket|timeout|timed out|connection/.test(lower)) category = 'provider_network_error';
  else if (error instanceof Error) category = 'provider_api_error';
  return normalizeErrorMetadata({
    category,
    message,
    retryable: context.retryable,
    phase: context.phase,
    source: {
      provider: context.provider,
      model: context.model,
      operation: context.operation,
    },
    partial_result_available: false,
    details: { error_class: errorClass },
  });
}

export function classifyAssistantFailure(input: {
  stopReason?: string;
  errorMessage?: string;
  sawToolActivity?: boolean;
  provider?: string;
  model?: string;
}): SubagentErrorMetadata | undefined {
  if (input.stopReason === 'error' || input.errorMessage) {
    return classifyThrownError(new Error(input.errorMessage ?? 'Assistant error'), {
      phase: 'assistant_final',
      provider: input.provider,
      model: input.model,
      operation: 'session.prompt',
    });
  }
  if (input.sawToolActivity) {
    return normalizeErrorMetadata({
      category: 'empty_response_after_tools',
      message: 'Subagent completed tool execution but did not produce a final response.',
      phase: 'assistant_final',
      partial_result_available: false,
    });
  }
  return normalizeErrorMetadata({
    category: 'empty_response_no_tools',
    message: 'Subagent finished without a final response.',
    phase: 'assistant_final',
    partial_result_available: false,
  });
}

export function classifyFallbackFailure(primary: SubagentErrorMetadata, fallback?: SubagentErrorMetadata): SubagentErrorMetadata {
  return normalizeErrorMetadata({
    category: fallback ? 'fallback_failed' : 'unknown_fallback',
    message: fallback ? 'Subagent fallback failed.' : 'Subagent fallback unavailable after model failure.',
    retryable: false,
    partial_result_available: false,
    attempts: fallback
      ? [{ ...normalizeErrorMetadata(primary), role: 'primary' }, { ...normalizeErrorMetadata(fallback), role: 'fallback' }]
      : [{ ...normalizeErrorMetadata(primary), role: 'primary' }],
  });
}

export function enrichErrorMetadata(metadata: SubagentErrorMetadata, snapshot: {
  usage_at_failure?: UsageStats;
  last_activity?: string;
  partial_result_available?: boolean;
  task_id?: string;
  parent_session_id?: string;
}): SubagentErrorMetadata {
  return normalizeErrorMetadata({
    ...metadata,
    usage_at_failure: snapshot.usage_at_failure ?? metadata.usage_at_failure,
    last_activity: snapshot.last_activity ?? metadata.last_activity,
    partial_result_available: snapshot.partial_result_available ?? metadata.partial_result_available,
    task_id: snapshot.task_id ?? metadata.task_id,
    parent_session_id: snapshot.parent_session_id ?? metadata.parent_session_id,
  });
}

export function serializeErrorMetadata(metadata: unknown): string | null {
  try {
    return JSON.stringify(normalizeErrorMetadata(metadata as Partial<SubagentErrorMetadata>));
  } catch {
    return JSON.stringify(normalizeErrorMetadata({
      category: 'serialization_failure',
      message: 'Subagent error metadata could not be serialized safely.',
      phase: 'serializer',
      partial_result_available: false,
    }));
  }
}

export function parseErrorMetadata(json: unknown): SubagentErrorMetadata | undefined {
  try {
    if (typeof json !== 'string' || !json.trim()) return undefined;
    return normalizeErrorMetadata(JSON.parse(json) as Partial<SubagentErrorMetadata>);
  } catch {
    return undefined;
  }
}

export function safeErrorMetadataDetails(metadata: SubagentErrorMetadata): Record<string, unknown> {
  const normalized = normalizeErrorMetadata(metadata);
  return {
    version: normalized.version,
    category: normalized.category,
    retryable: normalized.retryable,
    phase: normalized.phase,
    code: normalized.code,
    source: normalized.source,
    partial_result_available: normalized.partial_result_available,
    details: normalized.details,
  };
}

export class SubagentStructuredError extends Error {
  readonly error_metadata: SubagentErrorMetadata;

  constructor(metadata: SubagentErrorMetadata) {
    const normalized = normalizeErrorMetadata(metadata);
    super(deriveErrorString(normalized));
    this.name = 'SubagentStructuredError';
    this.error_metadata = normalized;
  }
}
