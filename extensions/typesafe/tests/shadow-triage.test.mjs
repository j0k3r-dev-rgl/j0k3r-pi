import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  evaluateShadowTriage,
  buildTriageQuestions,
} from '../src/shadow/triage-shadow.ts';
import { TelemetryDb } from '../src/storage/telemetry-db.ts';

test('MINI-004: buildTriageQuestions defines canonical choice and noul questions', () => {
  const questions = buildTriageQuestions();
  assert.ok(questions.suggested_lane);
  assert.equal(questions.suggested_lane.type, 'choice');
  assert.ok(questions.suggested_lane.criteria.direct_orchestrator);
  assert.ok(questions.suggested_lane.criteria.planned_workflow);
  assert.ok(questions.suggested_lane.criteria.deep_researcher);

  assert.ok(questions.is_complex_workflow);
  assert.equal(questions.is_complex_workflow.type, 'noul');

  assert.ok(questions.requires_investigation);
  assert.equal(questions.requires_investigation.type, 'noul');
});

test('MINI-004: evaluateShadowTriage records match agreement = 1 when predicted matches actual', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typesafe-shadow-match-'));
  const dbPath = path.join(tmpDir, 'telemetry.sqlite');
  const db = new TelemetryDb(dbPath);

  try {
    const mockClient = {
      evaluateSystemOne: async (_req, _opt) => ({
        model: 'jev-1.13.0',
        answers: {
          suggested_lane: {
            type: 'choice',
            choice: 'direct_orchestrator',
            confidence: 0.96,
            probabilities: { direct_orchestrator: 0.96, planned_workflow: 0.04 }
          },
          is_complex_workflow: { type: 'noul', noul: 0.05 },
          requires_investigation: { type: 'noul', noul: 0.02 }
        },
        responses: {},
        usage: { input_tokens: 210, output_tokens: 30 },
        latency_ms: 110
      })
    };

    const result = await evaluateShadowTriage(
      'Fix typo in README',
      'direct_orchestrator',
      'session-abc',
      { client: mockClient, db }
    );

    assert.ok(result);
    assert.equal(result.shadow_agreement, 1);
    assert.equal(result.shadow_predicted_route, 'direct_orchestrator');
    assert.equal(result.shadow_actual_route, 'direct_orchestrator');

    // Check database row
    const rows = db.queryTelemetry({ source: 'shadow-triage' });
    assert.equal(rows.total, 1);
    assert.equal(rows.records[0].shadow_agreement, 1);
    assert.equal(rows.records[0].shadow_actual_route, 'direct_orchestrator');
    assert.equal(rows.records[0].shadow_predicted_route, 'direct_orchestrator');
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-004: evaluateShadowTriage records discrepancy agreement = 0 when predicted differs from actual', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typesafe-shadow-discrepancy-'));
  const dbPath = path.join(tmpDir, 'telemetry.sqlite');
  const db = new TelemetryDb(dbPath);

  try {
    const mockClient = {
      evaluateSystemOne: async (_req, _opt) => ({
        model: 'jev-1.13.0',
        answers: {
          suggested_lane: {
            type: 'choice',
            choice: 'planned_workflow',
            confidence: 0.82,
            probabilities: { direct_orchestrator: 0.18, planned_workflow: 0.82 }
          },
          is_complex_workflow: { type: 'noul', noul: 0.85 },
          requires_investigation: { type: 'noul', noul: 0.1 }
        },
        responses: {},
        usage: { input_tokens: 220, output_tokens: 30 },
        latency_ms: 130
      })
    };

    // Orchestrator actually took direct_orchestrator
    const result = await evaluateShadowTriage(
      'Refactor telemetry DB with schema migrations',
      'direct_orchestrator',
      'session-xyz',
      { client: mockClient, db }
    );

    assert.ok(result);
    assert.equal(result.shadow_agreement, 0);
    assert.equal(result.shadow_predicted_route, 'planned_workflow');
    assert.equal(result.shadow_actual_route, 'direct_orchestrator');

    const discrepancies = db.queryTelemetry({ discrepancies_only: true });
    assert.equal(discrepancies.total, 1);
    assert.equal(discrepancies.records[0].shadow_agreement, 0);
    assert.equal(discrepancies.records[0].shadow_predicted_route, 'planned_workflow');
    assert.equal(discrepancies.records[0].shadow_actual_route, 'direct_orchestrator');
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-004: evaluateShadowTriage handles slow/failed API calls gracefully without throwing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typesafe-shadow-fail-'));
  const dbPath = path.join(tmpDir, 'telemetry.sqlite');
  const db = new TelemetryDb(dbPath);

  try {
    const failingClient = {
      evaluateSystemOne: async () => {
        throw new Error('Network outage');
      }
    };

    // Must return null or error object, NEVER throw
    const result = await evaluateShadowTriage(
      'Investigate bug in auth',
      'deep_researcher',
      'session-fail',
      { client: failingClient, db }
    );

    assert.equal(result, null);

    // Verifies an error record was saved to SQLite
    const saved = db.queryTelemetry({ source: 'shadow-triage' });
    assert.equal(saved.total, 1);
    assert.ok(saved.records[0].error.includes('Network outage'));
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
