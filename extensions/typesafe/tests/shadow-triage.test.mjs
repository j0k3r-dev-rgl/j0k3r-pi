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

test('MINI-004: evaluateShadowTriage enriches state with project_context when calling Jev', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typesafe-shadow-ctx-'));
  const dbPath = path.join(tmpDir, 'telemetry.sqlite');
  const db = new TelemetryDb(dbPath);

  // Create a fake package.json so detectProjectContext finds a stack
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }));
  // Create a fake src dir with files
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.ts'), 'export const a = 1;');
  fs.writeFileSync(path.join(tmpDir, 'src', 'b.ts'), 'export const b = 2;');

  const capturedRequests = [];
  const mockClient = {
    evaluateSystemOne: async (req, _opt) => {
      capturedRequests.push(req);
      return {
        model: 'jev-1.13.0',
        answers: {
          suggested_lane: {
            type: 'choice',
            choice: 'planned_workflow',
            confidence: 0.90,
            probabilities: { planned_workflow: 0.90, direct_orchestrator: 0.10 }
          },
          is_complex_workflow: { type: 'noul', noul: 0.8 },
          requires_investigation: { type: 'noul', noul: 0.2 }
        },
        responses: {},
        usage: { input_tokens: 240, output_tokens: 32 },
        latency_ms: 120
      };
    }
  };

  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    const result = await evaluateShadowTriage(
      'investigate how to add OAuth2 with PKCE in React Native',
      'planned_workflow',
      'session-ctx',
      { client: mockClient, db }
    );

    assert.ok(result);
    assert.equal(capturedRequests.length, 1);
    const state = capturedRequests[0].state;
    assert.ok(state.project_context, 'state must include project_context');
    assert.equal(state.project_context.stack, 'nodejs', 'should detect nodejs stack');
    assert.ok(typeof state.project_context.file_count_approx === 'number', 'file_count_approx must be a number');
    assert.ok(state.project_context.file_count_approx >= 2, 'should count at least src files');
    assert.equal(state.project_context.has_codegraph_index, false, 'no codegraph index in tmp dir');
  } finally {
    process.chdir(originalCwd);
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-004: buildTriageQuestions instructs Jev to distinguish scoped work from pure investigation', () => {
  const questions = buildTriageQuestions();
  const instructions = questions.suggested_lane.instructions;
  assert.ok(instructions.includes('specific technologies'), 'must mention specific technologies');
  assert.ok(instructions.includes('pure open-ended exploration'), 'must tell Jev what pure investigation is');
  assert.ok(questions.requires_investigation.instructions.includes('WITHOUT naming'), 'must qualify investigation by absence of named stack/files');
});

test('MINI-004: evaluateShadowTriage handles empty prompt gracefully', async () => {
  const result = await evaluateShadowTriage('', 'direct_orchestrator');
  assert.equal(result, null);
});

test('MINI-004: evaluateShadowTriage includes triage_policy in state sent to Jev', async () => {
  const capturedRequests = [];
  const mockClient = {
    evaluateSystemOne: async (req, _opt) => {
      capturedRequests.push(req);
      return {
        model: 'jev-1.13.0',
        answers: {
          suggested_lane: { type: 'choice', choice: 'planned_workflow', confidence: 0.90, probabilities: {} },
          is_complex_workflow: { type: 'noul', noul: 0.8 },
          requires_investigation: { type: 'noul', noul: 0.2 }
        },
        responses: {},
        usage: { input_tokens: 240, output_tokens: 32 },
        latency_ms: 120
      };
    }
  };

  const result = await evaluateShadowTriage('test prompt', 'direct_orchestrator', undefined, { client: mockClient });
  assert.ok(result);
  assert.equal(capturedRequests.length, 1);
  assert.ok(capturedRequests[0].state.triage_policy, 'state must include triage_policy');
  assert.ok(capturedRequests[0].state.triage_policy.includes('direct_orchestrator'), 'policy must mention direct_orchestrator');
  assert.ok(capturedRequests[0].state.triage_policy.includes('deep_researcher'), 'policy must mention deep_researcher');
});

test('MINI-004: evaluateShadowTriage flags discrepancy and requires user decision when routes differ', async () => {
  const mockClient = {
    evaluateSystemOne: async (_req, _opt) => ({
      model: 'jev-1.13.0',
      answers: {
        suggested_lane: {
          type: 'choice',
          choice: 'deep_researcher',
          confidence: 0.85,
          probabilities: { deep_researcher: 0.85, planned_workflow: 0.15 }
        },
        is_complex_workflow: { type: 'noul', noul: 0.3 },
        requires_investigation: { type: 'noul', noul: 0.9 }
      },
      responses: {},
      usage: { input_tokens: 230, output_tokens: 30 },
      latency_ms: 100
    })
  };

  const result = await evaluateShadowTriage(
    'investigate how to implement OAuth2',
    'planned_workflow',
    undefined,
    { client: mockClient }
  );

  assert.ok(result);
  assert.equal(result.shadow_agreement, 0, 'agreement must be 0 when routes differ');
  assert.equal(result.discrepancy_detected, true, 'must flag discrepancy');
  assert.equal(result.user_decision_required, true, 'must require user decision');
  assert.ok(result.jev_recommendation?.includes('deep_researcher'), 'must include Jev recommendation');
  assert.ok(result.orchestrator_recommendation?.includes('planned_workflow'), 'must include orchestrator recommendation');
});

test('MINI-004: evaluateShadowTriage does NOT flag discrepancy when routes agree', async () => {
  const mockClient = {
    evaluateSystemOne: async (_req, _opt) => ({
      model: 'jev-1.13.0',
      answers: {
        suggested_lane: {
          type: 'choice',
          choice: 'direct_orchestrator',
          confidence: 0.95,
          probabilities: { direct_orchestrator: 0.95, planned_workflow: 0.05 }
        },
        is_complex_workflow: { type: 'noul', noul: 0.1 },
        requires_investigation: { type: 'noul', noul: 0.05 }
      },
      responses: {},
      usage: { input_tokens: 210, output_tokens: 28 },
      latency_ms: 90
    })
  };

  const result = await evaluateShadowTriage(
    'fix typo in readme',
    'direct_orchestrator',
    undefined,
    { client: mockClient }
  );

  assert.ok(result);
  assert.equal(result.shadow_agreement, 1, 'agreement must be 1 when routes match');
  assert.equal(result.discrepancy_detected, false, 'must NOT flag discrepancy when routes agree');
  assert.equal(result.user_decision_required, false, 'must NOT require user decision when routes agree');
});
