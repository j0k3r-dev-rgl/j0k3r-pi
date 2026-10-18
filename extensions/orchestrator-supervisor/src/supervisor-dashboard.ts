import type { ConfigurationScopeControl } from './configuration-scope.ts';
import { createConfigurationScopeEditor } from './configuration-scope-panel.ts';
import {
  formatSlotLabel,
  renderEffortPicker,
  resolveEffortMenuOptions,
  computeEffortPatch,
  type EffortMenuOption,
} from './model-effort-panel.ts';
import { PANEL_VISIBLE_ROWS, createSupervisorPanel, type SupervisorPanelOptions } from './supervisor-panel.ts';
import { SUBAGENT_MODEL_COUNT_MAX, SUBAGENT_MODEL_COUNT_MIN, type SubagentConfig } from './subagent-config.ts';
import type { ModelCandidate } from './types.ts';

/**
 * Two-tab supervisor dialog.
 *
 * The existing `/supervisor` control panel is reused verbatim as the Orchestrator tab; it
 * keeps its own row ids, safety confirmation and picker behavior. The Subagents tab is an
 * independent configuration view for the subagent router: it toggles the feature, edits the
 * number of slots (2..20) and assigns a distinct model to each slot through the injected
 * `applyConfig`. Execution assignment lives in the child-side adapter, not in this view.
 *
 * Every terminal primitive arrives through `SupervisorPanelOptions.lib`, so this module
 * imports no host virtual module and `npm test` injects stand-ins.
 */

/** The two top-level views. */
export type DashboardTab = 'orchestrator' | 'subagents';

/**
 * The subagent router configuration this view edits. Type-only re-export of the canonical
 * document in `./subagent-config.ts`, so the UI can never drift from the persisted shape.
 */
export type { SubagentConfig };

/** The allowed number of subagent routing slots, inclusive; sourced from the config contract. */
export const SUBAGENT_MODEL_COUNT_RANGE: readonly [number, number] = [SUBAGENT_MODEL_COUNT_MIN, SUBAGENT_MODEL_COUNT_MAX];

export type SubagentPanelRowId = 'scope' | 'toggle' | 'modelCount' | `slot:${number}`;

/** Every selectable Subagents row, in the order ↑/↓ walks them. */
export function getSubagentRowIds(config: SubagentConfig): readonly SubagentPanelRowId[] {
  return [
    'toggle',
    'modelCount',
    ...Array.from({ length: config.modelCount }, (_, index) => `slot:${index + 1}` as SubagentPanelRowId),
  ];
}

export interface SupervisorDashboardOptions {
  /** Options for the existing Orchestrator control panel, reused unchanged. */
  orchestrator: SupervisorPanelOptions;
  subagents: {
    /** Current effective per-project subagent configuration. */
    config: SubagentConfig;
    scopeControl?: ConfigurationScopeControl<SubagentConfig>;
    /** The host's Pi registry catalogue for the subagent slot pickers. */
    candidates: ModelCandidate[];
    /** Set when the stored subagent document could not be trusted; then edits are refused. */
    error?: string;
    /** Persists a partial change, returns the effective config. Throws when the lock refuses. */
    applyConfig: (patch: Partial<SubagentConfig>) => SubagentConfig;
  };
  /** Whether to frame the dashboard with unicode box borders (modal mode). */
  framed?: boolean;
}

const LABEL_WIDTH = 22;
const VALUE_WIDTH = 8;
/** marker(2) + gap(1) + `[-]`(3) + gap(1) + value(8) + gap(1) + `[+]`(3). */
const THRESHOLD_OVERHEAD = 19;
const TAB_LABELS: ReadonlyArray<{ tab: DashboardTab; label: string }> = [
  { tab: 'orchestrator', label: 'Orchestrator' },
  { tab: 'subagents', label: 'Subagents' },
];
/** rule + tabs + rule, so a child click is offset by three rows. */
const TAB_BAR_LINE = 1;
const TAB_BAR_HEIGHT = 3;
const SUBAGENT_SAVED_NOTE = ' Configuration saved; least-loaded child assignment when enabled.';
const SUBAGENT_DISABLED_NOTE = ' edits are disabled until the stored configuration is valid';
const SUBAGENT_SAVE_ERROR = 'Could not save the subagent configuration; nothing changed.';

