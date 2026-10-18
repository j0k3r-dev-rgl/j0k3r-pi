import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLiveSupervisorConfig } from '../src/supervisor-live-config.ts';
import { DEFAULT_SUPERVISOR_CONFIG, type SupervisorConfig } from '../src/supervisor-config.ts';

/** Records what a live runtime was told to adopt, without needing a session or a terminal. */
function target(pollMs = 60000) {
  const calls = { priority: [] as string[][], quota: [] as number[], rotation: [] as number[], policy: [] as any[], timers: [] as number[], capabilities: [] as Array<[string, boolean]> };
  return {
    calls,
    target: {
      quotas: {
        setPriorityCandidateIds: (ids: string[]) => { calls.priority.push(ids); },
        setCodexQuotaThresholdPercent: (percent: number) => { calls.quota.push(percent); },
      },
      guard: {
        setRotationThresholdPercent: (percent: number) => { calls.rotation.push(percent); },
        setAutoRotate: (enabled: boolean) => { calls.capabilities.push(['autoRotate', enabled]); },
      },
      errors: { setFailurePolicy: (policy: any) => { calls.policy.push(policy); } },
      setAutoSwitchModel: (enabled: boolean) => { calls.capabilities.push(['autoSwitchModel', enabled]); },
      pollMs,
      restartPollTimer: (intervalMs: number) => { calls.timers.push(intervalMs); },
    },
  };
}

test('LIVE-CONFIG-001: every configured value reaches its live collaborator', () => {
  const { target: live, calls } = target();
  const next: SupervisorConfig = {
    ...DEFAULT_SUPERVISOR_CONFIG,
    rotationThresholdPercent: 70,
    codexQuotaThresholdPercent: 80,
    maxTransientFailures: 2,
    cooldownMinutes: 5,
    pollIntervalSeconds: 30,
    modelCount: 2,
    priorityCandidateIds: ['cliproxyapi/main/gpt-6.1-sol', 'cliproxyapi/second/gpt-6.1-sol', 'cliproxyapi/third/gpt-6.1-sol'],
  };

  applyLiveSupervisorConfig(live, next);

  // Only the first modelCount saved entries are active; the rest stay stored, unapplied.
  assert.deepEqual(calls.priority, [['cliproxyapi/main/gpt-6.1-sol', 'cliproxyapi/second/gpt-6.1-sol']]);
  assert.deepEqual(calls.quota, [80]);
  assert.deepEqual(calls.rotation, [70]);
  // Cooldown is stored in minutes and used in milliseconds.
  assert.deepEqual(calls.policy, [{ maxTransientFailures: 2, cooldownMs: 300000 }]);
  assert.deepEqual(calls.timers, [30000]);
});

test('LIVE-CONFIG-003: both capability switches reach the live runtime', () => {
  const { target: live, calls } = target();

  applyLiveSupervisorConfig(live, { ...DEFAULT_SUPERVISOR_CONFIG, autoRotate: false, autoSwitchModel: false });
  assert.deepEqual(calls.capabilities, [['autoRotate', false], ['autoSwitchModel', false]]);
});

test('LIVE-CONFIG-002: an unchanged poll interval never restarts the running timer', () => {
  const { target: live, calls } = target(60000);

  applyLiveSupervisorConfig(live, { ...DEFAULT_SUPERVISOR_CONFIG });

  assert.deepEqual(calls.timers, [], 'the timer is left alone when the interval did not change');
  // The other values are still pushed: only the timer is skipped.
  assert.deepEqual(calls.quota, [DEFAULT_SUPERVISOR_CONFIG.codexQuotaThresholdPercent]);
  assert.deepEqual(calls.rotation, [DEFAULT_SUPERVISOR_CONFIG.rotationThresholdPercent]);
  assert.deepEqual(calls.priority, [[]]);
});

test('LIVE-CONFIG-004 (S3): the runtime adopts the first modelCount saved candidates', () => {
  const { target: live, calls } = target();
  const config: SupervisorConfig = {
    ...DEFAULT_SUPERVISOR_CONFIG,
    modelCount: 3,
    priorityCandidateIds: ['a/1', 'a/2', 'a/3', 'a/4', 'a/5'],
  };

  applyLiveSupervisorConfig(live, config);

  assert.deepEqual(calls.priority, [['a/1', 'a/2', 'a/3']]);
});
