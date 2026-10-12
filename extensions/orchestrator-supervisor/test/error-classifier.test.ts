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

