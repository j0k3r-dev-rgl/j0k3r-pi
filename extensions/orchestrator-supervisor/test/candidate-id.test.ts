import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidCandidateId, validateCandidateId } from '../src/candidate-id.ts';

/** Candidate IDs stay unambiguous across Pi providers and namespaced model routes. */

test('CANDIDATE-001: every provider/model route is a valid candidate ID', () => {
  // No catalogue is hardcoded, and the model id itself may carry slashes
  // (CLIProxyAPI accounts, OpenRouter namespaces).
  for (const id of [
    'cliproxyapi/main/gpt-6.1-sol',
    'cliproxyapi/gemini-account/gemini-3.8-flash-high',
    'cliproxyapi/account_1/gpt-4o',
    'cliproxyapi/main/claude-3-opus',
    'anthropic/claude-sonnet-4-5',
    'openrouter/meta-llama/llama-3-70b',
    'ollama/llama3.1:8b',
    'cliproxyapi/main/gpt-',
  ]) {
    assert.equal(isValidCandidateId(id), true, id);
  }
});

test('CANDIDATE-002: ambiguous shapes are rejected instead of guessed', () => {
  for (const id of [
    'invalid-shape',
    'cliproxyapi//gpt-6.1-sol',
    'cliproxyapi/main/',
    'cliproxyapi/main//nested',
    '/gpt-6.1-sol',
    'provider/ model',
    '',
    undefined,
    null,
    42,
  ]) {
    assert.equal(isValidCandidateId(id), false, String(id));
    assert.throws(() => validateCandidateId(id), /Invalid candidate ID format/);
  }
});

test('CANDIDATE-003: validateCandidateId narrows without changing a valid ID', () => {
  const id: unknown = 'cliproxyapi/main/gpt-6.1-sol';
  validateCandidateId(id);
  assert.equal(id.endsWith('/gpt-6.1-sol'), true);
});
