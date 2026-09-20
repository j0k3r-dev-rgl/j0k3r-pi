import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { createEvaluateTool } from '../src/tools/evaluate-tool.ts';
import { createTelemetryTool } from '../src/tools/telemetry-tool.ts';
import { renderTypesafeResult } from '../src/render/index.ts';
import { TelemetryDb } from '../src/storage/telemetry-db.ts';

test('MINI-003: SimpleTextComponent wraps/truncates every line to render width constraint', async () => {
  const { SimpleTextComponent } = await import('../src/render/index.ts');
  const longText = 'This is a very long line of text that exceeds standard terminal widths by a considerable margin and should be wrapped safely.';
  const component = new SimpleTextComponent(longText);

  // Render with width 40
  const lines40 = component.render(40);
  assert.ok(lines40.length > 1, 'Long text must be broken into multiple lines for width 40');
  for (const line of lines40) {
    const clean = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    assert.ok(clean.length <= 40, `Rendered line must not exceed width 40: "${clean}" (length: ${clean.length})`);
  }

  // Render with ANSI styling and width 30
  const ansiText = '\x1b[32mStyled green text\x1b[0m followed by more words that definitely exceed thirty columns limit.';
  const ansiComp = new SimpleTextComponent(ansiText);
  const lines30 = ansiComp.render(30);
  for (const line of lines30) {
    const clean = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    assert.ok(clean.length <= 30, `Rendered ANSI line must not exceed width 30: "${clean}" (length: ${clean.length})`);
  }
});

