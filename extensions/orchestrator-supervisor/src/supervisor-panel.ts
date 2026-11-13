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

/** Rows the panel shows before its scrollable row window moves. */
export const PANEL_VISIBLE_ROWS = 12;

export type PanelRowId =
  | 'scope'
  | 'toggle'
  | 'autoRotate'
  | 'autoSwitch'
  | 'modelCount'
  | `slot:${number}`
  | 'thresholdsToggle'
  | 'rotation'
  | 'codexQuota'
  | 'retries'
  | 'cooldown'
  | 'poll';

/**
 * Every selectable row, in the order ↑/↓ walks them. Threshold steppers are collapsible
 * so the main view stays compact when only adjusting model priorities.
 */
export function getPanelRowIds(config: SupervisorConfig, thresholdsExpanded = false): readonly PanelRowId[] {
  return [
    'toggle',
    'autoRotate',
    'autoSwitch',
    'modelCount',
    ...Array.from({ length: config.modelCount }, (_, index) => `slot:${index + 1}` as PanelRowId),
    'thresholdsToggle',
    ...(thresholdsExpanded ? (['rotation', 'codexQuota', 'retries', 'cooldown', 'poll'] as const) : []),
  ];
}

export interface SupervisorPanelState {
  enabled: boolean;
  running: boolean;
  status?: string;
  activeModel?: string;
  checkpoint?: number;
  lastCheckpoint?: number;
  uncertain: number;
  inventory?: string;
  inventoryError?: string;
}

