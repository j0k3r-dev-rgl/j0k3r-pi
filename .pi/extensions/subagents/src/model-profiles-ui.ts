import os from 'node:os';
import path from 'node:path';
import { loadSubagents, readSubagentsConfig, resetGlobalSubagentModelProfileField, saveGlobalSubagentModelProfile } from './config.js';
import { resolveEffectiveSubagentProfile } from './profile-resolver.js';
import type { ModelRef, SubagentDefinition, SubagentModelProfile, SubagentModelProfiles, SubagentsConfig, ThinkingEffort } from './types.js';

export const KNOWN_SDD_PHASES = [
  'sdd-explore',
  'sdd-proposal',
  'sdd-spec',
  'sdd-design',
  'sdd-task',
  'sdd-apply',
  'sdd-verify',
  'sdd-archive',
];

const EFFORT_CHOICES: Array<ThinkingEffort | 'inherit'> = ['inherit', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

type AvailableModel = { provider: string; id: string; label: string };

export type ModelProfileRow = {
  name: string;
  description: string;
  kind: 'subagent' | 'sdd-phase';
  modelLabel: string;
  effortLabel: string;
  effectiveModel?: ModelRef;
  effectiveEffort?: ThinkingEffort;
  explicitProfile: SubagentModelProfile;
};

export function globalSubagentsConfigPath(agentDir = path.join(os.homedir(), '.pi', 'agent')): string {
  return path.join(agentDir, 'subagents.json');
}

function modelKey(model: ModelRef): string {
  return `${model.provider}/${model.id}`;
}

function modelFromAny(raw: any): AvailableModel | undefined {
  const provider = typeof raw?.provider === 'string'
    ? raw.provider
    : typeof raw?.provider?.id === 'string'
      ? raw.provider.id
      : typeof raw?.provider?.name === 'string'
        ? raw.provider.name
        : undefined;
  const id = typeof raw?.id === 'string'
    ? raw.id
    : typeof raw?.model === 'string'
      ? raw.model
      : typeof raw?.name === 'string'
        ? raw.name
        : undefined;
  if (!provider || !id) return undefined;
  return { provider, id, label: String(raw?.label ?? raw?.displayName ?? id) };
}

export function groupAvailableModelsByProvider(rawModels: any[] = []): Record<string, AvailableModel[]> {
  const grouped: Record<string, AvailableModel[]> = {};
  for (const raw of rawModels) {
    const model = modelFromAny(raw);
    if (!model) continue;
    grouped[model.provider] ??= [];
    if (!grouped[model.provider].some((existing) => existing.id === model.id)) grouped[model.provider].push(model);
  }
  for (const models of Object.values(grouped)) models.sort((a, b) => a.id.localeCompare(b.id));
  return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)));
}

function availableModelSet(rawModels: any[] = []): Set<string> {
  return new Set(Object.values(groupAvailableModelsByProvider(rawModels)).flat().map((model) => modelKey(model)));
}

function syntheticDefinition(name: string): SubagentDefinition {
  return { name, description: `${name} SDD phase`, filePath: '', instructions: '', tools: [] };
}