test('MINI-004: explicit shadow triage tool validates route enum and records agreement telemetry', async () => {
  const { createShadowTool } = await import('../src/tools/shadow-tool.ts');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typesafe-shadow-tool-test-'));
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
            confidence: 0.95,
            probabilities: { direct_orchestrator: 0.05, planned_workflow: 0.95 }
          },
          is_complex_workflow: { type: 'noul', noul: 0.9 },
          requires_investigation: { type: 'noul', noul: 0.1 }
        },
        responses: {},
        usage: { input_tokens: 220, output_tokens: 35 },
        latency_ms: 150
      })
    };

    const shadowTool = createShadowTool(mockClient, db);
    assert.ok(shadowTool);
    assert.equal(shadowTool.name, 'typesafe_record_shadow_triage');

    // Execute with match: route = 'planned_workflow'
    const matchRes = await shadowTool.execute('call-match', {
      original_prompt: 'Build a multi-agent workflow system with SQLite telemetry',
      route: 'planned_workflow'
    });

    assert.ok(matchRes.content);
    assert.equal(matchRes.details.actual_route, 'planned_workflow');
    assert.equal(matchRes.details.predicted_route, 'planned_workflow');
    assert.equal(matchRes.details.shadow_agreement, 1);

    // Verify persisted record in DB
    const rows = db.queryTelemetry({ source: 'shadow-triage' });
    assert.equal(rows.total, 1);
    assert.equal(rows.records[0].shadow_actual_route, 'planned_workflow');
    assert.equal(rows.records[0].shadow_predicted_route, 'planned_workflow');
    assert.equal(rows.records[0].shadow_agreement, 1);

    // Execute with discrepancy: route = 'direct_orchestrator'
    const discRes = await shadowTool.execute('call-disc', {
      original_prompt: 'Build a multi-agent workflow system with SQLite telemetry',
      route: 'direct_orchestrator'
    });
    assert.equal(discRes.details.actual_route, 'direct_orchestrator');
    assert.equal(discRes.details.predicted_route, 'planned_workflow');
    assert.equal(discRes.details.shadow_agreement, 0);

    const discRows = db.queryTelemetry({ source: 'shadow-triage', discrepancies_only: true });
    assert.equal(discRows.total, 1);
    assert.equal(discRows.records[0].shadow_actual_route, 'direct_orchestrator');
    assert.equal(discRows.records[0].shadow_agreement, 0);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-003: evaluate tool validates input, calls provider, persists telemetry, and returns details', async () => {

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typesafe-tool-test-'));
  const dbPath = path.join(tmpDir, 'telemetry.sqlite');
  const db = new TelemetryDb(dbPath);

  try {
    // Mock client evaluation
    const mockClient = {
      evaluateSystemOne: async (req, _options) => ({
        model: 'jev-1.13.0',
        answers: {
          test_lane: {
            type: 'choice',
            choice: 'direct_orchestrator',
            confidence: 0.95,
            probabilities: { direct_orchestrator: 0.95, planned_workflow: 0.05 }
          }
        },
        responses: {
          test_lane: {
            type: 'choice',
            choice: 'direct_orchestrator',
            confidence: 0.95,
            probabilities: { direct_orchestrator: 0.95, planned_workflow: 0.05 }
          }
        },
        usage: { input_tokens: 180, output_tokens: 25 },
        latency_ms: 120
      })
    };

    const evaluateTool = createEvaluateTool(mockClient, db);
    assert.equal(evaluateTool.name, 'typesafe_evaluate');
    assert.ok(evaluateTool.description);
    assert.ok(evaluateTool.parameters);

    const result = await evaluateTool.execute('call-1', {
      state: { prompt: 'Fix readme typo' },
      questions: {
        test_lane: {
          type: 'choice',
          instructions: 'Which lane?',
          criteria: { direct_orchestrator: 'simple', planned_workflow: 'complex' }
        }
      }
    });

    assert.ok(result.content);
    assert.equal(result.details.model, 'jev-1.13.0');
    assert.equal(result.details.latency_ms, 120);
    assert.equal(result.details.input_tokens, 180);
    assert.equal(result.details.output_tokens, 25);
    assert.ok(result.details.telemetry_id);

    // Verify it was stored in SQLite
    const saved = db.queryTelemetry({ limit: 1 });
    assert.equal(saved.total, 1);
    assert.equal(saved.records[0].source, 'evaluate-tool');
    assert.equal(saved.records[0].id, result.details.telemetry_id);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-003: telemetry tool queries records and returns bounded summary with continuation instructions', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typesafe-telemetry-tool-test-'));
  const dbPath = path.join(tmpDir, 'telemetry.sqlite');
  const db = new TelemetryDb(dbPath);

  try {
    for (let i = 1; i <= 12; i++) {
      db.recordEvaluation({
        id: `eval-${i}`,
        source: 'shadow-triage',
        created_at: new Date(Date.now() - (12 - i) * 1000).toISOString(),
        latency_ms: 50,
        model: 'jev-latest',
        state_json: '{}',
        questions_json: '{}',
        shadow_agreement: i % 3 === 0 ? 0 : 1,
        shadow_actual_route: 'direct_orchestrator',
        shadow_predicted_route: i % 3 === 0 ? 'planned_workflow' : 'direct_orchestrator',
      });
    }

    const telemetryTool = createTelemetryTool(db);
    assert.equal(telemetryTool.name, 'typesafe_telemetry');

    // Page 1
    const res1 = await telemetryTool.execute('call-2', { limit: 5, offset: 0 });
    assert.equal(res1.details.total, 12);
    assert.equal(res1.details.records_count, 5);
    assert.equal(res1.details.has_more, true);
    assert.equal(res1.details.continuation_offset, 5);
    assert.ok(res1.content[0].text.includes('continuation') || res1.content[0].text.includes('has_more: true'));

    // Filter discrepancies
    const resDisc = await telemetryTool.execute('call-3', { discrepancies_only: true });
    assert.equal(resDisc.details.total, 4);
    assert.equal(resDisc.details.has_more, false);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MINI-003: renderer produces compact collapsed view and rich ANSI expanded view', () => {
  const dummyTheme = {
    fg: (_color, text) => text,
    bold: (text) => text,
  };

  const dummyContext = {
    keybindings: {
      get: (id) => (id === 'app.tools.expand' ? 'ctrl+o' : undefined)
    }
  };

  // 1. Partial state
  const partialComponent = renderTypesafeResult(
    { content: [], details: {} },
    { expanded: false, isPartial: true },
    dummyTheme,
    dummyContext
  );
  assert.ok(partialComponent);
  assert.ok(partialComponent.text.includes('Evaluating') || partialComponent.text.includes('Processing'));

  // 2. Collapsed success view
  const successResult = {
    content: [{ type: 'text', text: 'summary' }],
    details: {
      telemetry_id: 'eval-999',
      model: 'jev-1.13.0',
      latency_ms: 125,
      input_tokens: 150,
      output_tokens: 20,
      answers: {
        lane: { type: 'choice', choice: 'direct_orchestrator', confidence: 0.98 }
      }
    }
  };

  const collapsedComponent = renderTypesafeResult(
    successResult,
    { expanded: false, isPartial: false },
    dummyTheme,
    dummyContext
  );
  assert.ok(collapsedComponent.text.includes('typesafe'));
  assert.ok(collapsedComponent.text.includes('125ms'));
  assert.ok(collapsedComponent.text.includes('direct_orchestrator'));
  assert.ok(collapsedComponent.text.includes('ctrl+o'));

  // 3. Expanded view
  const expandedComponent = renderTypesafeResult(
    successResult,
    { expanded: true, isPartial: false },
    dummyTheme,
    dummyContext
  );
  assert.ok(expandedComponent.text.includes('eval-999'));
  assert.ok(expandedComponent.text.includes('direct_orchestrator'));
  assert.ok(expandedComponent.text.includes('jev-1.13.0'));
});

