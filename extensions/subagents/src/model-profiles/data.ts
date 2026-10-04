import os from 'node:os';
import path from 'node:path';
import { resolveEffectiveSubagentProfile } from '../profile-resolver.js';
import type { ModelRef, SubagentDefinition, SubagentDefinitionScope, SubagentModelProfile, SubagentsConfig, ThinkingEffort } from '../types.js';

export const KNOWN_SDD_PHASES: readonly string[] = [];

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
  scope?: SubagentDefinitionScope;
};

export function globalSubagentsConfigPath(agentDir = path.join(os.homedir(), '.pi', 'agent')): string {
  return path.join(agentDir, 'subagents.json');
}

export function projectSubagentsConfigPath(cwd: string): string {
  return path.join(cwd, '.pi', 'subagents.json');
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

export function buildModelProfileRows(input: {
  definitions: SubagentDefinition[];
  config: SubagentsConfig;
  ctx: any;
  availableModels?: any[];
}): ModelProfileRow[] {
  const byName = new Map<string, SubagentDefinition>();
  for (const definition of input.definitions) byName.set(definition.name, definition);
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
        explicitProfile: { ...((definition.scope === 'project' ? input.config.project_model_profiles?.[definition.name] : input.config.global_model_profiles?.[definition.name]) ?? {}) },
        scope: definition.scope ?? 'global',
      };
    });
}
