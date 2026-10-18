import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_EFFORTS,
  isModelEffort,
  resetSupportedModelEffortsCacheForTests,
  supportedModelEfforts,
  validateModelEfforts,
} from '../src/model-effort.ts';

test('MODEL-EFFORT-001: the union matches the host thinking-level vocabulary exactly, in order', () => {
  assert.deepEqual(MODEL_EFFORTS, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
});

test('MODEL-EFFORT-002: isModelEffort accepts only the exact union members', () => {
  for (const level of MODEL_EFFORTS) assert.equal(isModelEffort(level), true);
  assert.equal(isModelEffort('HIGH'), false);
  assert.equal(isModelEffort('extreme'), false);
  assert.equal(isModelEffort(undefined), false);
  assert.equal(isModelEffort(null), false);
  assert.equal(isModelEffort(3), false);
});

test('MODEL-EFFORT-003: validateModelEfforts leaves an absent map absent (old files stay valid)', () => {
  assert.equal(validateModelEfforts(undefined), undefined);
});

test('MODEL-EFFORT-004: validateModelEfforts round-trips a well-formed map without truncation', () => {
  const input = {
    'cliproxyapi/main/gpt-6.1-sol': 'high',
    'anthropic/claude-sonnet-4-5': 'low',
    'openrouter/meta-llama/llama-3-70b': 'xhigh',
  };
  const result = validateModelEfforts(input);
  assert.deepEqual(result, input);
  // Every provided entry survives; none is dropped as "hidden" the way priority slots are.
  assert.equal(Object.keys(result!).length, 3);
});

test('MODEL-EFFORT-005: validateModelEfforts rejects a non-object root', () => {
  assert.throws(() => validateModelEfforts([]), /expected an object/);
  assert.throws(() => validateModelEfforts('high'), /expected an object/);
  assert.throws(() => validateModelEfforts(42), /expected an object/);
});

test('MODEL-EFFORT-006: validateModelEfforts rejects an unsupported effort value', () => {
  assert.throws(
    () => validateModelEfforts({ 'cliproxyapi/main/gpt-6.1-sol': 'extreme' }),
    /unsupported effort "extreme"/,
  );
});

test('MODEL-EFFORT-007: validateModelEfforts rejects a non-string effort value', () => {
  assert.throws(
    () => validateModelEfforts({ 'cliproxyapi/main/gpt-6.1-sol': 7 }),
    /unsupported effort/,
  );
});

test('MODEL-EFFORT-008: validateModelEfforts rejects an empty-string key', () => {
  assert.throws(() => validateModelEfforts({ '': 'high' }), /invalid model ID/);
});

test('MODEL-EFFORT-009: validateModelEfforts uses the caller-provided label in its error', () => {
  assert.throws(() => validateModelEfforts({ '': 'high' }, 'subagent configuration'), /Malformed subagent configuration/);
});

test('MODEL-EFFORT-010: supportedModelEfforts returns [] for a non-object model without throwing', async () => {
  resetSupportedModelEffortsCacheForTests();
  assert.deepEqual(await supportedModelEfforts(undefined), []);
  assert.deepEqual(await supportedModelEfforts(null), []);
  assert.deepEqual(await supportedModelEfforts('gpt'), []);
});

test('MODEL-EFFORT-011: supportedModelEfforts returns [] when the host resolver module is unavailable', async () => {
  resetSupportedModelEffortsCacheForTests();
  // The standalone node test process has no @earendil-works/pi-ai dependency wired in, so
  // the dynamic import fails and this must degrade to Default-only, never throw.
  const result = await supportedModelEfforts({ reasoning: true });
  assert.deepEqual(result, []);
});

test('MODEL-EFFORT-012: supportedModelEfforts reports exactly what an injected resolver proves, filtering any invented level', async () => {
  const model = { reasoning: true, thinkingLevelMap: { xhigh: 'xhigh-id' } };
  const resolver = (m: any) => { assert.equal(m, model); return ['off', 'low', 'high', 'xhigh', 'not-a-real-level']; };
  const result = await supportedModelEfforts(model, resolver);
  assert.deepEqual(result, ['off', 'low', 'high', 'xhigh']);
});

test('MODEL-EFFORT-013: supportedModelEfforts returns [] when an injected resolver throws, without propagating', async () => {
  const result = await supportedModelEfforts({ reasoning: true }, () => { throw new Error('capability lookup exploded'); });
  assert.deepEqual(result, []);
});

test('MODEL-EFFORT-014: supportedModelEfforts returns [] when an injected resolver returns a non-array', async () => {
  const result = await supportedModelEfforts({ reasoning: true }, (() => 'high') as any);
  assert.deepEqual(result, []);
});
