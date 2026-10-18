import { readFileSync } from 'node:fs';
import { resolveConfigurationLocation, selectConfigurationScope, withConfigurationLocation, type ConfigurationScope } from './configuration-scope.ts';
import { isValidCandidateId } from './candidate-id.ts';
import { withExclusiveFileLock, writeJsonAtomic } from './atomic-json.ts';
import { validateModelEfforts, type ModelEffort } from './model-effort.ts';

/**
 * Per-project subagent configuration: whether automatic subagent model assignment is
 * enabled, how many model slots are visible, and the ordered model list the operator
 * assigned to subagents.
 *
 * Stored at `<supervisor dir>/subagents.json`, beside `supervisor.json` and scoped to one
 * project through the same flow identity. It is a separate document on purpose: this
 * feature is about subagents, not the main agent, so a broken or missing `subagents.json`
 * must never disable, rewrite or block the Orchestrator configuration, and the
 * Orchestrator's own host switch (`PI_SUPERVISOR_DISABLED`) must never rewrite it.
 *
 * Configuration only. The child-side assignment adapter consumes this document;
 * this storage module never intercepts launches, changes a model or calls a provider.
 */

export const SUBAGENT_CONFIG_VERSION = 1;
/** S3: the feature allows a minimum of 2 configured models. */
export const SUBAGENT_MODEL_COUNT_MIN = 2;
/** S3: and a maximum of 20. */
export const SUBAGENT_MODEL_COUNT_MAX = 20;
/** Implementation assumption: a fresh project starts disabled with five visible slots. */
export const SUBAGENT_MODEL_COUNT_DEFAULT = 5;

const CONFIG_LABEL = 'subagent configuration';

export interface SubagentConfig {
  /** False keeps the feature off: no subagent model preference applies. */
  enabled: boolean;
  /**
   * How many saved models the panel shows (2..20, default 5). The visible list is always
   * the first `modelCount` entries of `priorityCandidateIds`; the saved list itself is
   * never truncated by a count change.
   */
  modelCount: number;
  /**
   * The entire ordered list of models assigned to subagents, most preferred first, with
   * every nonempty entry distinct. Empty strings preserve unassigned slot positions.
   * The first `modelCount` entries fill the visible slots, the rest
   * stay stored and hidden. Empty means no model preference is configured.
   */
  priorityCandidateIds: string[];
  /**
   * Optional explicit reasoning effort per model, keyed by the full `<provider>/<modelId>`
   * candidate ID. Absent entirely on files written before this field existed, so an old
   * document stays valid; a present entry is validated strictly and never silently
   * truncated, including an entry for a model hidden by the current `modelCount`.
   */
  modelEfforts?: Record<string, ModelEffort>;
}

export const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
  enabled: false,
  modelCount: SUBAGENT_MODEL_COUNT_DEFAULT,
  priorityCandidateIds: [],
};
Object.freeze(DEFAULT_SUBAGENT_CONFIG.priorityCandidateIds);

export interface SubagentConfigLoad {
  config: SubagentConfig;
  /** Where the effective config came from: defaults, the stored file, or an unusable file. */
  source: 'default' | 'file' | 'invalid';
  /** Set only when `source` is `invalid`; the config is then the disabled default. */
  error?: string;
}

/**
 * Read-only view of the count bounds, so the panel can clamp its stepping without a second
 * hardcoded copy. Additive helper: the exported constants stay authoritative.
 */
export const SUBAGENT_CONFIG_RANGES = Object.freeze({
  modelCount: Object.freeze([SUBAGENT_MODEL_COUNT_MIN, SUBAGENT_MODEL_COUNT_MAX] as [number, number]),
});

export function resolveSubagentConfigPath(cwd: string, flowKey?: string): string {
  return resolveConfigurationLocation(cwd, 'subagents', flowKey).path;
}

/**
 * Reads a boolean field. An absent key keeps the documented default, so a hand-written
 * `{"enabled": true}` is valid; a present-but-unusable value is an error, because guessing
 * there would silently change which models the panel shows as active.
 */
function readBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new Error(`Malformed ${CONFIG_LABEL}: ${field} must be a boolean`);
  }
  return value;
}

function readModelCount(value: unknown): number {
  if (value === undefined) return SUBAGENT_MODEL_COUNT_DEFAULT;
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < SUBAGENT_MODEL_COUNT_MIN
    || value > SUBAGENT_MODEL_COUNT_MAX
  ) {
    throw new Error(`Malformed ${CONFIG_LABEL}: modelCount must be an integer between ${SUBAGENT_MODEL_COUNT_MIN} and ${SUBAGENT_MODEL_COUNT_MAX}`);
  }
  return value;
}

/**
 * S4: the saved list is validated as a whole, including the entries hidden by a smaller
 * `modelCount`, so a duplicate can never become visible later by raising the count. Order
 * is preserved exactly as the operator arranged it.
 */
function readPriorityCandidateIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Malformed ${CONFIG_LABEL}: priorityCandidateIds must be an array`);
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const slot of value) {
    // An empty string is an unassigned position, not a model identity.
    if (slot === '') { ids.push(''); continue; }
    if (!isValidCandidateId(slot)) {
      throw new Error(`Malformed ${CONFIG_LABEL}: invalid candidate ID "${String(slot)}"`);
    }
    if (seen.has(slot)) {
      throw new Error(`Malformed ${CONFIG_LABEL}: duplicate candidate ID "${slot}"`);
    }
    seen.add(slot);
    ids.push(slot);
  }
  return ids;
}

/**
 * S1/S2: validates the optional per-model effort map. `undefined` stays `undefined`
 * (compatible with files written before this field existed). Keys are validated as
 * candidate IDs with the same check as `priorityCandidateIds`, so a malformed key is
 * reported with the same wording as every other invalid candidate ID in this document.
 * No entry is ever dropped for being outside the active `modelCount`.
 */
function readModelEfforts(value: unknown): Record<string, ModelEffort> | undefined {
  const efforts = validateModelEfforts(value, CONFIG_LABEL);
  if (efforts === undefined) return undefined;
  for (const key of Object.keys(efforts)) {
    if (!isValidCandidateId(key)) {
      throw new Error(`Malformed ${CONFIG_LABEL}: invalid candidate ID "${key}" in modelEfforts`);
    }
  }
  return efforts;
}

/**
 * Normalizes a stored document to a usable config. An absent field keeps its default; a
 * present-but-unusable field is an error, so a damaged document is reported instead of
 * quietly reinterpreting what the operator assigned.
 */
export function validateSubagentConfig(value: unknown): SubagentConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Malformed ${CONFIG_LABEL}: expected root object`);
  }
  const raw = value as Record<string, unknown>;

  if (raw.version !== undefined && raw.version !== SUBAGENT_CONFIG_VERSION) {
    throw new Error(`Malformed ${CONFIG_LABEL}: unsupported version ${String(raw.version)}`);
  }

  const config: SubagentConfig = {
    enabled: readBoolean(raw.enabled, 'enabled', DEFAULT_SUBAGENT_CONFIG.enabled),
    modelCount: readModelCount(raw.modelCount),
    priorityCandidateIds: readPriorityCandidateIds(raw.priorityCandidateIds),
  };
  const modelEfforts = readModelEfforts(raw.modelEfforts);
  if (modelEfforts !== undefined) config.modelEfforts = modelEfforts;
  return config;
}

/**
 * The models that fill the visible slots: the first `modelCount` saved entries. With fewer
 * saved entries than the count only the existing entries are returned; this never invents
 * a model, and it never drops a hidden one from the document.
 */
export function getActiveSubagentCandidateIds(config: SubagentConfig): string[] {
  return config.priorityCandidateIds.slice(0, config.modelCount).filter(id => id !== '');
}

/** Reads the stored document. Throws on an unreadable or unusable document; never writes. */
function readStoredConfig(path: string): { config: SubagentConfig; source: 'file' | 'default' } {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { config: validateSubagentConfig(DEFAULT_SUBAGENT_CONFIG), source: 'default' };
    }
    throw new Error(`Failed to read ${CONFIG_LABEL}: ${err.message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Malformed ${CONFIG_LABEL}: invalid JSON`);
  }
  return { config: validateSubagentConfig(parsed), source: 'file' };
}

/**
 * Effective subagent configuration for one project. A stored document that cannot be
 * trusted is reported, never repaired: the effective config is then the disabled default,
 * because an unreadable switch must not leave a model preference looking active.
 *
 * Deliberately no environment override: `PI_SUPERVISOR_DISABLED` governs the main
 * Orchestrator and must not change what the Subagents view reports or stores.
 */
export function loadSubagentConfig(cwd: string, flowKey?: string): SubagentConfigLoad {
  try {
    const path = resolveSubagentConfigPath(cwd, flowKey);
    return readStoredConfig(path);
  } catch (err: any) {
    return {
      config: { ...DEFAULT_SUBAGENT_CONFIG, priorityCandidateIds: [] },
      source: 'invalid',
      error: err.message,
    };
  }
}

function persist(path: string, config: SubagentConfig): SubagentConfig {
  const next = validateSubagentConfig({ version: SUBAGENT_CONFIG_VERSION, ...config });
  writeJsonAtomic(path, { version: SUBAGENT_CONFIG_VERSION, ...next }, CONFIG_LABEL);
  return next;
}

/**
 * Applies a partial change to the stored document and returns the persisted configuration,
 * so the panel can render exactly what reached disk.
 *
 * Re-reads inside the exclusive lock, so a concurrent writer is never clobbered, and
 * refuses to write over a document it cannot trust: silently replacing an unusable file
 * would hide a failure the operator has not seen yet. A rejected patch (bad count, an
 * invalid or duplicate model) throws before `writeJsonAtomic`, so the stored bytes stay
 * exactly as they were.
 */
export function updateSubagentConfig(cwd: string, patch: Partial<SubagentConfig>, flowKey?: string): SubagentConfig {
  return withConfigurationLocation(cwd, 'subagents', flowKey, ({ path }) => withExclusiveFileLock(path, CONFIG_LABEL, () => {
    const stored = readStoredConfig(path);
    return persist(path, { ...stored.config, ...patch });
  }));
}

/** Select a complete destination document, preserving every other source unchanged. */
export function selectSubagentConfigScope(cwd: string, scope: ConfigurationScope, flowKey?: string) {
  const selected = selectConfigurationScope(cwd, 'subagents', scope, readStoredConfig, flowKey);
  return { ...selected.value, location: selected.location };
}
