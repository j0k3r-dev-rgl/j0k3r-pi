import { readFileSync } from 'node:fs';
import { resolveConfigurationLocation, selectConfigurationScope, withConfigurationLocation, type ConfigurationScope } from './configuration-scope.ts';
import { isValidCandidateId } from './candidate-id.ts';
import { withExclusiveFileLock, writeJsonAtomic } from './atomic-json.ts';
import { validateModelEfforts, type ModelEffort } from './model-effort.ts';

/**
 * Per-project supervisor configuration: whether the supervisor runs at all, the priority
 * slots that drive automatic routing, and the thresholds the panel exposes.
 *
 * Stored at `<supervisor dir>/supervisor.json`, next to `state.json`, so the flag is
 * scoped to one project (the flow identity hashes the working directory) instead of the
 * whole machine.
 */

export const SUPERVISOR_MODEL_COUNT_DEFAULT = 5;

const CONFIG_LABEL = 'supervisor configuration';
const VERSION = 1;

export interface SupervisorConfig {
  /** False stops the runtime: no routing, no retries, no rotation. */
  enabled: boolean;
  /** Automatic rotation at the measured boundary. False only disables the threshold trigger. */
  autoRotate: boolean;
  /** Automatic model assignment (startup, failover, provider recovery). */
  autoSwitchModel: boolean;
  /** Context percentage that asks for a rotation. */
  rotationThresholdPercent: number;
  /** Codex window percentage above which a route is not eligible. */
  codexQuotaThresholdPercent: number;
  /** Consecutive provider failures before a route goes into cooldown. */
  maxTransientFailures: number;
  /** Cooldown length after those failures. */
  cooldownMinutes: number;
  /** Account/quota inventory polling period. */
  pollIntervalSeconds: number;
  /**
   * How many of the saved priority entries are active (2..10, default 5). The active pool
   * is always the first `modelCount` entries of `priorityCandidateIds`.
   */
  modelCount: number;
  /**
   * The entire ordered routing priority list, most important first. Never truncated by a
   * `modelCount` change: the first active entries drive routing, the rest stay stored.
   * Empty means "use computed order".
   */
  priorityCandidateIds: string[];
  /**
   * Optional explicit reasoning effort per model, keyed by the full `<provider>/<modelId>`
   * candidate ID. Absent entirely on files written before this field existed, so an old
   * document stays valid; a present entry is validated strictly and never silently
   * truncated, including entries for a model outside the active routing slots (S2).
   * Absence of a specific key preserves the prior runtime behaviour for that model
   * (Orchestrator defaults to `high`).
   */
  modelEfforts?: Record<string, ModelEffort>;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  enabled: true,
  autoRotate: true,
  autoSwitchModel: true,
  rotationThresholdPercent: 90,
  codexQuotaThresholdPercent: 95,
  maxTransientFailures: 3,
  cooldownMinutes: 15,
  pollIntervalSeconds: 60,
  modelCount: SUPERVISOR_MODEL_COUNT_DEFAULT,
  priorityCandidateIds: [],
};
Object.freeze(DEFAULT_SUPERVISOR_CONFIG.priorityCandidateIds);

export interface SupervisorConfigLoad {
  config: SupervisorConfig;
  /** Where the effective config came from: defaults, the stored file, or an unusable file. */
  source: 'default' | 'file' | 'invalid';
  /** Set only when `source` is `invalid`; the config is then the disabled default. */
  error?: string;
}

const INT_RANGES: Record<'rotationThresholdPercent' | 'codexQuotaThresholdPercent' | 'maxTransientFailures' | 'cooldownMinutes' | 'pollIntervalSeconds' | 'modelCount', [number, number]> = {
  rotationThresholdPercent: [1, 99],
  codexQuotaThresholdPercent: [1, 100],
  maxTransientFailures: [1, 10],
  cooldownMinutes: [1, 1440],
  pollIntervalSeconds: [5, 3600],
  modelCount: [2, 10],
};

