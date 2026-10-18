import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeLib, identityTheme, fakeKeybindings, mouseClick, mouseWheel, visibleWidth } from './fixtures/fake-tui.ts';
import { DEFAULT_SUPERVISOR_CONFIG, type SupervisorConfig } from '../src/supervisor-config.ts';
import { getPanelRowIds, type SupervisorPanelState } from '../src/supervisor-panel.ts';
import {
  createSupervisorDashboard,
  getSubagentRowIds,
  SUBAGENT_MODEL_COUNT_RANGE,
  type SubagentConfig,
} from '../src/supervisor-dashboard.ts';
import type { ModelCandidate } from '../src/types.ts';

/**
 * These tests drive the two-tab supervisor dialog through the host component surface only
 * (`render`, `handleInput`, `handleMouse`, `activeTab`, `selectedRowId`). Persistence is
 * injected: the dashboard must call the supplied `applyConfig` for every edit and must
 * never keep a shadow document of its own.
 */

const accountCandidate = (prefix: string, slug: string): ModelCandidate => ({
  id: `cliproxyapi/${prefix}/${slug}`,
  source: 'account',
  quotaProtocol: slug.startsWith('gemini') ? 'gemini' : 'wham',
  prefix,
  family: slug.startsWith('gemini') ? 'gemini' : 'codex',
  modelSlug: slug,
  provider: 'cliproxyapi',
  reasoningEffort: 'high',
});

const registeredCandidate = (id: string, provider: string): ModelCandidate => ({
  id,
  source: 'registered',
  quotaProtocol: 'none',
  modelSlug: id.slice(id.indexOf('/') + 1),
  provider,
  reasoningEffort: 'high',
});

const orchMain = 'cliproxyapi/main/gpt-6.1-sol';
const orchSecond = 'cliproxyapi/second/gpt-6.1-sol';
const orchFallback = 'cliproxyapi/fallback-a/gemini-3.8-flash-high';

const orchCatalog: ModelCandidate[] = [
  accountCandidate('main', 'gpt-6.1-sol'),
  accountCandidate('second', 'gpt-6.1-sol'),
  accountCandidate('fallback-a', 'gemini-3.8-flash-high'),
];

/** The Pi registry catalogue a host would supply for subagents: provided models only. */
const piCandidates: ModelCandidate[] = [
  registeredCandidate('anthropic/claude-sonnet-4', 'anthropic'),
  registeredCandidate('openai/gpt-5-codex', 'openai'),
  registeredCandidate('google/gemini-3-pro', 'google'),
  registeredCandidate('openrouter/meta-llama/llama-3-70b', 'openrouter'),
  registeredCandidate('xai/grok-4', 'xai'),
];

const piIds = piCandidates.map(candidate => candidate.id);

interface DashboardHarnessOptions {
  orchestratorConfig?: Partial<SupervisorConfig>;
  subagentConfig?: Partial<SubagentConfig>;
  orchestratorCandidates?: ModelCandidate[];
  subagentCandidates?: ModelCandidate[];
  subagentError?: string;
  bound?: boolean;
  state?: Partial<SupervisorPanelState>;
  failOrchestratorApply?: boolean;
  failSubagentApply?: boolean;
}

