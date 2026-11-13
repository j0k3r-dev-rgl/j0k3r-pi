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
import {
  getActiveSubagentCandidateIds,
  SUBAGENT_MODEL_COUNT_DEFAULT,
  SUBAGENT_MODEL_COUNT_MAX,
  SUBAGENT_MODEL_COUNT_MIN,
  type SubagentAgentPoolConfig,
  type SubagentConfig,
  type SubagentPoolMode,
} from './subagent-config.ts';
import type { ModelCandidate } from './types.ts';

export type DashboardTab = 'orchestrator' | 'subagents';
export type { SubagentConfig };

export const SUBAGENT_MODEL_COUNT_RANGE: readonly [number, number] = [SUBAGENT_MODEL_COUNT_MIN, SUBAGENT_MODEL_COUNT_MAX];
export const SUBAGENT_DEFAULT_TARGET = '__default__';

export type SubagentPanelRowId =
  | 'scope'
  | 'toggle'
  | 'target'
  | 'agentMode'
  | 'copyDefault'
  | 'removeEntry'
  | 'modelCount'
  | `slot:${number}`;

export function getSubagentRowIds(
  config: SubagentConfig,
  target: string = SUBAGENT_DEFAULT_TARGET,
  discoveredNames?: readonly string[],
): readonly SubagentPanelRowId[] {
  if (target === SUBAGENT_DEFAULT_TARGET) {
    return [
      'toggle',
      'target',
      'modelCount',
      ...Array.from({ length: config.modelCount }, (_, index) => `slot:${index + 1}` as SubagentPanelRowId),
    ];
  }
  const entry = config.subagentPools?.[target];
  const mode: SubagentPoolMode = entry?.mode ?? 'inherit';
  const isUndiscovered = discoveredNames !== undefined && !discoveredNames.includes(target);
  const rows: SubagentPanelRowId[] = ['toggle', 'target', 'agentMode'];
  if (isUndiscovered && entry !== undefined) rows.push('removeEntry');
  if (mode === 'custom') {
    rows.push('copyDefault');
    const count = entry?.modelCount ?? SUBAGENT_MODEL_COUNT_DEFAULT;
    rows.push(
      'modelCount',
      ...Array.from({ length: count }, (_, index) => `slot:${index + 1}` as SubagentPanelRowId),
    );
  }
  return rows;
}

export interface SupervisorDashboardOptions {
  orchestrator: SupervisorPanelOptions;
  subagents: {
    config: SubagentConfig;
    scopeControl?: ConfigurationScopeControl<SubagentConfig>;
    candidates: ModelCandidate[];
    agentNames?: string[];
    error?: string;
    applyConfig: (patch: Partial<SubagentConfig>) => SubagentConfig;
  };
  framed?: boolean;
}

const LABEL_WIDTH = 22;
const VALUE_WIDTH = 8;
const THRESHOLD_OVERHEAD = 19;
const TAB_LABELS: ReadonlyArray<{ tab: DashboardTab; label: string }> = [
  { tab: 'orchestrator', label: 'Orquestador' },
  { tab: 'subagents', label: 'Subagentes' },
];
const TAB_BAR_LINE = 1;
const TAB_BAR_HEIGHT = 3;
const FRAME_PAD_X = 2;
const FRAME_PAD_Y = 1;
const SUBAGENT_SAVED_NOTE = ' Guardado · asignación least-loaded y failover automático entre modelos.';
const SUBAGENT_DISABLED_NOTE = ' edición deshabilitada hasta que la configuración guardada sea válida';
const SUBAGENT_SAVE_ERROR = 'No se pudo guardar la configuración de subagentes; no hubo cambios.';

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
  agentNames?: string[];
  error?: string;
  applyConfig: (patch: Partial<SubagentConfig>) => SubagentConfig;
  onError: (message: string) => void;
  done: () => void;
  isBound: () => boolean;
}

