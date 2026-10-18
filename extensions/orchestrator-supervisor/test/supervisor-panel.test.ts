import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeLib, identityTheme, fakeKeybindings, mouseClick, mouseWheel, visibleWidth } from './fixtures/fake-tui.ts';
import { DEFAULT_SUPERVISOR_CONFIG, SUPERVISOR_CONFIG_RANGES, type SupervisorConfig } from '../src/supervisor-config.ts';
import { createSupervisorPanel, getPanelRowIds, PANEL_VISIBLE_ROWS, type SupervisorPanelState } from '../src/supervisor-panel.ts';
import type { ModelCandidate } from '../src/types.ts';

/**
 * The control panel takes every terminal primitive as an argument, so these fakes stand
 * in for `@earendil-works/pi-tui` without that host virtual module resolving here.
 *
 * The panel is configuration-only: it edits the stored document and shows state. Tests
 * here never assert removed action or routing behavior.
 */

const candidate = (prefix: string, slug: string): ModelCandidate => ({
  id: `cliproxyapi/${prefix}/${slug}`,
  source: 'account',
  quotaProtocol: slug.startsWith('gemini') ? 'gemini' : 'wham',
  prefix,
  family: slug.startsWith('gemini') ? 'gemini' : 'codex',
  modelSlug: slug,
  provider: 'cliproxyapi',
  reasoningEffort: 'high',
});

const idMain = 'cliproxyapi/main/gpt-6.1-sol';
const idSecond = 'cliproxyapi/second/gpt-6.1-sol';
const idFallback = 'cliproxyapi/fallback-a/gemini-3.8-flash-high';
const idHidden = 'cliproxyapi/d/m4';

const catalog: ModelCandidate[] = [
  candidate('main', 'gpt-6.1-sol'),
  candidate('second', 'gpt-6.1-sol'),
  candidate('fallback-a', 'gemini-3.8-flash-high'),
];

interface HarnessOptions {
  config?: Partial<SupervisorConfig>;
  candidates?: ModelCandidate[];
  discoveryFailed?: boolean;
  failApply?: boolean;
  bound?: boolean;
  /** Overrides for the read-only state section. */
  state?: Partial<SupervisorPanelState>;
}

function harness(options: HarnessOptions = {}) {
  let config: SupervisorConfig = {
    ...DEFAULT_SUPERVISOR_CONFIG,
    ...options.config,
    priorityCandidateIds: [...(options.config?.priorityCandidateIds ?? DEFAULT_SUPERVISOR_CONFIG.priorityCandidateIds)],
  };
  const patches: Array<Partial<SupervisorConfig>> = [];
  const enabledChanges: Array<[boolean, boolean | undefined]> = [];
  const errors: string[] = [];
  let closed = 0;
  let bound = options.bound ?? true;

  const component = createSupervisorPanel({
    lib: fakeLib,
    tui: { requestRender: () => {} },
    theme: identityTheme,
    keybindings: fakeKeybindings,
    config,
    state: () => ({
      enabled: config.enabled,
      running: true,
      status: 'active',
      activeModel: idMain,
      uncertain: 0,
      inventory: idMain,
      ...options.state,
    }),
    candidates: options.candidates ?? catalog,
    discoveryFailed: options.discoveryFailed ?? false,
    isBound: () => bound,
    applyConfig: patch => {
      if (options.failApply) throw new Error('lock held');
      patches.push(patch);
      config = { ...config, ...patch };
      if (patch.priorityCandidateIds) config.priorityCandidateIds = [...patch.priorityCandidateIds];
      return { ...config, priorityCandidateIds: [...config.priorityCandidateIds] };
    },
    onEnabledChange: (enabled, acknowledgeUncertain) => { enabledChanges.push([enabled, acknowledgeUncertain]); },
    onError: message => { errors.push(message); },
    done: () => { closed += 1; },
  });

  return {
    component,
    patches,
    enabledChanges,
    errors,
    closedCount: () => closed,
    current: () => config,
    rowIds: () => getPanelRowIds(config),
    setBound: (value: boolean) => { bound = value; },
    render: (width = 100): string[] => component.render(width),
    text: (width = 100): string => (component.render(width) as string[]).join('\n'),
  };
}

type Harness = ReturnType<typeof harness>;

/** Slot rows render as `→ 1. value` or `  1. value`; count only those, never the count row. */
const slotLines = (lines: string[]): string[] => lines.filter(line => /^(?:→ | {2})\d+\. /.test(line));

/** Walks the selection down until the requested row id is highlighted. */
function selectRow(h: Harness, id: string): void {
  let guard = 0;
  while (h.component.selectedRowId !== id && guard < 40) {
    h.component.handleInput('\x1b[B');
    guard += 1;
  }
  assert.equal(h.component.selectedRowId, id);
}