function harness(options: DashboardHarnessOptions = {}) {
  let orchestratorConfig: SupervisorConfig = {
    ...DEFAULT_SUPERVISOR_CONFIG,
    ...options.orchestratorConfig,
    priorityCandidateIds: [...(options.orchestratorConfig?.priorityCandidateIds ?? DEFAULT_SUPERVISOR_CONFIG.priorityCandidateIds)],
  };
  let subagentConfig: SubagentConfig = {
    enabled: false,
    modelCount: 5,
    priorityCandidateIds: [],
    ...options.subagentConfig,
    priorityCandidateIds: [...(options.subagentConfig?.priorityCandidateIds ?? [])],
  };
  const orchestratorPatches: Array<Partial<SupervisorConfig>> = [];
  const subagentPatches: Array<Partial<SubagentConfig>> = [];
  const enabledChanges: Array<[boolean, boolean | undefined]> = [];
  const errors: string[] = [];
  let closed = 0;
  let bound = options.bound ?? true;

  const cloneOrchestrator = (): SupervisorConfig => ({ ...orchestratorConfig, priorityCandidateIds: [...orchestratorConfig.priorityCandidateIds] });
  const cloneSubagent = (): SubagentConfig => ({ ...subagentConfig, priorityCandidateIds: [...subagentConfig.priorityCandidateIds] });

  const component = createSupervisorDashboard({
    orchestrator: {
      lib: fakeLib,
      tui: { requestRender: () => {} },
      theme: identityTheme,
      keybindings: fakeKeybindings,
      config: orchestratorConfig,
      state: () => ({
        enabled: orchestratorConfig.enabled,
        running: true,
        status: 'active',
        activeModel: orchMain,
        uncertain: 0,
        inventory: orchMain,
        ...options.state,
      }),
      candidates: options.orchestratorCandidates ?? orchCatalog,
      discoveryFailed: false,
      isBound: () => bound,
      applyConfig: patch => {
        if (options.failOrchestratorApply) throw new Error('lock held');
        orchestratorPatches.push(patch);
        orchestratorConfig = { ...orchestratorConfig, ...patch };
        if (patch.priorityCandidateIds) orchestratorConfig.priorityCandidateIds = [...patch.priorityCandidateIds];
        return cloneOrchestrator();
      },
      onEnabledChange: (enabled, acknowledgeUncertain) => { enabledChanges.push([enabled, acknowledgeUncertain]); },
      onError: message => { errors.push(message); },
      done: () => { closed += 1; },
    },
    subagents: {
      config: subagentConfig,
      candidates: options.subagentCandidates ?? piCandidates,
      error: options.subagentError,
      applyConfig: patch => {
        if (options.failSubagentApply) throw new Error('lock held');
        subagentPatches.push(patch);
        subagentConfig = { ...subagentConfig, ...patch };
        if (patch.priorityCandidateIds) subagentConfig.priorityCandidateIds = [...patch.priorityCandidateIds];
        return cloneSubagent();
      },
    },
  });

  return {
    component,
    orchestratorPatches,
    subagentPatches,
    enabledChanges,
    errors,
    closedCount: () => closed,
    orchestratorConfig: cloneOrchestrator,
    subagentConfig: cloneSubagent,
    setBound: (value: boolean) => { bound = value; },
    render: (width = 100): string[] => component.render(width) as string[],
    text: (width = 100): string => (component.render(width) as string[]).join('\n'),
  };
}

type Harness = ReturnType<typeof harness>;

/** Walks the active child's highlight to the requested row id from either direction. */
function selectRow(h: Harness, id: string): void {
  for (let press = 0; press < 60; press++) h.component.handleInput('\x1b[A');
  let guard = 0;
  while (h.component.selectedRowId !== id && guard < 60) {
    h.component.handleInput('\x1b[B');
    guard += 1;
  }
  assert.equal(h.component.selectedRowId, id);
}

/** Walks the open picker down until the highlighted entry contains the fragment. */
function selectPickerEntry(h: Harness, fragment: string): void {
  let guard = 0;
  const highlighted = (): string | undefined =>
    (h.render(100) as string[]).find(line => line.startsWith('→ ') && line.includes(fragment));
  while (!highlighted() && guard < 60) {
    h.component.handleInput('\x1b[B');
    guard += 1;
  }
  assert.ok(highlighted(), `picker entry containing "${fragment}" was reachable`);
}

test('DASH-001 (S1): the dialog shows Orchestrator and Subagents tabs with Orchestrator active first', () => {
  const h = harness();
  assert.equal(h.component.activeTab, 'orchestrator');

  const text = h.text();
  assert.ok(text.includes('[Orchestrator]'), text);
  assert.ok(text.includes('[Subagents]'), text);
  assert.ok(text.includes('Supervisor control panel'), text);
  assert.ok(!text.includes('Subagent router configuration'), text);
});

test('DASH-002 (S1, S6): Tab and Shift+Tab switch between independent views', () => {
  const h = harness();

  h.component.handleInput('\t');
  assert.equal(h.component.activeTab, 'subagents');
  const subagents = h.text();
  assert.ok(subagents.includes('Subagent router configuration'), subagents);
  assert.ok(!subagents.includes('Supervisor control panel'), subagents);

  h.component.handleInput('\x1b[Z');
  assert.equal(h.component.activeTab, 'orchestrator');
  assert.ok(h.text().includes('Supervisor control panel'), h.text());

  // With two tabs both directions toggle between them.
  h.component.handleInput('\t');
  h.component.handleInput('\t');
  assert.equal(h.component.activeTab, 'orchestrator');
});

