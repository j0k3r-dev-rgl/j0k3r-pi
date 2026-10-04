import { loadSubagents, readSubagentsConfig } from '../config.js';
import type { ModelRef, SubagentDefinitionScope, SubagentModelProfile, SubagentModelProfiles, ThinkingEffort } from '../types.js';
import { buildModelProfileRows, globalSubagentsConfigPath, groupAvailableModelsByProvider } from './data.js';
import type { ModelProfileRow } from './data.js';
import { applyDirtyProfileEdit, commitStagedModelProfiles, stageModelProfileEdit } from './editor.js';
import { buildNoChangesModelProfilesMessage, constrainLines, frameModal, normalizeModalKey, padToVisibleWidth, pendingLabel, profileLabel, truncateToVisibleWidth, visibleWidth } from './formatting.js';
import { themeAccent, themeDim, themeTitle, themeWarning } from '../ui/theme.js';

const EFFORT_CHOICES: Array<ThinkingEffort | 'inherit'> = ['inherit', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export type SubagentModelProfilesModalResult =
  | { action: 'save'; dirtyProfiles: SubagentModelProfiles }
  | { action: 'cancel' };

type ModalView = 'main' | 'model-provider' | 'model-model' | 'effort';

type ModalComponent = {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
};

type ModalInput = {
  rows: ModelProfileRow[];
  availableModels?: any[];
  tui?: { requestRender?: () => void };
  theme?: any;
  done: (result: SubagentModelProfilesModalResult) => void;
};

function cloneProfile(profile: SubagentModelProfile = {}): SubagentModelProfile {
  return {
    ...(profile.model ? { model: { ...profile.model } } : {}),
    ...(profile.effort ? { effort: profile.effort } : {}),
  };
}

function cloneProfiles(profiles: SubagentModelProfiles): SubagentModelProfiles {
  return Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, cloneProfile(profile)]));
}