test('PANEL-001 (S1, S2, S6): rows show modelCount slots and every configurable threshold', () => {
  const h = harness({
    config: {
      modelCount: 5,
      rotationThresholdPercent: 77,
      codexQuotaThresholdPercent: 88,
      maxTransientFailures: 4,
      cooldownMinutes: 25,
      pollIntervalSeconds: 90,
      priorityCandidateIds: [idMain, idSecond],
    },
  });
  const lines = h.render(100);
  const lineWith = (fragment: string) => lines.find(line => line.includes(fragment));

  assert.ok(lineWith('Switches'), lines.join('\n'));
  assert.ok(lineWith('Priority slots (1-5)'), lines.join('\n'));
  assert.ok(lineWith('Thresholds'), lines.join('\n'));

  assert.ok(lineWith(`1. ${idMain}`), lines.join('\n'));
  assert.ok(lineWith(`2. ${idSecond}`), lines.join('\n'));
  assert.equal(lines.filter(line => line.includes('(empty)')).length, 3);
  assert.match(lineWith('Model count')!, /5/);

  assert.match(lineWith('Rotation threshold')!, /77%/);
  assert.match(lineWith('Codex quota threshold')!, /88%/);
  assert.match(lineWith('Retries')!, /4/);
  assert.match(lineWith('Cooldown')!, /25 min/);
  assert.match(lineWith('Poll interval')!, /90 s/);

  // The number of visible slot editors follows modelCount, not a fixed five.
  const two = harness({ config: { modelCount: 2 } });
  assert.equal(slotLines(two.render(100)).length, 2);
  for (let slot = 1; slot <= 2; slot++) {
    assert.ok(two.text().includes(`${slot}. (empty)`), two.text());
  }
  const ten = harness({ config: { modelCount: 10 } });
  assert.equal(slotLines(ten.render(100)).length, 10);
  assert.ok(ten.text().includes('Priority slots (1-10)'), ten.text());
});

test('PANEL-002 (S4): Enter flips the supervisor switch and notifies the host once per flip', () => {
  const h = harness({ config: { enabled: true } });

  h.component.handleInput('\r');
  assert.deepEqual(h.patches, [{ enabled: false }]);
  assert.deepEqual(h.enabledChanges, [[false, false]]);
  assert.equal(h.closedCount(), 0);
  assert.ok(h.text().includes('[ ] Disabled'), h.text());
  assert.ok(!h.text().includes('[x] Enabled'));

  h.component.handleInput('\r');
  assert.deepEqual(h.patches, [{ enabled: false }, { enabled: true }]);
  assert.deepEqual(h.enabledChanges, [[false, false], [true, false]]);
  assert.ok(h.text().includes('[x] Enabled'), h.text());
});

test('PANEL-003 (S1): the keyboard path assigns a slot via the filtered picker and keeps the dialog open', () => {
  const h = harness({ config: { priorityCandidateIds: [idMain] } });

  assert.equal(h.component.selectedRowId, 'toggle');
  selectRow(h, 'slot:2');

  h.component.handleInput('\r');
  assert.ok(h.text().includes('Assign priority slot 2'), h.text());

  for (const character of 'second') h.component.handleInput(character);
  assert.ok(h.text().includes(idSecond), h.text());
  assert.ok(!h.text().includes(idMain), h.text());

  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 2'), h.text());
  assert.deepEqual(h.patches, [], 'model selection alone does not save until effort is confirmed');

  h.component.handleInput('\r');
  assert.deepEqual(h.patches, [{ priorityCandidateIds: [idMain, idSecond] }]);
  assert.equal(h.closedCount(), 0);

  const back = h.text();
  assert.ok(!back.includes('Assign priority slot'), back);
  assert.ok(!back.includes('Select reasoning effort'), back);
  assert.ok(back.includes(`1. ${idMain}`), back);
  assert.ok(back.includes(`2. ${idSecond}`), back);
});