test('DASH-003 (S2): the Subagents enable switch persists through the injected applyConfig only', () => {
  const h = harness();

  h.component.handleInput('\t');
  assert.equal(h.component.activeTab, 'subagents');
  assert.equal(h.component.selectedRowId, 'toggle');

  h.component.handleInput('\r');
  assert.deepEqual(h.subagentPatches, [{ enabled: true }]);
  assert.equal(h.subagentConfig().enabled, true);
  assert.ok(h.text().includes('[x] Enabled'), h.text());
  assert.deepEqual(h.orchestratorPatches, [], 'the Orchestrator document is untouched');

  h.component.handleInput('\r');
  assert.deepEqual(h.subagentPatches, [{ enabled: true }, { enabled: false }]);
  assert.equal(h.subagentConfig().enabled, false);
  assert.ok(h.text().includes('[ ] Disabled'), h.text());
});

test('DASH-004 (S3, S4): the subagent count steps inside 2..20 and never drops stored entries', () => {
  const saved = piIds.slice(0, 4);
  const h = harness({ subagentConfig: { modelCount: 2, priorityCandidateIds: saved } });
  h.component.handleInput('\t');
  selectRow(h, 'modelCount');

  // At the lower bound a further step persists nothing.
  h.component.handleInput('\x1b[D');
  assert.equal(h.subagentPatches.length, 0);

  h.component.handleInput('\x1b[C');
  assert.deepEqual(h.subagentPatches.at(-1), { modelCount: 3 });
  assert.deepEqual(h.subagentConfig().priorityCandidateIds, saved, 'raising the count keeps the full list');

  for (let press = 0; press < 40; press++) h.component.handleInput('\x1b[C');
  assert.deepEqual([SUBAGENT_MODEL_COUNT_RANGE[0], SUBAGENT_MODEL_COUNT_RANGE[1]], [2, 20]);
  for (const patch of h.subagentPatches) {
    if (patch.modelCount !== undefined) assert.ok(patch.modelCount >= 2 && patch.modelCount <= 20, String(patch.modelCount));
  }
  assert.equal(h.subagentConfig().modelCount, 20, 'clamps at the maximum');
  assert.deepEqual(h.subagentConfig().priorityCandidateIds, saved, 'the full list survives the maximum');

  for (let press = 0; press < 40; press++) h.component.handleInput('\x1b[D');
  assert.equal(h.subagentConfig().modelCount, 2, 'clamps at the minimum');
  assert.deepEqual(h.subagentConfig().priorityCandidateIds, saved, 'the full list survives shrinking too');
});

test('DASH-005 (S4): subagent pickers hide other slots and restore released models', () => {
  const saved = piIds.slice(0, 4);
  const h = harness({ subagentConfig: { modelCount: 2, priorityCandidateIds: saved }, subagentCandidates: piCandidates });
  h.component.handleInput('\t');
  selectRow(h, 'slot:2');
  h.component.handleInput('\r');

  const picker = h.text();
  assert.ok(picker.includes('Assign subagent slot 2'), picker);
  for (const id of [piIds[0], piIds[2], piIds[3]]) {
    assert.ok(!picker.includes(id), 'models owned by other visible or hidden slots are absent: ' + picker);
  }
  assert.ok(picker.includes(piIds[1]), 'the current slot model stays selectable');
  assert.ok(picker.includes(piIds[4]), 'unassigned Pi models stay selectable');
  assert.equal(h.subagentPatches.length, 0, 'opening the picker never saves');

  // Keeping the current model allows opening effort menu and escaping without writing.
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 2'), h.text());
  assert.equal(h.subagentPatches.length, 0);
  h.component.handleInput('\x1b'); // Escape back to model picker
  assert.ok(h.text().includes('Assign subagent slot 2'), h.text());
  h.component.handleInput('\x1b'); // Escape closes picker
  assert.equal(h.subagentPatches.length, 0);
  assert.ok(!h.text().includes('Assign subagent slot 2'));
  selectRow(h, 'slot:2');
  h.component.handleInput('\r');

  // Clearing slot 2 drops only that entry and keeps the hidden order.
  selectPickerEntry(h, 'clear (drop slot 2)');
  h.component.handleInput('\r');
  assert.deepEqual(h.subagentPatches.at(-1), { priorityCandidateIds: [piIds[0], piIds[2], piIds[3]] });
  assert.deepEqual(h.subagentConfig().priorityCandidateIds, [piIds[0], piIds[2], piIds[3]]);

  // A released model immediately returns to the choices for another slot.
  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  assert.ok(h.text().includes(piIds[1]), 'the cleared model becomes available again');
  h.component.handleInput('\x1b');

  // A genuinely new model from the provided catalogue is assignable; the hidden entry survives.
  selectRow(h, 'slot:2');
  h.component.handleInput('\r');
  for (const character of 'grok') h.component.handleInput(character);
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 2'), h.text());
  h.component.handleInput('\r');
  assert.deepEqual(h.subagentPatches.at(-1), { priorityCandidateIds: [piIds[0], piIds[4], piIds[3]] });
  assert.deepEqual(h.subagentConfig().priorityCandidateIds, [piIds[0], piIds[4], piIds[3]]);
  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  assert.ok(!h.text().includes(piIds[4]), 'a newly assigned model disappears from other slots');
  assert.ok(h.text().includes(piIds[2]), 'a replaced model becomes available again');
  assert.deepEqual(h.orchestratorPatches, []);
  assert.deepEqual(h.errors, []);
});

