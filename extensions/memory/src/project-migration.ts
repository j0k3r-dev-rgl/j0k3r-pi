import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Db } from './db.js';
import { parseGitRemote } from './context.js';
import type { ResolvedContext } from './types.js';
import { nowIso, slug } from './utils.js';

type ProjectAlias = { project_id?: string | null; project_name?: string | null; source?: string };

export type ProjectMigrationInput = {
  aliases?: ProjectAlias[];
  dry_run?: boolean;
};

function runGit(args: string[], cwd: string): string | undefined {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return undefined; }
}

export function discoverProjectAliases(context: ResolvedContext): ProjectAlias[] {
  if (context.scope !== 'project') return [];
  const aliases: ProjectAlias[] = [];
  const add = (alias: ProjectAlias) => {
    if (!alias.project_id && !alias.project_name) return;
    if (alias.project_id === context.project_id && alias.project_name === context.project_name) return;
    if (aliases.some((a) => a.project_id === alias.project_id && a.project_name === alias.project_name)) return;
    aliases.push(alias);
  };

  const cwdName = path.basename(context.cwd);
  add({ project_id: `project:${slug(cwdName)}`, project_name: cwdName, source: 'folder' });

  const gitRoot = context.git_root ?? runGit(['rev-parse', '--show-toplevel'], context.cwd);
  if (gitRoot) {
    const rootName = path.basename(gitRoot);
    add({ project_id: `project:${slug(rootName)}`, project_name: rootName, source: 'git_root' });
    const remote = runGit(['config', '--get', 'remote.origin.url'], gitRoot);
    if (remote) {
      const parsed = parseGitRemote(remote);
      if (parsed) add({ project_id: parsed.projectId, project_name: parsed.projectName, source: 'git_remote' });
    }
  }

  for (const alias of context.config?.aliases ?? []) {
    add({ project_id: `project:${slug(alias)}`, project_name: alias, source: 'memory_json_alias' });
  }
  return aliases;
}

function aliasWhere(aliases: ProjectAlias[]): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  const seen = new Set<string>();
  for (const alias of aliases) {
    const key = `${alias.project_id ?? ''}\u0000${alias.project_name ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (alias.project_id && alias.project_name) {
      parts.push('(project_id = ? AND project_name = ?)');
      args.push(alias.project_id, alias.project_name);
    } else if (alias.project_id) {
      parts.push('project_id = ?');
      args.push(alias.project_id);
    } else if (alias.project_name) {
      parts.push('project_name = ?');
      args.push(alias.project_name);
    }
  }
  return { sql: parts.length ? `(${parts.join(' OR ')})` : '(1=0)', args };
}

export function migrateProjectCanonicals(db: Db, context: ResolvedContext, input: ProjectMigrationInput = {}) {
  if (context.scope !== 'project' || !context.project_id || !context.project_name) throw new Error('project canonical migration requires project context.');
  const aliases = input.aliases?.length ? input.aliases : discoverProjectAliases(context);
  const filtered = aliases.filter((a) => (a.project_id && a.project_id !== context.project_id) || (a.project_name && a.project_name !== context.project_name));
  const where = aliasWhere(filtered);
  const memRows = db.prepare(`SELECT id, project_id, project_name FROM memories WHERE scope='project' AND ${where.sql} AND NOT (project_id=? AND project_name=?)`).all(...where.args as any[], context.project_id, context.project_name) as any[];
  const sessionRows = db.prepare(`SELECT id, project_id, project_name FROM memory_sessions WHERE scope='project' AND ${where.sql} AND NOT (project_id=? AND project_name=?)`).all(...where.args as any[], context.project_id, context.project_name) as any[];
  const dryRun = input.dry_run ?? true;
  const now = nowIso();

  if (!dryRun) {
    db.prepare(`UPDATE memories SET project_id=?, project_name=?, updated_at=?, version=version+1 WHERE id IN (${memRows.map(() => '?').join(',') || 'NULL'})`)
      .run(context.project_id, context.project_name, now, ...memRows.map((r) => r.id) as any[]);
    db.prepare(`UPDATE memory_sessions SET project_id=?, project_name=? WHERE id IN (${sessionRows.map(() => '?').join(',') || 'NULL'})`)
      .run(context.project_id, context.project_name, ...sessionRows.map((r) => r.id) as any[]);
  }

  return {
    dry_run: dryRun,
    canonical: { project_id: context.project_id, project_name: context.project_name, source: context.source },
    aliases: filtered,
    memories_to_update: memRows.length,
    sessions_to_update: sessionRows.length,
    updated_memories: dryRun ? 0 : memRows.length,
    updated_sessions: dryRun ? 0 : sessionRows.length,
    memory_ids: memRows.map((r) => r.id),
    session_ids: sessionRows.map((r) => r.id),
  };
}
