import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type ModelEffort,
  type EffortMenuOption,
  resolveEffortMenuOptions,
  computeEffortPatch,
  formatSlotLabel,
  renderEffortPicker,
} from '../src/model-effort-panel.ts';
import { fakeLib, identityTheme, fakeKeybindings } from './fixtures/fake-tui.ts';
import { createSupervisorPanel } from '../src/supervisor-panel.ts';
import { createSupervisorDashboard } from '../src/supervisor-dashboard.ts';
import { DEFAULT_SUPERVISOR_CONFIG } from '../src/supervisor-config.ts';
import { DEFAULT_SUBAGENT_CONFIG } from '../src/subagent-config.ts';
import type { ModelCandidate } from '../src/types.ts';

const candidateWithEfforts: ModelCandidate = {
  id: 'cliproxyapi/main/gpt-6.1-sol',
  source: 'account',
  quotaProtocol: 'wham',
  prefix: 'main',
  family: 'codex',
  modelSlug: 'gpt-6.1-sol',
  provider: 'cliproxyapi',
  reasoningEffort: 'high',
  supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
};

const candidateWithoutEfforts: ModelCandidate = {
  id: 'cliproxyapi/fallback/gemini-3.8-flash-high',
  source: 'account',
  quotaProtocol: 'gemini',
  prefix: 'fallback',
  family: 'gemini',
  modelSlug: 'gemini-3.8-flash-high',
  provider: 'cliproxyapi',
  reasoningEffort: 'high',
};

test('EFFORT-PANEL-001: resolveEffortMenuOptions exposes Default only when supportedEfforts is absent or empty', () => {
  const result1 = resolveEffortMenuOptions(candidateWithoutEfforts);
  assert.deepEqual(result1.options, ['Default']);
  assert.equal(result1.initialIndex, 0);

  const emptyCandidate = { ...candidateWithoutEfforts, supportedEfforts: [] as ModelEffort[] };
  const result2 = resolveEffortMenuOptions(emptyCandidate);
  assert.deepEqual(result2.options, ['Default']);
  assert.equal(result2.initialIndex, 0);

  // Unknown capabilities must not guess from model names (e.g., 'flash-high' in slug)
  assert.equal(result1.options.length, 1);
});