export function createSubagentModelProfilesModal(input: ModalInput): ModalComponent {
  const rows = input.rows;
  const availableByProvider = groupAvailableModelsByProvider(input.availableModels ?? []);
  const providerNames = Object.keys(availableByProvider);
  const baseProfiles: SubagentModelProfiles = Object.fromEntries(rows.map((row) => [row.name.trim().toLowerCase(), cloneProfile(row.explicitProfile)]));
  let selectedIndex = 0;
  let scrollOffset = 0;
  let view: ModalView = 'main';
  let pickerIndex = 0;
  let pickerScrollOffset = 0;
  let modelSearch = '';
  let selectedProvider: string | undefined;
  let dirtyProfiles: SubagentModelProfiles = {};
  let completed = false;

  const selectedRow = () => rows[Math.min(Math.max(selectedIndex, 0), Math.max(0, rows.length - 1))];
  const requestRender = () => input.tui?.requestRender?.();

  const finish = (result: SubagentModelProfilesModalResult) => {
    if (completed) return;
    completed = true;
    input.done(result.action === 'save' ? { action: 'save', dirtyProfiles: cloneProfiles(result.dirtyProfiles) } : result);
  };

  const clampSelection = () => {
    selectedIndex = Math.min(Math.max(selectedIndex, 0), Math.max(0, rows.length - 1));
    if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
    const maxVisibleRows = 10;
    if (selectedIndex >= scrollOffset + maxVisibleRows) scrollOffset = selectedIndex - maxVisibleRows + 1;
    scrollOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, rows.length - 1)));
  };

  const resetPickerPosition = () => {
    pickerIndex = 0;
    pickerScrollOffset = 0;
  };

  const openPicker = (nextView: ModalView) => {
    view = nextView;
    resetPickerPosition();
    modelSearch = '';
    selectedProvider = undefined;
  };

  const applyEdit = (edit: { model?: ModelRef; effort?: ThinkingEffort; reset?: 'model' | 'effort' | 'row' }) => {
    const row = selectedRow();
    if (!row) return;
    dirtyProfiles = applyDirtyProfileEdit({
      baseProfiles,
      dirtyProfiles,
      edit: { agentName: row.name, ...edit },
    });
  };

  const rowKey = (row: ModelProfileRow): string => row.name.trim().toLowerCase();
  const rowScope = (row: ModelProfileRow): SubagentDefinitionScope => row.scope ?? 'global';
  const dim = (text: string): string => themeDim(input.theme, text);
  const scopedName = (row: ModelProfileRow): string => `${row.name} ${dim(rowScope(row) === 'project' ? '(local)' : '(global)')}`;
  const hasDirtyProfileFor = (row: ModelProfileRow): boolean => Object.prototype.hasOwnProperty.call(dirtyProfiles, rowKey(row));
  const dirtyProfileFor = (row: ModelProfileRow): SubagentModelProfile | undefined => dirtyProfiles[rowKey(row)];

  const rowModelText = (row: ModelProfileRow): string => {
    if (!hasDirtyProfileFor(row)) return row.modelLabel;
    const dirty = dirtyProfileFor(row);
    const label = profileLabel(dirty, 'model');
    if (label) return `staged: ${label}`;
    return baseProfiles[rowKey(row)]?.model ? `staged: inherit/reset model (was ${row.modelLabel})` : row.modelLabel;
  };

  const rowEffortText = (row: ModelProfileRow): string => {
    if (!hasDirtyProfileFor(row)) return row.effortLabel;
    const dirty = dirtyProfileFor(row);
    const label = profileLabel(dirty, 'effort');
    if (label) return `staged: ${label}`;
    return baseProfiles[rowKey(row)]?.effort ? `staged: inherit/reset effort (was ${row.effortLabel})` : row.effortLabel;
  };

  const selectedSummaryLine = (): string => {
    const row = selectedRow();
    if (!row) return 'selected: (none)';
    const availability = row.modelLabel.includes('(unavailable)') ? ' · unavailable model' : '';
    return `selected: ${themeAccent(input.theme, row.name)}${availability} · model: ${rowModelText(row)} · effort: ${rowEffortText(row)}`;
  };

  const rowListLines = (width: number): string[] => {
    const innerWidth = Math.max(1, Math.floor(width || 1) - 2);
    const visibleRows = rows.slice(scrollOffset, scrollOffset + 10);
    if (innerWidth >= 100) {
      const nameWidth = 32;
      const effortWidth = 24;
      const modelWidth = Math.max(24, innerWidth - nameWidth - effortWidth - 6);
      const lines = [`${padToVisibleWidth('agent/phase', nameWidth)}  ${padToVisibleWidth('model', modelWidth)}  ${padToVisibleWidth('effort', effortWidth)}`];
      for (const [offset, item] of visibleRows.entries()) {
        const index = scrollOffset + offset;
        const marker = index === selectedIndex ? themeAccent(input.theme, '›') : ' ';
        const dirty = hasDirtyProfileFor(item) ? themeWarning(input.theme, '*') : ' ';
        lines.push(`${marker} ${dirty} ${padToVisibleWidth(scopedName(item), nameWidth - 4)}  ${padToVisibleWidth(rowModelText(item), modelWidth)}  ${padToVisibleWidth(rowEffortText(item), effortWidth)}`);
      }
      return lines;
    }
    const lines = ['agent/phase · model · effort'];
    for (const [offset, item] of visibleRows.entries()) {
      const index = scrollOffset + offset;
      const marker = index === selectedIndex ? themeAccent(input.theme, '›') : ' ';
      const dirty = hasDirtyProfileFor(item) ? themeWarning(input.theme, '*') : ' ';
      lines.push(`${marker} ${dirty} ${scopedName(item)} · ${rowModelText(item)} · ${rowEffortText(item)}`);
    }
    return lines;
  };

  const renderMain = (width: number): string[] => {
    const dirtyCount = Object.keys(dirtyProfiles).length;
    const body = [
      `target: local/global by subagent scope · ${pendingLabel(dirtyCount, input.theme)}`,
      '↑/↓/j/k move · enter/m model · e effort · M/E/r reset · s save · esc/q cancel',
      '',
      ...rowListLines(width),
      '',
      selectedSummaryLine(),
    ];
    return frameModal('Subagent model profiles', body, width, input.theme);
  };

  const renderProviderPicker = (width: number): string[] => {
    const row = selectedRow();
    const lines = [
      `Select model provider for ${row?.name ?? '(none)'}`,
      'choose provider · enter: select · esc/q: back',
      '',
    ];
    const items = ['inherit/reset model', ...providerNames];
    if (!providerNames.length) lines.push('No available models found; reset remains available.');
    for (const [index, item] of items.entries()) {
      const marker = index === pickerIndex ? themeAccent(input.theme, '›') : ' ';
      lines.push(`${marker} ${item}`);
    }
    return frameModal('Choose model provider', lines, width, input.theme);
  };

  const filteredProviderModels = (): any[] => {
    const models = selectedProvider ? (availableByProvider[selectedProvider] ?? []) : [];
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) => `${model.label} ${model.provider}/${model.id}`.toLowerCase().includes(query));
  };

  const modelPickerVisibleRows = (): number => 10;

  const clampPickerScroll = (length: number) => {
    pickerIndex = Math.min(Math.max(pickerIndex, 0), Math.max(0, length - 1));
    if (pickerIndex < pickerScrollOffset) pickerScrollOffset = pickerIndex;
    const visibleRows = modelPickerVisibleRows();
    if (pickerIndex >= pickerScrollOffset + visibleRows) pickerScrollOffset = pickerIndex - visibleRows + 1;
    pickerScrollOffset = Math.max(0, Math.min(pickerScrollOffset, Math.max(0, length - 1)));
  };

  const renderModelPicker = (width: number): string[] => {
    const row = selectedRow();
    const allModels = selectedProvider ? (availableByProvider[selectedProvider] ?? []) : [];
    const models = filteredProviderModels();
    clampPickerScroll(models.length);
    const visibleRows = modelPickerVisibleRows();
    const visibleModels = models.slice(pickerScrollOffset, pickerScrollOffset + visibleRows);
    const rangeEnd = Math.min(models.length, pickerScrollOffset + visibleRows);
    const countText = modelSearch ? `${models.length}/${allModels.length} match${models.length === 1 ? '' : 'es'}` : `${models.length} model${models.length === 1 ? '' : 's'}`;
    const lines = [
      `Select ${selectedProvider ?? ''} model for ${row?.name ?? '(none)'}`,
      `provider: ${selectedProvider ?? '(none)'} · ${countText}${models.length > visibleRows ? ` · showing ${pickerScrollOffset + 1}-${rangeEnd}` : ''}`,
      `search: ${modelSearch || '(type to filter)'}`,
      '↑/↓/j/k move · type search · backspace clear · enter select · esc back',
      '',
    ];
    if (!allModels.length) lines.push('No models available for this provider.');
    else if (!models.length) lines.push('No models match the current search.');
    for (const [offset, model] of visibleModels.entries()) {
      const index = pickerScrollOffset + offset;
      const marker = index === pickerIndex ? themeAccent(input.theme, '›') : ' ';
      lines.push(`${marker} ${model.label} (${model.provider}/${model.id})`);
    }
    return frameModal('Choose model', lines, width, input.theme);
  };

  const renderEffortPicker = (width: number): string[] => {
    const row = selectedRow();
    const lines = [
      `row: ${row?.name ?? '(none)'}`,
      'choose effort · enter: select · esc/q: back',
      '',
    ];
    const items = ['inherit/reset effort', ...EFFORT_CHOICES.filter((choice): choice is ThinkingEffort => choice !== 'inherit')];
    for (const [index, item] of items.entries()) {
      const marker = index === pickerIndex ? themeAccent(input.theme, '›') : ' ';
      lines.push(`${marker} ${item}`);
    }
    return frameModal('Choose effort', lines, width, input.theme);
  };

  const movePicker = (delta: number) => {
    const length = view === 'model-provider'
      ? 1 + providerNames.length
      : view === 'model-model'
        ? filteredProviderModels().length
        : 1 + EFFORT_CHOICES.filter((choice) => choice !== 'inherit').length;
    pickerIndex = Math.min(Math.max(pickerIndex + delta, 0), Math.max(0, length - 1));
    if (view === 'model-model') clampPickerScroll(length);
  };

  const updateModelSearch = (nextSearch: string) => {
    modelSearch = nextSearch;
    resetPickerPosition();
  };

  const isPrintableSearchInput = (key: string): boolean => key.length === 1 && key >= ' ' && key !== '\u007f';

  const chooseProvider = () => {
    if (pickerIndex === 0) {
      applyEdit({ reset: 'model' });
      view = 'main';
      return;
    }
    selectedProvider = providerNames[pickerIndex - 1];
    resetPickerPosition();
    modelSearch = '';
    view = 'model-model';
  };

  const chooseModel = () => {
    const model = filteredProviderModels()[pickerIndex];
    if (model) applyEdit({ model: { provider: model.provider, id: model.id } });
    view = 'main';
  };

  const chooseEffort = () => {
    const efforts = EFFORT_CHOICES.filter((choice): choice is ThinkingEffort => choice !== 'inherit');
    if (pickerIndex === 0) applyEdit({ reset: 'effort' });
    else {
      const effort = efforts[pickerIndex - 1];
      if (effort) applyEdit({ effort });
    }
    view = 'main';
  };

  clampSelection();

  return {
    render(width: number): string[] {
      if (view === 'model-provider') return constrainLines(renderProviderPicker(width), width);
      if (view === 'model-model') return constrainLines(renderModelPicker(width), width);
      if (view === 'effort') return constrainLines(renderEffortPicker(width), width);
      return constrainLines(renderMain(width), width);
    },
    handleInput(data: string): void {
      if (completed) return;
      const key = normalizeModalKey(data);
      if (view !== 'main') {
        if (key === 'esc' || (key === 'q' && view !== 'model-model')) view = 'main';
        else if (view === 'model-model' && (key === '\u007f' || key === '\b')) updateModelSearch(modelSearch.slice(0, -1));
        else if (view === 'model-model' && key === '\u0015') updateModelSearch('');
        else if (key === 'up' || key === 'k') movePicker(-1);
        else if (key === 'down' || key === 'j') movePicker(1);
        else if (view === 'model-model' && modelSearch && isPrintableSearchInput(key)) updateModelSearch(`${modelSearch}${key}`);
        else if (key === 'home' || key === 'g') {
          pickerIndex = 0;
          if (view === 'model-model') clampPickerScroll(filteredProviderModels().length);
        }
        else if (key === 'end' || key === 'G') movePicker(Number.MAX_SAFE_INTEGER);
        else if (key === 'enter') {
          if (view === 'model-provider') chooseProvider();
          else if (view === 'model-model') chooseModel();
          else chooseEffort();
        }
        else if (view === 'model-model' && isPrintableSearchInput(key)) updateModelSearch(`${modelSearch}${key}`);
        requestRender();
        return;
      }
      if (key === 'up' || key === 'k') selectedIndex -= 1;
      else if (key === 'down' || key === 'j') selectedIndex += 1;
      else if (key === 'home' || key === 'g') selectedIndex = 0;
      else if (key === 'end' || key === 'G') selectedIndex = rows.length - 1;
      else if (key === 'enter' || key === 'm') openPicker('model-provider');
      else if (key === 'e') openPicker('effort');
      else if (key === 'M') applyEdit({ reset: 'model' });
      else if (key === 'E') applyEdit({ reset: 'effort' });
      else if (key === 'r') applyEdit({ reset: 'row' });
      else if (key === 's') finish({ action: 'save', dirtyProfiles });
      else if (key === 'esc' || key === 'q') finish({ action: 'cancel' });
      clampSelection();
      requestRender();
    },
    invalidate(): void {
      requestRender();
    },
  };
}