test('MINI-001: borders.ts exports palette and accurate width-safe box primitives', async () => {
  const borders = await import('../src/render/borders.ts');
  assert.equal(borders.YELLOW, '\x1b[1;38;2;255;230;0m');
  assert.equal(borders.RED, '\x1b[1;38;2;255;77;109m');
  assert.equal(borders.LIME, '\x1b[1;38;2;102;255;102m');
  assert.equal(borders.AMBER, '\x1b[1;38;2;255;184;77m');
  assert.equal(borders.DIM, '\x1b[2m');
  assert.equal(borders.RESET, '\x1b[0m');

  // electric wrapper
  const styled = borders.electric(borders.YELLOW, 'TypeSafe');
  assert.equal(styled, `${borders.YELLOW}TypeSafe${borders.RESET}`);

  // visibleWidth with ANSI and CJK
  assert.equal(borders.visibleWidth(styled), 8);
  assert.equal(borders.visibleWidth('Hello 世界'), 10); // 'Hello ' (6) + '世界' (4) = 10

  // fit and pad
  assert.equal(borders.fit('abcdefghij', 5), 'abcde');
  assert.equal(borders.visibleWidth(borders.pad('test', 10)), 10);

  // Exact border width test for terminal width 60 (innerWidth = 58)
  const innerWidth = 58;
  const top = borders.cardTopBorder('typesafe_evaluate', 'jev-1.13.0', innerWidth);
  const bottom = borders.cardBottomBorder(innerWidth);
  const line = borders.boxLine('Body content', innerWidth);

  assert.equal(borders.visibleWidth(top), innerWidth + 2, 'Top border must match innerWidth + 2');
  assert.equal(borders.visibleWidth(bottom), innerWidth + 2, 'Bottom border must match innerWidth + 2');
  assert.equal(borders.visibleWidth(line), innerWidth + 2, 'Box line must match innerWidth + 2');

  // toolHint
  const hint = borders.toolHint('to expand');
  assert.ok(hint.includes('Ctrl+O'));
  assert.ok(hint.includes('to expand'));
  assert.ok(hint.includes(borders.DIM));
});

