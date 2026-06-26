import type { Db } from './db.js';
import { fts5Available } from './db.js';
import { resolveBackupPath, resolveDbPath } from './config.js';
import { resolveMemoryContext } from './context.js';
import { searchMemory } from './search.js';
import { listMemories } from './memory-store.js';
import { resolveCloudRuntime } from './cloud.js';
import { openMemoryBrowser } from './memory-browser.js';
import { getSyncStatus } from './sync-status.js';
import { consolidateMemories } from './consolidation.js';
import { ensureProjectProfile } from './project-profile.js';
import { exportMemory, importMemory } from './export-import.js';

type MemoryImportMode = 'merge' | 'dry_run';
type MemoryImportConflictPolicy = 'keep_local' | 'keep_imported' | 'mark_conflict';
type MemoryExportFormat = 'jsonl' | 'sqlite';
type MemoryExportMode = 'mirror' | 'merge';

const IMPORT_USAGE = 'Usage: /memory-import [merge|dry_run] [keep_local|keep_imported|mark_conflict]. Unknown options show usage.';
const EXPORT_USAGE = 'Usage: /memory-export [jsonl|sqlite] [mirror|merge] [sessions] [active-only]. sqlite mode is reserved and will fail until implemented.';

function parseBooleanInput(value: string): boolean | undefined {
  if (value === 'true' || value === '1' || value === 'yes' || value === 'on') return true;
  if (value === 'false' || value === '0' || value === 'no' || value === 'off') return false;
  return undefined;
}

function parseImportArgs(raw: string): { mode?: MemoryImportMode; on_conflict?: MemoryImportConflictPolicy; showUsage?: boolean } {
  const args = (raw ?? '').trim().split(/\s+/).filter(Boolean);
  const isHelp = args.some((arg) => ['--help', '-h', 'help', '?'].includes(arg.toLowerCase()));
  if (isHelp) return { showUsage: true };

  let mode: MemoryImportMode | undefined;
  let on_conflict: MemoryImportConflictPolicy | undefined;

  for (const token of args) {
    const arg = token.toLowerCase();
    if (arg === 'merge' || arg === 'dry_run') {
      mode = arg;
      continue;
    }
    if (arg.startsWith('mode=')) {
      const value = arg.slice(5);
      if (value === 'merge' || value === 'dry_run') {
        mode = value;
        continue;
      }
      throw new Error(`Invalid mode: ${value}. Use merge|dry_run.`);
    }
    if (arg === 'keep_local' || arg === 'keep_imported' || arg === 'mark_conflict') {
      on_conflict = arg;
      continue;
    }
    if (arg.startsWith('on_conflict=')) {
      const value = arg.slice(11);
      if (value === 'keep_local' || value === 'keep_imported' || value === 'mark_conflict') {
        on_conflict = value;
        continue;
      }
      throw new Error(`Invalid on_conflict: ${value}. Use keep_local|keep_imported|mark_conflict.`);
    }
    if (arg) throw new Error(`Unknown /memory-import option: ${arg}`);
  }

  return { mode, on_conflict };
}

