import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextGuard } from '../src/context-guard.ts';

test('MINI-004: ContextGuard uses reported metrics when non-null and caps window by provider', () => {
  const guard = new ContextGuard();

  // Reported tokens: 200,000 on GPT (cap 272,000)
  const metrics = guard.evaluateUsage(
    { tokens: 200000, contextWindow: 300000, percent: 66.6 },
    'cliproxyapi/main/gpt-6.1-sol',
  );

  assert.equal(metrics.contextWindow, 272000); // capped by provider cap
  assert.equal(metrics.tokens, 200000);
  assert.equal(metrics.isFallback, false);
  assert.equal(metrics.isReserveExceeded, false); // 200k / 272k = 73.5% < 90%
});

test('MINI-004: Post-compaction null tokens triggers deterministic Math.ceil(chars / 4) fallback', () => {
  const guard = new ContextGuard();

  // 40,000 characters + 1 image block (4,800 chars) = 44,800 chars -> 11,200 tokens
  const metrics = guard.evaluateUsage(
    { tokens: null, contextWindow: 272000, percent: null },
    'cliproxyapi/main/gpt-6.1-sol',
    {
      systemPrompt: 'System prompt instructions (30 chars)',
      entriesChars: 40000,
      imageBlockCount: 1,
    },
  );

  assert.equal(metrics.isFallback, true);
  assert.ok(metrics.tokens > 11000);
  assert.equal(metrics.contextWindow, 272000);
  assert.equal(metrics.isReserveExceeded, false);
});

test('MINI-004: Reaching 90% context reserve flags reserve exceeded and blocks subsequent batch tool calls', () => {
  const guard = new ContextGuard();

  // 245,000 tokens on 272,000 window -> 90.07% (>= 90%)
  const metrics = guard.evaluateUsage(
    { tokens: 245000, contextWindow: 272000, percent: 90.07 },
    'cliproxyapi/main/gpt-6.1-sol',
  );

  assert.equal(metrics.isReserveExceeded, true);

  // Remaining tool calls in batch are intercepted and blocked with terminate: true
  const interception = guard.interceptToolCall(
    { name: 'bash', arguments: { command: 'ls' } },
    metrics.tokens,
    metrics.contextWindow,
  );

  assert.ok(interception);
  assert.equal(interception.block, true);
  assert.equal(interception.terminate, true);
  assert.match(interception.reason ?? '', /Límite de seguridad de contexto alcanzado \(90%\)|Context reserve ceiling \(90%\) reached/);

  // Essential lifecycle tools memory_save, memory_get, and supervisor_rotate are NEVER blocked even at >= 90%!
  const memSaveIntercept = guard.interceptToolCall(
    { toolName: 'memory_save', input: { action: 'save', type: 'session_summary' } },
    metrics.tokens,
    metrics.contextWindow,
  );
  assert.equal(memSaveIntercept, null, 'memory_save must NEVER be blocked by context ceiling');

  const rotateIntercept = guard.interceptToolCall(
    { toolName: 'supervisor_rotate', input: { memory_id: 88 } },
    metrics.tokens,
    metrics.contextWindow,
  );
  assert.equal(rotateIntercept, null, 'supervisor_rotate must NEVER be blocked by context ceiling');
});

test('MINI-004: Strict 90% boundary: tools are allowed below 90% and blocked only when actual tokens reach ceiling', () => {
  const guard = new ContextGuard();

  // Tokens at 222,000 (81.6%) and 240,000 (88.2%) on 272,000 cap (ceiling = 244,800):
  // Tools must NOT be blocked by speculative preventive budgeting!
  const callBelow1 = guard.interceptToolCall(
    { toolName: 'bash', input: { command: 'git status' } },
    222000,
    272000,
  );
  assert.equal(callBelow1, null, 'Must allow bash below 90%');

  const callBelow2 = guard.interceptToolCall(
    { toolName: 'read', input: { path: 'plan.md' } },
    240000,
    272000,
  );
  assert.equal(callBelow2, null, 'Must allow read below 90%');

  // Actual tokens at or above 244,800 (>= 90%): tools are blocked with clean reason
  const callAtCeiling = guard.interceptToolCall(
    { toolName: 'bash', input: { command: 'ls' } },
    245000,
    272000,
  );
  assert.ok(callAtCeiling);
  assert.equal(callAtCeiling.block, true);
  assert.equal(callAtCeiling.terminate, true);
  assert.match(callAtCeiling.reason, /Límite de seguridad de contexto alcanzado \(90%\)/);

  // Memory tools are never blocked even at >= 90%
  const memCall = guard.interceptToolCall(
    { toolName: 'memory_save', input: { action: 'save' } },
    250000,
    272000,
  );
  assert.equal(memCall, null, 'memory_save must never be blocked');
});

test('MINI-004: extractFallbackDetails computes systemPrompt, compaction summary, kept branch entries, and image blocks', () => {
  const guard = new ContextGuard();
  const mockCtx = {
    getSystemPrompt: () => 'A'.repeat(4000),
    sessionManager: {
      getBranch: () => [
        { id: 'e1', type: 'message', message: { role: 'user', content: 'old message before compaction'.repeat(100) } },
        { id: 'c1', type: 'compaction', summary: 'B'.repeat(2000), firstKeptEntryId: 'e2' },
        {
          id: 'e2',
          type: 'message',
          message: {
            role: 'user',
            content: [
              { type: 'text', text: 'C'.repeat(4000) },
              { type: 'image', data: 'base64...' },
            ],
          },
        },
      ],
    },
  };

  const details = (guard as any).extractFallbackDetails(mockCtx);
  assert.equal(details.systemPrompt.length, 4000);
  assert.equal(details.compactionSummary.length, 2000);
  assert.equal(details.entriesChars, 4000);
  assert.equal(details.imageBlockCount, 1);

  const metrics = guard.evaluateUsage(
    { tokens: null, contextWindow: 272000, percent: null },
    'cliproxyapi/main/gpt-6.1-sol',
    details,
  );
  // (4000 + 2000 + 4000 + 4800) / 4 = 14800 / 4 = 3700 tokens
  assert.equal(metrics.isFallback, true);
  assert.equal(metrics.tokens, 3700);
});