test('MINI-002: Hollow card call & result components coordinate via context.state', async () => {
  const { TypesafeCardCallComponent, TypesafeCardResultComponent } = await import('../src/render/components.ts');
  const { YELLOW, RED } = await import('../src/render/borders.ts');

  const state = {};
  const callComp = new TypesafeCardCallComponent(
    'typesafe_evaluate',
    () => 'jev-1.13.0',
    () => '● Evaluating...',
    (s) => (s.isError ? RED : YELLOW),
    state
  );

  // Pending call renders full box (top border, body, bottom border)
  const pendingLines = callComp.render(60);
  assert.equal(pendingLines.length, 3);
  assert.ok(pendingLines[0].includes('typesafe_evaluate'));
  assert.ok(pendingLines[1].includes('Evaluating...'));
  assert.ok(pendingLines[2].includes('╰'));

  // Once result is ready, callComp renders ONLY top border line
  const resultComp = new TypesafeCardResultComponent(
    () => ['Result summary line'],
    (s) => (s.isError ? RED : YELLOW),
    state
  );
  state.hasResult = true;

  const settledCallLines = callComp.render(60);
  assert.equal(settledCallLines.length, 1, 'Settled call must render only the top border line');
  assert.ok(settledCallLines[0].includes('typesafe_evaluate'));

  const resultLines = resultComp.render(60);
  assert.equal(resultLines.length, 2, 'Result component renders framed body + bottom border');
  assert.ok(resultLines[0].includes('Result summary line'));
  assert.ok(resultLines[1].includes('╰'));

  // Width < 24 narrow fallback
  const narrowCall = callComp.render(20);
  assert.equal(narrowCall.length, 1);
  assert.ok(!narrowCall[0].includes('╭'));
  const narrowResult = resultComp.render(20);
  assert.equal(narrowResult.length, 0);

  // Invalidation clears cache
  resultComp.invalidate();
  callComp.invalidate();
});

test('MINI-003: Renderers across states for evaluate, telemetry, shadow, and errors', async () => {
  const { renderTypesafeCall, renderTypesafeResult } = await import('../src/render/index.ts');
  const { YELLOW, RED, AMBER, LIME } = await import('../src/render/borders.ts');

  // 1. Evaluate pending call
  const callContext = { state: {}, isError: false };
  const evalCall = renderTypesafeCall({ questions: { test: {} } }, null, callContext);
  const evalCallLines = evalCall.render(60);
  assert.ok(evalCallLines[0].includes('typesafe_evaluate'));
  assert.ok(evalCallLines[1].includes('Evaluating with TypeSafe System One'));

  // 2. Evaluate collapsed result
  const evalRes = {
    content: [],
    details: {
      model: 'jev-1.13.0',
      latency_ms: 125,
      input_tokens: 150,
      output_tokens: 20,
      answers: {
        lane: { type: 'choice', choice: 'direct_orchestrator', confidence: 0.98 }
      }
    }
  };
  const evalResComp = renderTypesafeResult(evalRes, { expanded: false }, null, callContext);
  const evalResLines = evalResComp.render(100);
  assert.equal(callContext.state.hasResult, true);
  assert.ok(evalResLines[0].includes('[typesafe]'));
  assert.ok(evalResLines[0].includes('lane=direct_orchestrator (98%)'));
  assert.ok(evalResLines[1].includes('╰'));

  // 3. Shadow triage match
  const shadowContext = { state: {}, isError: false };
  const shadowMatchRes = {
    content: [],
    details: {
      actual_route: 'planned_workflow',
      predicted_route: 'planned_workflow',
      shadow_agreement: 1
    }
  };
  const shadowMatchComp = renderTypesafeResult(shadowMatchRes, { expanded: false }, null, shadowContext);
  const shadowMatchLines = shadowMatchComp.render(120);
  assert.ok(shadowMatchLines[0].includes('Match'));
  assert.ok(shadowMatchLines[0].includes('[typesafe:shadow]'));

  // 4. Shadow triage discrepancy with Amber badge
  const shadowDiscContext = { state: {}, isError: false };
  const shadowDiscRes = {
    content: [],
    details: {
      actual_route: 'direct_orchestrator',
      predicted_route: 'planned_workflow',
      shadow_agreement: 0
    }
  };
  const shadowDiscComp = renderTypesafeResult(shadowDiscRes, { expanded: false }, null, shadowDiscContext);
  const shadowDiscLines = shadowDiscComp.render(120);
  assert.ok(shadowDiscLines[0].includes('DISCREPANCY'));
  assert.ok(shadowDiscLines[0].includes(AMBER), 'Discrepancy must be styled in Amber');

  // 5. Shadow triage expanded view with consultative disclaimer
  const shadowExpandedComp = renderTypesafeResult(shadowDiscRes, { expanded: true }, null, shadowDiscContext);
  const shadowExpandedLines = shadowExpandedComp.render(80);
  const fullText = shadowExpandedLines.join('\n');
  assert.ok(fullText.includes('LLM triage route selection remains 100% authoritative.'));

  // 6. Telemetry collapsed view
  const telemetryContext = { state: {}, isError: false };
  const telemetryRes = {
    content: [],
    details: {
      records_count: 5,
      total: 12,
      offset: 0
    }
  };
  const telemetryComp = renderTypesafeResult(telemetryRes, { expanded: false }, null, telemetryContext);
  const telemetryLines = telemetryComp.render(80);
  assert.ok(telemetryLines[0].includes('[typesafe:telemetry]'));
  assert.ok(telemetryLines[0].includes('5 records (total 12)'));

  // 7. Error state
  const errorContext = { state: {}, isError: true };
  const errorRes = {
    content: [],
    details: { error: 'Authentication failed: invalid token' }
  };
  const errorComp = renderTypesafeResult(errorRes, { expanded: false }, null, errorContext);
  const errorLines = errorComp.render(60);
  assert.ok(errorLines[0].includes('TypeSafe Error'));
  assert.ok(errorLines[0].includes(RED), 'Error border must be Neon Red');
});

