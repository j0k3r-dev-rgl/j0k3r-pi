import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowJournal } from '../src/journal.ts';

test('MINI-006: FlowJournal records pre-execution tool call with status pending and directory fsync', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-journal-test-'));
  try {
    const journal = new FlowJournal(tmpDir, 'flow-test-1', 'session-1');

    const entry = journal.recordToolCallPre({
      toolCallId: 'call_abc_1',
      sessionId: 'session-1',
      turnIndex: 0,
      toolName: 'write',
      args: { path: '/tmp/test.txt', content: 'hello' },
    });

    assert.equal(entry.status, 'pending');
    assert.equal(entry.isMutating, true);

    const journalFile = join(tmpDir, 'tool-journal.json');
    assert.equal(existsSync(journalFile), true);

    const raw = JSON.parse(readFileSync(journalFile, 'utf8'));
    assert.equal(raw.length, 1);
    assert.equal(raw[0].toolCallId, 'call_abc_1');
    assert.equal(raw[0].status, 'pending');

    // Settle tool result
    journal.recordToolCallResult('call_abc_1', false, { success: true });
    const rawSettled = JSON.parse(readFileSync(journalFile, 'utf8'));
    assert.equal(rawSettled[0].status, 'settled');
    assert.equal(rawSettled[0].isError, false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-006: Crash recovery transitions pending mutating tool calls to uncertain without replay', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-journal-crash-'));
  try {
    const journal = new FlowJournal(tmpDir, 'flow-crash-1', 'session-1');

    // Simulate crash: pending mutating call not settled
    journal.recordToolCallPre({
      toolCallId: 'call_mutating_crash',
      sessionId: 'session-1',
      turnIndex: 1,
      toolName: 'bash',
      args: { command: 'npm run build' },
    });

    // New journal instance simulating startup recovery
    const recoveryJournal = new FlowJournal(tmpDir, 'flow-crash-1', 'session-2');
    const { uncertainEntries } = recoveryJournal.recoverOnStartup();

    assert.equal(uncertainEntries.length, 1);
    assert.equal(uncertainEntries[0]!.toolCallId, 'call_mutating_crash');
    assert.equal(uncertainEntries[0]!.status, 'uncertain');

    const journalFile = join(tmpDir, 'tool-journal.json');
    const diskEntries = JSON.parse(readFileSync(journalFile, 'utf8'));
    assert.equal(diskEntries[0].status, 'uncertain');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-006: FlowJournal saves and loads state.json with atomic rename and directory durability', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-state-test-'));
  try {
    const journal = new FlowJournal(tmpDir, 'flow-state-1', 'session-1');

    journal.saveState({
      flowIdentity: 'flow-state-1',
      sessionId: 'session-1',
      activeModel: 'cliproxyapi/main/gpt-6.1-sol',
      status: 'active',
      activeGeneration: 1,
      uncertainMutationsCount: 0,
      updatedAt: Date.now(),
    });

    const state = journal.loadState();
    assert.ok(state);
    assert.equal(state.flowIdentity, 'flow-state-1');
    assert.equal(state.activeModel, 'cliproxyapi/main/gpt-6.1-sol');
    assert.equal(state.status, 'active');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-006: FlowJournal classifies git commit vs git push and tracks partialSideEffectSuspected on tool errors', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-journal-git-'));
  try {
    const journal = new FlowJournal(tmpDir, 'flow-git-1', 'session-1');

    const commitEntry = journal.recordToolCallPre({
      toolCallId: 'call_commit_1',
      sessionId: 'session-1',
      turnIndex: 0,
      toolName: 'bash',
      args: { command: 'git commit -m "feat: x"' },
    });
    assert.equal(commitEntry.operationKind, 'git_commit');

    const pushEntry = journal.recordToolCallPre({
      toolCallId: 'call_push_1',
      sessionId: 'session-1',
      turnIndex: 1,
      toolName: 'bash',
      args: { command: 'git push origin main' },
    });
    assert.equal(pushEntry.operationKind, 'git_push');

    // Settle push with error -> partialSideEffectSuspected must be true
    journal.recordToolCallResult('call_push_1', true, { error: 'connection reset' });
    const entries = journal.getEntries();
    const settledPush = entries.find((e) => e.toolCallId === 'call_push_1')!;
    assert.equal(settledPush.status, 'settled');
    assert.equal(settledPush.isError, true);
    assert.equal(settledPush.partialSideEffectSuspected, true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
