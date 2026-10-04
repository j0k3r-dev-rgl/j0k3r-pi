import { resetSubagentModelProfileField, saveSubagentModelProfile } from '../config.js';
import type { ModelRef, SubagentDefinitionScope, SubagentModelProfile, SubagentModelProfiles, ThinkingEffort } from '../types.js';
import { globalSubagentsConfigPath, projectSubagentsConfigPath } from './data.js';

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

export function commitStagedModelProfiles(input: { stagedProfiles: SubagentModelProfiles; save: boolean; agentDir?: string; cwd?: string; profileScopes?: Record<string, SubagentDefinitionScope> }): string {
  const globalPath = globalSubagentsConfigPath(input.agentDir);
  const projectPath = input.cwd ? projectSubagentsConfigPath(input.cwd) : undefined;
  if (!input.save) return `Cancelled. No changes written to ${globalPath}.`;
  const touched = new Set<string>();
  for (const [agentName, profile] of Object.entries(input.stagedProfiles)) {
    const scope = input.profileScopes?.[agentName.trim().toLowerCase()] ?? 'global';
    const target = scope === 'project' && input.cwd ? projectPath! : globalPath;
    touched.add(target);
    if (profile.model || profile.effort) saveSubagentModelProfile({ agentName, profile, scope, cwd: input.cwd, agentDir: input.agentDir });
    else {
      resetSubagentModelProfileField({ agentName, field: 'model', scope, cwd: input.cwd, agentDir: input.agentDir });
      resetSubagentModelProfileField({ agentName, field: 'effort', scope, cwd: input.cwd, agentDir: input.agentDir });
    }
  }
  const targets = [...touched];
  return targets.length > 1
    ? `Saved subagent model profiles to ${targets.join(' and ')}.`
    : `Saved subagent model profiles to ${targets[0] ?? globalPath}.`;
}