export interface SupervisorPanelOptions {
  lib: any;
  tui: any;
  theme: any;
  keybindings: any;
  config: SupervisorConfig;
  scopeControl?: ConfigurationScopeControl<SupervisorConfig>;
  error?: string;
  state: () => SupervisorPanelState;
  candidates: ModelCandidate[];
  discoveryFailed?: boolean;
  isBound: () => boolean;
  applyConfig: (patch: Partial<SupervisorConfig>) => SupervisorConfig;
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

const CAPABILITY_ROWS: readonly CapabilityRow[] = [
  { id: 'autoRotate', field: 'autoRotate', label: 'Rotación automática' },
  { id: 'autoSwitch', field: 'autoSwitchModel', label: 'Cambio automático de modelo' },
];

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

const MODEL_COUNT_ROW: ThresholdRow = { id: 'modelCount', field: 'modelCount', label: 'Cantidad de modelos', format: value => String(value) };

const THRESHOLD_ROWS: readonly ThresholdRow[] = [
  { id: 'rotation', field: 'rotationThresholdPercent', label: 'Umbral de rotación', format: value => `${value}%` },
  { id: 'codexQuota', field: 'codexQuotaThresholdPercent', label: 'Umbral cuota Codex', format: value => `${value}%` },
  { id: 'retries', field: 'maxTransientFailures', label: 'Reintentos', format: value => String(value) },
  { id: 'cooldown', field: 'cooldownMinutes', label: 'Cooldown', format: value => `${value} min` },
  { id: 'poll', field: 'pollIntervalSeconds', label: 'Intervalo de poll', format: value => `${value} s` },
];

const STEPPER_ROWS: readonly ThresholdRow[] = [MODEL_COUNT_ROW, ...THRESHOLD_ROWS];

const LABEL_WIDTH = 22;
const VALUE_WIDTH = 8;
/** marker(2) + gap(1) + `[-]`(3) + gap(1) + value(8) + gap(1) + `[+]`(3). */
const THRESHOLD_OVERHEAD = 19;
const SAVE_ERROR = 'No se pudo guardar la configuración del supervisor; no hubo cambios.';

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

function safeFg(theme: any, color: string, text: string): string {
  try { return theme?.fg ? theme.fg(color, text) : text; }
  catch { return text; }
}

function translateStatus(status?: string): string {
  if (!status) return 'desconocido';
  if (status === 'active') return 'activo';
  if (status === 'idle') return 'en espera';
  if (status === 'stopped') return 'detenido';
  if (status === 'halted: uncertain effects') return 'pausado: efectos inciertos';
  return status;
}

export function createSupervisorPanel(options: SupervisorPanelOptions): any {
  const { lib, tui, theme, keybindings, candidates, discoveryFailed, isBound, applyConfig, onEnabledChange, onError, done, state: readState } = options;
  const { truncateToWidth, visibleWidth } = lib;
  const clip = (text: string, width: number): string => truncateToWidth(text, width, '…');
  const style = {
    accent: (text: string) => safeFg(theme, 'accent', text),
    muted: (text: string) => safeFg(theme, 'muted', text),
    dim: (text: string) => safeFg(theme, 'dim', text),
    success: (text: string) => safeFg(theme, 'success', text),
    warning: (text: string) => safeFg(theme, 'warning', text),
    error: (text: string) => safeFg(theme, 'error', text),
    bold: (text: string) => (theme?.bold ? theme.bold(text) : text),
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
  let confirmEnable = false;
  let thresholdsExpanded = false;

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
  const rowIds = (): readonly PanelRowId[] => {
    const base = getPanelRowIds(config, thresholdsExpanded);
    return scopeEditor.available ? ['scope', ...base] : base;
  };
  selectedIndex = scopeEditor.available ? 1 : 0;

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

  const flipCapability = (row: CapabilityRow): void => {
    if (applyPatch({ [row.field]: !config[row.field] } as Partial<SupervisorConfig>)) tui.requestRender?.();
  };

  const steppedValue = (field: ThresholdField, current: number, direction: 1 | -1): number => {
    const [min, max] = SUPERVISOR_CONFIG_RANGES[field];
    return Math.max(min, Math.min(max, current + direction * THRESHOLD_STEPS[field]));
  };

  const stepThreshold = (field: ThresholdField, direction: 1 | -1): void => {
    const next = steppedValue(field, config[field], direction);
    if (next === config[field]) return;
    if (applyPatch({ [field]: next } as Partial<SupervisorConfig>)) {
      selectedIndex = clampIndex(selectedIndex, rowIds().length);
      tui.requestRender?.();
    }
  };

  const stepSelectedThreshold = (id: PanelRowId, direction: 1 | -1): void => {
    const row = STEPPER_ROWS.find(candidate => candidate.id === id);
    if (row) stepThreshold(row.field, direction);
  };

  const moveSlot = (slotNumber: number, delta: -1 | 1): void => {
    const target = slotNumber + delta;
    if (target < 1 || target > config.modelCount) return;
    const fromIdx = slotNumber - 1;
    const toIdx = target - 1;
    const next = [...config.priorityCandidateIds];
    const needed = Math.max(fromIdx, toIdx) + 1;
    while (next.length < needed) next.push('');
    const tmp = next[fromIdx];
    next[fromIdx] = next[toIdx];
    next[toIdx] = tmp;
    while (next.length > 0 && next[next.length - 1] === '') next.pop();
    if (applyPatch({ priorityCandidateIds: next })) {
      const nextPos = rowIds().indexOf(`slot:${target}` as PanelRowId);
      if (nextPos >= 0) selectedIndex = nextPos;
      tui.requestRender?.();
    }
  };

  const clearSlot = (slotNumber: number): void => {
    const index = slotNumber - 1;
    if (!config.priorityCandidateIds[index]) return;
    const next = [...config.priorityCandidateIds];
    next[index] = '';
    while (next.length > 0 && next[next.length - 1] === '') next.pop();
    if (applyPatch({ priorityCandidateIds: next })) tui.requestRender?.();
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
          label: usedInSlot === undefined ? candidate.id : `${candidate.id} (en slot ${usedInSlot})`,
        });
      }
    }
    entries.push({ kind: 'clear', label: picker ? `vaciar (quitar slot ${picker.targetSlot})` : 'vaciar' });
    return entries;
  };

  const confirmPicker = (): void => {
    const picker = pickerState;
    if (!picker) return;
    const entries = pickerEntries();
    const entry = entries[clampIndex(picker.selected, entries.length)];
    if (!entry) return;

    const full = config.priorityCandidateIds;
    const index = picker.targetSlot - 1;

    if (entry.kind === 'clear') {
      if (index >= full.length) { closePicker(); tui.requestRender?.(); return; }
      const next = [...full.slice(0, index), ...full.slice(index + 1)];
      if (applyPatch({ priorityCandidateIds: next })) { closePicker(); tui.requestRender?.(); }
      return;
    }
    if (entry.usedInSlot !== undefined) return;

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

  const renderStepper = (row: ThresholdRow, width: number, push: (text: string) => number, hits: PanelHitRow[]): void => {
    const labelWidth = Math.max(4, Math.min(LABEL_WIDTH, width - THRESHOLD_OVERHEAD));
    const isSelected = rowIds()[selectedIndex] === row.id;
    const label = clip(row.label, labelWidth);
    const paddedLabel = label + ' '.repeat(Math.max(0, labelWidth - visibleWidth(label)));
    const value = row.format(config[row.field]);
    const paddedValue = value + ' '.repeat(Math.max(0, VALUE_WIDTH - visibleWidth(value)));
    const rawLine = `${marker(isSelected)}${paddedLabel} [-] ${paddedValue} [+]`;
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

    push(style.bold(style.accent(' ◆ Panel del Supervisor · Orquestador')));
    rule();

    if (scopeEditor.available) {
      const [source, path] = scopeEditor.lines(rowIds()[selectedIndex] === 'scope');
      hits.push({ id: 'scope', y: push(source) });
      push(style.dim(path));
    }
    if (configError) push(style.error(` ⚠ Error de configuración: ${configError}`));
    const live = readState();
    push(style.muted(' ◆ Estado'));
    if (!live.running) {
      push(style.dim('   ○ Apagado para este proyecto'));
    } else {
      const statusBadge = live.uncertain > 0 || live.status?.startsWith('halted')
        ? style.warning(`● ${translateStatus(live.status)}`)
        : style.success(`● ${translateStatus(live.status)}`);
      push(`   ${statusBadge} · modelo: ${live.activeModel ?? 'desconocido'}`);
      const checkpoint = live.checkpoint !== undefined ? `${live.checkpoint} pendiente`
        : live.lastCheckpoint !== undefined ? `#${live.lastCheckpoint} guardado` : 'ninguno';
      push(`   checkpoint: ${checkpoint} · efectos inciertos: ${live.uncertain}`);
      push(style.dim(`   inventario: ${live.inventory === 'none' ? 'ninguno' : (live.inventory ?? 'no disponible')}${live.inventoryError ? ` — ${live.inventoryError}` : ''}`));
    }

    push('');
    push(style.muted(' ◆ Interruptores'));
    const toggleId: PanelRowId = 'toggle';
    const isToggleSel = rowIds()[selectedIndex] === toggleId;
    const toggleText = `${marker(isToggleSel)}[${config.enabled ? 'x' : ' '}] ${config.enabled ? 'Habilitado' : 'Deshabilitado'}`;
    hits.push({
      id: toggleId,
      y: push(isToggleSel ? style.accent(toggleText) : (config.enabled ? style.success(toggleText) : style.dim(toggleText))),
    });
    for (const capability of CAPABILITY_ROWS) {
      const on = config[capability.field];
      const isCapSel = rowIds()[selectedIndex] === capability.id;
      const capText = `${marker(isCapSel)}[${on ? 'x' : ' '}] ${capability.label}`;
      hits.push({
        id: capability.id,
        y: push(isCapSel ? style.accent(capText) : capText),
      });
    }

    push('');
    push(style.muted(` ◆ Modelos prioritarios (1-${config.modelCount})`));
    renderStepper(MODEL_COUNT_ROW, available, push, hits);
    const current = slots();
    for (let slot = 1; slot <= config.modelCount; slot++) {
      const id: PanelRowId = `slot:${slot}`;
      const value = current[slot - 1];
      const isSel = rowIds()[selectedIndex] === id;
      const slotText = `${marker(isSel)}${formatSlotLabel(slot, value, config.modelEfforts)}`;
      hits.push({ id, y: push(isSel ? style.accent(slotText) : (value ? slotText : style.dim(slotText))) });
    }

    push('');
    const isThreshSelected = rowIds()[selectedIndex] === 'thresholdsToggle';
    const threshSummary = thresholdsExpanded
      ? '▾ Umbrales avanzados'
      : `▸ Umbrales avanzados (rotación ${config.rotationThresholdPercent}% · codex ${config.codexQuotaThresholdPercent}% · reintentos ${config.maxTransientFailures} · cooldown ${config.cooldownMinutes}m · poll ${config.pollIntervalSeconds}s)`;
    const threshLine = `${marker(isThreshSelected)}${threshSummary}`;
    hits.push({ id: 'thresholdsToggle', y: push(isThreshSelected ? style.accent(threshLine) : style.muted(threshLine)) });
    if (thresholdsExpanded) {
      for (const row of THRESHOLD_ROWS) renderStepper(row, available, push, hits);
    }

    if (confirmEnable) {
      push(style.warning(' ⚠ Presioná Enter de nuevo para confirmar con efectos inciertos · Esc cancela'));
    }

    push('');
    rule();
    push(style.dim(' ↑↓/jk mover · ←→/hl ajustar · K/J reordenar · d vaciar · tab cambiar · esc cerrar'));

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
    push(style.bold(style.accent(` Asignar slot prioritario ${picker.targetSlot}`)));
    rule();
    push(` > ${picker.query || style.dim('filtrar por proveedor, prefijo o modelo…')}`);
    rule();
    if (discoveryFailed) push(style.warning(' inventario de cuentas no disponible: mostrando solo modelos locales'));

    const entries = pickerEntries();
    if (!entries.some(entry => entry.kind === 'candidate')) {
      push(style.dim(picker.query ? ` ningún modelo coincide con "${picker.query}"` : ' no hay modelos disponibles'));
    }
    const selected = clampIndex(picker.selected, entries.length);
    const start = windowStart(entries.length, selected, PANEL_VISIBLE_ROWS);
    const end = Math.min(start + PANEL_VISIBLE_ROWS, entries.length);
    for (let index = start; index < end; index++) {
      push(`${marker(index === selected)}${entries[index].label}`);
    }
    if (entries.length > PANEL_VISIBLE_ROWS) {
      push(style.dim(` ${selected + 1}/${entries.length} · pgUp/pgDn desplazar`));
    }

    rule();
    push(style.dim(' escribir filtrar · ↑↓ mover · enter asignar · esc volver'));
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
      if (confirmEnable) { confirmEnable = false; tui.requestRender?.(); return; }
      done();
      return;
    }
    const rows = rowIds();
    const id = rows[selectedIndex];
    if (id === 'scope' && (keybindings.matches(data, 'tui.select.confirm') || data === ' ' || keybindings.matches(data, 'tui.editor.cursorLeft') || keybindings.matches(data, 'tui.editor.cursorRight') || data === 'h' || data === 'l')) {
      const goLeft = keybindings.matches(data, 'tui.editor.cursorLeft') || data === 'h';
      const goRight = keybindings.matches(data, 'tui.editor.cursorRight') || data === 'l';
      scopeEditor.select(goLeft ? 'project' : goRight ? 'global' : undefined);
      tui.requestRender?.(); return;
    }
    if ((data === 'K' || data === '\x1b[1;2A') && id?.startsWith('slot:')) {
      moveSlot(Number(id.slice('slot:'.length)), -1);
      return;
    }
    if ((data === 'J' || data === '\x1b[1;2B') && id?.startsWith('slot:')) {
      moveSlot(Number(id.slice('slot:'.length)), 1);
      return;
    }
    if (data === 'd' && id?.startsWith('slot:')) {
      clearSlot(Number(id.slice('slot:'.length)));
      return;
    }
    if (keybindings.matches(data, 'tui.select.up') || data === 'k') selectedIndex = clampIndex(selectedIndex - 1, rows.length);
    else if (keybindings.matches(data, 'tui.select.down') || data === 'j') selectedIndex = clampIndex(selectedIndex + 1, rows.length);
    else if (keybindings.matches(data, 'tui.select.pageUp')) selectedIndex = clampIndex(selectedIndex - PANEL_VISIBLE_ROWS, rows.length);
    else if (keybindings.matches(data, 'tui.select.pageDown')) selectedIndex = clampIndex(selectedIndex + PANEL_VISIBLE_ROWS, rows.length);
    else if (keybindings.matches(data, 'tui.select.confirm') || data === ' ') {
      if (id === 'thresholdsToggle') {
        thresholdsExpanded = !thresholdsExpanded;
        selectedIndex = clampIndex(selectedIndex, rowIds().length);
        tui.requestRender?.();
        return;
      }
      if (configError) return;
      if (id === 'toggle') { flipEnabled(); return; }
      if (confirmEnable) { confirmEnable = false; tui.requestRender?.(); return; }
      const capability = CAPABILITY_ROWS.find(row => row.id === id);
      if (capability) { flipCapability(capability); return; }
      if (id.startsWith('slot:')) { openPicker(Number(id.slice('slot:'.length))); return; }
    } else if (keybindings.matches(data, 'tui.editor.cursorLeft') || data === 'h') stepSelectedThreshold(id, -1);
    else if (keybindings.matches(data, 'tui.editor.cursorRight') || data === 'l') stepSelectedThreshold(id, 1);
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
      if (keybindings.matches(data, 'tui.select.up') || data === 'k') picker.effortSelected = clampIndex((picker.effortSelected ?? 0) - 1, total);
      else if (keybindings.matches(data, 'tui.select.down') || data === 'j') picker.effortSelected = clampIndex((picker.effortSelected ?? 0) + 1, total);
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
      if (!event) return;
      if (event.type === 'wheel' && event.wheelDelta) {
        const delta = event.wheelDelta > 0 ? 1 : -1;
        if (pickerState) {
          if (pickerState.stage === 'effort') {
            const total = pickerState.effortOptions?.length ?? 1;
            pickerState.effortSelected = clampIndex((pickerState.effortSelected ?? 0) + delta, total);
          } else {
            pickerState.selected = clampIndex(pickerState.selected + delta, pickerEntries().length);
          }
        } else {
          selectedIndex = clampIndex(selectedIndex + delta, rowIds().length);
        }
        tui.requestRender?.();
        return;
      }
      if (pickerState) return;
      if (event.type !== 'press' || event.button !== 'left') return;
      if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return;

      const hit = build(lastWidth).hits.find(row => row.y === event.y);
      if (!hit) return;
      selectedIndex = Math.max(0, rowIds().indexOf(hit.id));
      if (hit.id === 'scope') { scopeEditor.select(); tui.requestRender?.(); return; }
      if (hit.id === 'thresholdsToggle') {
        thresholdsExpanded = !thresholdsExpanded;
        selectedIndex = clampIndex(selectedIndex, rowIds().length);
        tui.requestRender?.();
        return;
      }
      if (configError) return;
      if (hit.id === 'toggle') { flipEnabled(); return; }
      if (confirmEnable) { confirmEnable = false; tui.requestRender?.(); return; }
      const capability = CAPABILITY_ROWS.find(row => row.id === hit.id);
      if (capability) { flipCapability(capability); return; }
      if (hit.id.startsWith('slot:')) { openPicker(Number(hit.id.slice('slot:'.length))); return; }
      if (hit.minus && event.x >= hit.minus[0] && event.x < hit.minus[1]) { stepSelectedThreshold(hit.id, -1); return; }
      if (hit.plus && event.x >= hit.plus[0] && event.x < hit.plus[1]) { stepSelectedThreshold(hit.id, 1); return; }
      tui.requestRender?.();
    },
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
