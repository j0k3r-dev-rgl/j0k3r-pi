import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeFlowIdentity, resolveSupervisorDir } from './config.ts';
import { isValidCandidateId } from './candidate-id.ts';
import { withExclusiveFileLock, writeJsonAtomic } from './atomic-json.ts';

/**
 * Cross-process least-loaded sharing pool for subagent model assignment.
 *
 * The short-lived consumer asks the pool for one of the selected model IDs;
 * the pool records a live lease in `<supervisor dir>/subagent-pool.json`
 * and returns the least-loaded eligible candidate. All coordination goes through that one
 * versioned document under the shared exclusive file lock, so independent children
 * count each other's reservations before selecting a model and never lose peer leases.
 *
 * Sharing is explicit policy (selection token least_loaded_share): when every candidate
 * already has an active lease the least-loaded one is handed out again immediately. Nothing
 * here waits for capacity, discovers quotas, reserves exclusivity or switches a model in the
 * middle of a request. Manual release and liveness pruning are the only ways a lease goes away.
 *
 * Storage is reused read-only surface: identity/path from `config.ts` and the locked atomic
 * private writer from `atomic-json.ts` are used exactly as the existing configuration code
 * uses them; no shared helper is modified and no second storage mechanism is introduced.
 *
 * A damaged document is reported, never repaired: both operations throw and leave the bytes
 * untouched, because silently rewriting state that assigns models would hide the failure from
 * the operator and could strand or duplicate leases. Locks are bounded and surface an explicit
 * error instead of waiting, and a held lock is never force-deleted.
 * Pruning removes a lease only when `process.kill(pid, 0)` proves ESRCH;
 * EPERM or any unexpected liveness outcome is uncertain and the lease stays occupied.
 */

const POOL_LABEL = 'subagent pool';

export const SUBAGENT_POOL_VERSION = 1;

export interface SubagentPoolLease {
  /** Opaque, unique per lease; the handle used to release exactly this reservation. */
  token: string;
  /** A selected model ID from the caller's candidate list. */
  modelId: string;
  /** Owning process; liveness is checked against this PID only. */
  pid: number;
  /** Owning Pi session within that process. */
  sessionId: string;
  acquiredAt: number;
}

export interface SubagentPoolState {
  version: number;
  leases: SubagentPoolLease[];
  /** Per-model assignment counter, persisted so ties keep rotating across processes. */
  rotation: Record<string, number>;
}

export interface SubagentPoolOwner {
  pid: number;
  sessionId: string;
}

export interface SubagentPoolLeaseRef {
  token: string;
  modelId: string;
}

export interface AcquiredSubagentModel {
  token: string;
  modelId: string;
}

const ROOT_FIELDS = ['version', 'leases', 'rotation'] as const;
const LEASE_FIELDS = ['token', 'modelId', 'pid', 'sessionId', 'acquiredAt'] as const;

export function resolveSubagentPoolPath(cwd: string, flowKey?: string): string {
  return join(resolveSupervisorDir(computeFlowIdentity(cwd, flowKey)), 'subagent-pool.json');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(raw: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw new Error(`Malformed ${POOL_LABEL}: unexpected field "${key}" in ${where}`);
    }
  }
}

function readStoredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Malformed ${POOL_LABEL}: ${field} must be a positive integer`);
  }
  return value;
}

function readStoredNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Malformed ${POOL_LABEL}: ${field} must be a non-empty string`);
  }
  return value;
}

function readStoredModelId(value: unknown, field: string): string {
  if (!isValidCandidateId(value)) {
    throw new Error(`Malformed ${POOL_LABEL}: ${field} must be a valid candidate ID`);
  }
  return value;
}

/**
 * Strict shape check for the stored document. Every field is required with an exact type, a
 * lease may not carry unknown keys, tokens and owner identities must be unique, and the
 * rotation map may only mention valid candidate IDs with non-negative integer counters.
 */
