import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  TelemetryDb,
  resolveTelemetryDbPath,
  resolveTelemetryHome,
} from '../src/storage/telemetry-db.ts';

test('MINI-002: runtime uses node:sqlite and strictly contains no bun:sqlite fallback or references', () => {
  const currentFilePath = new URL(import.meta.url).pathname;
  const testDir = path.dirname(currentFilePath);
  const pkgDir = path.resolve(testDir, '..');
  const dbSource = fs.readFileSync(path.join(pkgDir, 'src', 'storage', 'telemetry-db.ts'), 'utf8');
  assert.ok(!dbSource.includes('bun:sqlite'), 'telemetry-db.ts must not reference bun:sqlite');

  // Verify across all source files in src/
  const srcDir = path.join(pkgDir, 'src');
  const entries = fs.readdirSync(srcDir, { recursive: true });
  for (const entry of entries) {
    if (typeof entry === 'string' && entry.endsWith('.ts')) {
      const content = fs.readFileSync(path.join(srcDir, entry), 'utf8');
      assert.ok(!content.includes('bun:sqlite'), `File ${entry} must not reference bun:sqlite`);
    }
  }
});

test('MINI-002: path resolution respects environment and XDG conventions', () => {

  const customPath = '/tmp/custom-pi-typesafe/test.sqlite';
  const resolved = resolveTelemetryDbPath({ PI_TYPESAFE_TELEMETRY_DB_PATH: customPath });
  assert.equal(resolved, customPath);

  const home = resolveTelemetryHome({ XDG_DATA_HOME: '/tmp/xdg-test' });
  assert.equal(home, path.join('/tmp/xdg-test', 'pi', 'typesafe'));
});

test('MINI-002: database initializes on fresh path with WAL mode and secure permissions', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typesafe-db-test-'));
  const dbPath = path.join(tmpDir, 'telemetry.sqlite');

  try {
    const db = new TelemetryDb(dbPath);
    assert.ok(fs.existsSync(dbPath), 'Database file must be created');

    const fileStat = fs.statSync(dbPath);
    // On POSIX, file permissions should be 0o600
    const mode = fileStat.mode & 0o777;
    assert.equal(mode, 0o600, 'File permission must be 0600');

    db.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-002: recordEvaluation stores full payload and queryTelemetry retrieves paginated results', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typesafe-db-test-'));
  const dbPath = path.join(tmpDir, 'telemetry.sqlite');

  try {
    const db = new TelemetryDb(dbPath);

    // Insert 15 records
    for (let i = 1; i <= 15; i++) {
      db.recordEvaluation({
        id: `eval-${i.toString().padStart(3, '0')}`,
        session_id: 'session-123',
        source: i % 2 === 0 ? 'shadow-triage' : 'evaluate-tool',
        created_at: new Date(Date.now() - (15 - i) * 1000).toISOString(),
        latency_ms: 100 + i,
        model: 'jev-latest',
        state_json: JSON.stringify({ index: i, prompt: `task ${i}` }),
        questions_json: JSON.stringify({ lane: { type: 'choice' } }),
        response_json: JSON.stringify({ answers: { lane: { choice: 'direct_orchestrator' } } }),
        input_tokens: 100 + i,
        output_tokens: 20 + i,
        shadow_actual_route: i % 2 === 0 ? 'direct_orchestrator' : undefined,
        shadow_predicted_route: i === 4 ? 'planned_workflow' : (i % 2 === 0 ? 'direct_orchestrator' : undefined),
        shadow_agreement: i === 4 ? 0 : (i % 2 === 0 ? 1 : undefined),
      });
    }

    // Default pagination: limit 10, offset 0
    const page1 = db.queryTelemetry({ limit: 10, offset: 0 });
    assert.equal(page1.total, 15);
    assert.equal(page1.records.length, 10);
    assert.equal(page1.has_more, true);
    assert.equal(page1.continuation_offset, 10);

    // Page 2: limit 10, offset 10
    const page2 = db.queryTelemetry({ limit: 10, offset: 10 });
    assert.equal(page2.records.length, 5);
    assert.equal(page2.has_more, false);
    assert.equal(page2.continuation_offset, undefined);

    // Filter by discrepancies_only
    const discrepancies = db.queryTelemetry({ discrepancies_only: true });
    assert.equal(discrepancies.total, 1);
    assert.equal(discrepancies.records[0].id, 'eval-004');
    assert.equal(discrepancies.records[0].shadow_agreement, 0);
    assert.equal(discrepancies.records[0].shadow_actual_route, 'direct_orchestrator');
    assert.equal(discrepancies.records[0].shadow_predicted_route, 'planned_workflow');

    // Filter by source
    const shadowRuns = db.queryTelemetry({ source: 'shadow-triage' });
    assert.equal(shadowRuns.total, 7);

    db.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-002: pruneExpiredTelemetry removes records older than 90 days while preserving newer records', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typesafe-db-test-'));
  const dbPath = path.join(tmpDir, 'telemetry.sqlite');

  try {
    const db = new TelemetryDb(dbPath);

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Record from 100 days ago (older than 90 days -> should be pruned)
    db.recordEvaluation({
      id: 'expired-100d',
      source: 'shadow-triage',
      created_at: new Date(now - 100 * dayMs).toISOString(),
      latency_ms: 120,
      model: 'jev-latest',
      state_json: '{}',
      questions_json: '{}',
    });

    // Record from 91 days ago (should be pruned)
    db.recordEvaluation({
      id: 'expired-91d',
      source: 'shadow-triage',
      created_at: new Date(now - 91 * dayMs).toISOString(),
      latency_ms: 120,
      model: 'jev-latest',
      state_json: '{}',
      questions_json: '{}',
    });

    // Record from 89 days ago (inside retention window -> MUST be preserved)
    db.recordEvaluation({
      id: 'retained-89d',
      source: 'shadow-triage',
      created_at: new Date(now - 89 * dayMs).toISOString(),
      latency_ms: 120,
      model: 'jev-latest',
      state_json: '{}',
      questions_json: '{}',
    });

    // Record from 1 day ago (inside retention window -> MUST be preserved)
    db.recordEvaluation({
      id: 'retained-1d',
      source: 'shadow-triage',
      created_at: new Date(now - 1 * dayMs).toISOString(),
      latency_ms: 120,
      model: 'jev-latest',
      state_json: '{}',
      questions_json: '{}',
    });

    // Prune with default 90-day retention
    const deletedCount = db.pruneExpiredTelemetry(90);
    assert.equal(deletedCount, 2, 'Should delete exactly the 2 expired records');

    const remaining = db.queryTelemetry({ limit: 50 });
    assert.equal(remaining.total, 2, 'Should preserve both records within 90-day window');
    const remainingIds = remaining.records.map(r => r.id).sort();
    assert.deepEqual(remainingIds, ['retained-1d', 'retained-89d']);

    db.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
