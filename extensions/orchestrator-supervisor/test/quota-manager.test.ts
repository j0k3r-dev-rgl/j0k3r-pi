import test from 'node:test';
import assert from 'node:assert/strict';
import { MockCpamcServer } from './fixtures/mock-cpamc.ts';
import { QuotaManager } from '../src/quota-manager.ts';

test('MINI-002: Model priority selects main when eligible, second when main >= 95%, gemini when both >= 95%', async () => {
  const server = new MockCpamcServer({
    mainWhamUsedPercentPrimary: 50.0,
    mainWhamUsedPercentSecondary: 40.0,
  });
  const baseUrl = await server.start();

  try {
    const qm = new QuotaManager({ baseUrl, retryDelayMs: 10 });
    const selection = await qm.selectBestCandidate();
    assert.equal(selection.candidate.id, 'cliproxyapi/main/gpt-6.1-sol');

    // Case 2: main is at 95.00% -> ineligibile, falls back to second
    server.options.mainWhamUsedPercentPrimary = 95.00;
    qm.clearCache();
    const selection2 = await qm.selectBestCandidate();
    assert.equal(selection2.candidate.id, 'cliproxyapi/second/gpt-6.1-sol');

    // Case 3: both main and second >= 95% -> falls back to gemini
    server.options.secondWhamUsedPercentSecondary = 95.01;
    qm.clearCache();
    const selection3 = await qm.selectBestCandidate();
    assert.equal(selection3.candidate.id, 'cliproxyapi/j0k3r/gemini-3.8-flash-high');
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
    const qm = new QuotaManager({ baseUrl, retryDelayMs: 10 });
    const selection = await qm.selectBestCandidate();
    assert.equal(selection.candidate.id, 'cliproxyapi/main/gpt-6.1-sol');

    // Exactly 95.00%
    server.options.mainWhamUsedPercentPrimary = 95.00;
    qm.clearCache();
    const selection2 = await qm.selectBestCandidate();
    assert.equal(selection2.candidate.id, 'cliproxyapi/second/gpt-6.1-sol');
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
    const qm = new QuotaManager({ baseUrl, retryDelayMs: 10 });
    const selection = await qm.selectBestCandidate();
    assert.equal(selection.candidate.id, 'cliproxyapi/second/gpt-6.1-sol');
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
    const qm = new QuotaManager({ baseUrl, retryDelayMs: 5, maxRetries: 2 });
    const selection = await qm.selectBestCandidate();
    assert.equal(selection.candidate.id, 'cliproxyapi/second/gpt-6.1-sol');
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
    const qm = new QuotaManager({ baseUrl, retryDelayMs: 10 });
    // First query: main is exhausted, so on second
    const sel = await qm.selectBestCandidate();
    assert.equal(sel.candidate.id, 'cliproxyapi/second/gpt-6.1-sol');

    // Simulate quota reset on server after reset_at passed (WITHOUT manual clearCache!)
    server.options.mainWhamUsedPercentPrimary = 10.0;

    // Reset check must detect expired reset_at and force fresh uncached quota fetch
    const shouldReturn = await qm.checkResetReturn('cliproxyapi/second/gpt-6.1-sol');
    assert.equal(shouldReturn.shouldReturn, true);
    assert.equal(shouldReturn.targetCandidate?.id, 'cliproxyapi/main/gpt-6.1-sol');
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
    const qm = new QuotaManager({ baseUrl, retryDelayMs: 5 });
    const mapping = await qm.resolvePrefixMapping('main');
    assert.equal(mapping, undefined, 'Ambiguous main prefix must be rejected');

    // Selection skips ambiguous main and selects unambiguous second
    const selection = await qm.selectBestCandidate();
    assert.equal(selection.candidate?.id, 'cliproxyapi/second/gpt-6.1-sol');
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
    const qm = new QuotaManager({ baseUrl, retryDelayMs: 5 });
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

