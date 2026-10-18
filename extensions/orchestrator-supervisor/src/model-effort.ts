/**
 * Per-model reasoning effort: the union, storage validation, and capability discovery
 * shared by the Orchestrator and Subagents configuration documents.
 *
 * `ModelEffort` deliberately mirrors the host's `ModelThinkingLevel` exactly
 * (`off, minimal, low, medium, high, xhigh, max`): this module never invents a level the
 * host does not already define, and `supportedModelEfforts` only ever reports levels the
 * public capability resolver actually proved for the concrete model.
 */

export const MODEL_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ModelEffort = typeof MODEL_EFFORTS[number];

const MODEL_EFFORT_SET: ReadonlySet<string> = new Set(MODEL_EFFORTS);

export function isModelEffort(value: unknown): value is ModelEffort {
  return typeof value === 'string' && MODEL_EFFORT_SET.has(value);
}

/**
 * Validates a stored `modelEfforts` map. `undefined` is a valid, compatible absence (old
 * files stay valid); every other shape is validated strictly. Keys are not re-validated as
 * candidate IDs here, so callers can apply their own existing ID checks (and existing
 * invalid-ID error wording) to the same keys; this function only enforces that keys are
 * non-empty strings and values are one of `MODEL_EFFORTS`. No entry is ever dropped or
 * truncated: every provided key/value pair is validated and returned.
 */
export function validateModelEfforts(value: unknown, label = 'model efforts'): Record<string, ModelEffort> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Malformed ${label}: expected an object`);
  }
  const raw = value as Record<string, unknown>;
  const result: Record<string, ModelEffort> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error(`Malformed ${label}: invalid model ID "${String(key)}"`);
    }
    if (!isModelEffort(entry)) {
      throw new Error(`Malformed ${label}: unsupported effort "${String(entry)}" for "${key}"`);
    }
    result[key] = entry;
  }
  return result;
}

/**
 * Public-host-proven thinking levels for one concrete model, or `[]` when the host
 * capability resolver is unavailable (an older host, or a standalone non-Pi process).
 * Never infers support from a model name or provider: an unavailable resolver means the
 * panel offers Default only, exactly as an unknown capability should.
 */
export interface ThinkingCapableModel {
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null | undefined>;
  [key: string]: unknown;
}

export type SupportedThinkingLevelsResolver = (model: ThinkingCapableModel) => readonly string[];

let cachedResolver: SupportedThinkingLevelsResolver | undefined | null = null;

/**
 * Loads `getSupportedThinkingLevels` from the public `@earendil-works/pi-ai/compat` host
 * module. Cached after the first attempt (success or failure) for this process; a
 * standalone node test without that host module keeps getting `undefined`, never a thrown
 * error, so capability discovery degrades to Default without breaking startup.
 */
async function loadSupportedThinkingLevelsResolver(): Promise<SupportedThinkingLevelsResolver | undefined> {
  if (cachedResolver !== null) return cachedResolver ?? undefined;
  try {
    const mod: any = await import('@earendil-works/pi-ai/compat');
    const fn = mod?.getSupportedThinkingLevels;
    cachedResolver = typeof fn === 'function' ? fn : undefined;
  } catch {
    cachedResolver = undefined;
  }
  return cachedResolver ?? undefined;
}

/** Test-only seam: forces the next resolution to reload the module. */
export function resetSupportedModelEffortsCacheForTests(): void {
  cachedResolver = null;
}

/**
 * The efforts a concrete registry model actually supports, proven by the public host
 * resolver. Returns `[]` (Default only) when the resolver is unavailable, when the model
 * is missing/unusable, or when the resolver itself throws: a capability failure must never
 * throw into a caller or guess a level the host never confirmed.
 *
 * `resolver` is an optional test seam: a standalone node test without the real
 * `@earendil-works/pi-ai` dependency can inject a fake `getSupportedThinkingLevels` to
 * exercise the "capability available" path without that host package. Production callers
 * never pass it, so the real dynamic import stays the only production path.
 */
export async function supportedModelEfforts(model: unknown, resolver?: SupportedThinkingLevelsResolver): Promise<ModelEffort[]> {
  if (!model || typeof model !== 'object') return [];
  const resolve = resolver ?? await loadSupportedThinkingLevelsResolver();
  if (!resolve) return [];
  try {
    const levels = resolve(model as ThinkingCapableModel);
    if (!Array.isArray(levels)) return [];
    return levels.filter(isModelEffort);
  } catch {
    return [];
  }
}
