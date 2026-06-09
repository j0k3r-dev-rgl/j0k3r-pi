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
  if (!ctx?.ui?.select) return buildNonTuiModelProfilesMessage(agentDir);

  const cwd = ctx.cwd ?? process.cwd();
  const definitions = loadSubagents(cwd);
  const config = readSubagentsConfig(cwd);
  const availableModels = await getAvailableModels(ctx);
  const rows = buildModelProfileRows({ definitions, config, ctx, availableModels });
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