test('PANEL-004 (S3): duplicates are refused even for hidden entries and clearing keeps the hidden order', () => {
  const h = harness({ config: { modelCount: 2, priorityCandidateIds: [idMain, idSecond, idFallback, idHidden] } });
  selectRow(h, 'slot:2');

  h.component.handleInput('\r');
  const picker = h.text();
  assert.ok(picker.includes('(in slot 1)'), picker);
  // idFallback lives at stored index 3: hidden behind modelCount=2, yet still owned.
  assert.ok(picker.includes('(in slot 3)'), picker);

  // The first entry is already used in slot 1: Enter must refuse and persist nothing.
  h.component.handleInput('\r');
  assert.equal(h.patches.length, 0);
  assert.ok(h.text().includes('Assign priority slot 2'), h.text());

  // Selecting the hidden duplicate (idFallback) is likewise refused.
  h.component.handleInput('\x1b[B');
  h.component.handleInput('\x1b[B');
  h.component.handleInput('\r');
  assert.equal(h.patches.length, 0, 'a hidden duplicate is never assigned again');

  // Walk down to the `clear` entry and drop slot 2; the hidden entries survive in order.
  h.component.handleInput('\x1b[B');
  assert.ok(h.text().includes('clear'), h.text());
  h.component.handleInput('\r');
  assert.deepEqual(h.patches, [{ priorityCandidateIds: [idMain, idFallback, idHidden] }]);
  assert.deepEqual(h.current().priorityCandidateIds, [idMain, idFallback, idHidden]);

  const rows = h.render(100);
  assert.ok(rows.some(line => line.includes(`1. ${idMain}`)), rows.join('\n'));
  assert.ok(rows.some(line => line.includes(`2. ${idFallback}`)), rows.join('\n'));
  assert.ok(!rows.some(line => line.includes(idHidden)), 'hidden entries stay stored but unrendered');
});

test('PANEL-005 (S6): arrow keys step each threshold and clamp at both bounds', () => {
  const cases: Array<{ id: string; field: 'rotationThresholdPercent' | 'codexQuotaThresholdPercent' | 'maxTransientFailures' | 'cooldownMinutes' | 'pollIntervalSeconds'; step: number; min: number; max: number; mid: number }> = [
    { id: 'rotation', field: 'rotationThresholdPercent', step: 1, min: 1, max: 99, mid: 50 },
    { id: 'codexQuota', field: 'codexQuotaThresholdPercent', step: 1, min: 1, max: 100, mid: 50 },
    { id: 'retries', field: 'maxTransientFailures', step: 1, min: 1, max: 10, mid: 5 },
    { id: 'cooldown', field: 'cooldownMinutes', step: 5, min: 1, max: 1440, mid: 100 },
    { id: 'poll', field: 'pollIntervalSeconds', step: 5, min: 5, max: 3600, mid: 100 },
  ];

  for (const c of cases) {
    const config = (value: number): Partial<SupervisorConfig> => ({ [c.field]: value });

    const stepped = harness({ config: config(c.mid) });
    selectRow(stepped, c.id);
    stepped.component.handleInput('\x1b[D');
    assert.deepEqual(stepped.patches, [{ [c.field]: c.mid - c.step }], `${c.id}: step down`);
    stepped.component.handleInput('\x1b[C');
    assert.deepEqual(stepped.patches.at(-1), { [c.field]: c.mid }, `${c.id}: step up`);

    const nearMax = harness({ config: config(c.max - 1) });
    selectRow(nearMax, c.id);
    nearMax.component.handleInput('\x1b[C');
    assert.deepEqual(nearMax.patches, [{ [c.field]: c.max }], `${c.id}: clamp up to max`);

    const nearMin = harness({ config: config(c.min + 1) });
    selectRow(nearMin, c.id);
    nearMin.component.handleInput('\x1b[D');
    assert.deepEqual(nearMin.patches, [{ [c.field]: c.min }], `${c.id}: clamp down to min`);

    const atMax = harness({ config: config(c.max) });
    selectRow(atMax, c.id);
    atMax.component.handleInput('\x1b[C');
    atMax.component.handleInput('\x1b[C');
    assert.equal(atMax.patches.length, 0, `${c.id}: nothing persists past max`);
    assert.equal(atMax.current()[c.field], c.max, `${c.id}: max unchanged`);

    const atMin = harness({ config: config(c.min) });
    selectRow(atMin, c.id);
    atMin.component.handleInput('\x1b[D');
    atMin.component.handleInput('\x1b[D');
    assert.equal(atMin.patches.length, 0, `${c.id}: nothing persists past min`);
    assert.equal(atMin.current()[c.field], c.min, `${c.id}: min unchanged`);

    for (const patch of [...stepped.patches, ...nearMax.patches, ...nearMin.patches]) {
      const value = patch[c.field] as number;
      assert.ok(value >= c.min && value <= c.max, `${c.id}: ${String(value)} in range`);
    }
  }
});

