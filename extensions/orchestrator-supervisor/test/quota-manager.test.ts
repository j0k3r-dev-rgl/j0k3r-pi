import test from 'node:test';
import assert from 'node:assert/strict';
import { MockCpamcServer } from './fixtures/mock-cpamc.ts';
import { QuotaManager } from '../src/quota-manager.ts';
import * as config from '../src/config.ts';

const MAIN = 'cliproxyapi/main/gpt-6.1-sol';
const SECOND = 'cliproxyapi/second/gpt-6.1-sol';
const GEMINI = 'cliproxyapi/gemini-account/gemini-3.8-flash-high';

// There is no hardcoded candidate seed: production discovers account routes first.
// Automatic routing is driven by the saved slot list, so every selection test sets one.
async function discovered(options: any = {}): Promise<QuotaManager> {
  const qm = new QuotaManager(options);
  await qm.discoverCandidates(() => true);
  qm.setPriorityCandidateIds([MAIN, SECOND, GEMINI]);
  return qm;
}

test('MINI-002: Model priority selects main when eligible, second when main >= 95%, gemini when both >= 95%', async () => {
  const server = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 50.0,
    mainWhamUsedPercentSecondary: 40.0,
  });
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 10 });
    const selection = await qm.selectBestCandidate();
    assert.equal(selection.candidate.id, MAIN);

    // Case 2: main is at 95.00% -> ineligibile, falls back to second
    server.options.mainWhamUsedPercentPrimary = 95.00;
    qm.clearCache();
    const selection2 = await qm.selectBestCandidate();
    assert.equal(selection2.candidate.id, SECOND);

    // Case 3: both main and second >= 95% -> falls back to gemini
    server.options.secondWhamUsedPercentSecondary = 95.01;
    qm.clearCache();
    const selection3 = await qm.selectBestCandidate();
    assert.equal(selection3.candidate.id, GEMINI);
  } finally {
    await server.stop();
  }
});

test('MINI-002: Strict numeric 95% boundary: 94.99% is eligible, 95.00% is ineligible', async () => {
  const server = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 94.99,
    mainWhamUsedPercentSecondary: 90.00,
  });
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 10 });
    const selection = await qm.selectBestCandidate();
    assert.equal(selection.candidate.id, MAIN);

    // Exactly 95.00%
    server.options.mainWhamUsedPercentPrimary = 95.00;
    qm.clearCache();
    const selection2 = await qm.selectBestCandidate();
    assert.equal(selection2.candidate.id, SECOND);
  } finally {
    await server.stop();
  }
});

test('MINI-002: Secondary window >= 95% makes candidate ineligible even if primary is low', async () => {
  const server = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 10.0,
    mainWhamUsedPercentSecondary: 95.00,
  });
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 10 });
    const selection = await qm.selectBestCandidate();
    assert.equal(selection.candidate.id, SECOND);
  } finally {
    await server.stop();
  }
});

test('MINI-002: Quota fetch failure treats candidate as unverified and advances to verified backup', async () => {
  const server = new MockCpamcServer({
    simulateWhamError: true, // main fails
    secondWhamUsedPercentPrimary: 20.0,
  });
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 5, maxRetries: 2 });
    const selection = await qm.selectBestCandidate();
    assert.equal(selection.candidate.id, SECOND);
  } finally {
    await server.stop();
  }
});

test('MINI-002: Reset-return engine detects reset_at expiration and initiates return to main', async () => {
  const pastResetAt = Math.floor(Date.now() / 1000) - 10;
  const server = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 95.5,
    mainWhamResetAt: pastResetAt,
    secondWhamUsedPercentPrimary: 50.0,
  });
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 10 });
    // First query: main is exhausted, so on second
    const sel = await qm.selectBestCandidate();
    assert.equal(sel.candidate.id, SECOND);

    // Simulate quota reset on server after reset_at passed (WITHOUT manual clearCache!)
    server.options.mainWhamUsedPercentPrimary = 10.0;

    // Reset check must detect expired reset_at and force fresh uncached quota fetch
    const shouldReturn = await qm.checkResetReturn(SECOND);
    assert.equal(shouldReturn.shouldReturn, true);
    assert.equal(shouldReturn.targetCandidate?.id, MAIN);
  } finally {
    await server.stop();
  }
});