export function validateSubagentPoolState(value: unknown): SubagentPoolState {
  if (!isPlainObject(value)) {
    throw new Error(`Malformed ${POOL_LABEL}: expected root object`);
  }
  assertExactKeys(value, ROOT_FIELDS, 'pool');
  if (value.version !== SUBAGENT_POOL_VERSION) {
    throw new Error(`Malformed ${POOL_LABEL}: unsupported version ${String(value.version)}`);
  }
  if (!Array.isArray(value.leases)) {
    throw new Error(`Malformed ${POOL_LABEL}: leases must be an array`);
  }

  const tokens = new Set<string>();
  const owners = new Set<string>();
  const leases: SubagentPoolLease[] = value.leases.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new Error(`Malformed ${POOL_LABEL}: lease ${index} must be an object`);
    }
    assertExactKeys(entry, LEASE_FIELDS, `lease ${index}`);
    const token = readStoredNonEmptyString(entry.token, `lease ${index} token`);
    if (tokens.has(token)) {
      throw new Error(`Malformed ${POOL_LABEL}: duplicate lease token`);
    }
    tokens.add(token);
    const modelId = readStoredModelId(entry.modelId, `lease ${index} modelId`);
    const pid = readStoredPositiveInteger(entry.pid, `lease ${index} pid`);
    const sessionId = readStoredNonEmptyString(entry.sessionId, `lease ${index} sessionId`);
    const ownerKey = `${pid}:${sessionId}`;
    if (owners.has(ownerKey)) {
      throw new Error(`Malformed ${POOL_LABEL}: duplicate lease owner`);
    }
    owners.add(ownerKey);
    const acquiredAt = readStoredPositiveInteger(entry.acquiredAt, `lease ${index} acquiredAt`);
    return { token, modelId, pid, sessionId, acquiredAt };
  });

  if (!isPlainObject(value.rotation)) {
    throw new Error(`Malformed ${POOL_LABEL}: rotation must be an object`);
  }
  const rotation: Record<string, number> = {};
  for (const [modelId, counter] of Object.entries(value.rotation)) {
    if (!isValidCandidateId(modelId)) {
      throw new Error(`Malformed ${POOL_LABEL}: rotation key must be a valid candidate ID`);
    }
    if (typeof counter !== 'number' || !Number.isInteger(counter) || counter < 0) {
      throw new Error(`Malformed ${POOL_LABEL}: rotation count must be a non-negative integer`);
    }
    rotation[modelId] = counter;
  }

  return { version: SUBAGENT_POOL_VERSION, leases, rotation };
}

/** Caller-supplied input validation; a refusal happens before any lock or file access. */
function validateCandidateIds(candidateIds: unknown): string[] {
  if (!Array.isArray(candidateIds)) {
    throw new Error('Subagent pool: candidateIds must be an array');
  }
  if (candidateIds.length === 0) {
    throw new Error('Subagent pool: at least one candidate model is required');
  }
  const seen = new Set<string>();
  for (const id of candidateIds) {
    if (!isValidCandidateId(id)) {
      throw new Error(`Subagent pool: invalid candidate ID "${String(id)}"`);
    }
    if (seen.has(id)) {
      throw new Error(`Subagent pool: duplicate candidate ID "${id}"`);
    }
    seen.add(id);
  }
  return candidateIds as string[];
}

function validateOwner(owner: unknown): SubagentPoolOwner {
  if (!isPlainObject(owner)) {
    throw new Error('Subagent pool: owner must be an object with pid and sessionId');
  }
  if (typeof owner.pid !== 'number' || !Number.isInteger(owner.pid) || owner.pid <= 0) {
    throw new Error('Subagent pool: owner pid must be a positive integer');
  }
  if (typeof owner.sessionId !== 'string' || owner.sessionId.length === 0) {
    throw new Error('Subagent pool: owner sessionId must be a non-empty string');
  }
  return { pid: owner.pid, sessionId: owner.sessionId };
}

function validateLeaseRef(lease: unknown): SubagentPoolLeaseRef {
  if (!isPlainObject(lease)) {
    throw new Error('Subagent pool: lease must be an object with token and modelId');
  }
  if (typeof lease.token !== 'string' || lease.token.length === 0) {
    throw new Error('Subagent pool: lease token must be a non-empty string');
  }
  if (!isValidCandidateId(lease.modelId)) {
    throw new Error('Subagent pool: lease modelId must be a valid candidate ID');
  }
  return { token: lease.token, modelId: lease.modelId };
}

function emptyState(): SubagentPoolState {
  return { version: SUBAGENT_POOL_VERSION, leases: [], rotation: {} };
}

/** Reads the stored document. A missing file is an empty pool; a damaged one throws. */
function readState(path: string): SubagentPoolState {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return emptyState();
    throw new Error(`Failed to read ${POOL_LABEL}: ${err.message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Malformed ${POOL_LABEL}: invalid JSON`);
  }
  return validateSubagentPoolState(parsed);
}

function writeState(path: string, state: SubagentPoolState): void {
  writeJsonAtomic(
    path,
    { version: SUBAGENT_POOL_VERSION, leases: state.leases, rotation: state.rotation },
    POOL_LABEL,
  );
}

/** True only when the OS proves the process is gone; every other outcome is uncertain. */
function isProcessGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err: any) {
    return err?.code === 'ESRCH';
  }
}

function pruneDeadLeases(state: SubagentPoolState): { state: SubagentPoolState; changed: boolean } {
  const survivors = state.leases.filter(lease => !isProcessGone(lease.pid));
  if (survivors.length === state.leases.length) return { state, changed: false };
  return { state: { version: state.version, leases: survivors, rotation: state.rotation }, changed: true };
}