test('MINI-004: registerTypesafeTools configures renderShell: self and renderCall on all tools', async () => {
  const { registerTypesafeTools } = await import('../src/tools/index.ts');
  const { renderTypesafeCall, renderTypesafeResult } = await import('../src/render/index.ts');

  const registered = [];
  const mockPi = {
    registerTool: (tool) => {
      registered.push(tool);
    }
  };
  const mockDb = {};

  registerTypesafeTools(mockPi, mockDb);
  assert.equal(registered.length, 6, 'Must register evaluate, telemetry, shadow, shadow_triage, circuit_breaker, and overengineering');

  for (const tool of registered) {
    assert.equal(tool.renderShell, 'self', `Tool ${tool.name} must declare renderShell: 'self'`);
    assert.equal(tool.renderCall, renderTypesafeCall, `Tool ${tool.name} must wire renderCall`);
    assert.equal(tool.renderResult, renderTypesafeResult, `Tool ${tool.name} must wire renderResult`);
  }
});

test('MINI-005: Static independence guard - zero cross-extension imports or external dependencies', async () => {
  const renderDir = path.resolve(import.meta.dirname, '../src/render');
  const files = fs.readdirSync(renderDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(renderDir, file), 'utf8');
    assert.ok(
      !content.includes('j0k3r-theme'),
      `File ${file} must not contain references or imports to j0k3r-theme`
    );
    // Check that import statements only import from node:*, local files (. or ..), or @earendil-works/pi-coding-agent type imports
    const importLines = content.split('\n').filter((l) => l.trim().startsWith('import ') || l.trim().startsWith('export * from'));
    for (const line of importLines) {
      assert.ok(
        !line.includes('pi-tui') || line.includes('type '),
        `File ${file} should not have runtime imports from pi-tui: ${line}`
      );
      assert.ok(
        !line.includes('chalk') && !line.includes('cli-color') && !line.includes('kleur'),
        `File ${file} must have zero external color dependencies: ${line}`
      );
    }
  }
});