function parseExportArgs(raw: string): { format?: MemoryExportFormat; mode?: MemoryExportMode; include_sessions?: boolean; include_archived?: boolean; showUsage?: boolean } {
  const args = (raw ?? '').trim().split(/\s+/).filter(Boolean);
  const isHelp = args.some((arg) => ['--help', '-h', 'help', '?'].includes(arg.toLowerCase()));
  if (isHelp) return { showUsage: true };

  let format: MemoryExportFormat | undefined;
  let mode: MemoryExportMode | undefined;
  let include_sessions: boolean | undefined;
  let include_archived: boolean | undefined;

  for (const token of args) {
    const arg = token.toLowerCase();
    if (arg === 'jsonl' || arg === 'sqlite') {
      format = arg;
      continue;
    }
    if (arg === 'mirror' || arg === 'merge') {
      mode = arg;
      continue;
    }
    if (arg === 'sessions') {
      include_sessions = true;
      continue;
    }
    if (arg === 'active-only' || arg === 'active') {
      include_archived = false;
      continue;
    }
    if (arg.startsWith('format=')) {
      const value = arg.slice(7);
      if (value === 'jsonl' || value === 'sqlite') {
        format = value;
        continue;
      }
      throw new Error(`Invalid format: ${value}. Use jsonl.`);
    }
    if (arg.startsWith('mode=')) {
      const value = arg.slice(5);
      if (value === 'mirror' || value === 'merge') {
        mode = value;
        continue;
      }
      throw new Error(`Invalid export mode: ${value}. Use mirror|merge.`);
    }
    if (arg.startsWith('include_sessions=')) {
      const value = parseBooleanInput(arg.slice(16));
      if (typeof value === 'boolean') {
        include_sessions = value;
        continue;
      }
      throw new Error(`Invalid include_sessions value: ${arg.slice(16)}.`);
    }
    if (arg.startsWith('include_archived=')) {
      const value = parseBooleanInput(arg.slice(16));
      if (typeof value === 'boolean') {
        include_archived = value;
        continue;
      }
      throw new Error(`Invalid include_archived value: ${arg.slice(16)}.`);
    }
    if (arg) throw new Error(`Unknown /memory-export option: ${arg}`);
  }

  return { format, mode, include_sessions, include_archived };
}

function withWarnings(message: string, warnings: string[]): string {
  if (!warnings.length) return message;
  return `${message}\nWarnings:\n${warnings.map((warning) => `- ${warning}`).join('\n')}`;
}

