import test from 'node:test';
import assert from 'node:assert/strict';
import { ErrorClassifier } from '../src/error-classifier.ts';

test('MINI-003: Tool errors, bash failures, and subagent task errors are ignored', () => {
  const classifier = new ErrorClassifier('session-orch-1');

  // Tool error result message
  const toolMsg = { role: 'toolResult', isError: true, content: 'Command failed' };
  const action1 = classifier.handleMessageEnd(toolMsg, 'cliproxyapi/main/gpt-6.1-sol', {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(action1.type, 'ignored');
  assert.equal(classifier.getConsecutiveErrors('cliproxyapi/main/gpt-6.1-sol'), 0);

  // Assistant turn in non-tui or different session
  const diffSessionMsg = { role: 'assistant', stopReason: 'error', errorMessage: '429 Rate limit' };
  const action2 = classifier.handleMessageEnd(diffSessionMsg, 'cliproxyapi/main/gpt-6.1-sol', {
    mode: 'rpc',
    sessionId: 'session-orch-1',
  });
  assert.equal(action2.type, 'ignored');
});

test('MINI-003: Hard quota exhaustion triggers immediate abort and candidate exclusion without 3 retries', () => {
  const classifier = new ErrorClassifier('session-orch-1');

  const hardQuotaMsg = {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'HTTP 429: insufficient_quota for this organization',
  };

  const action = classifier.handleMessageEnd(hardQuotaMsg, 'cliproxyapi/main/gpt-6.1-sol', {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });

  assert.equal(action.type, 'immediate_failover');
  assert.equal(action.isHardQuota, true);
  assert.equal(action.shouldAbortRetry, true);
});

test('MINI-003: Transient 5xx increments counter; 3rd transient triggers candidate cooldown and failover', () => {
  const classifier = new ErrorClassifier('session-orch-1');
  const candidate = 'cliproxyapi/main/gpt-6.1-sol';

  const transientMsg = {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'HTTP 503: Service Unavailable',
  };

  // Attempt 1
  const action1 = classifier.handleMessageEnd(transientMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(action1.type, 'transient_retry');
  assert.equal(action1.consecutiveErrors, 1);
  assert.equal(classifier.isInCooldown(candidate), false);

  // Attempt 2
  const action2 = classifier.handleMessageEnd(transientMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(action2.type, 'transient_retry');
  assert.equal(action2.consecutiveErrors, 2);
  assert.equal(classifier.isInCooldown(candidate), false);

  // Attempt 3 -> triggers cooldown and failover
  const action3 = classifier.handleMessageEnd(transientMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(action3.type, 'cooldown_failover');
  assert.equal(action3.consecutiveErrors, 3);
  assert.equal(classifier.isInCooldown(candidate), true);

  // Successful turn resets counter
  const successMsg = { role: 'assistant', stopReason: 'stop', content: 'Completed' };
  classifier.handleMessageEnd(successMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(classifier.getConsecutiveErrors(candidate), 0);
});

test('MINI-003: Fatal proxy key error halts supervisor with fatal alert', () => {
  const classifier = new ErrorClassifier('session-orch-1');
  const fatalMsg = {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'HTTP 401: {"error": "Invalid API key"}',
  };

  const action = classifier.handleMessageEnd(fatalMsg, 'cliproxyapi/main/gpt-6.1-sol', {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });

  assert.equal(action.type, 'fatal_proxy_key');
  assert.equal(action.shouldHalt, true);
});

test('MINI-003: Revoked OAuth (401/403) and model_not_found remain excluded until positive restoration evidence', () => {
  const classifier = new ErrorClassifier('session-orch-1');
  const mainId = 'cliproxyapi/main/gpt-6.1-sol';
  const secondId = 'cliproxyapi/second/gpt-6.1-sol';

  const revokedMsg = {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'HTTP 401: oauth token_revoked for account main',
  };
  const actionRevoked = classifier.handleMessageEnd(revokedMsg, mainId, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(actionRevoked.type, 'immediate_failover');
  assert.equal(actionRevoked.shouldAbortRetry, true);
  assert.equal((classifier as any).isCandidateExcluded(mainId), true);

  const missingModelMsg = {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'HTTP 400: {"error":{"code":"model_not_found"}}',
  };
  const actionMissing = classifier.handleMessageEnd(missingModelMsg, secondId, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(actionMissing.type, 'immediate_failover');
  assert.equal((classifier as any).isCandidateExcluded(secondId), true);

  // Positive restoration evidence clears exclusion
  (classifier as any).recordPositiveRestorationEvidence(mainId);
  assert.equal((classifier as any).isCandidateExcluded(mainId), false);
});

test('MINI-003: HTTP 429 without literal insufficient_quota checks freshQuotaStatus to trigger immediate hard quota abort', () => {
  const classifier = new ErrorClassifier('session-orch-1');
  const candidate = 'cliproxyapi/main/gpt-6.1-sol';

  const generic429Msg = {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'HTTP 429 Too Many Requests',
  };

  const action = (classifier as any).handleMessageEnd(
    generic429Msg,
    candidate,
    { mode: 'tui', sessionId: 'session-orch-1' },
    {
      freshQuotaStatus: {
        candidateId: candidate,
        isEligible: false,
        isUnknown: false,
        reason: 'primary_window_ineligible (>= 95% policy threshold: 96.2%)',
      },
    },
  );

  assert.equal(action.type, 'immediate_failover');
  assert.equal(action.isHardQuota, true);
  assert.equal(action.shouldAbortRetry, true);
});

test('S6: ErrorClassifier honours an injected maxTransientFailures for the threshold and the retry reason', () => {
  const classifier = new ErrorClassifier('session-orch-1', { maxTransientFailures: 2 });
  const candidate = 'cliproxyapi/main/gpt-6.1-sol';
  const transientMsg = {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'HTTP 503: Service Unavailable',
  };

  // First transient is below the injected threshold of 2 and reports it in the reason.
  const first = classifier.handleMessageEnd(transientMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(first.type, 'transient_retry');
  assert.equal(first.consecutiveErrors, 1);
  assert.equal(first.retryDelayMs, 1000);
  assert.equal(first.reason, 'Transient provider error (attempt 1/2). Retrying in 1000ms.');
  assert.equal(classifier.isInCooldown(candidate), false);

  // Second transient reaches the injected threshold of 2 and triggers cooldown + failover.
  const second = classifier.handleMessageEnd(transientMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(second.type, 'cooldown_failover');
  assert.equal(second.consecutiveErrors, 2);
  assert.equal(second.shouldAbortRetry, true);
  assert.equal(classifier.isInCooldown(candidate), true);
});

test('S6: ErrorClassifier applies an injected cooldownMs to hard-quota and transient-threshold cooldowns', () => {
  const candidate = 'cliproxyapi/main/gpt-6.1-sol';
  const cooldownMs = 120000;

  // Hard quota exhaustion path.
  const hardQuotaClassifier = new ErrorClassifier('session-orch-1', { cooldownMs });
  const hardQuota = hardQuotaClassifier.handleMessageEnd(
    { role: 'assistant', stopReason: 'error', errorMessage: 'insufficient_quota' },
    candidate,
    { mode: 'tui', sessionId: 'session-orch-1' },
  );
  assert.equal(hardQuota.type, 'immediate_failover');
  const hardQuotaUntil = hardQuotaClassifier.getCooldowns().get(candidate);
  assert.ok(hardQuotaUntil, 'hard-quota path must register a cooldown');
  const hardQuotaDelta = hardQuotaUntil! - Date.now();
  assert.ok(
    hardQuotaDelta > cooldownMs - 5000 && hardQuotaDelta <= cooldownMs,
    `injected hard-quota cooldown must be ~${cooldownMs}ms, got ${hardQuotaDelta}ms`,
  );

  // Transient-threshold path (default threshold of 3 failures).
  const transientClassifier = new ErrorClassifier('session-orch-1', { cooldownMs });
  const transientMsg = {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'HTTP 503: Service Unavailable',
  };
  let last = transientClassifier.handleMessageEnd(transientMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  last = transientClassifier.handleMessageEnd(transientMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  last = transientClassifier.handleMessageEnd(transientMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(last.type, 'cooldown_failover');
  const transientUntil = transientClassifier.getCooldowns().get(candidate);
  assert.ok(transientUntil, 'transient-threshold path must register a cooldown');
  const transientDelta = transientUntil! - Date.now();
  assert.ok(
    transientDelta > cooldownMs - 5000 && transientDelta <= cooldownMs,
    `injected transient cooldown must be ~${cooldownMs}ms, got ${transientDelta}ms`,
  );
});

test('S6: ErrorClassifier keeps the default failure threshold and cooldown when constructed without options', () => {
  const classifier = new ErrorClassifier('session-orch-1');
  const candidate = 'cliproxyapi/main/gpt-6.1-sol';
  const transientMsg = {
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'HTTP 503: Service Unavailable',
  };

  // Default MAX_TRANSIENT_FAILURES = 3: the 2nd attempt is still a retry, not a cooldown.
  const first = classifier.handleMessageEnd(transientMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  const second = classifier.handleMessageEnd(transientMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(first.type, 'transient_retry');
  assert.equal(second.type, 'transient_retry');
  assert.equal(second.reason, 'Transient provider error (attempt 2/3). Retrying in 2000ms.');
  assert.equal(classifier.isInCooldown(candidate), false);

  const third = classifier.handleMessageEnd(transientMsg, candidate, {
    mode: 'tui',
    sessionId: 'session-orch-1',
  });
  assert.equal(third.type, 'cooldown_failover');
  assert.equal(classifier.isInCooldown(candidate), true);

  // Default COOLDOWN_DURATION_MS = 15m.
  const until = classifier.getCooldowns().get(candidate);
  assert.ok(until);
  const delta = until! - Date.now();
  assert.ok(delta > 14 * 60 * 1000 && delta <= 15 * 60 * 1000, `default cooldown must be ~15m, got ${delta}ms`);

  // setCooldown still defaults to the module constant and still accepts an explicit duration.
  const other = 'cliproxyapi/second/gpt-6.1-sol';
  classifier.setCooldown(other);
  const defaultUntil = classifier.getCooldowns().get(other);
  assert.ok(defaultUntil);
  const defaultDelta = defaultUntil! - Date.now();
  assert.ok(
    defaultDelta > 14 * 60 * 1000 && defaultDelta <= 15 * 60 * 1000,
    `setCooldown default must be ~15m, got ${defaultDelta}ms`,
  );

  classifier.setCooldown(other, 5000);
  const explicitUntil = classifier.getCooldowns().get(other);
  assert.ok(explicitUntil);
  const explicitDelta = explicitUntil! - Date.now();
  assert.ok(explicitDelta > 0 && explicitDelta <= 5000, `explicit cooldown must be 5s, got ${explicitDelta}ms`);
});

test('S6: the cooldown_failover diagnostic names the injected failure limit and cooldown', () => {
  const candidate = 'cliproxyapi/main/gpt-6.1-sol';
  const transient = { role: 'assistant', stopReason: 'error', errorMessage: 'HTTP 503: Service Unavailable' };
  const ctx = { mode: 'tui', sessionId: 'session-orch-1' };

  /** Drives one classifier until it reaches its own threshold and returns that reason. */
  const reasonAtThreshold = (classifier: ErrorClassifier, attempts: number): string => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const action = classifier.handleMessageEnd(transient, candidate, ctx);
      if (action.type === 'cooldown_failover') return action.reason ?? '';
    }
    return '';
  };

  // The operator must read the values this runtime actually uses, never the old pair.
  assert.equal(
    reasonAtThreshold(new ErrorClassifier('session-orch-1', { maxTransientFailures: 2, cooldownMs: 5 * 60 * 1000 }), 2),
    `Transient failures reached the configured limit of 2 on ${candidate}; putting into 5m cooldown and failing over.`,
  );
  // A cooldown that is not a whole number of minutes reports seconds, not a rounded lie.
  assert.equal(
    reasonAtThreshold(new ErrorClassifier('session-orch-1', { maxTransientFailures: 1, cooldownMs: 90_000 }), 1),
    `Transient failures reached the configured limit of 1 on ${candidate}; putting into 90s cooldown and failing over.`,
  );
  // No options keeps the documented defaults and still names them.
  assert.equal(
    reasonAtThreshold(new ErrorClassifier('session-orch-1'), 3),
    `Transient failures reached the configured limit of 3 on ${candidate}; putting into 15m cooldown and failing over.`,
  );
});

test('S6: a live ErrorClassifier adopts a failure policy changed from the panel', () => {
  const candidate = 'cliproxyapi/main/gpt-6.1-sol';
  const transient = { role: 'assistant', stopReason: 'error', errorMessage: 'HTTP 503: Service Unavailable' };
  const ctx = { mode: 'tui', sessionId: 'session-orch-1' };
  const classifier = new ErrorClassifier('session-orch-1', { maxTransientFailures: 3, cooldownMs: 15 * 60 * 1000 });

  assert.equal(classifier.handleMessageEnd(transient, candidate, ctx).type, 'transient_retry');
  assert.equal(classifier.handleMessageEnd(transient, candidate, ctx).type, 'transient_retry');

  // The panel tightens the policy; the next failure uses it, not the constructed one.
  classifier.setFailurePolicy({ maxTransientFailures: 1, cooldownMs: 60 * 1000 });
  const action = classifier.handleMessageEnd(transient, candidate, ctx);
  assert.equal(action.type, 'cooldown_failover');
  assert.equal(
    action.reason,
    `Transient failures reached the configured limit of 1 on ${candidate}; putting into 1m cooldown and failing over.`,
  );
  const until = classifier.getCooldowns().get(candidate);
  assert.ok(until, 'a cooldown is registered');
  const delta = until! - Date.now();
  assert.ok(delta > 55000 && delta <= 60000, `the new cooldown must be ~1m, got ${delta}ms`);
});

test('S6: the cooldown_failover diagnostic labels each configured cooldown exactly', () => {
  const candidate = 'cliproxyapi/main/gpt-6.1-sol';
  const ctx = { mode: 'tui', sessionId: 'session-orch-1' };

  /** Drives one classifier to its transient threshold and returns the failover reason. */
  const reasonFor = (cooldownMs: number, maxTransientFailures = 1): string => {
    const classifier = new ErrorClassifier('session-orch-1', { maxTransientFailures, cooldownMs });
    for (let attempt = 0; attempt < maxTransientFailures + 2; attempt++) {
      const action = classifier.handleMessageEnd(
        { role: 'assistant', stopReason: 'error', errorMessage: 'HTTP 503' },
        candidate,
        ctx,
      );
      if (action.type === 'cooldown_failover') return action.reason ?? '';
    }
    return '';
  };

  // Whole minutes read as `Nm`; whole seconds as `Ns`; anything else keeps its exact
  // length, and a non-positive duration is reported as-is instead of rounded.
  const cases: Array<[number, string]> = [
    [900000, '15m'], [300000, '5m'], [60000, '1m'], [3600000, '60m'], [86400000, '1440m'],
    [90000, '90s'], [1000, '1s'], [500, '500ms'], [59999, '59999ms'], [1, '1ms'],
    [0, '0ms'], [-1000, '-1000ms'],
  ];
  for (const [cooldownMs, label] of cases) {
    assert.equal(
      reasonFor(cooldownMs),
      `Transient failures reached the configured limit of 1 on ${candidate}; putting into ${label} cooldown and failing over.`,
      `cooldownMs=${cooldownMs}`,
    );
  }
});