test('DASH-019: d empties only the highlighted Subagents slot and leaves other positions intact', () => {
  const saved = piIds.slice(0, 4);
  const h = harness({ subagentConfig: { modelCount: 3, priorityCandidateIds: saved } });
  selectRow(h, 'slot:1');
  h.component.handleInput('d');
  assert.deepEqual(h.orchestratorPatches, [], 'd is not an Orchestrator shortcut');
  h.component.handleInput('\t');
  h.component.handleInput('d');
  selectRow(h, 'modelCount');
  h.component.handleInput('d');
  assert.deepEqual(h.subagentPatches, [], 'non-slot rows ignore d');
  selectRow(h, 'slot:2');
  h.component.handleInput('d');
  assert.deepEqual(h.subagentPatches, [{ priorityCandidateIds: [piIds[0], '', piIds[2], piIds[3]] }]);
  assert.deepEqual(h.subagentConfig().priorityCandidateIds, [piIds[0], '', piIds[2], piIds[3]]);
  assert.equal(h.component.selectedRowId, 'slot:2');
  assert.match(h.text(), /2\. \(empty\)/);
  assert.match(h.text(), /d clear/i);
  h.component.handleInput('d');
  assert.equal(h.subagentPatches.length, 1, 'an empty slot is a no-op');
  h.component.handleInput('\r');
  assert.ok(h.text().includes(piIds[1]), 'the cleared model is available again');
  const beforeTyping = h.subagentPatches.length;
  h.component.handleInput('d');
  assert.match(h.text(), /> d/);
  assert.equal(h.subagentPatches.length, beforeTyping, 'd in a picker is filter text');
  h.component.handleInput('\x7f');
  selectPickerEntry(h, piIds[4]);
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 2'), h.text());
  h.component.handleInput('\r');
  assert.deepEqual(h.subagentConfig().priorityCandidateIds, [piIds[0], piIds[4], piIds[2], piIds[3]]);
  assert.deepEqual(h.orchestratorPatches, []);
  assert.deepEqual(h.errors, []);
});

test('DASH-020: assignment to a later empty slot pads gaps and d respects save failures and stale sessions', () => {
  const h = harness({ subagentConfig: { modelCount: 5, priorityCandidateIds: [piIds[0]] } });
  h.component.handleInput('\t');
  selectRow(h, 'slot:4');
  h.component.handleInput('d');
  assert.deepEqual(h.subagentPatches, [], 'unassigned slots are a no-op');
  h.component.handleInput('\r');
  selectPickerEntry(h, piIds[1]);
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 4'), h.text());
  h.component.handleInput('\r');
  assert.deepEqual(h.subagentConfig().priorityCandidateIds, [piIds[0], '', '', piIds[1]]);
  h.setBound(false);
  h.component.handleInput('d');
  assert.equal(h.subagentPatches.length, 1);
  assert.equal(h.closedCount(), 1);
  const failed = harness({ subagentConfig: { priorityCandidateIds: piIds.slice(0, 3) }, failSubagentApply: true });
  failed.component.handleInput('\t');
  selectRow(failed, 'slot:2');
  failed.component.handleInput('d');
  assert.deepEqual(failed.subagentPatches, []);
  assert.deepEqual(failed.subagentConfig().priorityCandidateIds, piIds.slice(0, 3));
  assert.equal(failed.errors.length, 1);
  const invalid = harness({ subagentConfig: { priorityCandidateIds: [piIds[0]] }, subagentError: 'invalid JSON' });
  invalid.component.handleInput('\t');
  invalid.component.handleInput('d');
  assert.deepEqual(invalid.subagentPatches, []);
});