/**
 * Read-only view of the integer ranges above, so the control panel can clamp its
 * stepping without a second hardcoded copy. Additive only: `INT_RANGES` and every
 * behaviour built on it stay untouched. Includes `modelCount` (2..10).
 */
export const SUPERVISOR_CONFIG_RANGES = INT_RANGES;

export function resolveSupervisorConfigPath(cwd: string, flowKey?: string): string {
  return resolveConfigurationLocation(cwd, 'supervisor', flowKey).path;
}

/**
 * Reads a boolean field. An absent key keeps the documented default, so files written
 * before the field existed stay valid; a present-but-unusable value is an error, because
 * guessing there would silently change which automatic actions run.
 */
function readBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new Error(`Malformed ${CONFIG_LABEL}: ${field} must be a boolean`);
  }
  return value;
}

/**
 * Normalizes a stored document to a usable config. An absent field keeps its default
 * (a hand-written `{"enabled": false}` is valid); a present-but-unusable field is an
 * error, because guessing there would silently change what the supervisor does.
 */
export function validateSupervisorConfig(value: unknown): SupervisorConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Malformed ${CONFIG_LABEL}: expected root object`);
  }
  const raw = value as Record<string, unknown>;

  if (raw.version !== undefined && raw.version !== VERSION) {
    throw new Error(`Malformed ${CONFIG_LABEL}: unsupported version ${String(raw.version)}`);
  }

  const config: SupervisorConfig = {
    enabled: readBoolean(raw.enabled, 'enabled', DEFAULT_SUPERVISOR_CONFIG.enabled),
    autoRotate: readBoolean(raw.autoRotate, 'autoRotate', DEFAULT_SUPERVISOR_CONFIG.autoRotate),
    autoSwitchModel: readBoolean(raw.autoSwitchModel, 'autoSwitchModel', DEFAULT_SUPERVISOR_CONFIG.autoSwitchModel),
    rotationThresholdPercent: DEFAULT_SUPERVISOR_CONFIG.rotationThresholdPercent,
    codexQuotaThresholdPercent: DEFAULT_SUPERVISOR_CONFIG.codexQuotaThresholdPercent,
    maxTransientFailures: DEFAULT_SUPERVISOR_CONFIG.maxTransientFailures,
    cooldownMinutes: DEFAULT_SUPERVISOR_CONFIG.cooldownMinutes,
    pollIntervalSeconds: DEFAULT_SUPERVISOR_CONFIG.pollIntervalSeconds,
    modelCount: DEFAULT_SUPERVISOR_CONFIG.modelCount,
    priorityCandidateIds: [],
  };

  for (const [field, [min, max]] of Object.entries(INT_RANGES) as Array<[keyof typeof INT_RANGES, [number, number]]>) {
    const candidate = raw[field];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate < min || candidate > max) {
      throw new Error(`Malformed ${CONFIG_LABEL}: ${field} must be an integer between ${min} and ${max}`);
    }
    config[field] = candidate;
  }

  const slots = raw.priorityCandidateIds;
  if (slots !== undefined) {
    if (!Array.isArray(slots)) {
      throw new Error(`Malformed ${CONFIG_LABEL}: priorityCandidateIds must be an array`);
    }
    // The whole ordered list is stored. `modelCount` bounds only the active prefix, so a
    // longer list is valid and changing the count never deletes a saved entry.
    const seen = new Set<string>();
    for (const slot of slots) {
      if (!isValidCandidateId(slot)) {
        throw new Error(`Malformed ${CONFIG_LABEL}: invalid candidate ID "${String(slot)}"`);
      }
      if (seen.has(slot)) {
        throw new Error(`Malformed ${CONFIG_LABEL}: duplicate candidate ID "${slot}"`);
      }
      seen.add(slot);
    }
    config.priorityCandidateIds = [...slots];
  }

  const efforts = validateModelEfforts(raw.modelEfforts, CONFIG_LABEL);
  if (efforts !== undefined) {
    for (const key of Object.keys(efforts)) {
      if (!isValidCandidateId(key)) {
        throw new Error(`Malformed ${CONFIG_LABEL}: invalid candidate ID "${key}" in modelEfforts`);
      }
    }
    config.modelEfforts = efforts;
  }

  return config;
}

/**
 * The candidates that drive automatic routing: the first `modelCount` saved entries. With
 * fewer saved entries than the count, only the existing entries are returned; this never
 * invents a model. An empty list means no automatic routing.
 */
export function getActiveCandidateIds(config: SupervisorConfig): string[] {
  return config.priorityCandidateIds.slice(0, config.modelCount);
}

/** Reads the stored file. Throws on an unreadable or unusable document; never writes. */
function readStoredConfig(path: string): { config: SupervisorConfig; source: 'file' | 'default' } {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { config: validateSupervisorConfig(DEFAULT_SUPERVISOR_CONFIG), source: 'default' };
    }
    throw new Error(`Failed to read ${CONFIG_LABEL}: ${err.message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Malformed ${CONFIG_LABEL}: invalid JSON`);
  }
  return { config: validateSupervisorConfig(parsed), source: 'file' };
}

/**
 * Effective configuration for one project. A stored file that cannot be trusted is
 * reported, never repaired: the effective config is then the *disabled* default, because
 * an unreadable control must not silently leave automatic actions running.
 */
export function loadSupervisorConfig(cwd: string, flowKey?: string): SupervisorConfigLoad {
  try {
    const path = resolveSupervisorConfigPath(cwd, flowKey);
    const { config, source } = readStoredConfig(path);
    if (process.env.PI_SUPERVISOR_DISABLED === '1') {
      return { config: { ...config, enabled: false }, source };
    }
    return { config, source };
  } catch (err: any) {
    return {
      config: { ...DEFAULT_SUPERVISOR_CONFIG, priorityCandidateIds: [], enabled: false },
      source: 'invalid',
      error: err.message,
    };
  }
}

export function isSupervisorEnabled(cwd: string, flowKey?: string): boolean {
  return loadSupervisorConfig(cwd, flowKey).config.enabled;
}

function persist(path: string, config: SupervisorConfig): SupervisorConfig {
  const next = validateSupervisorConfig({ version: VERSION, ...config });
  writeJsonAtomic(path, { version: VERSION, ...next }, CONFIG_LABEL);
  return next;
}

/**
 * Replaces the whole stored document. Like `updateSupervisorConfig`, it refuses to write
 * over a document it cannot trust: silently replacing an unusable file would paper over a
 * failure the operator has not seen yet.
 */
export function saveSupervisorConfig(cwd: string, config: SupervisorConfig, flowKey?: string): SupervisorConfig {
  return withConfigurationLocation(cwd, 'supervisor', flowKey, ({ path }) => withExclusiveFileLock(path, CONFIG_LABEL, () => {
    readStoredConfig(path);
    return persist(path, config);
  }));
}

/**
 * Applies a partial change to the stored document. Re-reads inside the lock so a
 * concurrent writer cannot be clobbered, and refuses to overwrite an unusable file.
 */
export function updateSupervisorConfig(cwd: string, patch: Partial<SupervisorConfig>, flowKey?: string): SupervisorConfig {
  return withConfigurationLocation(cwd, 'supervisor', flowKey, ({ path }) => withExclusiveFileLock(path, CONFIG_LABEL, () => {
    const stored = readStoredConfig(path);
    return persist(path, { ...stored.config, ...patch });
  }));
}

/** Select a complete destination document, preserving every other source unchanged. */
export function selectSupervisorConfigScope(cwd: string, scope: ConfigurationScope, flowKey?: string) {
  const selected = selectConfigurationScope(cwd, 'supervisor', scope, readStoredConfig, flowKey);
  return { ...selected.value, location: selected.location };
}