const POOL_MODES: readonly SubagentPoolMode[] = ['inherit', 'custom', 'disabled'];
const POOL_MODE_LABELS: Record<SubagentPoolMode, string> = {
  inherit: 'Heredar Default',
  custom: 'Pool propio',
  disabled: 'Deshabilitado (orquestador)',
};

function safeFg(theme: any, color: string, text: string): string {
  try { return theme?.fg ? theme.fg(color, text) : text; }
  catch { return text; }
}

function cloneSubagentConfigState(source: SubagentConfig): SubagentConfig {
  const clonedPools: Record<string, SubagentAgentPoolConfig> | undefined = source.subagentPools
    ? Object.fromEntries(
      Object.entries(source.subagentPools).map(([name, pool]) => [
        name,
        {
          mode: pool.mode,
          modelCount: pool.modelCount,
          priorityCandidateIds: [...pool.priorityCandidateIds],
          ...(pool.modelEfforts ? { modelEfforts: { ...pool.modelEfforts } } : {}),
        },
      ]),
    )
    : undefined;
  return {
    ...source,
    priorityCandidateIds: [...(source.priorityCandidateIds ?? [])],
    modelEfforts: source.modelEfforts ? { ...source.modelEfforts } : undefined,
    subagentPools: clonedPools,
  };
}

