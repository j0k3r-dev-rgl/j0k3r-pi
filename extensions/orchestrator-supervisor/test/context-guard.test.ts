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

test('S6: ContextGuard honours an injected rotationThresholdPercent for the reserve decision and the tool ceiling', () => {
  const guard = new ContextGuard({ rotationThresholdPercent: 50 });

  // Reported metrics: 140,000 / 272,000 = 51.5%, above the injected 50% but below the default 90%.
  const reportedAbove = guard.evaluateUsage(
    { tokens: 140000, contextWindow: 272000, percent: 51.5 },
    'cliproxyapi/main/gpt-6.1-sol',
  );
  assert.equal(reportedAbove.isFallback, false);
  assert.equal(reportedAbove.isReserveExceeded, true);

  const reportedBelow = guard.evaluateUsage(
    { tokens: 100000, contextWindow: 272000, percent: 36.8 },
    'cliproxyapi/main/gpt-6.1-sol',
  );
  assert.equal(reportedBelow.isReserveExceeded, false);

  // Fallback estimation: (2,000 default system prompt + 544,000 entries) / 4 = 136,500 tokens = 50.2%.
  const fallbackAbove = guard.evaluateUsage(
    { tokens: null, contextWindow: 272000, percent: null },
    'cliproxyapi/main/gpt-6.1-sol',
    { entriesChars: 544000 },
  );
  assert.equal(fallbackAbove.isFallback, true);
  assert.equal(fallbackAbove.isReserveExceeded, true);

  const fallbackBelow = guard.evaluateUsage(
    { tokens: null, contextWindow: 272000, percent: null },
    'cliproxyapi/main/gpt-6.1-sol',
    { entriesChars: 200000 },
  );
  assert.equal(fallbackBelow.isReserveExceeded, false);

  // Injected ceiling = floor(50% * 272,000) = 136,000 tokens.
  const atCeiling = guard.interceptToolCall({ toolName: 'bash', input: {} }, 136000, 272000);
  assert.ok(atCeiling);
  assert.equal(atCeiling.block, true);
  assert.equal(atCeiling.terminate, true);
  assert.equal(
    atCeiling.reason,
    'L\u00edmite de seguridad de contexto alcanzado (50%). Rotaci\u00f3n autom\u00e1tica de sesi\u00f3n programada al finalizar el turno.',
  );

  const belowCeiling = guard.interceptToolCall({ toolName: 'bash', input: {} }, 135999, 272000);
  assert.equal(belowCeiling, null);
});

test('S6: ContextGuard defaults to the module rotation threshold and ceiling when no options are provided', () => {
  const guard = new ContextGuard();

  const reportedAbove = guard.evaluateUsage(
    { tokens: 245000, contextWindow: 272000, percent: 90.07 },
    'cliproxyapi/main/gpt-6.1-sol',
  );
  assert.equal(reportedAbove.isReserveExceeded, true);

  const reportedBelow = guard.evaluateUsage(
    { tokens: 244000, contextWindow: 272000, percent: 89.7 },
    'cliproxyapi/main/gpt-6.1-sol',
  );
  assert.equal(reportedBelow.isReserveExceeded, false);

  // Default ceiling = floor(90% * 272,000) = 244,800 tokens.
  const atCeiling = guard.interceptToolCall({ toolName: 'bash', input: {} }, 244800, 272000);
  assert.ok(atCeiling);
  assert.equal(atCeiling.block, true);

  const belowCeiling = guard.interceptToolCall({ toolName: 'bash', input: {} }, 244799, 272000);
  assert.equal(belowCeiling, null);
});

test('S9: the ceiling reason never promises an automatic rotation that is switched off', () => {
  const guard = new ContextGuard({ rotationThresholdPercent: 90 });

  guard.setAutoRotate(false);
  const blocked = guard.interceptToolCall({ toolName: 'bash', input: {} }, 245000, 272000);
  assert.ok(blocked);
  assert.equal(blocked.block, true, 'the safety ceiling still blocks with the switch off');
  assert.equal(blocked.terminate, true);
  assert.match(blocked.reason, /Límite de seguridad de contexto alcanzado \(90%\)/);
  assert.doesNotMatch(blocked.reason, /Rotación automática de sesión programada/);
  // The guidance must point at the only remaining human surface: the bare command and the
  // panel action. A removed subcommand is what this assertion exists to prevent.
  assert.match(blocked.reason, /\/supervisor\b/);
  assert.match(blocked.reason, /«rotate now»/);
  assert.doesNotMatch(blocked.reason, /\/supervisor (status|models|pause|resume|cancel|rotate|panel)\b/);

  guard.setAutoRotate(true);
  assert.match(
    guard.interceptToolCall({ toolName: 'bash', input: {} }, 245000, 272000)!.reason,
    /Rotación automática de sesión programada al finalizar el turno\./,
  );
});

test('S6: a live ContextGuard adopts a rotation threshold changed from the panel', () => {
  const guard = new ContextGuard({ rotationThresholdPercent: 90 });
  const usage = { tokens: 140000, contextWindow: 272000, percent: 51.5 };

  // The instance starts on its constructed value: below it nothing rotates.
  assert.equal(guard.evaluateUsage(usage, 'cliproxyapi/main/gpt-6.1-sol').isReserveExceeded, false);
  assert.equal(guard.interceptToolCall({ toolName: 'bash', input: {} }, 140000, 272000), null);

  // The panel lowers the threshold; this same instance must decide with the new value.
  guard.setRotationThresholdPercent(50);
  assert.equal(guard.evaluateUsage(usage, 'cliproxyapi/main/gpt-6.1-sol').isReserveExceeded, true);
  const atNewCeiling = guard.interceptToolCall({ toolName: 'bash', input: {} }, 136000, 272000);
  assert.ok(atNewCeiling);
  assert.equal(atNewCeiling.terminate, true);
  assert.match(atNewCeiling.reason, /\(50%\)/);
});