export function buildModelProfileRows(input: {
  definitions: SubagentDefinition[];
  config: SubagentsConfig;
  ctx: any;
  availableModels?: any[];
}): ModelProfileRow[] {
  const byName = new Map<string, SubagentDefinition>();
  for (const definition of input.definitions) byName.set(definition.name, definition);
  for (const phase of KNOWN_SDD_PHASES) if (!byName.has(phase)) byName.set(phase, syntheticDefinition(phase));
  const available = input.availableModels ? availableModelSet(input.availableModels) : undefined;

  return [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((definition) => {
      const resolved = resolveEffectiveSubagentProfile({ agentName: definition.name, definition, config: input.config, ctx: input.ctx });
      const unavailable = resolved.model.value && available && !available.has(modelKey(resolved.model.value));
      return {
        name: definition.name,
        description: definition.description,
        kind: definition.name.startsWith('sdd-') ? 'sdd-phase' : 'subagent',
        modelLabel: `${resolved.model.label}${unavailable ? ' (unavailable)' : ''}`,
        effortLabel: resolved.effort.label,
        effectiveModel: resolved.model.value,
        effectiveEffort: resolved.effort.value,
        explicitProfile: { ...(input.config.model_profiles[definition.name] ?? {}) },
      };
    });
}

export function stageModelProfileEdit(
  current: SubagentModelProfiles,
  edit: { agentName: string; model?: ModelRef; effort?: ThinkingEffort; reset?: 'model' | 'effort' | 'row' },
): SubagentModelProfiles {
  const agentName = edit.agentName.trim().toLowerCase();
  const next: SubagentModelProfiles = { ...current, [agentName]: { ...(current[agentName] ?? {}) } };
  if (edit.reset === 'row') next[agentName] = {};
  else {
    if (edit.reset === 'model') delete next[agentName].model;
    if (edit.reset === 'effort') delete next[agentName].effort;
    if (edit.model) next[agentName].model = edit.model;
    if (edit.effort) next[agentName].effort = edit.effort;
  }
  return next;
}

function cloneProfile(profile: SubagentModelProfile = {}): SubagentModelProfile {
  return {
    ...(profile.model ? { model: { ...profile.model } } : {}),
    ...(profile.effort ? { effort: profile.effort } : {}),
  };
}

function profilesEqual(a: SubagentModelProfile = {}, b: SubagentModelProfile = {}): boolean {
  return a.model?.provider === b.model?.provider
    && a.model?.id === b.model?.id
    && a.effort === b.effort;
}

export function applyDirtyProfileEdit(input: {
  baseProfiles: SubagentModelProfiles;
  dirtyProfiles: SubagentModelProfiles;
  edit: { agentName: string; model?: ModelRef; effort?: ThinkingEffort; reset?: 'model' | 'effort' | 'row' };
}): SubagentModelProfiles {
  const agentName = input.edit.agentName.trim().toLowerCase();
  const baseProfile = cloneProfile(input.baseProfiles[agentName]);
  const seededProfiles: SubagentModelProfiles = {
    [agentName]: cloneProfile(input.dirtyProfiles[agentName] ?? baseProfile),
  };
  const stagedProfile = cloneProfile(stageModelProfileEdit(seededProfiles, input.edit)[agentName]);
  const nextDirtyProfiles: SubagentModelProfiles = Object.fromEntries(
    Object.entries(input.dirtyProfiles)
      .filter(([name]) => name !== agentName)
      .map(([name, profile]) => [name, cloneProfile(profile)]),
  );

  if (!profilesEqual(stagedProfile, baseProfile)) nextDirtyProfiles[agentName] = stagedProfile;
  return nextDirtyProfiles;
}

export function commitStagedModelProfiles(input: { stagedProfiles: SubagentModelProfiles; save: boolean; agentDir?: string }): string {
  if (!input.save) return `Cancelled. No changes written to ${globalSubagentsConfigPath(input.agentDir)}.`;
  for (const [agentName, profile] of Object.entries(input.stagedProfiles)) {
    if (profile.model || profile.effort) saveGlobalSubagentModelProfile({ agentName, profile, agentDir: input.agentDir });
    else {
      resetGlobalSubagentModelProfileField({ agentName, field: 'model', agentDir: input.agentDir });
      resetGlobalSubagentModelProfileField({ agentName, field: 'effort', agentDir: input.agentDir });
    }
  }
  return `Saved subagent model profiles to ${globalSubagentsConfigPath(input.agentDir)}.`;
}

export function buildNoChangesModelProfilesMessage(agentDir?: string): string {
  return `No subagent model profile changes to save. Nothing written to ${globalSubagentsConfigPath(agentDir)}.`;
}

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
  done: (result: SubagentModelProfilesModalResult) => void;
};

function stripTerminalEscapes(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\u001b\][^\u001b]*(?:\u001b\\|\u0007)/g, '');
}

function visibleWidth(text: string): number {
  return stripTerminalEscapes(text).length;
}

function truncateToVisibleWidth(text: string, width: number): string {
  if (width <= 0) return '';
  if (visibleWidth(text) <= width) return text;
  if (width === 1) return '…';
  let output = '';
  let visible = 0;
  for (let index = 0; index < text.length;) {
    if (text[index] === '\u001b') {
      const csi = text.slice(index).match(/^\u001b\[[0-9;]*m/);
      if (csi) {
        output += csi[0];
        index += csi[0].length;
        continue;
      }
      const osc = text.slice(index).match(/^\u001b\][^\u001b]*(?:\u001b\\|\u0007)/);
      if (osc) {
        output += osc[0];
        index += osc[0].length;
        continue;
      }
    }
    if (visible >= width - 1) break;
    output += text[index];
    visible += 1;
    index += 1;
  }
  return `${output}…`;
}