interface PanelHitRow {
  id: SubagentPanelRowId;
  y: number;
  minus?: readonly [number, number];
  plus?: readonly [number, number];
}

interface PickerEntry {
  kind: 'candidate' | 'clear';
  id?: string;
  label: string;
  /** Set when another slot already owns this candidate; then it cannot be assigned. */
  usedInSlot?: number;
}

interface PickerState {
  targetSlot: number;
  query: string;
  selected: number;
  stage: 'model' | 'effort';
  selectedCandidate?: ModelCandidate;
  effortOptions?: EffortMenuOption[];
  effortSelected?: number;
}

interface SubagentPanelOptions {
  lib: any;
  tui: any;
  theme: any;
  keybindings: any;
  config: SubagentConfig;
  scopeControl?: ConfigurationScopeControl<SubagentConfig>;
  candidates: ModelCandidate[];
  error?: string;
  applyConfig: (patch: Partial<SubagentConfig>) => SubagentConfig;
  onError: (message: string) => void;
  done: () => void;
  isBound: () => boolean;
}

/**
 * Renders and drives the Subagents configuration view. Like the Orchestrator panel it
 * exposes `render`, `invalidate`, `dispose`, `handleInput`, `handleMouse`, a settable
 * `focused` and a read-only `selectedRowId`. A stored-document error makes the view
 * read-only: it still renders and its tab stays reachable, but no edit is applied.
 */