function createSubagentPanel(options: SubagentPanelOptions): any {
  const { lib, tui, theme, keybindings, candidates, applyConfig, onError, done, isBound } = options;
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

  const discoveredNames = [...new Set(
    (options.agentNames ?? []).map(name => name.trim().toLowerCase()).filter(Boolean),
  )].sort();
  const discoveredSet = new Set(discoveredNames);

  let config: SubagentConfig = cloneSubagentConfigState(options.config);
  let activeTarget: string = SUBAGENT_DEFAULT_TARGET;
  let selectedIndex = 0;
  let pickerState: PickerState | null = null;
  let lastWidth = 80;
  let focused = true;
  let error = options.error;
  const disabled = (): boolean => Boolean(error);

  const targetIds = (): string[] => {
    const configured = Object.keys(config.subagentPools ?? {});
    const merged = [...new Set([...discoveredNames, ...configured])].sort();
    return [SUBAGENT_DEFAULT_TARGET, ...merged];
  };

  const activePool = (): SubagentAgentPoolConfig => {
    if (activeTarget === SUBAGENT_DEFAULT_TARGET) {
      return {
        mode: 'custom',
        modelCount: config.modelCount,
        priorityCandidateIds: config.priorityCandidateIds,
        modelEfforts: config.modelEfforts,
      };
    }
    return config.subagentPools?.[activeTarget] ?? {
      mode: 'inherit',
      modelCount: SUBAGENT_MODEL_COUNT_DEFAULT,
      priorityCandidateIds: [],
    };
  };

  const scopeEditor = createConfigurationScopeEditor(options.scopeControl, (next, nextError) => {
    config = cloneSubagentConfigState(next);
    error = nextError;
    pickerState = null;
    if (!targetIds().includes(activeTarget)) activeTarget = SUBAGENT_DEFAULT_TARGET;
    selectedIndex = rowIds().indexOf('scope');
  }, onError);
  const rowIds = (): readonly SubagentPanelRowId[] => {
    const base = getSubagentRowIds(config, activeTarget, discoveredNames);
    return scopeEditor.available ? ['scope', ...base] : base;
  };
  selectedIndex = scopeEditor.available ? 1 : 0;

  const slots = (): string[] => {
    const pool = activePool();
    const padded = pool.priorityCandidateIds.slice(0, pool.modelCount);
    while (padded.length < pool.modelCount) padded.push('');
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

  const applyPatch = (patch: Partial<SubagentConfig>): boolean => {
    if (disabled()) return false;
    try {
      const next = applyConfig(patch);
      config = cloneSubagentConfigState(next);
      return true;
    } catch {
      onError(SUBAGENT_SAVE_ERROR);
      return false;
    }
  };

  const applyActivePoolPatch = (poolPatch: Partial<SubagentAgentPoolConfig>): boolean => {
    if (activeTarget === SUBAGENT_DEFAULT_TARGET) {
      const patch: Partial<SubagentConfig> = {};
      if (poolPatch.modelCount !== undefined) patch.modelCount = poolPatch.modelCount;
      if (poolPatch.priorityCandidateIds !== undefined) patch.priorityCandidateIds = poolPatch.priorityCandidateIds;
      if ('modelEfforts' in poolPatch) patch.modelEfforts = poolPatch.modelEfforts;
      return applyPatch(patch);
    }
    const current = activePool();
    const updatedEntry: SubagentAgentPoolConfig = {
      mode: poolPatch.mode ?? current.mode,
      modelCount: poolPatch.modelCount ?? current.modelCount,
      priorityCandidateIds: poolPatch.priorityCandidateIds ?? [...current.priorityCandidateIds],
      ...('modelEfforts' in poolPatch
        ? (poolPatch.modelEfforts ? { modelEfforts: poolPatch.modelEfforts } : {})
        : (current.modelEfforts ? { modelEfforts: current.modelEfforts } : {})),
    };
    const nextPools = { ...(config.subagentPools ?? {}), [activeTarget]: updatedEntry };
    return applyPatch({ subagentPools: nextPools });
  };

  const flipEnabled = (): void => {
    if (applyPatch({ enabled: !config.enabled })) tui.requestRender?.();
  };

  const stepTarget = (direction: 1 | -1): void => {
    const ids = targetIds();
    if (ids.length <= 1) return;
    const currentIdx = Math.max(0, ids.indexOf(activeTarget));
    const nextIdx = (currentIdx + direction + ids.length) % ids.length;
    activeTarget = ids[nextIdx];
    const nextRows = rowIds();
    const targetPos = nextRows.indexOf('target');
    selectedIndex = targetPos >= 0 ? targetPos : clampIndex(selectedIndex, nextRows.length);
    tui.requestRender?.();
  };

  const stepAgentMode = (direction: 1 | -1): void => {
    if (activeTarget === SUBAGENT_DEFAULT_TARGET) return;
    const current = activePool().mode;
    const currentIdx = Math.max(0, POOL_MODES.indexOf(current));
    const nextMode = POOL_MODES[(currentIdx + direction + POOL_MODES.length) % POOL_MODES.length];
    if (applyActivePoolPatch({ mode: nextMode })) {
      selectedIndex = clampIndex(selectedIndex, rowIds().length);
      tui.requestRender?.();
    }
  };

  const copyFromDefault = (): void => {
    if (activeTarget === SUBAGENT_DEFAULT_TARGET || activePool().mode !== 'custom') return;
    const patch: Partial<SubagentAgentPoolConfig> = {
      modelCount: config.modelCount,
      priorityCandidateIds: [...config.priorityCandidateIds],
      modelEfforts: config.modelEfforts ? { ...config.modelEfforts } : undefined,
    };
    if (applyActivePoolPatch(patch)) {
      selectedIndex = clampIndex(selectedIndex, rowIds().length);
      tui.requestRender?.();
    }
  };

  const removeUndiscoveredEntry = (): void => {
    if (activeTarget === SUBAGENT_DEFAULT_TARGET || discoveredSet.has(activeTarget)) return;
    const nextPools = { ...(config.subagentPools ?? {}) };
    delete nextPools[activeTarget];
    if (applyPatch({ subagentPools: Object.keys(nextPools).length > 0 ? nextPools : undefined })) {
      activeTarget = SUBAGENT_DEFAULT_TARGET;
      const nextRows = rowIds();
      const targetPos = nextRows.indexOf('target');
      selectedIndex = targetPos >= 0 ? targetPos : 0;
      tui.requestRender?.();
    }
  };

  const stepModelCount = (direction: 1 | -1): void => {
    const [min, max] = SUBAGENT_MODEL_COUNT_RANGE;
    const pool = activePool();
    const next = Math.max(min, Math.min(max, pool.modelCount + direction));
    if (next === pool.modelCount) return;
    if (applyActivePoolPatch({ modelCount: next })) {
      selectedIndex = clampIndex(selectedIndex, rowIds().length);
      tui.requestRender?.();
    }
  };

  const moveSlot = (slotNumber: number, delta: -1 | 1): void => {
    const pool = activePool();
    const target = slotNumber + delta;
    if (target < 1 || target > pool.modelCount) return;
    const fromIdx = slotNumber - 1;
    const toIdx = target - 1;
    const next = [...pool.priorityCandidateIds];
    const needed = Math.max(fromIdx, toIdx) + 1;
    while (next.length < needed) next.push('');
    const tmp = next[fromIdx];
    next[fromIdx] = next[toIdx];
    next[toIdx] = tmp;
    while (next.length > 0 && next[next.length - 1] === '') next.pop();
    if (applyActivePoolPatch({ priorityCandidateIds: next })) {
      const nextPos = rowIds().indexOf(`slot:${target}` as SubagentPanelRowId);
      if (nextPos >= 0) selectedIndex = nextPos;
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
      const full = activePool().priorityCandidateIds;
      for (const candidate of candidates) {
        const haystack = `${candidate.id} ${candidate.provider} ${candidate.prefix ?? ''}`.toLowerCase();
        if (!tokens.every(token => haystack.includes(token))) continue;
        const usedAt = full.indexOf(candidate.id);
        const usedInSlot = usedAt >= 0 && usedAt + 1 !== picker.targetSlot ? usedAt + 1 : undefined;
        if (usedInSlot !== undefined) continue;
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

    const full = activePool().priorityCandidateIds;
    const index = picker.targetSlot - 1;

    if (entry.kind === 'clear') {
      if (index >= full.length) { closePicker(); tui.requestRender?.(); return; }
      const next = [...full.slice(0, index), ...full.slice(index + 1)];
      if (applyActivePoolPatch({ priorityCandidateIds: next })) { closePicker(); tui.requestRender?.(); }
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

    const currentOverride = activePool().modelEfforts?.[candidate.id];
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
    const pool = activePool();
    const full = pool.priorityCandidateIds;
    const index = picker.targetSlot - 1;

    const next = [...full];
    while (next.length <= index) next.push('');
    next[index] = candidate.id;

    const effortPatch = computeEffortPatch(candidate.id, chosenEffort, pool.modelEfforts);
    const patch: Partial<SubagentAgentPoolConfig> = {
      priorityCandidateIds: next,
      ...('modelEfforts' in effortPatch ? { modelEfforts: effortPatch.modelEfforts } : {}),
    };

    if (applyActivePoolPatch(patch)) {
      closePicker();
      tui.requestRender?.();
    }
  };

  const renderStepper = (width: number, push: (text: string) => number, hits: PanelHitRow[], count: number): void => {
    const labelWidth = Math.max(4, Math.min(LABEL_WIDTH, width - THRESHOLD_OVERHEAD));
    const isSelected = rowIds()[selectedIndex] === 'modelCount';
    const label = clip('Cantidad de modelos', labelWidth);
    const paddedLabel = label + ' '.repeat(Math.max(0, labelWidth - visibleWidth(label)));
    const value = String(count);
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

  const renderCycleRow = (
    id: 'target' | 'agentMode',
    rowLabel: string,
    valueText: string,
    width: number,
    push: (text: string) => number,
    hits: PanelHitRow[],
  ): void => {
    const labelWidth = Math.max(4, Math.min(14, width - 10));
    const isSelected = rowIds()[selectedIndex] === id;
    const label = clip(rowLabel, labelWidth);
    const paddedLabel = label + ' '.repeat(Math.max(0, labelWidth - visibleWidth(label)));
    const prefix = `${marker(isSelected)}${paddedLabel} `;
    const leftArrow = '◀';
    const rightArrow = '▶';
    const rawLine = `${prefix}${leftArrow} ${valueText} ${rightArrow}`;
    const limit = visibleWidth(rawLine) > width ? width - 1 : width;
    const y = push(isSelected ? style.accent(rawLine) : rawLine);

    const minusStart = visibleWidth(prefix);
    const plusStart = visibleWidth(`${prefix}${leftArrow} ${valueText} `);
    const hit: PanelHitRow = { id, y };
    if (minusStart + 1 <= limit) hit.minus = [minusStart, minusStart + 1];
    if (plusStart + 1 <= limit) hit.plus = [plusStart, plusStart + 1];
    hits.push(hit);
  };

  const formatTargetDisplay = (target: string): string => {
    if (target === SUBAGENT_DEFAULT_TARGET) return 'Default';
    const entry = config.subagentPools?.[target];
    const modeTag = entry?.mode === 'custom' ? ' [propio]' : entry?.mode === 'disabled' ? ' [off]' : '';
    const orphanSuffix = !discoveredSet.has(target) ? ' (no descubierto)' : '';
    return `${target}${orphanSuffix}${modeTag}`;
  };

  const summaryItems = (): string[] => {
    const allAgents = targetIds().filter(id => id !== SUBAGENT_DEFAULT_TARGET);
    if (allAgents.length === 0) return [];
    return allAgents.map((name) => {
      const entry = config.subagentPools?.[name];
      if (entry?.mode === 'custom') {
        const count = getActiveSubagentCandidateIds(entry).length;
        return `${name} [propio:${count}]`;
      }
      if (entry?.mode === 'disabled') return `${name} [off]`;
      return `${name} [hereda]`;
    });
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

    push(style.bold(style.accent(' ◆ Configuración de Subagentes')));
    rule();

    if (scopeEditor.available) {
      const [source, path] = scopeEditor.lines(rowIds()[selectedIndex] === 'scope');
      hits.push({ id: 'scope', y: push(source) });
      push(style.dim(path));
    }
    if (disabled()) {
      push(style.error(` ⚠ Error de configuración: ${error ?? ''}`));
      push(style.dim(SUBAGENT_DISABLED_NOTE));
    }

    const items = summaryItems();
    if (items.length > 0) {
      push(style.muted(' ◆ Resumen de pools'));
      const defaultCount = getActiveSubagentCandidateIds(config).length;
      push(style.dim(`   Default [${defaultCount} modelo(s)] · ${items.join(' · ')}`));
      push('');
    }

    push(style.muted(' ◆ Interruptores'));
    const toggleId: SubagentPanelRowId = 'toggle';
    const isToggleSel = rowIds()[selectedIndex] === toggleId;
    const toggleText = `${marker(isToggleSel)}[${config.enabled ? 'x' : ' '}] ${config.enabled ? 'Habilitado' : 'Deshabilitado'}`;
    hits.push({
      id: toggleId,
      y: push(isToggleSel ? style.accent(toggleText) : (config.enabled ? style.success(toggleText) : style.dim(toggleText))),
    });

    push('');
    const pool = activePool();
    const isDefault = activeTarget === SUBAGENT_DEFAULT_TARGET;
    const isUndiscovered = !isDefault && !discoveredSet.has(activeTarget);
    push(style.muted(` ◆ Pool de modelos (${isDefault ? 'Default' : activeTarget})`));
    renderCycleRow('target', 'Subagente', formatTargetDisplay(activeTarget), available, push, hits);

    if (!isDefault) {
      renderCycleRow('agentMode', 'Modo de pool', POOL_MODE_LABELS[pool.mode], available, push, hits);
      if (isUndiscovered && config.subagentPools?.[activeTarget] !== undefined) {
        const isRemSelected = rowIds()[selectedIndex] === 'removeEntry';
        const remLine = `${marker(isRemSelected)}[Limpiar entrada guardada]`;
        hits.push({ id: 'removeEntry', y: push(isRemSelected ? style.accent(remLine) : style.warning(remLine)) });
      }
    }

    if (isDefault || pool.mode === 'custom') {
      if (!isDefault) {
        const isCopySel = rowIds()[selectedIndex] === 'copyDefault';
        const copyLine = `${marker(isCopySel)}[Copiar slots desde Default] (c)`;
        hits.push({ id: 'copyDefault', y: push(isCopySel ? style.accent(copyLine) : style.dim(copyLine)) });
      }
      push(style.muted(` ◆ Slots de modelos (1-${pool.modelCount})`));
      renderStepper(available, push, hits, pool.modelCount);
      const current = slots();
      for (let slot = 1; slot <= pool.modelCount; slot++) {
        const id: SubagentPanelRowId = `slot:${slot}`;
        const value = current[slot - 1];
        const isSel = rowIds()[selectedIndex] === id;
        const slotText = `${marker(isSel)}${formatSlotLabel(slot, value, pool.modelEfforts)}`;
        hits.push({ id, y: push(isSel ? style.accent(slotText) : (value ? slotText : style.dim(slotText))) });
      }
    } else if (pool.mode === 'inherit') {
      const activeDefault = getActiveSubagentCandidateIds(config);
      push(style.dim(`   Hereda el pool Default (${config.modelCount} slots, ${activeDefault.length} asignado(s))`));
      for (let slot = 1; slot <= config.modelCount; slot++) {
        const value = config.priorityCandidateIds[slot - 1] ?? '';
        push(style.dim(`   ${formatSlotLabel(slot, value, config.modelEfforts)}`));
      }
    } else {
      push(style.dim('   Asignación deshabilitada; este subagente usa el modelo del orquestador.'));
    }

    if (!disabled()) push(style.dim(SUBAGENT_SAVED_NOTE));

    push('');
    rule();
    push(style.dim(' ↑↓/jk mover · ←→/hl ajustar · K/J reordenar · d vaciar · c copiar Default · tab cambiar · esc cerrar'));

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
    push(style.bold(style.accent(` Asignar slot de subagente ${picker.targetSlot}`)));
    rule();
    push(` > ${picker.query || style.dim('filtrar por proveedor o modelo…')}`);
    rule();

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
    if (data === 'c' && activeTarget !== SUBAGENT_DEFAULT_TARGET && activePool().mode === 'custom') {
      copyFromDefault();
      return;
    }
    if (data === 'd' && id?.startsWith('slot:')) {
      const index = Number(id.slice('slot:'.length)) - 1;
      const full = activePool().priorityCandidateIds;
      if (!full[index]) return;
      const next = [...full];
      next[index] = '';
      if (applyActivePoolPatch({ priorityCandidateIds: next })) tui.requestRender?.();
      return;
    }
    if (keybindings.matches(data, 'tui.select.up') || data === 'k') selectedIndex = clampIndex(selectedIndex - 1, rows.length);
    else if (keybindings.matches(data, 'tui.select.down') || data === 'j') selectedIndex = clampIndex(selectedIndex + 1, rows.length);
    else if (keybindings.matches(data, 'tui.select.pageUp')) selectedIndex = clampIndex(selectedIndex - PANEL_VISIBLE_ROWS, rows.length);
    else if (keybindings.matches(data, 'tui.select.pageDown')) selectedIndex = clampIndex(selectedIndex + PANEL_VISIBLE_ROWS, rows.length);
    else if (keybindings.matches(data, 'tui.select.confirm') || data === ' ') {
      if (id === 'target') { stepTarget(1); return; }
      if (disabled()) return;
      if (id === 'toggle') { flipEnabled(); return; }
      if (id === 'agentMode') { stepAgentMode(1); return; }
      if (id === 'copyDefault') { copyFromDefault(); return; }
      if (id === 'removeEntry') { removeUndiscoveredEntry(); return; }
      if (id && id.startsWith('slot:')) { openPicker(Number(id.slice('slot:'.length))); return; }
    } else if (id === 'target' && (keybindings.matches(data, 'tui.editor.cursorLeft') || data === 'h')) stepTarget(-1);
    else if (id === 'target' && (keybindings.matches(data, 'tui.editor.cursorRight') || data === 'l')) stepTarget(1);
    else if (id === 'agentMode' && (keybindings.matches(data, 'tui.editor.cursorLeft') || data === 'h')) stepAgentMode(-1);
    else if (id === 'agentMode' && (keybindings.matches(data, 'tui.editor.cursorRight') || data === 'l')) stepAgentMode(1);
    else if (id === 'modelCount' && (keybindings.matches(data, 'tui.editor.cursorLeft') || data === 'h')) stepModelCount(-1);
    else if (id === 'modelCount' && (keybindings.matches(data, 'tui.editor.cursorRight') || data === 'l')) stepModelCount(1);
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
    if (hit.id === 'target') {
      if (hit.minus && event.x >= hit.minus[0] && event.x < hit.minus[1]) { stepTarget(-1); return; }
      stepTarget(1);
      return;
    }
    if (disabled()) return;
    if (hit.id === 'toggle') { flipEnabled(); return; }
    if (hit.id === 'agentMode') {
      if (hit.minus && event.x >= hit.minus[0] && event.x < hit.minus[1]) { stepAgentMode(-1); return; }
      stepAgentMode(1);
      return;
    }
    if (hit.id === 'copyDefault') { copyFromDefault(); return; }
    if (hit.id === 'removeEntry') { removeUndiscoveredEntry(); return; }
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

export function createSupervisorDashboard(options: SupervisorDashboardOptions): any {
  const { orchestrator, subagents, framed } = options;
  const { lib, tui, theme, keybindings, isBound, onError, done } = orchestrator;
  const { truncateToWidth, visibleWidth } = lib;
  const clip = (text: string, width: number): string => truncateToWidth(text, width, '…');
  const style = {
    accent: (text: string) => safeFg(theme, 'accent', text),
    muted: (text: string) => safeFg(theme, 'muted', text),
    dim: (text: string) => safeFg(theme, 'dim', text),
    border: (text: string) => safeFg(theme, 'border', text),
    borderMuted: (text: string) => safeFg(theme, 'borderMuted', text),
    error: (text: string) => safeFg(theme, 'error', text),
    bold: (text: string) => (theme?.bold ? theme.bold(text) : text),
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
    agentNames: subagents.agentNames,
    error: subagents.error,
    applyConfig: subagents.applyConfig,
    onError,
    done,
    isBound,
  });

  let activeTab: DashboardTab = 'orchestrator';
  let focused = true;
  let closed = false;
  let lastWidth = 80;
  let tabHits: Array<{ tab: DashboardTab; y: number; start: number; end: number }> = [];
  let closeHit: { x1: number; x2: number; y: number } | null = null;

  const activePanel = (): any => (activeTab === 'subagents' ? subagentPanel : orchestratorPanel);

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

  const renderTabBar = (width: number): string[] => {
    const available = Math.max(1, width);
    const lines: string[] = [clip(style.dim('─'.repeat(available)), available)];

    let plain = '';
    const spans: Array<{ tab: DashboardTab; start: number; end: number }> = [];
    for (const entry of TAB_LABELS) {
      if (plain.length > 0) plain += '  ';
      const start = plain.length;
      plain += entry.tab === activeTab ? `[ ◆ ${entry.label} ]` : `  ◇ ${entry.label}  `;
      spans.push({ tab: entry.tab, start, end: plain.length });
    }
    let styled = '';
    let cursor = 0;
    for (const span of spans) {
      styled += plain.slice(cursor, span.start);
      const raw = plain.slice(span.start, span.end);
      styled += span.tab === activeTab ? style.bold(style.accent(raw)) : style.muted(raw);
      cursor = span.end;
    }
    styled += plain.slice(cursor);

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
      lastWidth = width;
      closeHit = null;

      if (framed && width >= 20) {
        const innerW = Math.max(4, width - 2 - FRAME_PAD_X * 2);
        const innerLines = renderTabBar(innerW);
        innerLines.push(...activePanel().render(innerW));

        const pad = (s: string, len: number) => {
          const clipped = clip(s, len);
          const vis = visibleWidth(clipped);
          return clipped + ' '.repeat(Math.max(0, len - vis));
        };
        const gutter = ' '.repeat(FRAME_PAD_X);
        const border = style.border('│');
        const blank = `${border}${' '.repeat(width - 2)}${border}`;
        const row = (content: string) => `${border}${gutter}${pad(content, innerW)}${gutter}${border}`;

        const titlePlain = '◆ Supervisor';
        const titleStyled = style.bold(style.accent(titlePlain));
        const closePlain = '[✕]';
        const closeStyled = style.error(closePlain);
        const prefix = '╭─ ';
        const suffix = ' ─╮';
        const availHeader = width - visibleWidth(prefix) - visibleWidth(suffix) - visibleWidth(closePlain) - 2;
        const fillDashes = Math.max(1, availHeader - visibleWidth(titlePlain));
        const closeX1 = width - visibleWidth(suffix) - visibleWidth(closePlain);
        closeHit = { x1: closeX1, x2: closeX1 + visibleWidth(closePlain), y: 0 };

        const top = `${style.border(prefix)}${titleStyled} ${style.borderMuted('─'.repeat(fillDashes))} ${closeStyled}${style.border(suffix)}`;
        const bottom = style.border(`╰${'─'.repeat(width - 2)}╯`);

        return [
          clip(top, width),
          ...Array.from({ length: FRAME_PAD_Y }, () => blank),
          ...innerLines.map(row),
          ...Array.from({ length: FRAME_PAD_Y }, () => blank),
          clip(bottom, width),
        ];
      }

      if (framed && width >= 10) {
        const innerW = Math.max(1, width - 2);
        const innerLines = renderTabBar(innerW);
        innerLines.push(...activePanel().render(innerW));
        const pad = (s: string, len: number) => {
          const clipped = clip(s, len);
          const vis = visibleWidth(clipped);
          return clipped + ' '.repeat(Math.max(0, len - vis));
        };
        const row = (content: string) => style.border('│') + pad(content, innerW) + style.border('│');
        return [
          style.border(`╭${'─'.repeat(innerW)}╮`),
          ...innerLines.map(row),
          style.border(`╰${'─'.repeat(innerW)}╯`),
        ];
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

      if (framed && lastWidth >= 20 && closeHit && event.type === 'press' && event.button === 'left') {
        if (event.y === closeHit.y && event.x >= closeHit.x1 && event.x < closeHit.x2) {
          close();
          return;
        }
      }

      const yOffset = framed && lastWidth >= 20 ? 1 + FRAME_PAD_Y : framed && lastWidth >= 10 ? 1 : 0;
      const xOffset = framed && lastWidth >= 20 ? 1 + FRAME_PAD_X : framed && lastWidth >= 10 ? 1 : 0;
      const adjustedY = event.y - yOffset;
      const adjustedX = event.x - xOffset;

      if (adjustedY < TAB_BAR_HEIGHT && event.type !== 'wheel') {
        if (event.type !== 'press' || event.button !== 'left') return;
        const hit = tabHits.find(entry => entry.y === adjustedY && adjustedX >= entry.start && adjustedX < entry.end);
        if (hit) setActiveTab(hit.tab);
        return;
      }
      activePanel().handleMouse({ ...event, x: adjustedX, y: adjustedY - TAB_BAR_HEIGHT });
    },
  };

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
  Object.defineProperty(component, 'panels', {
    enumerable: false,
    configurable: true,
    get: () => ({ orchestrator: orchestratorPanel, subagents: subagentPanel }),
  });
  return component;
}
