import type { Db } from './db.js';
import { fts5Available } from './db.js';
import { resolveDbPath } from './config.js';
import { resolveMemoryContext } from './context.js';
import { searchMemory } from './search.js';
import { listMemories } from './memory-store.js';
import { resolveCloudRuntime } from './cloud.js';
import { openMemoryBrowser } from './memory-browser.js';
import { getSyncStatus } from './sync-status.js';
import { consolidateMemories } from './consolidation.js';
import { ensureProjectProfile } from './project-profile.js';

export function registerMemoryCommands(pi: any, db: Db): void {
  pi.registerCommand('memory-status', { description: 'Show memory extension status', handler: async (_args: string, ctx: any) => { const context = resolveMemoryContext(ctx.cwd ?? process.cwd()); const cloud = resolveCloudRuntime(context); ctx.ui.notify(`Memory DB: ${resolveDbPath()} | context: ${context.scope}${context.project_name ? `/${context.project_name}` : ''} | cloud: ${cloud.enabled ? (cloud.ready ? 'ready' : 'not ready') : 'off'}`, 'info'); } });
  pi.registerCommand('memory-context', { description: 'Show resolved memory context', handler: async (_args: string, ctx: any) => { const c = resolveMemoryContext(ctx.cwd ?? process.cwd()); ctx.ui.notify(JSON.stringify({ scope: c.scope, project_id: c.project_id, project_name: c.project_name, source: c.source, warnings: c.warnings }, null, 2), 'info'); } });
  pi.registerCommand('memory-search', { description: 'Search local memory: /memory-search <query>', handler: async (args: string, ctx: any) => { const c = resolveMemoryContext(ctx.cwd ?? process.cwd()); const r = searchMemory(db, { query: args || 'project', limit: 10 }, c); ctx.ui.notify(r.results.map((x: any) => `${x.id}: ${x.title ?? x.snippet}`).join('\n') || 'No results', 'info'); } });
  pi.registerCommand('memory-list', { description: 'List recent memories', handler: async (_args: string, ctx: any) => { const c = resolveMemoryContext(ctx.cwd ?? process.cwd()); const rows = listMemories(db, { limit: 20 }, c); ctx.ui.notify(rows.map((x) => `${x.id}: ${x.title}`).join('\n') || 'No memories', 'info'); } });
  pi.registerCommand('memory-doctor', { description: 'Diagnose memory extension', handler: async (_args: string, ctx: any) => { const c = resolveMemoryContext(ctx.cwd ?? process.cwd()); const cloud = resolveCloudRuntime(c); const checks = [`db_path=${resolveDbPath()}`, `fts5=${fts5Available(db) ? 'ok' : 'missing'}`, `context=${c.scope}${c.project_name ? `/${c.project_name}` : ''}`, `cloud=${cloud.enabled ? (cloud.ready ? 'ready' : 'not-ready') : 'off'}`, ...c.warnings, ...cloud.warnings]; ctx.ui.notify(checks.join('\n'), cloud.warnings.length ? 'warning' : 'info'); } });
  pi.registerCommand('memory-sync-status', { description: 'Show memory sync-aware status counts', handler: async (_args: string, ctx: any) => { const c = resolveMemoryContext(ctx.cwd ?? process.cwd()); ctx.ui.notify(JSON.stringify(getSyncStatus(db, c), null, 2), 'info'); } });
  pi.registerCommand('memory-consolidate', { description: 'Find duplicate memories: /memory-consolidate [kind]', handler: async (args: string, ctx: any) => { const c = resolveMemoryContext(ctx.cwd ?? process.cwd()); const result = consolidateMemories(db, { kind: args?.trim() || undefined, dry_run: true }, c); ctx.ui.notify(JSON.stringify(result.candidates, null, 2) || 'No duplicate candidates', 'info'); } });
  pi.registerCommand('memory-project-profile', { description: 'Ensure and show current project profile', handler: async (_args: string, ctx: any) => { const c = resolveMemoryContext(ctx.cwd ?? process.cwd()); const result = ensureProjectProfile(db, c); ctx.ui.notify(result.profile ? `${result.created ? 'created' : 'loaded'}: ${result.profile.id}\n${result.profile.summary}` : 'No project context', 'info'); } });
  pi.registerCommand('memory-browser', { description: 'Open interactive memory browser with nvim-style navigation', handler: async (_args: string, ctx: any) => { const c = resolveMemoryContext(ctx.cwd ?? process.cwd()); await openMemoryBrowser(db, ctx, c); } });
}