test('MINI-002: Rejects ambiguous prefix shared across distinct auth_index credentials', async () => {
  const server = new MockCpamcServer({
    ambiguousMainPrefix: true,
    mainWhamUsedPercentPrimary: 10.0,
    secondWhamUsedPercentPrimary: 30.0,
  });
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 5 });
    const mapping = await qm.resolvePrefixMapping('main');
    assert.equal(mapping, undefined, 'Ambiguous main prefix must be rejected');

    // Selection skips ambiguous main and selects unambiguous second
    const selection = await qm.selectBestCandidate();
    assert.equal(selection.candidate?.id, SECOND);
  } finally {
    await server.stop();
  }
});

test('MINI-002: Validates Wham limit_window_seconds (18000 / 604800) and finite used_percent', async () => {
  const server = new MockCpamcServer({
    invalidWhamWindowSeconds: true,
    secondWhamUsedPercentPrimary: 25.0,
  });
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 5 });
    const whamInvalidWindow = await qm.fetchWhamQuota('main');
    assert.equal(whamInvalidWindow, undefined, 'Invalid limit_window_seconds must be rejected');

    server.options.invalidWhamWindowSeconds = false;
    server.options.nanWhamUsedPercent = true;
    const whamNan = await qm.fetchWhamQuota('main');
    assert.equal(whamNan, undefined, 'Non-finite used_percent must be rejected');
  } finally {
    await server.stop();
  }
});

test('SELECTED-001: a route outside the saved slots is never probed or selected', async () => {
  const server = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 20.0,
    secondWhamUsedPercentPrimary: 30.0,
  });
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 5 });
    qm.setPriorityCandidateIds([SECOND]);

    const mainCandidate = qm.getCandidates().find(c => c.id === MAIN)!;
    const before = server.apiCallCount;
    const status = await qm.checkCandidateStatus(mainCandidate);
    assert.equal(status.isEligible, false);
    assert.equal(status.reason, 'not_selected');
    assert.equal(server.apiCallCount, before, 'a non-selected route must not trigger any quota probe');

    // main has the best quota but is not selected; second wins anyway.
    const selection = await qm.selectBestCandidate();
    assert.equal(selection.candidate.id, SECOND);
    assert.equal(selection.allUnavailable, false);
  } finally {
    await server.stop();
  }
});

test('SELECTED-002: an empty selection returns all_candidates_unavailable without inventing a route', async () => {
  const server = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 10.0,
    secondWhamUsedPercentPrimary: 10.0,
  });
  const baseUrl = await server.start();

  try {
    const qm = new QuotaManager({ baseUrl, retryDelayMs: 5 });
    await qm.discoverCandidates(() => true);
    assert.equal(qm.getCandidates().length, 3, 'the catalog must be populated before asserting unavailability');
    const selection = await qm.selectBestCandidate();

    assert.equal(selection.candidate, null);
    assert.equal(selection.allUnavailable, true);
    assert.equal(selection.reason, 'all_candidates_unavailable');
  } finally {
    await server.stop();
  }
});

test('SELECTED-003: reset-return never targets a route outside the saved slots', async () => {
  const pastResetAt = Math.floor(Date.now() / 1000) - 10;
  const server = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 10.0,
    mainWhamResetAt: pastResetAt,
    secondWhamUsedPercentPrimary: 30.0,
  });
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 5 });
    qm.setPriorityCandidateIds([SECOND]);

    // Despite main having reset and having low usage (10%), it is not a saved slot.
    const shouldReturn = await qm.checkResetReturn(SECOND);
    assert.equal(shouldReturn.shouldReturn, false);
  } finally {
    await server.stop();
  }
});

test('SELECTED-004: discovery retains every addressable route for the slot editors', async () => {
  const server = new MockCpamcServer();
  const baseUrl = await server.start();

  try {
    const qm = new QuotaManager({ baseUrl, retryDelayMs: 5 });
    await qm.discoverCandidates(() => true);
    qm.setPriorityCandidateIds([SECOND]);

    const candidateIds = qm.getCandidates().map(c => c.id);
    assert.ok(candidateIds.includes(MAIN), 'an unselected route must still be offered');
    assert.ok(candidateIds.includes(SECOND));
    assert.equal(qm.isSelected(MAIN), false);
    assert.equal(qm.isSelected(SECOND), true);
  } finally {
    await server.stop();
  }
});