test('PANEL-006 (S8): clicks flip the switch, open pickers, step thresholds and ignore elsewhere', () => {
  const h = harness({ config: { enabled: true } });

  const initial = h.render(100);
  const yToggle = initial.findIndex(line => line.includes('[x] Enabled'));
  assert.ok(yToggle >= 0, initial.join('\n'));
  h.component.handleMouse(mouseClick(5, yToggle));
  assert.deepEqual(h.patches, [{ enabled: false }]);
  assert.deepEqual(h.enabledChanges, [[false, false]]);
  assert.ok(h.render(100)[yToggle].includes('[ ] Disabled'));

  const ySlot1 = h.render(100).findIndex(line => line.includes('1. '));
  h.component.handleMouse(mouseClick(5, ySlot1));
  assert.equal(h.component.selectedRowId, 'slot:1');
  assert.ok(h.text().includes('Assign priority slot 1'), h.text());
  assert.equal(h.patches.length, 1);

  h.component.handleInput('\x1b'); // Escape returns to the rows view.
  const rowLines = h.render(100);
  const yRotation = rowLines.findIndex(line => line.includes('Rotation threshold'));
  const minusX = rowLines[yRotation].indexOf('[-]');
  const plusX = rowLines[yRotation].indexOf('[+]');
  assert.ok(minusX >= 0 && plusX > minusX, rowLines[yRotation]);

  h.component.handleMouse(mouseClick(minusX, yRotation));
  assert.deepEqual(h.patches.at(-1), { rotationThresholdPercent: 89 });
  h.component.handleMouse(mouseClick(plusX, yRotation));
  assert.deepEqual(h.patches.at(-1), { rotationThresholdPercent: 90 });

  // Clicking the label only selects the row.
  const afterSteps = h.patches.length;
  const yCooldown = rowLines.findIndex(line => line.includes('Cooldown'));
  h.component.handleMouse(mouseClick(4, yCooldown));
  assert.equal(h.component.selectedRowId, 'cooldown');
  assert.equal(h.patches.length, afterSteps);

  // Header, footer and wheel events change nothing.
  const before = h.patches.length;
  const footerY = rowLines.findIndex(line => line.includes('esc close'));
  h.component.handleMouse(mouseClick(3, 0));
  h.component.handleMouse(mouseClick(3, footerY));
  h.component.handleMouse(mouseWheel(yRotation, 1));
  assert.equal(h.patches.length, before);
  assert.deepEqual(h.enabledChanges, [[false, false]]);
});

test('PANEL-007 (S8, S6): Escape closes and a refused write reports without changing anything', () => {
  const escape = harness();
  escape.component.handleInput('\x1b');
  assert.equal(escape.closedCount(), 1);
  assert.equal(escape.patches.length, 0);

  const failing = harness({ config: { enabled: true }, failApply: true });
  const before = failing.text();
  failing.component.handleInput('\r');
  assert.equal(failing.patches.length, 0);
  assert.equal(failing.enabledChanges.length, 0);
  assert.equal(failing.errors.length, 1);
  assert.match(failing.errors[0], /configuration|save/i);
  assert.equal(failing.text(), before);
  assert.equal(failing.closedCount(), 0);

  const failingStep = harness({ failApply: true });
  selectRow(failingStep, 'rotation');
  const stepBefore = failingStep.text();
  failingStep.component.handleInput('\x1b[C');
  assert.equal(failingStep.patches.length, 0);
  assert.equal(failingStep.errors.length, 1);
  assert.equal(failingStep.text(), stepBefore);
});

test('PANEL-008 (S8): every line fits the width and an unbound panel closes without writing', () => {
  for (const width of [24, 40, 120]) {
    const h = harness({ config: { modelCount: 3, priorityCandidateIds: [idMain, idSecond, idFallback] } });
    const rows = h.render(width);
    assert.ok(rows.length > 0);
    assert.ok(rows.every(line => visibleWidth(line) <= width), `rows @${String(width)}: ${JSON.stringify(rows)}`);

    selectRow(h, 'slot:1');
    h.component.handleInput('\r');
    const picker = h.render(width);
    assert.ok(picker.every(line => visibleWidth(line) <= width), `picker @${String(width)}: ${JSON.stringify(picker)}`);
    assert.ok(picker.some(line => line.includes('Assign priority slot 1')), picker.join('\n'));
  }

  const input = harness({ bound: false });
  input.component.handleInput('a');
  assert.equal(input.closedCount(), 1);
  assert.equal(input.patches.length, 0);

  const click = harness({ bound: false });
  click.component.handleMouse(mouseClick(5, 4));
  assert.equal(click.closedCount(), 1);
  assert.equal(click.patches.length, 0);
});

