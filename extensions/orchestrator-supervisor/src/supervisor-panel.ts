import type { ConfigurationScopeControl } from './configuration-scope.ts';
import { createConfigurationScopeEditor } from './configuration-scope-panel.ts';
import {
  formatSlotLabel,
  renderEffortPicker,
  resolveEffortMenuOptions,
  computeEffortPatch,
  type EffortMenuOption,
} from './model-effort-panel.ts';
import {
  SUPERVISOR_CONFIG_RANGES,
  type SupervisorConfig,
} from './supervisor-config.ts';
import type { ModelCandidate } from './types.ts';

/**
 * Modal `/supervisor` component: the per-project on/off switch, the `modelCount` ordered
 * routing slots and every panel-editable threshold. It is configuration-only: it shows
 * state and edits the stored document, and performs no actions. Rotation stays available
 * to the agent through the existing private tool, never as a panel row.
 *
 * Every terminal primitive arrives as `options.lib`, which keeps this module free of
 * `@earendil-works/pi-tui` imports: the extension host
 * resolves that virtual module, while `npm test` injects stand-ins. The renderer also
 * returns the row hit map it drew, so mouse clicks and the lines on screen cannot drift
 * apart (`clip` to `width`, bounded row window).
 */

/** Rows the panel shows before its scrollable row window moves. */
export const PANEL_VISIBLE_ROWS = 12;

export type PanelRowId = 'scope' | 'toggle' | 'autoRotate' | 'autoSwitch' | 'modelCount' | `slot:${number}` | 'rotation' | 'codexQuota' | 'retries' | 'cooldown' | 'poll';

/**
 * Every selectable row, in the order ↑/↓ walks them. The list is dynamic: `modelCount`
 * decides how many slot editors exist, so callers derive it from the current config.
 */
export function getPanelRowIds(config: SupervisorConfig): readonly PanelRowId[] {
  return [
    'toggle',
    'autoRotate',
    'autoSwitch',
    'modelCount',
    ...Array.from({ length: config.modelCount }, (_, index) => `slot:${index + 1}` as PanelRowId),
    'rotation',
    'codexQuota',
    'retries',
    'cooldown',
    'poll',
  ];
}

/**
 * Read-only view of the running supervisor, so the panel can show state instead of only
 * configuration. Every field is optional except `enabled`/`running`: a project with the
 * supervisor off has no runtime to report.
 */
export interface SupervisorPanelState {
  enabled: boolean;
  running: boolean;
  status?: string;
  activeModel?: string;
  /** Pending verified checkpoint inside the runtime, if a handover is scheduled. */
  checkpoint?: number;
  /** Last saved checkpoint id, so a completed handover is still visible. */
  lastCheckpoint?: number;
  uncertain: number;
  /** Printable catalogue summary, or the reason it is missing. */
  inventory?: string;
  inventoryError?: string;
}

export interface SupervisorPanelOptions {
  /** The host-provided `@earendil-works/pi-tui` module: resolved by the extension loader. */
  lib: any;
  /** The host TUI instance, used only to request a render after state changes. */
  tui: any;
  theme: any;
  keybindings: any;
  /** Current effective per-project config. */
  config: SupervisorConfig;
  scopeControl?: ConfigurationScopeControl<SupervisorConfig>;
  error?: string;
  /** Live state for the read-only section; re-read on every render. */
  state: () => SupervisorPanelState;
  /** Routing catalogue for the slot pickers. */
  candidates: ModelCandidate[];
  discoveryFailed?: boolean;
  /** False once the runtime this dialog belongs to was replaced or disposed. */
  isBound: () => boolean;
  /** Persists a partial change, returns the effective config. Throws when the lock refuses. */
  applyConfig: (patch: Partial<SupervisorConfig>) => SupervisorConfig;
  /**
   * Called after `enabled` flips so the host creates or tears down the runtime immediately.
   * `acknowledgeUncertain` is true only when the human explicitly confirmed enabling with
   * uncertain mutation effects outstanding.
   */
  onEnabledChange: (enabled: boolean, acknowledgeUncertain?: boolean) => void;
  onError: (message: string) => void;
  done: () => void;
}

type ThresholdField =
  | 'modelCount'
  | 'rotationThresholdPercent'
  | 'codexQuotaThresholdPercent'
  | 'maxTransientFailures'
  | 'cooldownMinutes'
  | 'pollIntervalSeconds';