test('DASH-006 (S5): the subagent picker lists only the provided Pi models and reports empty filters', () => {
  const h = harness({ subagentConfig: { modelCount: 2 }, subagentCandidates: piCandidates });
  h.component.handleInput('\t');
  selectRow(h, 'slot:1');
  h.component.handleInput('\r');

  const picker = h.text();
  for (const candidate of piCandidates) assert.ok(picker.includes(candidate.id), candidate.id);
  assert.ok(!picker.includes('cliproxyapi'), 'no account or invented catalogue leaks in: ' + picker);

  for (const character of 'gemini') h.component.handleInput(character);
  assert.ok(h.text().includes('google/gemini-3-pro'), h.text());
  assert.ok(!h.text().includes('anthropic/claude-sonnet-4'), h.text());

  for (let index = 0; index < 'gemini'.length; index++) h.component.handleInput('\x7f');
  for (const character of 'zzz') h.component.handleInput(character);
  assert.match(h.text(), /no model matches "zzz"/, h.text());
});

test('DASH-007 (assignment S2-S4): the Subagents view describes child assignment without claiming live telemetry', () => {
  const h = harness();
  h.component.handleInput('\t');
  const text = h.text();

  assert.match(text, /Configuration saved/, text);
  assert.match(text, /least-loaded/i, text);
  assert.match(text, /child assignment/i, text);
  assert.doesNotMatch(text, /not connected yet/, text);

  // It must not pretend a runtime is active for subagents.
  assert.ok(!/runtime:/i.test(text), text);
  assert.ok(!/active model/i.test(text), text);
  assert.ok(!/running/i.test(text), text);
});

test('DASH-008 (S6): subagent edits never change Orchestrator patches, rows or state', () => {
  const h = harness({ orchestratorConfig: { enabled: true, modelCount: 3 } });

  // The Orchestrator keeps its documented row set.
  const rows: string[] = [];
  const expected = [...getPanelRowIds(h.orchestratorConfig())];

  h.component.handleInput('\t');
  h.component.handleInput('\r'); // toggle Subagents
  selectRow(h, 'modelCount');
  h.component.handleInput('\x1b[C'); // step count

  assert.equal(h.orchestratorPatches.length, 0);
  assert.equal(h.orchestratorConfig().modelCount, 3);
  assert.equal(h.orchestratorConfig().enabled, true);

  h.component.handleInput('\t');
  assert.deepEqual([...getPanelRowIds(h.orchestratorConfig())], expected);
});

test('DASH-009: mouse clicks on tab bar switch views and clicks below route to active child', () => {
  const h = harness();

  // Tab bar occupies the top 3 rows. Clicking the Subagents tab switches to it.
  const tabLine = h.render().findIndex(line => line.includes('[Subagents]'));
  assert.ok(tabLine >= 0);
  const subagentX = h.render()[tabLine].indexOf('[Subagents]') + 1;
  h.component.handleMouse(mouseClick(subagentX, tabLine));
  assert.equal(h.component.activeTab, 'subagents');

  // The Orchestrator tab is clickable too.
  const orchLine = h.render().findIndex(line => line.includes('[Orchestrator]'));
  const orchX = h.render()[orchLine].indexOf('[Orchestrator]') + 1;
  h.component.handleMouse(mouseClick(orchX, orchLine));
  assert.equal(h.component.activeTab, 'orchestrator');
});

test('DASH-010: every line fits the width and clicking any column never throws or writes', () => {
  for (const width of [1, 2, 3, 5, 10, 20, 30, 60, 120]) {
    const h = harness({
      subagentConfig: { modelCount: 3, priorityCandidateIds: piIds.slice(0, 3) },
      subagentCandidates: piCandidates,
    });

    const orchestratorLines = h.render(width);
    assert.ok(orchestratorLines.length > 0);
    assert.ok(orchestratorLines.every(line => visibleWidth(line) <= width), `orchestrator w=${width}: ${JSON.stringify(orchestratorLines)}`);

    h.component.handleInput('\t');
    const subagentLines = h.render(width);
    assert.ok(subagentLines.every(line => visibleWidth(line) <= width), `subagents w=${width}: ${JSON.stringify(subagentLines)}`);

    selectRow(h, 'slot:1');
    h.component.handleInput('\r');
    const picker = h.render(width);
    assert.ok(picker.every(line => visibleWidth(line) <= width), `picker w=${width}: ${JSON.stringify(picker)}`);
    if (width >= 30) assert.ok(picker.some(line => line.includes('Assign subagent slot 1')), picker.join('\n'));

    for (let y = 0; y < picker.length; y++) {
      for (let x = 0; x < width + 3; x++) h.component.handleMouse(mouseClick(x, y));
    }
  }
});