test('PANEL-009 (S8): the keyboard path reaches every dynamic row', () => {
  const h = harness({ config: { modelCount: 4 } });
  const rows = [...h.rowIds()];
  assert.deepEqual(rows, ['toggle', 'autoRotate', 'autoSwitch', 'modelCount', 'slot:1', 'slot:2', 'slot:3', 'slot:4', 'rotation', 'codexQuota', 'retries', 'cooldown', 'poll']);

  assert.equal(h.component.selectedRowId, 'toggle');
  const visited = [h.component.selectedRowId];
  for (let step = 0; step < rows.length - 1; step++) {
    h.component.handleInput('\x1b[B');
    visited.push(h.component.selectedRowId);
  }
  assert.deepEqual(visited, rows);

  // Down clamps at the last row, page keys jump by the visible window.
  h.component.handleInput('\x1b[B');
  assert.equal(h.component.selectedRowId, 'poll');
  h.component.handleInput('\x1b[5~');
  assert.equal(h.component.selectedRowId, rows[Math.max(0, rows.length - 1 - PANEL_VISIBLE_ROWS)]);
  h.component.handleInput('\x1b[6~');
  assert.equal(h.component.selectedRowId, 'poll');

  for (let step = 0; step < rows.length - 1; step++) h.component.handleInput('\x1b[A');
  assert.equal(h.component.selectedRowId, 'toggle');
  h.component.handleInput('\x1b[A');
  assert.equal(h.component.selectedRowId, 'toggle');

  const lines = h.render(100);
  const highlighted = lines.filter(line => line.startsWith('→ '));
  assert.equal(highlighted.length, 1, lines.join('\n'));
  assert.ok(highlighted[0].includes('[x] Enabled'), highlighted[0]);
});

test('PANEL-010 (S6): stepping every configured range never persists a value outside it', () => {
  const cases: Array<{ id: string; field: keyof typeof SUPERVISOR_CONFIG_RANGES }> = [
    { id: 'modelCount', field: 'modelCount' },
    { id: 'rotation', field: 'rotationThresholdPercent' },
    { id: 'codexQuota', field: 'codexQuotaThresholdPercent' },
    { id: 'retries', field: 'maxTransientFailures' },
    { id: 'cooldown', field: 'cooldownMinutes' },
    { id: 'poll', field: 'pollIntervalSeconds' },
  ];
  for (const { id, field } of cases) {
    const [min, max] = SUPERVISOR_CONFIG_RANGES[field];

    // Walk down many times from the max: every persisted value stays inside the range.
    const down = harness({ config: { [field]: max } });
    selectRow(down, id);
    for (let press = 0; press < 2000; press++) down.component.handleInput('\x1b[D');
    for (const patch of down.patches) {
      const value = patch[field] as number;
      assert.ok(value >= min && value <= max, `${field} down ${String(value)}`);
    }
    assert.equal(down.current()[field], min, `${field}: clamps at min`);

    // Walk up many times from the min: every persisted value stays inside the range.
    const up = harness({ config: { [field]: min } });
    selectRow(up, id);
    for (let press = 0; press < 5000; press++) up.component.handleInput('\x1b[C');
    for (const patch of up.patches) {
      const value = patch[field] as number;
      assert.ok(value >= min && value <= max, `${field} up ${String(value)}`);
    }
    assert.equal(up.current()[field], max, `${field}: clamps at max`);

    assert.ok(down.patches.length > 0 && up.patches.length > 0, `${field}: the walk persisted steps`);
  }
});

test('PANEL-011 (S8): rows and the picker stay bounded at extreme widths and every column is clickable', () => {
  const five = [idMain, idSecond, idFallback];
  for (const width of [1, 2, 3, 5, 10, 19, 20, 21, 50, 120]) {
    const h = harness({ config: { modelCount: 3, priorityCandidateIds: five } });
    const rows = h.render(width);
    assert.ok(rows.every(line => visibleWidth(line) <= width), `rows w=${width}: ${JSON.stringify(rows)}`);

    h.component.handleInput('\x1b[B');
    h.component.handleInput('\r');
    const picker = h.render(width);
    assert.ok(picker.every(line => visibleWidth(line) <= width), `picker w=${width}: ${JSON.stringify(picker)}`);

    // No click zone may include a clipped (ellipsis) column: clicking every column must not throw.
    const lines = h.render(width);
    for (let y = 0; y < lines.length; y++) {
      for (let x = 0; x < width + 3; x++) h.component.handleMouse(mouseClick(x, y));
    }
  }
});

test('PANEL-012 (S8): an unbound panel closes without writing, including from an open picker', () => {
  const input = harness({ bound: false });
  input.component.handleInput('\r');
  assert.equal(input.closedCount(), 1);
  assert.equal(input.patches.length, 0);

  const click = harness({ bound: false });
  click.component.handleMouse(mouseClick(5, 3));
  assert.equal(click.closedCount(), 1);
  assert.equal(click.patches.length, 0);

  const picker = harness({ config: { priorityCandidateIds: [] } });
  selectRow(picker, 'slot:1');
  picker.component.handleInput('\r'); // open the picker while bound
  assert.ok(picker.text().includes('Assign priority slot 1'), picker.text());
  picker.setBound(false);
  picker.component.handleInput('a');
  assert.equal(picker.closedCount(), 1);
  assert.equal(picker.patches.length, 0, 'no write after unbind');
});