function createSubagentPanel(options: SubagentPanelOptions): any {
  const { lib, tui, theme, keybindings, candidates, applyConfig, onError, done, isBound } = options;
  const { truncateToWidth, visibleWidth } = lib;
  const clip = (text: string, width: number): string => truncateToWidth(text, width, '…');
  const style = {
    accent: (text: string) => theme.fg('accent', text),
    muted: (text: string) => theme.fg('muted', text),
    dim: (text: string) => theme.fg('dim', text),
    warning: (text: string) => theme.fg('warning', text),
    bold: (text: string) => theme.bold(text),
  };

  let config: SubagentConfig = {
    ...options.config,
    priorityCandidateIds: [...options.config.priorityCandidateIds],
    modelEfforts: options.config.modelEfforts ? { ...options.config.modelEfforts } : undefined,
  };
  let selectedIndex = 0;
  let pickerState: PickerState | null = null;
  let lastWidth = 80;
  let focused = true;
  let error = options.error;
  const disabled = (): boolean => Boolean(error);
  const scopeEditor = createConfigurationScopeEditor(options.scopeControl, (next, nextError) => {
    config = {
      ...next,
      priorityCandidateIds: [...next.priorityCandidateIds],
      modelEfforts: next.modelEfforts ? { ...next.modelEfforts } : undefined,
    };
    error = nextError;
    pickerState = null;
    selectedIndex = rowIds().indexOf('scope');
  }, onError);
  const rowIds = (): readonly SubagentPanelRowId[] => scopeEditor.available ? ['scope', ...getSubagentRowIds(config)] : getSubagentRowIds(config);
  selectedIndex = scopeEditor.available ? 1 : 0;

  /** The visible slot editors: the active prefix of the saved list, padded with empties. */
  const slots = (): string[] => {
    const padded = config.priorityCandidateIds.slice(0, config.modelCount);
    while (padded.length < config.modelCount) padded.push('');
    return padded;
  };

  const clampIndex = (index: number, total: number): number => {
    if (total <= 0) return 0;
    return Math.max(0, Math.min(index, total - 1));
  };

  const windowStart = (total: number, selected: number, maxVisible: number): number => {
    const visible = Math.max(1, Math.min(maxVisible, Math.max(0, total)));
    const centered = selected - Math.floor(visible / 2);
    return Math.max(0, Math.min(centered, Math.max(0, total - visible)));
  };

  const marker = (isSelected: boolean): string => (isSelected ? '→ ' : '  ');

  /** Persists through the injected host API and adopts the returned document. Never mocks. */
  const applyPatch = (patch: Partial<SubagentConfig>): boolean => {
    if (disabled()) return false;
    try {
      const next = applyConfig(patch);
      config = {
        ...next,
        priorityCandidateIds: [...(next.priorityCandidateIds ?? [])],
        modelEfforts: next.modelEfforts ? { ...next.modelEfforts } : undefined,
      };
      return true;
    } catch {
      onError(SUBAGENT_SAVE_ERROR);
      return false;
    }
  };

  const flipEnabled = (): void => {
    if (applyPatch({ enabled: !config.enabled })) tui.requestRender?.();
  };

  const stepModelCount = (direction: 1 | -1): void => {
    const [min, max] = SUBAGENT_MODEL_COUNT_RANGE;
    // Only the count changes: the full saved list is never truncated by a count step.
    const next = Math.max(min, Math.min(max, config.modelCount + direction));
    if (next === config.modelCount) return;
    if (applyPatch({ modelCount: next })) {
      selectedIndex = clampIndex(selectedIndex, rowIds().length);
      tui.requestRender?.();
    }
  };

  const openPicker = (slotNumber: number): void => {
    selectedIndex = Math.max(0, rowIds().indexOf(`slot:${slotNumber}` as SubagentPanelRowId));
    pickerState = { targetSlot: slotNumber, query: '', selected: 0, stage: 'model' };
    tui.requestRender?.();
  };

  const closePicker = (): void => { pickerState = null; };

  const pickerEntries = (): PickerEntry[] => {
    const picker = pickerState;
    const entries: PickerEntry[] = [];
    if (picker) {
      const tokens = picker.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const full = config.priorityCandidateIds;
      for (const candidate of candidates) {
        const haystack = `${candidate.id} ${candidate.provider} ${candidate.prefix ?? ''}`.toLowerCase();
        if (!tokens.every(token => haystack.includes(token))) continue;
        const usedAt = full.indexOf(candidate.id);
        const usedInSlot = usedAt >= 0 && usedAt + 1 !== picker.targetSlot ? usedAt + 1 : undefined;
        // Other slots own these models even when hidden by modelCount. Keep only
        // unassigned models and the model already assigned to the slot being edited.
        if (usedInSlot !== undefined) continue;
        entries.push({
          kind: 'candidate',
          id: candidate.id,
          usedInSlot,
          label: usedInSlot === undefined ? candidate.id : `${candidate.id} (in slot ${usedInSlot})`,
        });
      }
    }
    entries.push({ kind: 'clear', label: picker ? `clear (drop slot ${picker.targetSlot})` : 'clear' });
    return entries;
  };

  const confirmPicker = (): void => {
    const picker = pickerState;
    if (!picker) return;
    const entries = pickerEntries();
    const entry = entries[clampIndex(picker.selected, entries.length)];
    if (!entry) return;

    // Edit against the whole stored list: hidden entries keep their order and are never
    // silently dropped, and a duplicate anywhere in it is refused.
    const full = config.priorityCandidateIds;
    const index = picker.targetSlot - 1;

    if (entry.kind === 'clear') {
      if (index >= full.length) { closePicker(); tui.requestRender?.(); return; }
      const next = [...full.slice(0, index), ...full.slice(index + 1)];
      if (applyPatch({ priorityCandidateIds: next })) { closePicker(); tui.requestRender?.(); }
      return;
    }
    if (entry.usedInSlot !== undefined) return; // Owned by another slot (visible or hidden): refuse.

    const candidate = candidates.find(c => c.id === entry.id) ?? {
      id: entry.id!,
      source: 'account' as const,
      quotaProtocol: 'none' as const,
      modelSlug: entry.id!,
      provider: '',
      reasoningEffort: 'high' as const,
    };

    const currentOverride = config.modelEfforts?.[candidate.id];
    const { options: effortOptions, initialIndex } = resolveEffortMenuOptions(candidate, currentOverride);

    picker.stage = 'effort';
    picker.selectedCandidate = candidate;
    picker.effortOptions = effortOptions;
    picker.effortSelected = initialIndex;
    tui.requestRender?.();
  };

  const confirmEffortPicker = (): void => {
    const picker = pickerState;
    if (!picker || picker.stage !== 'effort' || !picker.selectedCandidate || !picker.effortOptions) return;

    const candidate = picker.selectedCandidate;
    const chosenEffort = picker.effortOptions[clampIndex(picker.effortSelected ?? 0, picker.effortOptions.length)];
    const full = config.priorityCandidateIds;
    const index = picker.targetSlot - 1;

    const next = [...full];
    while (next.length <= index) next.push('');
    next[index] = candidate.id;

    const effortPatch = computeEffortPatch(candidate.id, chosenEffort, config.modelEfforts);
    const patch: Partial<SubagentConfig> = {
      priorityCandidateIds: next,
      ...effortPatch,
    };

    if (applyPatch(patch)) {
      closePicker();
      tui.requestRender?.();
    }
  };

  /** Renders one `[-] value [+]` row and registers its click zones. */
  const renderStepper = (width: number, push: (text: string) => number, hits: PanelHitRow[]): void => {
    const labelWidth = Math.max(4, Math.min(LABEL_WIDTH, width - THRESHOLD_OVERHEAD));
    const isSelected = rowIds()[selectedIndex] === 'modelCount';
    const label = clip('Model count', labelWidth);
    const paddedLabel = label + ' '.repeat(Math.max(0, labelWidth - visibleWidth(label)));
    const value = String(config.modelCount);
    const paddedValue = value + ' '.repeat(Math.max(0, VALUE_WIDTH - visibleWidth(value)));
    const rawLine = `${marker(isSelected)}${paddedLabel} [-] ${paddedValue} [+]`;
    const limit = visibleWidth(rawLine) > width ? width - 1 : width;
    const y = push(isSelected ? style.accent(rawLine) : rawLine);

    const minusStart = 2 + labelWidth + 1;
    const plusStart = minusStart + 3 + 1 + VALUE_WIDTH + 1;
    const hit: PanelHitRow = { id: 'modelCount', y };
    if (minusStart + 3 <= limit) hit.minus = [minusStart, minusStart + 3];
    if (plusStart + 3 <= limit) hit.plus = [plusStart, plusStart + 3];
    hits.push(hit);
  };

  const renderRows = (width: number): { lines: string[]; hits: PanelHitRow[] } => {
    const available = Math.max(1, width);
    const lines: string[] = [];
    const hits: PanelHitRow[] = [];
    const push = (text: string): number => {
      const index = lines.length;
      lines.push(clip(text, available));
      return index;
    };
    const rule = (): void => { push(style.dim('─'.repeat(available))); };

    rule();
    push(style.bold(style.accent(' Subagent router configuration')));
    rule();

    if (scopeEditor.available) {
      const [source, path] = scopeEditor.lines(rowIds()[selectedIndex] === 'scope');
      hits.push({ id: 'scope', y: push(source) });
      push(path);
    }
    if (disabled()) {
      push(style.warning(` configuration error: ${error ?? ''}`));
      push(style.dim(SUBAGENT_DISABLED_NOTE));
    }

    push(style.muted(' Switches'));
    const toggleId: SubagentPanelRowId = 'toggle';
    hits.push({
      id: toggleId,
      y: push(`${marker(rowIds()[selectedIndex] === toggleId)}[${config.enabled ? 'x' : ' '}] ${config.enabled ? 'Enabled' : 'Disabled'}`),
    });

    push('');
    push(style.muted(` Model slots (1-${config.modelCount})`));
    renderStepper(available, push, hits);
    const current = slots();
    for (let slot = 1; slot <= config.modelCount; slot++) {
      const id: SubagentPanelRowId = `slot:${slot}`;
      const value = current[slot - 1];
      const slotText = formatSlotLabel(slot, value, config.modelEfforts);
      hits.push({ id, y: push(`${marker(rowIds()[selectedIndex] === id)}${slotText}`) });
    }

    if (!disabled()) push(style.dim(SUBAGENT_SAVED_NOTE));

    push('');
    rule();
    push(style.dim(' ↑↓ move · ←→ adjust · enter select · d clear slot · tab switch panel · esc close'));
    rule();

    return { lines, hits };
  };

  const renderPicker = (width: number): { lines: string[]; hits: PanelHitRow[] } => {
    const available = Math.max(1, width);
    const lines: string[] = [];
    const push = (text: string): number => {
      const index = lines.length;
      lines.push(clip(text, available));
      return index;
    };
    const rule = (): void => { push(style.dim('─'.repeat(available))); };
    const picker = pickerState as PickerState;

    rule();
    push(style.bold(style.accent(` Assign subagent slot ${picker.targetSlot}`)));
    rule();
    push(` > ${picker.query || style.dim('filter by provider or model…')}`);
    rule();

    const entries = pickerEntries();
    if (!entries.some(entry => entry.kind === 'candidate')) {
      push(style.dim(picker.query ? ` no model matches "${picker.query}"` : ' no models available'));
    }
    const selected = clampIndex(picker.selected, entries.length);
    const start = windowStart(entries.length, selected, PANEL_VISIBLE_ROWS);
    const end = Math.min(start + PANEL_VISIBLE_ROWS, entries.length);
    for (let index = start; index < end; index++) {
      push(`${marker(index === selected)}${entries[index].label}`);
    }
    if (entries.length > PANEL_VISIBLE_ROWS) {
      push(style.dim(` ${selected + 1}/${entries.length} · pgUp/pgDn scroll`));
    }

    rule();
    push(style.dim(' type to filter · ↑↓ move · enter assign · esc back'));
    rule();
    return { lines, hits: [] };
  };

  const build = (width: number): { lines: string[]; hits: PanelHitRow[] } => {
    if (!pickerState) return renderRows(width);
    if (pickerState.stage === 'effort' && pickerState.selectedCandidate && pickerState.effortOptions) {
      return {
        lines: renderEffortPicker({
          width,
          targetSlot: pickerState.targetSlot,
          candidateId: pickerState.selectedCandidate.id,
          options: pickerState.effortOptions,
          selectedIndex: clampIndex(pickerState.effortSelected ?? 0, pickerState.effortOptions.length),
          style,
          lib,
        }),
        hits: [],
      };
    }
    return renderPicker(width);
  };

  const handleRowInput = (data: string): void => {
    const rows = rowIds();
    const id = rows[selectedIndex];
    if (id === 'scope' && (keybindings.matches(data, 'tui.select.confirm') || keybindings.matches(data, 'tui.editor.cursorLeft') || keybindings.matches(data, 'tui.editor.cursorRight'))) {
      scopeEditor.select(keybindings.matches(data, 'tui.editor.cursorLeft') ? 'project' : keybindings.matches(data, 'tui.editor.cursorRight') ? 'global' : undefined);
      tui.requestRender?.(); return;
    }
    if (data === 'd' && id?.startsWith('slot:')) {
      const index = Number(id.slice('slot:'.length)) - 1;
      if (!config.priorityCandidateIds[index]) return;
      const next = [...config.priorityCandidateIds];
      next[index] = '';
      if (applyPatch({ priorityCandidateIds: next })) tui.requestRender?.();
      return;
    }
    if (keybindings.matches(data, 'tui.select.up')) selectedIndex = clampIndex(selectedIndex - 1, rows.length);
    else if (keybindings.matches(data, 'tui.select.down')) selectedIndex = clampIndex(selectedIndex + 1, rows.length);
    else if (keybindings.matches(data, 'tui.select.pageUp')) selectedIndex = clampIndex(selectedIndex - PANEL_VISIBLE_ROWS, rows.length);
    else if (keybindings.matches(data, 'tui.select.pageDown')) selectedIndex = clampIndex(selectedIndex + PANEL_VISIBLE_ROWS, rows.length);
    else if (keybindings.matches(data, 'tui.select.confirm')) {
      if (disabled()) return;
      if (id === 'toggle') { flipEnabled(); return; }
      if (id && id.startsWith('slot:')) { openPicker(Number(id.slice('slot:'.length))); return; }
    } else if (id === 'modelCount' && keybindings.matches(data, 'tui.editor.cursorLeft')) stepModelCount(-1);
    else if (id === 'modelCount' && keybindings.matches(data, 'tui.editor.cursorRight')) stepModelCount(1);
    tui.requestRender?.();
  };

  const handlePickerInput = (data: string): void => {
    const picker = pickerState;
    if (!picker) return;

    if (picker.stage === 'effort') {
      if (keybindings.matches(data, 'tui.select.cancel')) {
        picker.stage = 'model';
        picker.selectedCandidate = undefined;
        picker.effortOptions = undefined;
        picker.effortSelected = undefined;
        tui.requestRender?.();
        return;
      }
      if (keybindings.matches(data, 'tui.select.confirm')) {
        confirmEffortPicker();
        return;
      }
      const total = picker.effortOptions?.length ?? 1;
      if (keybindings.matches(data, 'tui.select.up')) picker.effortSelected = clampIndex((picker.effortSelected ?? 0) - 1, total);
      else if (keybindings.matches(data, 'tui.select.down')) picker.effortSelected = clampIndex((picker.effortSelected ?? 0) + 1, total);
      else if (keybindings.matches(data, 'tui.select.pageUp')) picker.effortSelected = clampIndex((picker.effortSelected ?? 0) - PANEL_VISIBLE_ROWS, total);
      else if (keybindings.matches(data, 'tui.select.pageDown')) picker.effortSelected = clampIndex((picker.effortSelected ?? 0) + PANEL_VISIBLE_ROWS, total);
      tui.requestRender?.();
      return;
    }

    if (keybindings.matches(data, 'tui.select.confirm')) { confirmPicker(); return; }

    const total = pickerEntries().length;
    if (keybindings.matches(data, 'tui.select.up')) picker.selected = clampIndex(picker.selected - 1, total);
    else if (keybindings.matches(data, 'tui.select.down')) picker.selected = clampIndex(picker.selected + 1, total);
    else if (keybindings.matches(data, 'tui.select.pageUp')) picker.selected = clampIndex(picker.selected - PANEL_VISIBLE_ROWS, total);
    else if (keybindings.matches(data, 'tui.select.pageDown')) picker.selected = clampIndex(picker.selected + PANEL_VISIBLE_ROWS, total);
    else if (data === '\x7f' || data === '\b') { picker.query = picker.query.slice(0, -1); picker.selected = 0; }
    else if (data.length === 1 && data >= ' ' && data <= '~') { picker.query += data; picker.selected = 0; }
    tui.requestRender?.();
  };

  const handleInput = (data: string): void => {
    if (!isBound()) { done(); return; }
    if (keybindings.matches(data, 'tui.select.cancel')) {
      if (pickerState) {
        if (pickerState.stage === 'effort') {
          pickerState.stage = 'model';
          pickerState.selectedCandidate = undefined;
          pickerState.effortOptions = undefined;
          pickerState.effortSelected = undefined;
          tui.requestRender?.();
          return;
        }
        closePicker();
        tui.requestRender?.();
        return;
      }
      done();
      return;
    }
    if (pickerState) handlePickerInput(data);
    else handleRowInput(data);
  };

  const handleMouse = (event: any): void => {
    if (!isBound()) { done(); return; }
    if (pickerState) return; // The picker is keyboard-driven.
    if (!event || event.type !== 'press' || event.button !== 'left') return;
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return;

    const hit = build(lastWidth).hits.find(row => row.y === event.y);
    if (!hit) return;
    selectedIndex = Math.max(0, rowIds().indexOf(hit.id));
    if (hit.id === 'scope') { scopeEditor.select(); tui.requestRender?.(); return; }
    if (disabled()) return;
    if (hit.id === 'toggle') { flipEnabled(); return; }
    if (hit.id.startsWith('slot:')) { openPicker(Number(hit.id.slice('slot:'.length))); return; }
    if (hit.id === 'modelCount') {
      if (hit.minus && event.x >= hit.minus[0] && event.x < hit.minus[1]) { stepModelCount(-1); return; }
      if (hit.plus && event.x >= hit.plus[0] && event.x < hit.plus[1]) { stepModelCount(1); return; }
    }
    tui.requestRender?.();
  };

  const component: any = {
    render: (width: number): string[] => {
      lastWidth = width;
      return build(width).lines;
    },
    invalidate: (): void => {},
    dispose: (): void => {},
    handleInput,
    handleMouse,
  };

  Object.defineProperty(component, 'focused', {
    enumerable: true,
    configurable: true,
    get: () => focused,
    set: (value: boolean) => { focused = value; },
  });
  Object.defineProperty(component, 'selectedRowId', {
    enumerable: true,
    configurable: true,
    get: () => rowIds()[selectedIndex],
  });
  return component;
}