test('DASH-011: an unbound dashboard closes without writing, including from an open picker', () => {
  const input = harness({ bound: false });
  input.component.handleInput('\t');
  assert.equal(input.closedCount(), 1);
  assert.equal(input.orchestratorPatches.length, 0);
  assert.equal(input.subagentPatches.length, 0);

  const click = harness({ bound: false });
  click.component.handleMouse(mouseClick(5, 4));
  assert.equal(click.closedCount(), 1);
  assert.equal(click.subagentPatches.length, 0);

  const picker = harness({ subagentConfig: { modelCount: 2 } });
  picker.component.handleInput('\t');
  selectRow(picker, 'slot:1');
  picker.component.handleInput('\r');
  assert.ok(picker.text().includes('Assign subagent slot 1'), picker.text());
  picker.setBound(false);
  picker.component.handleInput('a');
  assert.equal(picker.closedCount(), 1);
  assert.equal(picker.subagentPatches.length, 0, 'no write after unbind');
});

test('DASH-012: focus propagates to the active child and follows tab switches', () => {
  const h = harness();

  assert.equal(h.component.panels.orchestrator.focused, true);
  assert.equal(h.component.panels.subagents.focused, false);

  h.component.focused = false;
  assert.equal(h.component.panels.orchestrator.focused, false);
  h.component.focused = true;
  assert.equal(h.component.panels.orchestrator.focused, true);

  h.component.handleInput('\t');
  assert.equal(h.component.panels.subagents.focused, true);
  assert.equal(h.component.panels.orchestrator.focused, false);

  h.component.focused = false;
  assert.equal(h.component.panels.subagents.focused, false);
  h.component.handleInput('\t');
  assert.equal(h.component.panels.orchestrator.focused, false);
});

test('DASH-013 (S6): an invalid subagent config stays reachable, shows its error, refuses edits and leaves Orchestrator usable', () => {
  const error = 'Malformed subagent configuration: modelCount must be an integer between 2 and 20';
  const h = harness({ orchestratorConfig: { enabled: true }, subagentError: error });

  h.component.handleInput('\t');
  assert.equal(h.component.activeTab, 'subagents', 'the tab is still reachable');
  const text = h.text();
  assert.match(text, /configuration error:/, text);
  assert.ok(text.includes('Malformed subagent configuration'), text);
  assert.match(text, /edits are disabled/i, text);
  assert.ok(!/Configuration saved/.test(text), 'nothing claims to be saved while the file is invalid');

  // Enter and mouse both refuse to edit.
  h.component.handleInput('\r');
  const toggleY = h.render().findIndex(line => line.includes('Enabled') || line.includes('Disabled'));
  h.component.handleMouse(mouseClick(5, toggleY));
  assert.equal(h.subagentPatches.length, 0, 'no subagent write while the stored file is invalid');
  assert.deepEqual(h.errors, [], 'a refusal caused by invalid state is not an applied-write error');

  // The Orchestrator document and runtime controls stay fully usable.
  h.component.handleInput('\t');
  assert.equal(h.component.activeTab, 'orchestrator');
  h.component.handleInput('\r');
  assert.deepEqual(h.orchestratorPatches, [{ enabled: false }]);
});

test('DASH-014 (S6): mouse clicks step subagent count and assign slots through picker', () => {
  const h = harness({ subagentConfig: { modelCount: 3, priorityCandidateIds: [piIds[0]] }, subagentCandidates: piCandidates });
  h.component.handleInput('\t');

  const rows = h.render(100);
  const yCount = rows.findIndex(line => line.includes('Model count'));
  const plusX = rows[yCount].indexOf('[+]');
  h.component.handleMouse(mouseClick(plusX, yCount));
  assert.deepEqual(h.subagentPatches, [{ modelCount: 4 }]);

  const after = h.render(100);
  const ySlot2 = after.findIndex(line => line.includes('2. (empty)'));
  h.component.handleMouse(mouseClick(5, ySlot2));
  assert.ok(h.text().includes('Assign subagent slot 2'));
});