type CapabilityField = 'autoRotate' | 'autoSwitchModel';

interface CapabilityRow {
  id: PanelRowId;
  field: CapabilityField;
  label: string;
}

/**
 * The two automatic capabilities, each with its own switch next to the master one. They
 * never tear the runtime down: they only gate what the supervisor may do on its own.
 */
const CAPABILITY_ROWS: readonly CapabilityRow[] = [
  { id: 'autoRotate', field: 'autoRotate', label: 'Auto rotation' },
  { id: 'autoSwitch', field: 'autoSwitchModel', label: 'Auto model switch' },
];

/** Step size per stepper; the bounds come from `SUPERVISOR_CONFIG_RANGES`. */
const THRESHOLD_STEPS: Record<ThresholdField, number> = {
  modelCount: 1,
  rotationThresholdPercent: 1,
  codexQuotaThresholdPercent: 1,
  maxTransientFailures: 1,
  cooldownMinutes: 5,
  pollIntervalSeconds: 5,
};

interface ThresholdRow {
  id: PanelRowId;
  field: ThresholdField;
  label: string;
  format: (value: number) => string;
}

/** The active-prefix length lives with the slots it governs. */
const MODEL_COUNT_ROW: ThresholdRow = { id: 'modelCount', field: 'modelCount', label: 'Model count', format: value => String(value) };

const THRESHOLD_ROWS: readonly ThresholdRow[] = [
  { id: 'rotation', field: 'rotationThresholdPercent', label: 'Rotation threshold', format: value => `${value}%` },
  { id: 'codexQuota', field: 'codexQuotaThresholdPercent', label: 'Codex quota threshold', format: value => `${value}%` },
  { id: 'retries', field: 'maxTransientFailures', label: 'Retries', format: value => String(value) },
  { id: 'cooldown', field: 'cooldownMinutes', label: 'Cooldown', format: value => `${value} min` },
  { id: 'poll', field: 'pollIntervalSeconds', label: 'Poll interval', format: value => `${value} s` },
];

const STEPPER_ROWS: readonly ThresholdRow[] = [MODEL_COUNT_ROW, ...THRESHOLD_ROWS];

const LABEL_WIDTH = 22;
const VALUE_WIDTH = 8;
/** marker(2) + gap(1) + `[-]`(3) + gap(1) + value(8) + gap(1) + `[+]`(3). */
const THRESHOLD_OVERHEAD = 19;
const SAVE_ERROR = 'Could not save the supervisor configuration; nothing changed.';

/** A rendered row and the clickable column ranges that belong to it. */
interface PanelHitRow {
  id: PanelRowId;
  y: number;
  minus?: readonly [number, number];
  plus?: readonly [number, number];
}