export function buildNonTuiModelProfilesMessage(agentDir?: string): string {
  return `subagent model profiles require Pi TUI. Edit global profiles manually in ${globalSubagentsConfigPath(agentDir)} under the model_profiles key.`;
}

function rowChoice(row: ModelProfileRow): string {
  const scope = row.scope === 'project' ? 'local' : 'global';
  return `${row.name} (${scope}) — model ${row.modelLabel}; effort ${row.effortLabel}`;
}

async function getAvailableModels(ctx: any): Promise<any[]> {
  try {
    const available = await ctx?.modelRegistry?.getAvailable?.();
    return Array.isArray(available) ? available : [];
  } catch {
    return [];
  }
}

async function chooseSave(ctx: any, stagedProfiles: SubagentModelProfiles, input: { agentDir?: string; cwd?: string; profileScopes?: Record<string, SubagentDefinitionScope> } = {}): Promise<string> {
  const decision = await ctx.ui.select('Save subagent model profile changes?', ['Save', 'Cancel']);
  const message = commitStagedModelProfiles({ stagedProfiles, save: decision === 'Save', agentDir: input.agentDir, cwd: input.cwd, profileScopes: input.profileScopes });
  ctx.ui.notify?.(message, decision === 'Save' ? 'info' : 'warning');
  return message;
}