/**
 * Least-loaded choice restricted to the selected unique candidates: lowest active lease
 * count first, then the lowest persisted rotation counter, then the caller's order as the
 * final stable tie-break. Because the counter is bumped on every assignment, equally loaded
 * candidates keep rotating instead of sticking to one model.
 */
function selectLeastLoaded(candidateIds: string[], leases: SubagentPoolLease[], rotation: Record<string, number>): string {
  const loads = new Map<string, number>(candidateIds.map(id => [id, 0]));
  for (const lease of leases) {
    const load = loads.get(lease.modelId);
    if (load !== undefined) loads.set(lease.modelId, load + 1);
  }

  let selected = candidateIds[0];
  let selectedLoad = Number.POSITIVE_INFINITY;
  let selectedRotation = Number.POSITIVE_INFINITY;
  for (const id of candidateIds) {
    const load = loads.get(id) ?? 0;
    const counter = rotation[id] ?? 0;
    if (load < selectedLoad || (load === selectedLoad && counter < selectedRotation)) {
      selected = id;
      selectedLoad = load;
      selectedRotation = counter;
    }
  }
  return selected;
}

/**
 * Acquires one model for `owner` from the supplied candidate list.
 *
 * Idempotent per owner/session: if this owner already holds a lease for a candidate that is
 * still selected, that exact lease is returned and the file is not rewritten. If the owner's
 * held model is no longer among the candidates the call is refused with the stable
 * `existing_lease_outside_candidates` code, without creating a second lease: the caller must
 * release first, so no lease is leaked and no held model is disclosed.
 *
 * Sharing is intentional and immediate: an already-loaded candidate is still eligible, and
 * no call waits for another lease to free up.
 */
export function acquireSubagentModel(cwd: string, candidateIds: string[], owner: SubagentPoolOwner): AcquiredSubagentModel {
  const candidates = validateCandidateIds(candidateIds);
  const normalizedOwner = validateOwner(owner);
  const path = resolveSubagentPoolPath(cwd);

  return withExclusiveFileLock(path, POOL_LABEL, () => {
    const loaded = readState(path);
    const pruned = pruneDeadLeases(loaded);
    const state = pruned.state;

    const existing = state.leases.find(
      lease => lease.pid === normalizedOwner.pid && lease.sessionId === normalizedOwner.sessionId,
    );
    if (existing) {
      if (!candidates.includes(existing.modelId)) {
        const error: any = new Error('Subagent pool: the owner already holds a lease outside the supplied candidates');
        error.code = 'existing_lease_outside_candidates';
        throw error;
      }
      // Persist pruning even when the owner's own lease is unchanged, so a dead peer is
      // reclaimed by whichever live session asks next.
      if (pruned.changed) writeState(path, state);
      return { token: existing.token, modelId: existing.modelId };
    }

    const modelId = selectLeastLoaded(candidates, state.leases, state.rotation);
    const lease: SubagentPoolLease = {
      token: randomUUID(),
      modelId,
      pid: normalizedOwner.pid,
      sessionId: normalizedOwner.sessionId,
      acquiredAt: Date.now(),
    };
    const next: SubagentPoolState = {
      version: SUBAGENT_POOL_VERSION,
      leases: [...state.leases, lease],
      rotation: { ...state.rotation, [modelId]: (state.rotation[modelId] ?? 0) + 1 },
    };
    writeState(path, next);
    return { token: lease.token, modelId };
  });
}

/**
 * Releases a lease previously handed to `owner`.
 *
 * Idempotent: an unknown token (already released, pruned, or a project without a pool) is a
 * no-op, so a retried cleanup never throws. The release is accepted only when the stored
 * lease belongs to the same owner and describes the same model; otherwise it is refused and
 * the lease stays active, so one session can never free another session's reservation.
 */
export function releaseSubagentModel(cwd: string, lease: SubagentPoolLeaseRef, owner: SubagentPoolOwner): void {
  const ref = validateLeaseRef(lease);
  const normalizedOwner = validateOwner(owner);
  const path = resolveSubagentPoolPath(cwd);

  withExclusiveFileLock(path, POOL_LABEL, () => {
    const state = readState(path);
    const index = state.leases.findIndex(entry => entry.token === ref.token);
    if (index < 0) return;

    const found = state.leases[index];
    if (
      found.pid !== normalizedOwner.pid
      || found.sessionId !== normalizedOwner.sessionId
      || found.modelId !== ref.modelId
    ) {
      throw new Error('Subagent pool: the lease does not belong to this owner');
    }

    const leases = state.leases.filter((_, position) => position !== index);
    writeState(path, { version: state.version, leases, rotation: state.rotation });
  });
}