test('PANEL-013 (S9): the two capability switches have their own toggle rows and persist on Enter and click', () => {
  const h = harness({ config: { autoRotate: true, autoSwitchModel: true } });
  const lines = h.render(100);
  assert.ok(lines.some(line => line.includes('[x] Auto rotation')), lines.join('\n'));
  assert.ok(lines.some(line => line.includes('[x] Auto model switch')), lines.join('\n'));

  selectRow(h, 'autoRotate');
  h.component.handleInput('\r');
  assert.deepEqual(h.patches, [{ autoRotate: false }]);
  assert.deepEqual(h.enabledChanges, [], 'a capability switch never restarts the runtime');
  assert.ok(h.text().includes('[ ] Auto rotation'), h.text());

  const ySwitch = h.render(100).findIndex(line => line.includes('[ ] Auto model switch') || line.includes('[x] Auto model switch'));
  assert.ok(ySwitch >= 0, h.text());
  h.component.handleMouse(mouseClick(5, ySwitch));
  assert.deepEqual(h.patches, [{ autoRotate: false }, { autoSwitchModel: false }]);
  assert.deepEqual(h.enabledChanges, []);
  assert.ok(h.text().includes('[ ] Auto model switch'), h.text());

  // Both switches are reachable from the keyboard and carry the configured state.
  const off = harness({ config: { autoRotate: false, autoSwitchModel: false } });
  assert.ok(off.text().includes('[ ] Auto rotation'), off.text());
  selectRow(off, 'autoSwitch');
  off.component.handleInput('\r');
  assert.deepEqual(off.patches, [{ autoSwitchModel: true }]);
});

test('PANEL-014 (S2): the panel shows runtime state, not only configuration', () => {
  const h = harness({
    state: {
      running: true,
      status: 'active',
      activeModel: idSecond,
      checkpoint: 4379,
      uncertain: 2,
      inventory: idMain,
      inventoryError: 'Account inventory unavailable',
    },
  });
  const text = h.text();
  assert.ok(text.includes('State'), text);
  assert.ok(text.includes('runtime: active'), text);
  assert.ok(text.includes(`model: ${idSecond}`), text);
  assert.ok(text.includes('checkpoint: 4379 pending'), text);
  assert.ok(text.includes('uncertain effects: 2'), text);
  assert.ok(text.includes('Account inventory unavailable'), text);

  // A saved checkpoint stays visible after the handover, and an off project says so.
  const saved = harness({ state: { lastCheckpoint: 4378, inventory: 'none' } });
  assert.ok(saved.text().includes('checkpoint: #4378 saved'), saved.text());
  const off = harness({ state: { running: false, enabled: false } });
  assert.ok(off.text().includes('off for this project'), off.text());
});

test('PANEL-015 (S2, S3): stepping modelCount grows and shrinks the visible slots without touching the list', () => {
  const ten = Array.from({ length: 10 }, (_, index) => `cliproxyapi/m${index + 1}/gpt-6.1-sol`);
  const h = harness({ config: { modelCount: 2, priorityCandidateIds: ten } });

  assert.equal(slotLines(h.render(100)).length, 2);
  assert.ok(h.text().includes('Priority slots (1-2)'), h.text());

  selectRow(h, 'modelCount');
  h.component.handleInput('\x1b[C');
  h.component.handleInput('\x1b[C');
  assert.deepEqual(h.patches, [{ modelCount: 3 }, { modelCount: 4 }]);
  assert.equal(slotLines(h.render(100)).length, 4);
  assert.ok(h.text().includes('Priority slots (1-4)'), h.text());
  assert.equal(getPanelRowIds(h.current()).filter(id => id.startsWith('slot:')).length, 4);
  assert.deepEqual(h.current().priorityCandidateIds, ten, 'raising the count never deletes stored entries');

  h.component.handleInput('\x1b[D');
  h.component.handleInput('\x1b[D');
  assert.deepEqual(h.patches.at(-1), { modelCount: 2 });
  assert.equal(slotLines(h.render(100)).length, 2);
  assert.deepEqual(h.current().priorityCandidateIds, ten, 'lowering the count hides entries but keeps them');
});