test('ROUTING-003: the catalog is never a hardcoded module constant', async () => {
  assert.equal('MODEL_CANDIDATES' in config, false, 'MODEL_CANDIDATES must be removed entirely');

  // An undiscovered manager has no accounts and no host registry: empty, not seeded.
  const qm = new QuotaManager();
  assert.deepEqual(qm.getCandidates(), []);
  const selection = await qm.selectBestCandidate();
  assert.equal(selection.candidate, null);
  assert.equal(selection.allUnavailable, true);
});

test('ROUTING-003: registered host models join the pool after every account route, deduped', async () => {
  const server = new MockCpamcServer();
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 5 });
    qm.setRegisteredModels([
      { provider: 'openai', id: 'gpt-5' },
      { provider: 'anthropic', id: 'claude-sonnet-4-5', contextWindow: 200000 },
      { provider: 'openai', id: 'gpt-5' }, // duplicate must collapse
      { provider: 'bad provider', id: 'nope' }, // unaddressable route must be dropped
      { provider: 'openai', id: '' }, // empty model id must be dropped
      { provider: 'cliproxyapi', id: 'main/gpt-6.1-sol', contextWindow: 272000 }, // already an account route
    ]);

    assert.deepEqual(qm.getCandidates().map(c => c.id), [
      MAIN,
      SECOND,
      GEMINI,
      'anthropic/claude-sonnet-4-5',
      'openai/gpt-5',
    ]);
    // Host models are in the catalogue but never selected until a slot names them.
    assert.equal(qm.isSelected('anthropic/claude-sonnet-4-5'), false);
    assert.equal(qm.isSelected('openai/gpt-5'), false);
    assert.equal(qm.isSelected(MAIN), true);
  } finally {
    await server.stop();
  }
});

test('ROUTING-003: a saved host slot is the last-resort fallback after verified routes are exhausted', async () => {
  const server = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 10.0,
    secondWhamUsedPercentPrimary: 10.0,
    geminiRemainingFraction: 1,
  });
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 5 });
    qm.setRegisteredModels([{ provider: 'anthropic', id: 'claude-sonnet-4-5', contextWindow: 200000 }]);

    // Verified account routes win while they are eligible, even in a later slot.
    assert.equal((await qm.selectBestCandidate()).candidate.id, MAIN);

    // Without the host slot, exhausting the verified routes routes nothing.
    server.options.mainWhamUsedPercentPrimary = 99.0;
    server.options.secondWhamUsedPercentPrimary = 99.0;
    server.options.geminiRemainingFraction = 0;
    assert.equal((await qm.selectBestCandidate()).allUnavailable, true);

    // Appending the host model to the saved slots makes it the last resort.
    qm.setPriorityCandidateIds([MAIN, SECOND, GEMINI, 'anthropic/claude-sonnet-4-5']);
    const fallback = await qm.selectBestCandidate();
    assert.equal(fallback.candidate.id, 'anthropic/claude-sonnet-4-5');
    const status = await qm.checkCandidateStatus(fallback.candidate);
    assert.equal(status.isEligible, true);
    assert.equal(status.reason, 'registered_without_quota_protocol');
  } finally {
    await server.stop();
  }
});

test('ROUTING-003: a verified route with unverifiable quota is skipped, never assumed eligible', async () => {
  const server = new MockCpamcServer({
    simulateWhamError: true,
    secondWhamUsedPercentPrimary: 99.0,
    geminiRemainingFraction: 0,
  });
  const baseUrl = await server.start();

  try {
    const qm = await discovered({ baseUrl, retryDelayMs: 5, maxRetries: 1 });
    qm.setRegisteredModels([{ provider: 'anthropic', id: 'claude-sonnet-4-5' }]);
    qm.setPriorityCandidateIds([MAIN, SECOND, GEMINI, 'anthropic/claude-sonnet-4-5']);

    const main = qm.getCandidates().find(c => c.id === MAIN)!;
    const status = await qm.checkCandidateStatus(main);
    assert.equal(status.isEligible, false);
    assert.equal(status.isUnknown, true);
    assert.equal(status.reason, 'unverified_quota_fetch_failed');

    // Unknown verified quota never outranks the saved host fallback: it is skipped.
    assert.equal((await qm.selectBestCandidate()).candidate.id, 'anthropic/claude-sonnet-4-5');
  } finally {
    await server.stop();
  }
});