test('DASH-015: uncertain effect confirmation is scoped to Orchestrator tab and never blocks Subagents', () => {
  const h = harness({ orchestratorConfig: { enabled: false }, state: { uncertain: 2, running: false } });

  // Subagents toggle works immediately with no confirmation gate.
  h.component.handleInput('\t');
  h.component.handleInput('\r');
  assert.deepEqual(h.subagentPatches, [{ enabled: true }]);
  assert.deepEqual(h.enabledChanges, []);

  // Orchestrator requires its two-step confirmation.
  h.component.handleInput('\t');
  assert.equal(h.component.activeTab, 'orchestrator');

  // First Enter arms the confirmation, the second enables with acknowledgement.
  h.component.handleInput('\r');
  assert.deepEqual(h.orchestratorPatches, []);
  assert.match(h.text(), /confirm enabling/, h.text());
  h.component.handleInput('\r');
  assert.deepEqual(h.orchestratorPatches, [{ enabled: true }]);
  assert.deepEqual(h.enabledChanges, [[true, true]]);

  // Slot assignment through the picker is unchanged.
  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Assign priority slot 1'), h.text());
  for (const character of 'second') h.component.handleInput(character);
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 1'), h.text());
  h.component.handleInput('\r');
  assert.deepEqual(h.orchestratorPatches.at(-1), { priorityCandidateIds: [orchSecond] });
});

test('DASH-016 (S6): the same model may be configured for Orchestrator and Subagents independently', () => {
  const shared = piCandidates[0].id;
  const h = harness({
    orchestratorConfig: { modelCount: 2, priorityCandidateIds: [shared] },
    subagentConfig: { modelCount: 2 },
    subagentCandidates: piCandidates,
  });

  h.component.handleInput('\t');
  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  const picker = h.text();
  assert.ok(picker.includes(shared), picker);
  assert.ok(!picker.includes('(in slot'), 'an Orchestrator entry is not a Subagents duplicate: ' + picker);

  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 1'), h.text());
  h.component.handleInput('\r');
  assert.deepEqual(h.subagentPatches.at(-1), { priorityCandidateIds: [shared] });
});

test('DASH-017: a refused subagent write reports the failure and keeps the view unchanged', () => {
  const h = harness({ subagentConfig: { enabled: false }, failSubagentApply: true });
  h.component.handleInput('\t');
  const before = h.text();
  h.component.handleInput('\r');

  assert.equal(h.subagentPatches.length, 0);
  assert.equal(h.subagentConfig().enabled, false);
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /subagent configuration|save/i);
  assert.equal(h.text(), before);
  assert.equal(h.closedCount(), 0);
});

test('DASH-018 (S6): getSubagentRowIds mirrors the rows the Subagents view exposes', () => {
  assert.deepEqual([...getSubagentRowIds({ enabled: true, modelCount: 2, priorityCandidateIds: [] })], ['toggle', 'modelCount', 'slot:1', 'slot:2']);
  assert.deepEqual([...getSubagentRowIds({ enabled: false, modelCount: 20, priorityCandidateIds: [] })].slice(0, 3), ['toggle', 'modelCount', 'slot:1']);
});

test('DASH-021 (S1): Subagents effort menu opens after model selection and persists atomically', () => {
  const effortCandidate: ModelCandidate = {
    ...piCandidates[0],
    id: 'openai/gpt-5-codex-effort',
    supportedEfforts: ['low', 'medium', 'high'],
  };
  const h = harness({
    subagentCandidates: [effortCandidate],
    subagentConfig: { modelCount: 2, priorityCandidateIds: [] },
  });

  h.component.handleInput('\t');
  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Assign subagent slot 1'));

  // Select candidate in model picker
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 1'));
  assert.ok(h.text().includes('openai/gpt-5-codex-effort'));
  assert.ok(h.text().includes('Default'));
  assert.ok(h.text().includes('low'));
  assert.ok(h.text().includes('medium'));
  assert.ok(h.text().includes('high'));
  assert.equal(h.subagentPatches.length, 0);

  // Select 'medium' (Default -> low -> medium)
  h.component.handleInput('\x1b[B');
  h.component.handleInput('\x1b[B');
  h.component.handleInput('\r');

  assert.equal(h.subagentPatches.length, 1);
  assert.deepEqual(h.subagentPatches[0], {
    priorityCandidateIds: ['openai/gpt-5-codex-effort'],
    modelEfforts: { 'openai/gpt-5-codex-effort': 'medium' },
  });
  assert.ok(h.text().includes('1. openai/gpt-5-codex-effort [medium]'));
});