function constrainLines(lines: string[], width: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width || 1));
  return lines.map((line) => truncateToVisibleWidth(line, safeWidth));
}

function padToVisibleWidth(text: string, width: number): string {
  const clipped = truncateToVisibleWidth(text, width);
  return `${clipped}${' '.repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

function frameModal(title: string, body: string[], width: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width || 1));
  if (safeWidth < 24) return constrainLines([title, ...body], safeWidth);
  const innerWidth = safeWidth - 2;
  const contentWidth = Math.max(1, innerWidth - 2);
  const titleText = ` ${title} `;
  const visibleTitle = truncateToVisibleWidth(titleText, Math.max(1, innerWidth));
  const top = `╭${visibleTitle}${'─'.repeat(Math.max(0, innerWidth - visibleWidth(visibleTitle)))}╮`;
  const bottom = `╰${'─'.repeat(innerWidth)}╯`;
  return [top, ...body.map((line) => `│ ${padToVisibleWidth(line, contentWidth)} │`), bottom];
}

function pendingLabel(count: number): string {
  if (count === 0) return 'pending: none';
  return `pending: ${count} change${count === 1 ? '' : 's'}`;
}

function normalizeModalKey(data: string): string {
  if (data === '\r' || data === '\n') return 'enter';
  if (data === '\u001b') return 'esc';
  if (data === '\u001b[A') return 'up';
  if (data === '\u001b[B') return 'down';
  if (data === '\u001b[H') return 'home';
  if (data === '\u001b[F') return 'end';
  return data;
}

function profileLabel(profile: SubagentModelProfile | undefined, field: 'model' | 'effort'): string | undefined {
  if (!profile) return undefined;
  if (field === 'model') return profile.model ? `${profile.model.provider}/${profile.model.id}` : undefined;
  return profile.effort;
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

  const openPicker = (nextView: ModalView) => {
    view = nextView;
    pickerIndex = 0;
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
    return `selected: ${row.name}${availability} · model: ${rowModelText(row)} · effort: ${rowEffortText(row)}`;
  };

  const rowListLines = (width: number): string[] => {
    const innerWidth = Math.max(1, Math.floor(width || 1) - 2);
    const visibleRows = rows.slice(scrollOffset, scrollOffset + 10);
    if (innerWidth >= 92) {
      const nameWidth = 24;
      const effortWidth = 22;
      const modelWidth = Math.max(18, innerWidth - nameWidth - effortWidth - 6);
      const lines = [`${padToVisibleWidth('agent/phase', nameWidth)}  ${padToVisibleWidth('model', modelWidth)}  ${padToVisibleWidth('effort', effortWidth)}`];
      for (const [offset, item] of visibleRows.entries()) {
        const index = scrollOffset + offset;
        const marker = index === selectedIndex ? '›' : ' ';
        const dirty = hasDirtyProfileFor(item) ? '*' : ' ';
        lines.push(`${marker} ${dirty} ${padToVisibleWidth(item.name, nameWidth - 4)}  ${padToVisibleWidth(rowModelText(item), modelWidth)}  ${padToVisibleWidth(rowEffortText(item), effortWidth)}`);
      }
      return lines;
    }
    const lines = ['agent/phase · model · effort'];
    for (const [offset, item] of visibleRows.entries()) {
      const index = scrollOffset + offset;
      const marker = index === selectedIndex ? '›' : ' ';
      const dirty = hasDirtyProfileFor(item) ? '*' : ' ';
      lines.push(`${marker} ${dirty} ${item.name} · ${rowModelText(item)} · ${rowEffortText(item)}`);
    }
    return lines;
  };

  const renderMain = (width: number): string[] => {
    const dirtyCount = Object.keys(dirtyProfiles).length;
    const body = [
      `target: global · ${pendingLabel(dirtyCount)}`,
      '↑/↓/j/k move · enter/m model · e effort · M/E/r reset · s save · esc/q cancel',
      '',
      ...rowListLines(width),
      '',
      selectedSummaryLine(),
    ];
    return frameModal('Subagent model profiles', body, width);
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
    for (const [index, item] of items.entries()) lines.push(`${index === pickerIndex ? '›' : ' '} ${item}`);
    return frameModal('Choose model provider', lines, width);
  };

  const renderModelPicker = (width: number): string[] => {
    const row = selectedRow();
    const models = selectedProvider ? (availableByProvider[selectedProvider] ?? []) : [];
    const lines = [
      `Select ${selectedProvider ?? ''} model for ${row?.name ?? '(none)'}`,
      `provider: ${selectedProvider ?? '(none)'}`,
      'choose model · enter: select · esc/q: back',
      '',
    ];
    if (!models.length) lines.push('No models available for this provider.');
    for (const [index, model] of models.entries()) lines.push(`${index === pickerIndex ? '›' : ' '} ${model.label} (${model.provider}/${model.id})`);
    return frameModal('Choose model', lines, width);
  };

  const renderEffortPicker = (width: number): string[] => {
    const row = selectedRow();
    const lines = [
      `row: ${row?.name ?? '(none)'}`,
      'choose effort · enter: select · esc/q: back',
      '',
    ];
    const items = ['inherit/reset effort', ...EFFORT_CHOICES.filter((choice): choice is ThinkingEffort => choice !== 'inherit')];
    for (const [index, item] of items.entries()) lines.push(`${index === pickerIndex ? '›' : ' '} ${item}`);
    return frameModal('Choose effort', lines, width);
  };

  const movePicker = (delta: number) => {
    const length = view === 'model-provider'
      ? 1 + providerNames.length
      : view === 'model-model'
        ? (selectedProvider ? (availableByProvider[selectedProvider] ?? []).length : 0)
        : 1 + EFFORT_CHOICES.filter((choice) => choice !== 'inherit').length;
    pickerIndex = Math.min(Math.max(pickerIndex + delta, 0), Math.max(0, length - 1));
  };

  const chooseProvider = () => {
    if (pickerIndex === 0) {
      applyEdit({ reset: 'model' });
      view = 'main';
      return;
    }
    selectedProvider = providerNames[pickerIndex - 1];
    pickerIndex = 0;
    view = 'model-model';
  };

  const chooseModel = () => {
    const model = selectedProvider ? (availableByProvider[selectedProvider] ?? [])[pickerIndex] : undefined;
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
        if (key === 'esc' || key === 'q') view = 'main';
        else if (key === 'up' || key === 'k') movePicker(-1);
        else if (key === 'down' || key === 'j') movePicker(1);
        else if (key === 'home' || key === 'g') pickerIndex = 0;
        else if (key === 'end' || key === 'G') movePicker(Number.MAX_SAFE_INTEGER);
        else if (key === 'enter') {
          if (view === 'model-provider') chooseProvider();
          else if (view === 'model-model') chooseModel();
          else chooseEffort();
        }
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
  return `${row.name} — model ${row.modelLabel}; effort ${row.effortLabel}`;
}

async function getAvailableModels(ctx: any): Promise<any[]> {
  try {
    const available = await ctx?.modelRegistry?.getAvailable?.();
    return Array.isArray(available) ? available : [];
  } catch {
    return [];
  }
}

async function chooseSave(ctx: any, stagedProfiles: SubagentModelProfiles, agentDir?: string): Promise<string> {
  const decision = await ctx.ui.select('Save subagent model profile changes?', ['Save', 'Cancel']);
  const message = commitStagedModelProfiles({ stagedProfiles, save: decision === 'Save', agentDir });
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

  if (hasCustomUi) {
    const result = await ctx.ui.custom(
      (tui: any, _theme: any, _keybindings: any, done: (result: SubagentModelProfilesModalResult) => void) => createSubagentModelProfilesModal({
        rows,
        availableModels,
        tui,
        done,
      }),
      { overlay: true, overlayOptions: { anchor: 'center', width: '90%', maxHeight: '85%', minWidth: 74 } },
    ) as SubagentModelProfilesModalResult | undefined;

    if (result?.action === 'save') {
      const hasDirtyRows = Object.keys(result.dirtyProfiles).length > 0;
      const message = hasDirtyRows
        ? commitStagedModelProfiles({ stagedProfiles: result.dirtyProfiles, save: true, agentDir })
        : buildNoChangesModelProfilesMessage(agentDir);
      ctx.ui.notify?.(message, 'info');
      return message;
    }

    const message = commitStagedModelProfiles({ stagedProfiles: {}, save: false, agentDir });
    ctx.ui.notify?.(message, 'warning');
    return message;
  }

  const rowChoices = rows.map(rowChoice);
  const selectedRowChoice = await ctx.ui.select('Select subagent or SDD phase to configure:', [...rowChoices, 'Cancel']);
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

  return chooseSave(ctx, staged, agentDir);
}
