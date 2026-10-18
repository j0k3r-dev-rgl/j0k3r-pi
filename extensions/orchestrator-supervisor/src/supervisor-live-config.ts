import { getActiveCandidateIds, type SupervisorConfig } from './supervisor-config.ts';

/**
 * The collaborators a running supervisor must update when the panel changes the stored
 * configuration (S6).
 *
 * The panel edits the project's file, but a runtime reads its configuration only when it is
 * created. Without this step a change would silently wait for the next reload, and the
 * panel would describe a policy that is not the one in force. The target is declared
 * structurally rather than as the extension runtime so the rule can be tested without a
 * session, a terminal or a network.
 */
export interface LiveSupervisorConfigTarget {
  quotas: {
    setPriorityCandidateIds(ids: string[]): void;
    setCodexQuotaThresholdPercent(percent: number): void;
  };
  guard: { setRotationThresholdPercent(percent: number): void; setAutoRotate(enabled: boolean): void };
  errors: { setFailurePolicy(policy: { maxTransientFailures: number; cooldownMs: number }): void };
  /** Adopts the automatic model-assignment capability change (startup, failover, recovery). */
  setAutoSwitchModel(enabled: boolean): void;
  /** Interval the running poll timer was created with, in milliseconds. */
  pollMs: number;
  /** Replaces the running poll timer. Called only when the interval really changed. */
  restartPollTimer(intervalMs: number): void;
}

/** Applies a persisted configuration to a runtime that is already running. */
export function applyLiveSupervisorConfig(target: LiveSupervisorConfigTarget, config: SupervisorConfig): void {
  // Only the first `modelCount` saved entries are active; hidden entries stay stored.
  target.quotas.setPriorityCandidateIds(getActiveCandidateIds(config));
  target.quotas.setCodexQuotaThresholdPercent(config.codexQuotaThresholdPercent);
  target.guard.setRotationThresholdPercent(config.rotationThresholdPercent);
  // The capability switches are adopted before any later poll or boundary decision.
  target.guard.setAutoRotate(config.autoRotate);
  target.setAutoSwitchModel(config.autoSwitchModel);
  target.errors.setFailurePolicy({
    maxTransientFailures: config.maxTransientFailures,
    cooldownMs: config.cooldownMinutes * 60_000,
  });

  const intervalMs = config.pollIntervalSeconds * 1000;
  // Restarting an unchanged timer would drop nothing but would reset its phase: skip it.
  if (target.pollMs !== intervalMs) target.restartPollTimer(intervalMs);
}
