import type { Db } from './db.js';
import type { ResolvedContext } from './types.js';

export function getSyncStatus(db: Db, context: ResolvedContext) {
  const where = context.scope === 'project' ? 'WHERE scope != \'project\' OR project_id = ?' : '';
  const args = context.scope === 'project' ? [context.project_id] : [];
  const memoryRows = db.prepare(`SELECT sync_status, COUNT(*) AS count FROM memories ${where} GROUP BY sync_status`).all(...args as any[]) as any[];
  const sessionRows = db.prepare(`SELECT sync_status, COUNT(*) AS count FROM memory_sessions ${where} GROUP BY sync_status`).all(...args as any[]) as any[];
  const promptRows = db.prepare(`SELECT p.sync_status, COUNT(*) AS count FROM memory_session_prompts p JOIN memory_sessions s ON s.id=p.session_id ${context.scope === 'project' ? 'WHERE s.scope != \'project\' OR s.project_id = ?' : ''} GROUP BY p.sync_status`).all(...args as any[]) as any[];
  return {
    context: { scope: context.scope, project_id: context.project_id, project_name: context.project_name },
    memories: Object.fromEntries(memoryRows.map((r) => [r.sync_status, r.count])),
    sessions: Object.fromEntries(sessionRows.map((r) => [r.sync_status, r.count])),
    prompts: Object.fromEntries(promptRows.map((r) => [r.sync_status, r.count])),
    has_pending: [...memoryRows, ...sessionRows, ...promptRows].some((r) => r.sync_status === 'pending' && r.count > 0),
    has_conflicts: [...memoryRows, ...sessionRows, ...promptRows].some((r) => r.sync_status === 'conflict' && r.count > 0),
  };
}