test('DASH-022 (S1): re-selecting same model in Subagents allows changing effort and Default removes override', () => {
  const effortCandidate: ModelCandidate = {
    ...piCandidates[0],
    id: piIds[0],
    supportedEfforts: ['low', 'high'],
  };
  const h = harness({
    subagentCandidates: [effortCandidate],
    subagentConfig: {
      modelCount: 2,
      priorityCandidateIds: [piIds[0]],
      modelEfforts: { [piIds[0]]: 'low', [piIds[1]]: 'high' },
    },
  });

  h.component.handleInput('\t');
  assert.ok(h.text().includes(`1. ${piIds[0]} [low]`));

  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  h.component.handleInput('\r'); // Select same model

  assert.ok(h.text().includes('Select reasoning effort: slot 1'));
  assert.ok(h.render(100).some(line => line.startsWith('→ low')));

  // Switch to Default
  h.component.handleInput('\x1b[A');
  assert.ok(h.render(100).some(line => line.startsWith('→ Default')));
  h.component.handleInput('\r');

  assert.equal(h.subagentPatches.length, 1);
  assert.deepEqual(h.subagentPatches[0], {
    priorityCandidateIds: [piIds[0]],
    modelEfforts: { [piIds[1]]: 'high' },
  });
  assert.ok(h.text().includes(`1. ${piIds[0]} [Default]`));
});

test('DASH-023 (S1): Subagents slots display saved effort or Default', () => {
  const h = harness({
    subagentConfig: {
      modelCount: 3,
      priorityCandidateIds: [piIds[0], piIds[1]],
      modelEfforts: { [piIds[0]]: 'xhigh' },
    },
  });

  h.component.handleInput('\t');
  const text = h.text();
  assert.ok(text.includes(`1. ${piIds[0]} [xhigh]`), text);
  assert.ok(text.includes(`2. ${piIds[1]} [Default]`), text);
  assert.ok(text.includes('3. (empty)'), text);
});

test('DASH-024 (S1): clearing Subagents slot via d preserves per-model overrides', () => {
  const h = harness({
    subagentConfig: {
      modelCount: 2,
      priorityCandidateIds: [piIds[0], piIds[1]],
      modelEfforts: { [piIds[0]]: 'high', [piIds[1]]: 'low' },
    },
  });

  h.component.handleInput('\t');
  selectRow(h, 'slot:1');
  h.component.handleInput('d');

  assert.deepEqual(h.subagentPatches, [{ priorityCandidateIds: ['', piIds[1]] }]);
  assert.equal(h.subagentConfig().modelEfforts?.[piIds[0]], 'high');
  assert.equal(h.subagentConfig().modelEfforts?.[piIds[1]], 'low');
});

test('DASH-025 (S1): Subagents effort menu respects escape, stale session and failed saves', () => {
  const h = harness({ subagentConfig: { modelCount: 2, priorityCandidateIds: [] } });
  h.component.handleInput('\t');
  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  h.component.handleInput('\r'); // Enter effort menu
  assert.ok(h.text().includes('Select reasoning effort: slot 1'));

  // Escape returns to model picker without save
  h.component.handleInput('\x1b');
  assert.ok(h.text().includes('Assign subagent slot 1'));
  assert.equal(h.subagentPatches.length, 0);

  // Enter effort menu again
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 1'));

  // Stale session closes without save
  h.setBound(false);
  h.component.handleInput('\r');
  assert.equal(h.closedCount(), 1);
  assert.equal(h.subagentPatches.length, 0);

  // Failed save keeps view and reports error
  const failed = harness({ subagentConfig: { modelCount: 2, priorityCandidateIds: [] }, failSubagentApply: true });
  failed.component.handleInput('\t');
  selectRow(failed, 'slot:1');
  failed.component.handleInput('\r');
  failed.component.handleInput('\r');
  failed.component.handleInput('\r');
  assert.equal(failed.subagentPatches.length, 0);
  assert.equal(failed.errors.length, 1);
  assert.ok(failed.text().includes('Select reasoning effort: slot 1'));
});