export async function runSubagentModelsCommand(ctx: any = {}): Promise<string> {
  const agentDir = ctx?.agentDir;
  const hasCustomUi = typeof ctx?.ui?.custom === 'function';
  const hasSelectUi = typeof ctx?.ui?.select === 'function';
  if (!hasCustomUi && !hasSelectUi) return buildNonTuiModelProfilesMessage(agentDir);

  const cwd = ctx.cwd ?? process.cwd();
  const definitions = loadSubagents(cwd);
  const config = readSubagentsConfig(cwd);
  const availableModels = await getAvailableModels(ctx);
  const rows = buildModelProfileRows({ definitions, config, ctx, availableModels });
  const profileScopes: Record<string, SubagentDefinitionScope> = Object.fromEntries(rows.map((row) => [row.name.trim().toLowerCase(), row.scope ?? 'global']));

  if (hasCustomUi) {
    const result = await ctx.ui.custom(
      (tui: any, theme: any, _keybindings: any, done: (result: SubagentModelProfilesModalResult) => void) => createSubagentModelProfilesModal({
        rows,
        availableModels,
        tui,
        theme,
        done,
      }),
      { overlay: true, overlayOptions: { anchor: 'center', width: '96%', maxHeight: '90%', minWidth: 96 } },
    ) as SubagentModelProfilesModalResult | undefined;

    if (result?.action === 'save') {
      const hasDirtyRows = Object.keys(result.dirtyProfiles).length > 0;
      const message = hasDirtyRows
        ? commitStagedModelProfiles({ stagedProfiles: result.dirtyProfiles, save: true, agentDir, cwd, profileScopes })
        : buildNoChangesModelProfilesMessage(agentDir);
      ctx.ui.notify?.(message, 'info');
      return message;
    }

    const message = commitStagedModelProfiles({ stagedProfiles: {}, save: false, agentDir });
    ctx.ui.notify?.(message, 'warning');
    return message;
  }

  const rowChoices = rows.map(rowChoice);
  const selectedRowChoice = await ctx.ui.select('Select subagent to configure:', [...rowChoices, 'Cancel']);
  if (!selectedRowChoice || selectedRowChoice === 'Cancel') return commitStagedModelProfiles({ stagedProfiles: {}, save: false, agentDir });
  const row = rows[rowChoices.indexOf(selectedRowChoice)];
  if (!row) return commitStagedModelProfiles({ stagedProfiles: {}, save: false, agentDir });

  const action = await ctx.ui.select(`Configure ${row.name}:`, ['Set provider/model/effort', 'Reset model', 'Reset effort', 'Reset row', 'Cancel']);
  let staged: SubagentModelProfiles = { [row.name]: { ...row.explicitProfile } };
  if (action === 'Cancel') return commitStagedModelProfiles({ stagedProfiles: staged, save: false, agentDir });
  if (action === 'Reset model') staged = stageModelProfileEdit(staged, { agentName: row.name, reset: 'model' });
  else if (action === 'Reset effort') staged = stageModelProfileEdit(staged, { agentName: row.name, reset: 'effort' });
  else if (action === 'Reset row') staged = stageModelProfileEdit(staged, { agentName: row.name, reset: 'row' });
  else {
    const grouped = groupAvailableModelsByProvider(availableModels);
    const providers = Object.keys(grouped);
    if (!providers.length) {
      const message = 'No available models found in the current model registry. Reset the saved model or edit the global JSON manually.';
      ctx.ui.notify?.(message, 'warning');
      return message;
    }
    const provider = await ctx.ui.select(`Select provider for ${row.name}:`, [...providers, 'inherit/reset model', 'Cancel']);
    if (provider === 'Cancel') return commitStagedModelProfiles({ stagedProfiles: staged, save: false, agentDir });
    if (provider === 'inherit/reset model') staged = stageModelProfileEdit(staged, { agentName: row.name, reset: 'model' });
    else {
      const models = grouped[provider] ?? [];
      const modelLabels = models.map((model) => model.label);
      const modelLabel = await ctx.ui.select(`Select model for ${row.name}:`, [...modelLabels, 'Cancel']);
      if (modelLabel === 'Cancel') return commitStagedModelProfiles({ stagedProfiles: staged, save: false, agentDir });
      const selectedModel = models[modelLabels.indexOf(modelLabel)];
      if (selectedModel) staged = stageModelProfileEdit(staged, { agentName: row.name, model: { provider: selectedModel.provider, id: selectedModel.id } });
    }
    const effort = await ctx.ui.select(`Select effort for ${row.name}:`, EFFORT_CHOICES);
    if (effort === 'inherit') staged = stageModelProfileEdit(staged, { agentName: row.name, reset: 'effort' });
    else staged = stageModelProfileEdit(staged, { agentName: row.name, effort });
  }

  return chooseSave(ctx, staged, { agentDir, cwd, profileScopes });
}