interface PanelRender {
  lines: string[];
  hits: PanelHitRow[];
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

/**
 * Renders and drives the panel. The returned component exposes the host component
 * surface: `render`, `invalidate`, `dispose`, `handleInput`, `handleMouse` and a settable
 * `focused`. It also exposes the highlighted row id for tests.
 */
export function createSupervisorPanel(options: SupervisorPanelOptions): any {
  const { lib, tui, theme, keybindings, candidates, discoveryFailed, isBound, applyConfig, onEnabledChange, onError, done, state: readState } = options;
  const { truncateToWidth, visibleWidth } = lib;
  const clip = (text: string, width: number): string => truncateToWidth(text, width, '…');
  const style = {
    accent: (text: string) => theme.fg('accent', text),
    muted: (text: string) => theme.fg('muted', text),
    dim: (text: string) => theme.fg('dim', text),
    warning: (text: string) => theme.fg('warning', text),
    bold: (text: string) => theme.bold(text),
  };

  let config: SupervisorConfig = {
    ...options.config,
    priorityCandidateIds: [...options.config.priorityCandidateIds],
    modelEfforts: options.config.modelEfforts ? { ...options.config.modelEfforts } : undefined,
  };
  let selectedIndex = 0;
  let pickerState: PickerState | null = null;
  let lastWidth = 80;
  let focused = true;
  /** Set while switching the master switch on waits for its second confirmation. */
  let confirmEnable = false;

  let configError = options.error;
  const scopeEditor = createConfigurationScopeEditor(options.scopeControl, (next, error) => {
    config = {
      ...next,
      priorityCandidateIds: [...next.priorityCandidateIds],
      modelEfforts: next.modelEfforts ? { ...next.modelEfforts } : undefined,
    };
    configError = error;
    confirmEnable = false;
    pickerState = null;
    selectedIndex = rowIds().indexOf('scope');
  }, onError);
  const rowIds = (): readonly PanelRowId[] => scopeEditor.available ? ['scope', ...getPanelRowIds(config)] : getPanelRowIds(config);
  // Preserve the existing initial Enter behavior: the master switch owns initial focus.
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

  /** First rendered index of a window that keeps the selection centered when it can. */
  const windowStart = (total: number, selected: number, maxVisible: number): number => {
    const visible = Math.max(1, Math.min(maxVisible, Math.max(0, total)));
    const centered = selected - Math.floor(visible / 2);
    return Math.max(0, Math.min(centered, Math.max(0, total - visible)));
  };

  const marker = (isSelected: boolean): string => (isSelected ? '→ ' : '  ');

  const applyPatch = (patch: Partial<SupervisorConfig>): boolean => {
    if (configError) return false;
    try {
      config = applyConfig(patch);
      return true;
    } catch {
      onError(SAVE_ERROR);
      return false;
    }
  };

  /**
   * Flips the master switch. Enabling with uncertain mutation effects needs a second
   * confirmation: the first Enter/click only arms it, the second persists enabled and
   * acknowledges the effects. Escape abandons the confirmation.
   */
  const flipEnabled = (): void => {
    if (config.enabled) {
      confirmEnable = false;
      if (!applyPatch({ enabled: false })) return;
      onEnabledChange(false, false);
      tui.requestRender?.();
      return;
    }
    const uncertain = readState().uncertain;
    if (uncertain > 0 && !confirmEnable) {
      confirmEnable = true;
      tui.requestRender?.();
      return;
    }
    confirmEnable = false;
    if (!applyPatch({ enabled: true })) return;
    onEnabledChange(true, uncertain > 0);
    tui.requestRender?.();
  };

  /** Flips one automatic capability. Unlike the master switch it never rebuilds the runtime. */
  const flipCapability = (row: CapabilityRow): void => {
    if (applyPatch({ [row.field]: !config[row.field] } as Partial<SupervisorConfig>)) tui.requestRender?.();
  };

  const steppedValue = (field: ThresholdField, current: number, direction: 1 | -1): number => {
    const [min, max] = SUPERVISOR_CONFIG_RANGES[field];
    return Math.max(min, Math.min(max, current + direction * THRESHOLD_STEPS[field]));
  };

  const stepThreshold = (field: ThresholdField, direction: 1 | -1): void => {
    const next = steppedValue(field, config[field], direction);
    if (next === config[field]) return; // At a bound there is nothing to persist.
    if (applyPatch({ [field]: next } as Partial<SupervisorConfig>)) {
      // Changing the count adds or hides rows: keep the highlight inside the new list.
      selectedIndex = clampIndex(selectedIndex, rowIds().length);
      tui.requestRender?.();
    }
  };

  const stepSelectedThreshold = (id: PanelRowId, direction: 1 | -1): void => {
    const row = STEPPER_ROWS.find(candidate => candidate.id === id);
    if (row) stepThreshold(row.field, direction);
  };

  const openPicker = (slotNumber: number): void => {
    selectedIndex = Math.max(0, rowIds().indexOf(`slot:${slotNumber}` as PanelRowId));
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
    if (index < next.length) next[index] = candidate.id;
    else next.push(candidate.id);

    const effortPatch = computeEffortPatch(candidate.id, chosenEffort, config.modelEfforts);
    const patch: Partial<SupervisorConfig> = {
      priorityCandidateIds: next,
      ...effortPatch,
    };

    if (applyPatch(patch)) {
      closePicker();
      tui.requestRender?.();
    }
  };

  /** Renders one `[-] value [+]` row and registers its click zones. */
  const renderStepper = (row: ThresholdRow, width: number, push: (text: string) => number, hits: PanelHitRow[]): void => {
    const labelWidth = Math.max(4, Math.min(LABEL_WIDTH, width - THRESHOLD_OVERHEAD));
    const isSelected = rowIds()[selectedIndex] === row.id;
    const label = clip(row.label, labelWidth);
    const paddedLabel = label + ' '.repeat(Math.max(0, labelWidth - visibleWidth(label)));
    const value = row.format(config[row.field]);
    const paddedValue = value + ' '.repeat(Math.max(0, VALUE_WIDTH - visibleWidth(value)));
    const rawLine = `${marker(isSelected)}${paddedLabel} [-] ${paddedValue} [+]`;
    // A clipped line ends in an ellipsis column: never register a zone that includes it.
    const limit = visibleWidth(rawLine) > width ? width - 1 : width;
    const y = push(isSelected ? style.accent(rawLine) : rawLine);

    const minusStart = 2 + labelWidth + 1;
    const plusStart = minusStart + 3 + 1 + VALUE_WIDTH + 1;
    const hit: PanelHitRow = { id: row.id, y };
    if (minusStart + 3 <= limit) hit.minus = [minusStart, minusStart + 3];
    if (plusStart + 3 <= limit) hit.plus = [plusStart, plusStart + 3];
    hits.push(hit);
  };

  const renderRows = (width: number): PanelRender => {
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
    push(style.bold(style.accent(' Supervisor control panel')));
    rule();

    if (scopeEditor.available) {
      const [source, path] = scopeEditor.lines(rowIds()[selectedIndex] === 'scope');
      hits.push({ id: 'scope', y: push(source) });
      push(path);
    }
    if (configError) push(style.warning(` configuration error: ${configError}`));
    const live = readState();
    push(style.muted(' State'));
    if (!live.running) {
      push(`   off for this project`);
    } else {
      push(`   runtime: ${live.status ?? 'unknown'} · model: ${live.activeModel ?? 'unknown'}`);
      const checkpoint = live.checkpoint !== undefined ? `${live.checkpoint} pending`
        : live.lastCheckpoint !== undefined ? `#${live.lastCheckpoint} saved` : 'none';
      push(`   checkpoint: ${checkpoint} · uncertain effects: ${live.uncertain}`);
      push(style.dim(`   inventory: ${live.inventory ?? 'unavailable'}${live.inventoryError ? ` — ${live.inventoryError}` : ''}`));
    }

    push(style.muted(' Switches'));
    const toggleId: PanelRowId = 'toggle';
    hits.push({
      id: toggleId,
      y: push(`${marker(rowIds()[selectedIndex] === toggleId)}[${config.enabled ? 'x' : ' '}] ${config.enabled ? 'Enabled' : 'Disabled'}`),
    });
    for (const capability of CAPABILITY_ROWS) {
      const on = config[capability.field];
      hits.push({
        id: capability.id,
        y: push(`${marker(rowIds()[selectedIndex] === capability.id)}[${on ? 'x' : ' '}] ${capability.label}`),
      });
    }

    push('');
    push(style.muted(` Priority slots (1-${config.modelCount})`));
    renderStepper(MODEL_COUNT_ROW, available, push, hits);
    const current = slots();
    for (let slot = 1; slot <= config.modelCount; slot++) {
      const id: PanelRowId = `slot:${slot}`;
      const value = current[slot - 1];
      const slotText = formatSlotLabel(slot, value, config.modelEfforts);
      hits.push({ id, y: push(`${marker(rowIds()[selectedIndex] === id)}${slotText}`) });
    }

    push('');
    push(style.muted(' Thresholds'));
    for (const row of THRESHOLD_ROWS) renderStepper(row, available, push, hits);

    if (confirmEnable) {
      push(style.warning(' press enter again to confirm enabling with uncertain effects · esc cancels'));
    }

    push('');
    rule();
    push(style.dim(' ↑↓ move · ←→ adjust · enter select · pgUp/pgDn page · esc close'));
    rule();

    return { lines, hits };
  };

  const renderPicker = (width: number): PanelRender => {
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
    push(style.bold(style.accent(` Assign priority slot ${picker.targetSlot}`)));
    rule();
    push(` > ${picker.query || style.dim('filter by provider, prefix or model…')}`);
    rule();
    if (discoveryFailed) push(style.warning(' account inventory unavailable: showing host models only'));

    const entries = pickerEntries();
    // Never leave a filtered-out viewport blank: a bounded message says why nothing is listed.
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

  const build = (width: number): PanelRender => {
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
    if (keybindings.matches(data, 'tui.select.cancel')) {
      // Escape first abandons a pending enable confirmation; only then does it close the panel.
      if (confirmEnable) { confirmEnable = false; tui.requestRender?.(); return; }
      done();
      return;
    }
    const rows = rowIds();
    const id = rows[selectedIndex];
    if (id === 'scope' && (keybindings.matches(data, 'tui.select.confirm') || keybindings.matches(data, 'tui.editor.cursorLeft') || keybindings.matches(data, 'tui.editor.cursorRight'))) {
      scopeEditor.select(keybindings.matches(data, 'tui.editor.cursorLeft') ? 'project' : keybindings.matches(data, 'tui.editor.cursorRight') ? 'global' : undefined);
      tui.requestRender?.(); return;
    }
    if (keybindings.matches(data, 'tui.select.up')) selectedIndex = clampIndex(selectedIndex - 1, rows.length);
    else if (keybindings.matches(data, 'tui.select.down')) selectedIndex = clampIndex(selectedIndex + 1, rows.length);
    else if (keybindings.matches(data, 'tui.select.pageUp')) selectedIndex = clampIndex(selectedIndex - PANEL_VISIBLE_ROWS, rows.length);
    else if (keybindings.matches(data, 'tui.select.pageDown')) selectedIndex = clampIndex(selectedIndex + PANEL_VISIBLE_ROWS, rows.length);
    else if (keybindings.matches(data, 'tui.select.confirm')) {
      if (configError) return;
      if (id === 'toggle') { flipEnabled(); return; }
      if (confirmEnable) { confirmEnable = false; tui.requestRender?.(); return; }
      const capability = CAPABILITY_ROWS.find(row => row.id === id);
      if (capability) { flipCapability(capability); return; }
      if (id.startsWith('slot:')) { openPicker(Number(id.slice('slot:'.length))); return; }
    } else if (keybindings.matches(data, 'tui.editor.cursorLeft')) stepSelectedThreshold(id, -1);
    else if (keybindings.matches(data, 'tui.editor.cursorRight')) stepSelectedThreshold(id, 1);
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

    if (keybindings.matches(data, 'tui.select.cancel')) { closePicker(); tui.requestRender?.(); return; }
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

  const component: any = {
    render: (width: number): string[] => {
      lastWidth = width;
      return build(width).lines;
    },
    invalidate: (): void => {},
    dispose: (): void => {},
    handleInput: (data: string): void => {
      if (!isBound()) { done(); return; }
      if (pickerState) handlePickerInput(data);
      else handleRowInput(data);
    },
    handleMouse: (event: any): void => {
      if (!isBound()) { done(); return; }
      if (pickerState) return; // The picker is keyboard-driven.
      if (!event || event.type !== 'press' || event.button !== 'left') return;
      if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return;

      const hit = build(lastWidth).hits.find(row => row.y === event.y);
      if (!hit) return;
      selectedIndex = Math.max(0, rowIds().indexOf(hit.id));
      if (hit.id === 'scope') { scopeEditor.select(); tui.requestRender?.(); return; }
      if (configError) return;
      if (hit.id === 'toggle') { flipEnabled(); return; }
      // Any other click abandons a pending enable confirmation; a second click on the
      // toggle confirms it.
      if (confirmEnable) { confirmEnable = false; tui.requestRender?.(); return; }
      const capability = CAPABILITY_ROWS.find(row => row.id === hit.id);
      if (capability) { flipCapability(capability); return; }
      if (hit.id.startsWith('slot:')) { openPicker(Number(hit.id.slice('slot:'.length))); return; }

      const row = STEPPER_ROWS.find(candidate => candidate.id === hit.id);
      if (!row) return;
      if (hit.minus && event.x >= hit.minus[0] && event.x < hit.minus[1]) { stepThreshold(row.field, -1); return; }
      if (hit.plus && event.x >= hit.plus[0] && event.x < hit.plus[1]) { stepThreshold(row.field, 1); return; }
      tui.requestRender?.();
    },
  };

  Object.defineProperty(component, 'focused', {
    enumerable: true,
    configurable: true,
    get: () => focused,
    set: (value: boolean) => { focused = value; },
  });
  // Test hook: which row ↑/↓ currently highlights, without scraping the rendered marker.
  Object.defineProperty(component, 'selectedRowId', {
    enumerable: true,
    configurable: true,
    get: () => rowIds()[selectedIndex],
  });
  return component;
}
