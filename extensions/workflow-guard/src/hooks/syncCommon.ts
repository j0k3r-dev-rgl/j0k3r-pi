import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { syncActiveWorkflows } from '../core/state.js';

export async function hasOpenSpecChanges(cwd: string): Promise<boolean> {
  try { await access(join(cwd, 'openspec', 'changes')); return true; }
  catch { return false; }
}

export async function quietSync(ctx: { cwd: string; ui?: { notify?: (message: string, level?: string) => void } }): Promise<void> {
  if (!(await hasOpenSpecChanges(ctx.cwd))) return;
  const result = await syncActiveWorkflows(ctx.cwd);
  const important = result.states.filter((state) => state.freshness === 'CONFLICT' || state.blockers.length > 0);
  if (important.length > 0) ctx.ui?.notify?.(`workflow-guard: ${important.length} active change(s) have blockers or conflicts.`, 'warning');
}