export function registerMemoryCommands(pi: any, db: Db): void {
  pi.registerCommand('memory-status', {
    description: 'Show memory extension status',
    handler: async (_args: string, ctx: any) => {
      const context = resolveMemoryContext(ctx.cwd ?? process.cwd());
      const cloud = resolveCloudRuntime(context);
      ctx.ui.notify(`Memory DB: ${resolveDbPath()} | context: ${context.scope}${context.project_name ? `/${context.project_name}` : ''} | cloud: ${cloud.enabled ? (cloud.ready ? 'ready' : 'not ready') : 'off'}`, 'info');
    },
  });
  pi.registerCommand('memory-context', {
    description: 'Show resolved memory context',
    handler: async (_args: string, ctx: any) => {
      const c = resolveMemoryContext(ctx.cwd ?? process.cwd());
      ctx.ui.notify(JSON.stringify({ scope: c.scope, project_id: c.project_id, project_name: c.project_name, source: c.source, warnings: c.warnings }, null, 2), 'info');
    },
  });
  pi.registerCommand('memory-search', {
    description: 'Search local memory: /memory-search <query>',
    handler: async (args: string, ctx: any) => {
      const c = resolveMemoryContext(ctx.cwd ?? process.cwd());
      const r = searchMemory(db, { query: args || 'project', limit: 10 }, c);
      ctx.ui.notify(r.results.map((x: any) => `${x.id}: ${x.title ?? x.snippet}`).join('\n') || 'No results', 'info');
    },
  });
  pi.registerCommand('memory-list', {
    description: 'List recent memories',
    handler: async (_args: string, ctx: any) => {
      const c = resolveMemoryContext(ctx.cwd ?? process.cwd());
      const rows = listMemories(db, { limit: 20 }, c);
      ctx.ui.notify(rows.map((x) => `${x.id}: ${x.title}`).join('\n') || 'No memories', 'info');
    },
  });
  pi.registerCommand('memory-doctor', {
    description: 'Diagnose memory extension',
    handler: async (_args: string, ctx: any) => {
      const c = resolveMemoryContext(ctx.cwd ?? process.cwd());
      const cloud = resolveCloudRuntime(c);
      const checks = [`db_path=${resolveDbPath()}`, `fts5=${fts5Available(db) ? 'ok' : 'missing'}`, `context=${c.scope}${c.project_name ? `/${c.project_name}` : ''}`, `cloud=${cloud.enabled ? (cloud.ready ? 'ready' : 'not-ready') : 'off'}`, ...c.warnings, ...cloud.warnings];
      ctx.ui.notify(checks.join('\n'), cloud.warnings.length ? 'warning' : 'info');
    },
  });
  pi.registerCommand('memory-sync-status', {
    description: 'Show memory sync-aware status counts',
    handler: async (_args: string, ctx: any) => {
      const c = resolveMemoryContext(ctx.cwd ?? process.cwd());
      ctx.ui.notify(JSON.stringify(getSyncStatus(db, c), null, 2), 'info');
    },
  });
  pi.registerCommand('memory-consolidate', {
    description: 'Find duplicate memories: /memory-consolidate [kind]',
    handler: async (args: string, ctx: any) => {
      const c = resolveMemoryContext(ctx.cwd ?? process.cwd());
      const result = consolidateMemories(db, { kind: args?.trim() || undefined, dry_run: true }, c);
      ctx.ui.notify(JSON.stringify(result.candidates, null, 2) || 'No duplicate candidates', 'info');
    },
  });
  pi.registerCommand('memory-project-profile', {
    description: 'Ensure and show current project profile',
    handler: async (_args: string, ctx: any) => {
      const c = resolveMemoryContext(ctx.cwd ?? process.cwd());
      const result = ensureProjectProfile(db, c);
      ctx.ui.notify(result.profile ? `${result.created ? 'created' : 'loaded'}: ${result.profile.id}\n${result.profile.summary}` : 'No project context', 'info');
    },
  });
  pi.registerCommand('memory-browser', {
    description: 'Open interactive memory browser with nvim-style navigation',
    handler: async (_args: string, ctx: any) => {
      const c = resolveMemoryContext(ctx.cwd ?? process.cwd());
      await openMemoryBrowser(db, ctx, c);
    },
  });
  pi.registerCommand('memory-export', {
    description: 'Export local memory backup',
    handler: async (args: string, ctx: any) => {
      try {
        const context = resolveMemoryContext(ctx.cwd ?? process.cwd());
        const parsed = parseExportArgs(args);
        if (parsed.showUsage) {
          ctx.ui.notify(EXPORT_USAGE, 'info');
          return;
        }
        if (parsed.format === 'sqlite') {
          ctx.ui.notify('SQLite export is reserved for future implementation; use jsonl.', 'warning');
          return;
        }
        const includeSessions = parsed.include_sessions ?? context.config?.backups?.include_sessions;
        const mode = parsed.mode ?? context.config?.backups?.mode ?? 'mirror';
        const result = exportMemory(db, {
          format: parsed.format,
          mode,
          include_archived: parsed.include_archived,
          include_sessions: includeSessions,
          context,
          path: resolveBackupPath(context.cwd, context.config?.backups?.path),
        });
        ctx.ui.notify(withWarnings(`Memory backup exported to ${result.path} (${result.rows} rows, mode=${result.mode}).`, context.warnings), 'info');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`memory-export failed: ${message}`, 'error');
      }
    },
  });
  pi.registerCommand('memory-import', {
    description: 'Import local memory backup',
    handler: async (args: string, ctx: any) => {
      try {
        const context = resolveMemoryContext(ctx.cwd ?? process.cwd());
        const parsed = parseImportArgs(args);
        if (parsed.showUsage) {
          ctx.ui.notify(IMPORT_USAGE, 'info');
          return;
        }
        const mode = parsed.mode ?? context.config?.import?.mode ?? 'dry_run';
        const on_conflict = parsed.on_conflict ?? context.config?.import?.on_conflict ?? 'mark_conflict';
        const result = importMemory(db, {
          path: resolveBackupPath(context.cwd, context.config?.backups?.path),
          mode,
          on_conflict,
          include_git: context.config?.git?.enabled === true && context.config.git.sync?.import === true,
        });
        const verb = result.mode === 'merge' ? 'merged' : 'validated';
        ctx.ui.notify(withWarnings(`Memory import ${verb}: inserted=${result.inserted}, would_insert=${result.would_insert}, conflicts=${result.conflicts}, skipped_git=${result.skipped_git}.`, context.warnings), 'info');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`memory-import failed: ${message}`, 'error');
      }
    },
  });
}