test('PANEL-016 (S1, S4): the panel exposes no action rows and no separate routing picker', () => {
  const h = harness({ config: { modelCount: 2 } });
  const text = h.text();
  for (const removed of ['rotate now', 'pause', 'cancel now', 'refresh inventory', 'routing models']) {
    assert.ok(!text.includes(removed), `${removed} must be gone: ${text}`);
  }
  const ids = [...h.rowIds()];
  assert.ok(!ids.some(id => id.startsWith('action:')), String(ids));
  assert.ok(!(ids as string[]).includes('models'), String(ids));
  assert.deepEqual(ids, ['toggle', 'autoRotate', 'autoSwitch', 'modelCount', 'slot:1', 'slot:2', 'rotation', 'codexQuota', 'retries', 'cooldown', 'poll']);
});

test('PANEL-017 (S6): enabling with uncertain effects asks for an explicit second confirmation', () => {
  const h = harness({ config: { enabled: false }, state: { uncertain: 3, running: false } });

  assert.ok(h.text().includes('[ ] Disabled'), h.text());
  h.component.handleInput('\r');
  assert.deepEqual(h.patches, [], 'the first Enter only arms confirmation');
  assert.deepEqual(h.enabledChanges, []);
  assert.match(h.text(), /confirm enabling/, h.text());

  // Escape abandons the confirmation without enabling or closing the panel.
  h.component.handleInput('\x1b');
  assert.equal(h.closedCount(), 0);
  assert.deepEqual(h.enabledChanges, []);
  assert.ok(!/confirm enabling/.test(h.text()), h.text());

  // The second Enter persists enabled and acknowledges the uncertain effects.
  h.component.handleInput('\r');
  h.component.handleInput('\r');
  assert.deepEqual(h.patches, [{ enabled: true }]);
  assert.deepEqual(h.enabledChanges, [[true, true]]);
  assert.ok(h.text().includes('[x] Enabled'), h.text());

  // Mouse follows the same two-step contract.
  const click = harness({ config: { enabled: false }, state: { uncertain: 1, running: false } });
  const y = click.render(100).findIndex(line => line.includes('[ ] Disabled'));
  click.component.handleMouse(mouseClick(5, y));
  assert.deepEqual(click.patches, []);
  assert.match(click.text(), /confirm enabling/);
  click.component.handleMouse(mouseClick(5, y));
  assert.deepEqual(click.patches, [{ enabled: true }]);
  assert.deepEqual(click.enabledChanges, [[true, true]]);

  // With no uncertain effects, enabling is ordinary and carries no acknowledgement.
  const plain = harness({ config: { enabled: false }, state: { uncertain: 0, running: false } });
  plain.component.handleInput('\r');
  assert.deepEqual(plain.patches, [{ enabled: true }]);
  assert.deepEqual(plain.enabledChanges, [[true, false]]);
  assert.ok(!/confirm enabling/.test(plain.text()), plain.text());
});

test('PANEL-018 (S3): a filter that matches no model reports it instead of a blank picker viewport', () => {
  const h = harness({ config: { modelCount: 2 } });
  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  for (const character of 'zzz') h.component.handleInput(character);
  const text = h.text();
  assert.match(text, /no model matches "zzz"/, text);

  // Backspace widens the filter again and the message goes away.
  for (let index = 0; index < 3; index++) h.component.handleInput('\x7f');
  assert.ok(!/no model matches/.test(h.text()), h.text());
  assert.ok(h.text().includes(idMain), h.text());
});

test('PANEL-019 (S1): effort menu opens after model selection and persists ID plus effort atomically', () => {
  const effortCandidate: ModelCandidate = {
    ...catalog[0],
    id: 'cliproxyapi/effort/gpt-6.1-sol',
    supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
  };
  const h = harness({ candidates: [effortCandidate, ...catalog], config: { modelCount: 2, priorityCandidateIds: [] } });

  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Assign priority slot 1'));

  // Select the effort candidate in model picker
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 1'));
  assert.ok(h.text().includes('cliproxyapi/effort/gpt-6.1-sol'));
  assert.ok(h.text().includes('Default'));
  assert.ok(h.text().includes('low'));
  assert.ok(h.text().includes('medium'));
  assert.ok(h.text().includes('high'));
  assert.ok(h.text().includes('xhigh'));
  assert.equal(h.patches.length, 0, 'no save before effort confirmation');

  // Step down to 'medium' (Default -> low -> medium)
  h.component.handleInput('\x1b[B'); // low
  h.component.handleInput('\x1b[B'); // medium
  h.component.handleInput('\r'); // confirm

  assert.equal(h.patches.length, 1);
  assert.deepEqual(h.patches[0], {
    priorityCandidateIds: ['cliproxyapi/effort/gpt-6.1-sol'],
    modelEfforts: { 'cliproxyapi/effort/gpt-6.1-sol': 'medium' },
  });
  assert.ok(h.text().includes('1. cliproxyapi/effort/gpt-6.1-sol [medium]'));
});

