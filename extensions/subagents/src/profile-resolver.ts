import type { EffectiveSubagentProfile, ModelRef, ProfileValueSource, ResolvedProfileField, SubagentDefinition, SubagentsConfig, ThinkingEffort } from './types.js';

function modelLabel(model: ModelRef): string {
  return `${model.provider}/${model.id}`;
}

function effortFromCtx(ctx: any): ThinkingEffort | undefined {
  const effort = ctx?.pi?.getThinkingLevel?.() ?? ctx?.getThinkingLevel?.() ?? ctx?.thinkingLevel;
  return typeof effort === 'string' ? effort as ThinkingEffort : undefined;
}

function modelFromCtx(ctx: any): ModelRef | undefined {
  const model = ctx?.model;
  if (!model || typeof model !== 'object') return undefined;
  const provider = typeof model.provider === 'string' ? model.provider : undefined;
  const id = typeof model.id === 'string' ? model.id : typeof model.name === 'string' ? model.name : undefined;
  return provider && id ? { provider, id } : undefined;
}

export function profileSourceLabel<T>(source: ProfileValueSource, value: T | undefined, format: (value: T) => string): string {
  return value === undefined ? 'unresolved' : `${source}: ${format(value)}`;
}

function field<T>(source: ProfileValueSource, value: T | undefined, format: (value: T) => string): ResolvedProfileField<T> {
  return { value, source, label: profileSourceLabel(source, value, format) };
}

function resolveModel(definition: SubagentDefinition, config: SubagentsConfig, ctx: any): ResolvedProfileField<ModelRef> {
  const profile = config.model_profiles[definition.name];
  if (profile?.model) return field('profile', profile.model, modelLabel);
  if (definition.model) return field('definition', definition.model, modelLabel);
  if (config.default_model) return field('default', config.default_model, modelLabel);
  const orchestratorModel = modelFromCtx(ctx);
  if (orchestratorModel) return field('orchestrator', orchestratorModel, modelLabel);
  return field('unresolved', undefined, modelLabel);
}

function resolveEffort(definition: SubagentDefinition, config: SubagentsConfig, ctx: any): ResolvedProfileField<ThinkingEffort> {
  const profile = config.model_profiles[definition.name];
  if (profile?.effort) return field('profile', profile.effort, String);
  if (definition.effort) return field('definition', definition.effort, String);
  if (config.default_effort) return field('default', config.default_effort, String);
  const orchestratorEffort = effortFromCtx(ctx);
  if (orchestratorEffort) return field('orchestrator', orchestratorEffort, String);
  return field('unresolved', undefined, String);
}

export function resolveEffectiveSubagentProfile(input: {
  agentName: string;
  definition: SubagentDefinition;
  config: SubagentsConfig;
  ctx: any;
}): EffectiveSubagentProfile {
  const definition = { ...input.definition, name: input.agentName.toLowerCase() };
  return {
    agent: definition.name,
    model: resolveModel(definition, input.config, input.ctx),
    effort: resolveEffort(definition, input.config, input.ctx),
  };
}
