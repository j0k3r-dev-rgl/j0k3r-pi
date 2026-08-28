import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveActiveWorkflows, syncActiveWorkflows } from './state.js';

export async function validateWorkflows(cwd: string, options: { slug?: string; repairDerivedJson?: boolean } = {}) {
  const derived = options.repairDerivedJson ? await syncActiveWorkflows(cwd, { slug: options.slug }) : { ...(await deriveActiveWorkflows(cwd)), regenerated_files: [] };
  const states = options.slug ? derived.states.filter((state) => state.slug === options.slug) : derived.states;
  const violations = states.flatMap((state) => state.blockers.map((blocker) => `${state.slug}: ${blocker}`));
  const conflicts = states.filter((state) => state.freshness === 'CONFLICT').map((state) => state.slug);
  const stale_files: string[] = [];
  if (!options.repairDerivedJson) {
    for (const state of states) {
      try { await access(join(cwd, 'openspec', 'changes', state.slug, 'workflow.json')); }
      catch { stale_files.push(`openspec/changes/${state.slug}/workflow.json`); }
    }
    try { await access(join(cwd, 'openspec', 'workflows.json')); }
    catch { stale_files.push('openspec/workflows.json'); }
  }
  return { pass: violations.length === 0 && conflicts.length === 0, states, index: derived.index, violations, conflicts, stale_files, regenerated_files: derived.regenerated_files };
}