/**
 * The two-tab supervisor dialog. The Orchestrator tab is the existing control panel,
 * reused unchanged; the Subagents tab is the independent subagent configuration view.
 *
 * The returned component exposes the host component surface plus `activeTab`,
 * `selectedRowId` (delegated to the active child) and a read-only `panels` hook used by
 * tests to check focus propagation.
 */
export function createSupervisorDashboard(options: SupervisorDashboardOptions): any {
  const { orchestrator, subagents, framed } = options;
  const { lib, tui, theme, keybindings, isBound, onError, done } = orchestrator;
  const { truncateToWidth, visibleWidth } = lib;
  const clip = (text: string, width: number): string => truncateToWidth(text, width, '…');
  const style = {
    accent: (text: string) => theme.fg('accent', text),
    muted: (text: string) => theme.fg('muted', text),
    dim: (text: string) => theme.fg('dim', text),
    border: (text: string) => (theme.fg ? theme.fg('border', text) : text),
    bold: (text: string) => theme.bold(text),
  };

  const orchestratorPanel = createSupervisorPanel(orchestrator);
  const subagentPanel = createSubagentPanel({
    lib,
    tui,
    theme,
    keybindings,
    config: subagents.config,
    scopeControl: subagents.scopeControl,
    candidates: subagents.candidates,
    error: subagents.error,
    applyConfig: subagents.applyConfig,
    onError,
    done,
    isBound,
  });

  let activeTab: DashboardTab = 'orchestrator';
  let focused = true;
  let closed = false;
  let tabHits: Array<{ tab: DashboardTab; y: number; start: number; end: number }> = [];

  const activePanel = (): any => (activeTab === 'subagents' ? subagentPanel : orchestratorPanel);

  /** Only the active child owns focus, so IME and focus-sensitive children behave. */
  const applyFocus = (): void => {
    orchestratorPanel.focused = focused && activeTab === 'orchestrator';
    subagentPanel.focused = focused && activeTab === 'subagents';
  };
  applyFocus();

  const close = (): void => {
    if (closed) return;
    closed = true;
    done();
  };

  const setActiveTab = (tab: DashboardTab): void => {
    if (tab === activeTab) return;
    activeTab = tab;
    applyFocus();
    tui.requestRender?.();
  };

  /** The tab bar: a rule, the clickable labels, a rule. Records its own hit map. */
  const renderTabBar = (width: number): string[] => {
    const available = Math.max(1, width);
    const lines: string[] = [clip(style.dim('─'.repeat(available)), available)];

    let plain = '';
    const spans: Array<{ tab: DashboardTab; start: number; end: number }> = [];
    for (const entry of TAB_LABELS) {
      if (plain.length > 0) plain += ' ';
      const start = plain.length;
      plain += `[${entry.label}]`;
      spans.push({ tab: entry.tab, start, end: plain.length });
    }
    let styled = '';
    let cursor = 0;
    for (const span of spans) {
      styled += plain.slice(cursor, span.start);
      const raw = plain.slice(span.start, span.end);
      styled += span.tab === activeTab ? style.accent(style.bold(raw)) : style.muted(raw);
      cursor = span.end;
    }
    styled += plain.slice(cursor);

    // A clipped line ends in an ellipsis column: never register a zone that includes it.
    const limit = visibleWidth(plain) > available ? available - 1 : available;
    tabHits = spans
      .filter(span => span.start < limit)
      .map(span => ({ tab: span.tab, y: TAB_BAR_LINE, start: span.start, end: Math.min(span.end, limit) }));

    lines.push(clip(styled, available));
    lines.push(clip(style.dim('─'.repeat(available)), available));
    return lines;
  };

  const isTabForward = (data: string): boolean => data === '\t' || keybindings.matches(data, 'tui.input.tab');
  const isTabBackward = (data: string): boolean => data === '\x1b[Z' || keybindings.matches(data, 'tui.input.backTab');

  const component: any = {
    render: (width: number): string[] => {
      if (framed && width >= 10) {
        const innerW = Math.max(1, width - 2);
        const innerLines = renderTabBar(innerW);
        innerLines.push(...activePanel().render(innerW));

        const pad = (s: string, len: number) => {
          const vis = visibleWidth(s);
          return s + ' '.repeat(Math.max(0, len - vis));
        };
        const row = (content: string) => style.border('│') + pad(content, innerW) + style.border('│');

        const out: string[] = [];
        out.push(style.border(`┌${'─'.repeat(innerW)}┐`));
        for (const line of innerLines) {
          out.push(row(line));
        }
        out.push(style.border(`└${'─'.repeat(innerW)}┘`));
        return out;
      }

      const lines = renderTabBar(width);
      lines.push(...activePanel().render(width));
      return lines;
    },
    invalidate: (): void => {
      orchestratorPanel.invalidate?.();
      subagentPanel.invalidate?.();
    },
    dispose: (): void => {
      orchestratorPanel.dispose?.();
      subagentPanel.dispose?.();
    },
    handleInput: (data: string): void => {
      if (closed) return;
      if (!isBound()) { close(); return; }
      if (data === 'q' || data === 'Q') {
        close();
        return;
      }
      if (isTabForward(data) || isTabBackward(data)) {
        setActiveTab(activeTab === 'orchestrator' ? 'subagents' : 'orchestrator');
        return;
      }
      activePanel().handleInput(data);
    },
    handleMouse: (event: any): void => {
      if (closed) return;
      if (!isBound()) { close(); return; }
      if (!event || !Number.isFinite(event.x) || !Number.isFinite(event.y)) return;

      const yOffset = (framed && lastWidth >= 10) ? 1 : 0;
      const xOffset = (framed && lastWidth >= 10) ? 1 : 0;
      const adjustedY = event.y - yOffset;
      const adjustedX = event.x - xOffset;

      if (adjustedY < TAB_BAR_HEIGHT) {
        if (event.type !== 'press' || event.button !== 'left') return;
        const hit = tabHits.find(entry => entry.y === adjustedY && adjustedX >= entry.start && adjustedX < entry.end);
        if (hit) setActiveTab(hit.tab);
        return;
      }
      // Child coordinates are relative to the child, so remove the tab bar height.
      activePanel().handleMouse({ ...event, x: adjustedX, y: adjustedY - TAB_BAR_HEIGHT });
    },
  };

  let lastWidth = 80;

  Object.defineProperty(component, 'focused', {
    enumerable: true,
    configurable: true,
    get: () => focused,
    set: (value: boolean) => { focused = value; applyFocus(); },
  });
  Object.defineProperty(component, 'activeTab', {
    enumerable: true,
    configurable: true,
    get: () => activeTab,
  });
  Object.defineProperty(component, 'selectedRowId', {
    enumerable: true,
    configurable: true,
    get: () => activePanel().selectedRowId,
  });
  // Read-only test hook: the two child components, to check focus propagation.
  Object.defineProperty(component, 'panels', {
    enumerable: false,
    configurable: true,
    get: () => ({ orchestrator: orchestratorPanel, subagents: subagentPanel }),
  });
  return component;
}