test('PANEL-020 (S1): re-selecting same model allows changing effort; Default removes override', () => {
  const effortCandidate: ModelCandidate = {
    ...catalog[0],
    id: idMain,
    supportedEfforts: ['low', 'medium', 'high'],
  };
  const h = harness({
    candidates: [effortCandidate],
    config: {
      modelCount: 2,
      priorityCandidateIds: [idMain],
      modelEfforts: { [idMain]: 'low', [idSecond]: 'high' },
    },
  });

  assert.ok(h.text().includes(`1. ${idMain} [low]`));

  // Open slot 1 and select the same model
  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Assign priority slot 1'));
  h.component.handleInput('\r');

  // Effort menu opens, prior override ('low') is highlighted (index 1)
  assert.ok(h.text().includes('Select reasoning effort: slot 1'));
  assert.ok(h.render(100).some(line => line.startsWith('→ low')));

  // Move up to Default (index 0) and confirm
  h.component.handleInput('\x1b[A');
  assert.ok(h.render(100).some(line => line.startsWith('→ Default')));
  h.component.handleInput('\r');

  // Default removes only that model's override; other overrides survive
  assert.equal(h.patches.length, 1);
  assert.deepEqual(h.patches[0], {
    priorityCandidateIds: [idMain],
    modelEfforts: { [idSecond]: 'high' },
  });
  assert.ok(h.text().includes(`1. ${idMain} [Default]`));
});

test('PANEL-021 (S1): Escape in effort menu returns to model picker without save; Escape in picker closes', () => {
  const h = harness({ config: { modelCount: 2, priorityCandidateIds: [] } });

  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Assign priority slot 1'));

  // Enter effort menu
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 1'));
  assert.equal(h.patches.length, 0);

  // Escape returns to model picker
  h.component.handleInput('\x1b');
  assert.ok(h.text().includes('Assign priority slot 1'));
  assert.ok(!h.text().includes('Select reasoning effort'));
  assert.equal(h.patches.length, 0);

  // Escape closes picker (returns to rows view)
  h.component.handleInput('\x1b');
  assert.ok(!h.text().includes('Assign priority slot'));
  assert.equal(h.closedCount(), 0);
  assert.equal(h.patches.length, 0);

  // Escape in rows view closes panel
  h.component.handleInput('\x1b');
  assert.equal(h.closedCount(), 1);
  assert.equal(h.patches.length, 0);
});

test('PANEL-022 (S1): clearing slot drops slot immediately and preserves per-model overrides', () => {
  const h = harness({
    config: {
      modelCount: 2,
      priorityCandidateIds: [idMain, idSecond],
      modelEfforts: { [idMain]: 'high', [idSecond]: 'low' },
    },
  });

  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Assign priority slot 1'));

  // Move down to 'clear (drop slot 1)' and confirm
  let guard = 0;
  while (!h.render(100).some(line => line.startsWith('→ clear')) && guard < 20) {
    h.component.handleInput('\x1b[B');
    guard++;
  }
  assert.ok(h.render(100).some(line => line.startsWith('→ clear')));
  h.component.handleInput('\r');

  // Clear is immediate, does NOT open effort menu, and leaves modelEfforts untouched
  assert.deepEqual(h.patches, [{ priorityCandidateIds: [idSecond] }]);
  assert.equal(h.current().modelEfforts?.[idMain], 'high');
  assert.equal(h.current().modelEfforts?.[idSecond], 'low');
});

test('PANEL-023 (S1): unbound panel closes without writing from effort menu', () => {
  const h = harness({ config: { modelCount: 2, priorityCandidateIds: [] } });
  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 1'));

  h.setBound(false);
  h.component.handleInput('\r');
  assert.equal(h.closedCount(), 1);
  assert.equal(h.patches.length, 0, 'no write after unbind in effort menu');
});

test('PANEL-024 (S1): refused write during effort confirmation reports error and keeps view open', () => {
  const h = harness({ config: { modelCount: 2, priorityCandidateIds: [] }, failApply: true });
  selectRow(h, 'slot:1');
  h.component.handleInput('\r');
  h.component.handleInput('\r');
  assert.ok(h.text().includes('Select reasoning effort: slot 1'));

  h.component.handleInput('\r');
  assert.equal(h.patches.length, 0);
  assert.equal(h.errors.length, 1);
  assert.ok(h.text().includes('Select reasoning effort: slot 1'));
  assert.equal(h.closedCount(), 0);
});