test('EFFORT-PANEL-002: resolveEffortMenuOptions prepends Default and highlights prior override if supported', () => {
  const noOverride = resolveEffortMenuOptions(candidateWithEfforts);
  assert.deepEqual(noOverride.options, ['Default', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(noOverride.initialIndex, 0);

  const withMedium = resolveEffortMenuOptions(candidateWithEfforts, 'medium');
  assert.deepEqual(withMedium.options, ['Default', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(withMedium.initialIndex, 2); // 'medium' is index 2

  const withHigh = resolveEffortMenuOptions(candidateWithEfforts, 'high');
  assert.equal(withHigh.initialIndex, 3); // 'high' is index 3

  // Unsupported prior override falls back to Default (index 0)
  const withMax = resolveEffortMenuOptions(candidateWithEfforts, 'max');
  assert.equal(withMax.initialIndex, 0);
});

test('EFFORT-PANEL-003: computeEffortPatch adds or updates explicit effort and preserves other entries', () => {
  const emptyBefore: Record<string, ModelEffort> | undefined = undefined;
  const patch1 = computeEffortPatch('cliproxyapi/main/gpt-6.1-sol', 'high', emptyBefore);
  assert.deepEqual(patch1, {
    modelEfforts: {
      'cliproxyapi/main/gpt-6.1-sol': 'high',
    },
  });

  const existing: Record<string, ModelEffort> = {
    'cliproxyapi/other/claude': 'low',
    'cliproxyapi/main/gpt-6.1-sol': 'medium',
  };
  const patch2 = computeEffortPatch('cliproxyapi/main/gpt-6.1-sol', 'xhigh', existing);
  assert.deepEqual(patch2, {
    modelEfforts: {
      'cliproxyapi/other/claude': 'low',
      'cliproxyapi/main/gpt-6.1-sol': 'xhigh',
    },
  });
  // Other model override must remain intact
  assert.equal(patch2.modelEfforts?.['cliproxyapi/other/claude'], 'low');
});

test('EFFORT-PANEL-004: computeEffortPatch with Default removes only current model override', () => {
  const existing: Record<string, ModelEffort> = {
    'cliproxyapi/m1/model': 'high',
    'cliproxyapi/m2/model': 'low',
  };
  const patch = computeEffortPatch('cliproxyapi/m1/model', 'Default', existing);
  assert.deepEqual(patch, {
    modelEfforts: {
      'cliproxyapi/m2/model': 'low',
    },
  });

  // When no override was stored for that model, patch is empty to avoid creating empty maps on old files
  const patchNoop = computeEffortPatch('cliproxyapi/m3/model', 'Default', existing);
  assert.deepEqual(patchNoop, {});

  const patchFromUndefined = computeEffortPatch('cliproxyapi/m1/model', 'Default', undefined);
  assert.deepEqual(patchFromUndefined, {});
});

test('EFFORT-PANEL-005: formatSlotLabel displays slot, model and effort or (empty)', () => {
  assert.equal(formatSlotLabel(1, ''), '1. (empty)');
  assert.equal(formatSlotLabel(2, 'cliproxyapi/main/gpt-6.1-sol'), '2. cliproxyapi/main/gpt-6.1-sol [Default]');
  assert.equal(
    formatSlotLabel(3, 'cliproxyapi/main/gpt-6.1-sol', { 'cliproxyapi/main/gpt-6.1-sol': 'medium' }),
    '3. cliproxyapi/main/gpt-6.1-sol [medium]',
  );
  assert.equal(
    formatSlotLabel(4, 'cliproxyapi/other/model', { 'cliproxyapi/main/gpt-6.1-sol': 'medium' }),
    '4. cliproxyapi/other/model [Default]',
  );
});

test('EFFORT-PANEL-006: renderEffortPicker formats title, candidate ID, options with marker, and bounds within width', () => {
  const options: EffortMenuOption[] = ['Default', 'low', 'medium', 'high'];
  const lines = renderEffortPicker({
    width: 60,
    targetSlot: 2,
    candidateId: 'cliproxyapi/main/gpt-6.1-sol',
    options,
    selectedIndex: 2,
    style: {
      accent: identityTheme.fg.bind(null, 'accent'),
      bold: identityTheme.bold,
      dim: identityTheme.fg.bind(null, 'dim'),
    },
    lib: fakeLib,
  });

  assert.ok(lines.some(l => l.includes('slot 2')));
  assert.ok(lines.some(l => l.includes('cliproxyapi/main/gpt-6.1-sol')));
  assert.ok(lines.some(l => l.startsWith('→ medium')));
  assert.ok(lines.some(l => l.startsWith('  Default')));
  assert.ok(lines.some(l => l.startsWith('  low')));
  assert.ok(lines.some(l => l.startsWith('  high')));
  assert.ok(lines.some(l => l.includes('esc back')));

  // Width boundary clamping
  for (const width of [20, 40, 80]) {
    const rendered = renderEffortPicker({
      width,
      targetSlot: 1,
      candidateId: 'cliproxyapi/main/gpt-6.1-sol',
      options,
      selectedIndex: 0,
      style: {
        accent: identityTheme.fg.bind(null, 'accent'),
        bold: identityTheme.bold,
        dim: identityTheme.fg.bind(null, 'dim'),
      },
      lib: fakeLib,
    });
    for (const line of rendered) {
      assert.ok(fakeLib.visibleWidth(line) <= width, `line exceeds width ${width}: ${line}`);
    }
  }
});

test('EFFORT-PANEL-007 (S1): createSupervisorPanel integrates two-stage model and effort selection', () => {
  let savedConfig: any = null;
  const component = (createSupervisorPanel as any)({
    lib: fakeLib,
    tui: { requestRender() {} },
    theme: identityTheme,
    keybindings: fakeKeybindings,
    config: {
      ...DEFAULT_SUPERVISOR_CONFIG,
      modelCount: 2,
      priorityCandidateIds: [],
    },
    state: () => ({ enabled: true, running: true, uncertain: 0 }),
    candidates: [candidateWithEfforts],
    isBound: () => true,
    applyConfig: (patch: any) => {
      savedConfig = patch;
      return { ...DEFAULT_SUPERVISOR_CONFIG, ...patch };
    },
    onEnabledChange() {},
    onError() {},
    done() {},
  });

  // Step down from toggle -> autoRotate -> autoSwitch -> modelCount -> slot:1
  for (let i = 0; i < 4; i++) component.handleInput('\x1b[B');
  assert.equal(component.selectedRowId, 'slot:1');

  // Open slot 1
  component.handleInput('\r');
  // First Enter on candidate in model picker: opens effort menu
  component.handleInput('\r');
  const effortView = (component.render(80) as string[]).join('\n');
  assert.ok(effortView.includes('Select reasoning effort: slot 1'));
  assert.equal(savedConfig, null, 'no save prior to final effort confirmation');

  // Move to 'high' (Default -> low -> medium -> high)
  component.handleInput('\x1b[B');
  component.handleInput('\x1b[B');
  component.handleInput('\x1b[B');
  component.handleInput('\r'); // confirm effort

  assert.deepEqual(savedConfig, {
    priorityCandidateIds: [candidateWithEfforts.id],
    modelEfforts: { [candidateWithEfforts.id]: 'high' },
  });
  const lines = component.render(80) as string[];
  assert.ok(lines.some((l: string) => l.includes(`1. ${candidateWithEfforts.id} [high]`)));
});

test('EFFORT-PANEL-008 (S1): createSupervisorDashboard Subagents tab integrates effort selection', () => {
  let savedSubagentPatch: any = null;
  const dashboard = (createSupervisorDashboard as any)({
    orchestrator: {
      lib: fakeLib,
      tui: { requestRender() {} },
      theme: identityTheme,
      keybindings: fakeKeybindings,
      config: DEFAULT_SUPERVISOR_CONFIG,
      state: () => ({ enabled: true, running: true, uncertain: 0 }),
      candidates: [],
      isBound: () => true,
      applyConfig: (patch: any) => patch,
      onEnabledChange() {},
      onError() {},
      done() {},
    },
    subagents: {
      config: { ...DEFAULT_SUBAGENT_CONFIG, modelCount: 2, priorityCandidateIds: [] },
      candidates: [candidateWithEfforts],
      applyConfig: (patch: any) => {
        savedSubagentPatch = patch;
        return { ...DEFAULT_SUBAGENT_CONFIG, ...patch };
      },
    },
  });

  // Switch to Subagents
  dashboard.handleInput('\t');
  assert.equal(dashboard.activeTab, 'subagents');

  // Navigate to slot 1: toggle -> modelCount -> slot:1
  dashboard.handleInput('\x1b[B');
  dashboard.handleInput('\x1b[B');
  assert.equal(dashboard.selectedRowId, 'slot:1');

  // Open model picker, select candidate -> opens effort menu
  dashboard.handleInput('\r');
  dashboard.handleInput('\r');
  assert.ok(dashboard.render(80).join('\n').includes('Select reasoning effort: slot 1'));

  // Move down to 'low' and confirm
  dashboard.handleInput('\x1b[B');
  dashboard.handleInput('\r');

  assert.deepEqual(savedSubagentPatch, {
    priorityCandidateIds: [candidateWithEfforts.id],
    modelEfforts: { [candidateWithEfforts.id]: 'low' },
  });
});

test('EFFORT-PANEL-009 (S1): Escape in effort menu returns to model picker without save', () => {
  let saved = false;
  const component = (createSupervisorPanel as any)({
    lib: fakeLib,
    tui: { requestRender() {} },
    theme: identityTheme,
    keybindings: fakeKeybindings,
    config: { ...DEFAULT_SUPERVISOR_CONFIG, modelCount: 2, priorityCandidateIds: [] },
    state: () => ({ enabled: true, running: true, uncertain: 0 }),
    candidates: [candidateWithEfforts],
    isBound: () => true,
    applyConfig: (patch: any) => { saved = true; return patch; },
    onEnabledChange() {},
    onError() {},
    done() {},
  });

  for (let i = 0; i < 4; i++) component.handleInput('\x1b[B');
  component.handleInput('\r'); // open picker
  component.handleInput('\r'); // open effort menu
  assert.ok(component.render(80).join('\n').includes('Select reasoning effort: slot 1'));

  // Escape returns to model picker
  component.handleInput('\x1b');
  assert.ok(component.render(80).join('\n').includes('Assign priority slot 1'));
  assert.equal(saved, false);

  // Escape closes picker
  component.handleInput('\x1b');
  assert.ok(!component.render(80).join('\n').includes('Assign priority slot'));
  assert.equal(saved, false);
});

test('EFFORT-PANEL-010 (S1): failed save during effort confirmation reports error and keeps view open', () => {
  const errors: string[] = [];
  const component = (createSupervisorPanel as any)({
    lib: fakeLib,
    tui: { requestRender() {} },
    theme: identityTheme,
    keybindings: fakeKeybindings,
    config: { ...DEFAULT_SUPERVISOR_CONFIG, modelCount: 2, priorityCandidateIds: [] },
    state: () => ({ enabled: true, running: true, uncertain: 0 }),
    candidates: [candidateWithEfforts],
    isBound: () => true,
    applyConfig: () => { throw new Error('write failed'); },
    onEnabledChange() {},
    onError: (msg: string) => errors.push(msg),
    done() {},
  });

  for (let i = 0; i < 4; i++) component.handleInput('\x1b[B');
  component.handleInput('\r'); // open picker
  component.handleInput('\r'); // open effort
  component.handleInput('\r'); // confirm effort (fails)

  assert.equal(errors.length, 1);
  assert.ok(component.render(80).join('\n').includes('Select reasoning effort: slot 1'));
});

test('EFFORT-PANEL-011 (S1): stale session guard closes dialog without saving from effort menu', () => {
  let bound = true;
  let closed = 0;
  let saved = false;
  const component = (createSupervisorPanel as any)({
    lib: fakeLib,
    tui: { requestRender() {} },
    theme: identityTheme,
    keybindings: fakeKeybindings,
    config: { ...DEFAULT_SUPERVISOR_CONFIG, modelCount: 2, priorityCandidateIds: [] },
    state: () => ({ enabled: true, running: true, uncertain: 0 }),
    candidates: [candidateWithEfforts],
    isBound: () => bound,
    applyConfig: (patch: any) => { saved = true; return patch; },
    onEnabledChange() {},
    onError() {},
    done: () => { closed++; },
  });

  for (let i = 0; i < 4; i++) component.handleInput('\x1b[B');
  component.handleInput('\r');
  component.handleInput('\r');
  assert.ok(component.render(80).join('\n').includes('Select reasoning effort: slot 1'));

  bound = false;
  component.handleInput('\r');
  assert.equal(closed, 1);
  assert.equal(saved, false);
});

test('EFFORT-PANEL-012 (PRESERVE): unknown capability model exposes Default only and saves cleanly', () => {
  let savedConfig: any = null;
  const component = (createSupervisorPanel as any)({
    lib: fakeLib,
    tui: { requestRender() {} },
    theme: identityTheme,
    keybindings: fakeKeybindings,
    config: { ...DEFAULT_SUPERVISOR_CONFIG, modelCount: 2, priorityCandidateIds: [] },
    state: () => ({ enabled: true, running: true, uncertain: 0 }),
    candidates: [candidateWithoutEfforts],
    isBound: () => true,
    applyConfig: (patch: any) => {
      savedConfig = patch;
      return { ...DEFAULT_SUPERVISOR_CONFIG, ...patch };
    },
    onEnabledChange() {},
    onError() {},
    done() {},
  });

  for (let i = 0; i < 4; i++) component.handleInput('\x1b[B');
  component.handleInput('\r');
  component.handleInput('\r'); // effort menu
  const lines = component.render(80) as string[];
  assert.ok(lines.some((l: string) => l.startsWith('→ Default')));
  assert.ok(!lines.some((l: string) => l.trim() === 'low' || l.trim() === 'high'));

  component.handleInput('\r'); // confirm Default
  assert.deepEqual(savedConfig, {
    priorityCandidateIds: [candidateWithoutEfforts.id],
  });
  const finalLines = component.render(80) as string[];
  assert.ok(finalLines.some((l: string) => l.includes(`1. ${candidateWithoutEfforts.id} [Default]`)));
});
