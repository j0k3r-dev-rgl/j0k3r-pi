import type { Db } from './db.js';
import type { ResolvedContext } from './types.js';
import { addMemory, archiveMemory } from './memory-store.js';
import { generateGenericId } from './ids.js';
import { nowIso } from './utils.js';

export type ConsolidateInput = {
  kind?: string;
  scope?: 'general' | 'project' | 'global';
  dry_run?: boolean;
  limit?: number;
  similarity?: boolean;
  similarity_threshold?: number;
};

function normalizedTitle(row: any): string {
  return String(row.title ?? row.summary ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}
function tokens(row: any): Set<string> {
  const stop = new Set(['the','and','for','with','that','this','should','when','from','into','type','context','details']);
  const words = String(`${row.title ?? ''} ${row.summary ?? ''} ${row.content ?? ''}`).toLowerCase().match(/[a-z0-9_./-]{4,}/g) ?? [];
  return new Set(words.filter((w) => !stop.has(w)));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size || 1;
  return intersection / union;
}
function hasContradictionRisk(rows: any[]): boolean {
  const texts = rows.map((r) => String(`${r.title ?? ''} ${r.summary ?? ''} ${r.content ?? ''}`).toLowerCase());
  return texts.some((a, i) => texts.some((b, j) => {
    if (i === j) return false;
    const negA = /\b(do not|dont|don't|never|avoid|no)\b/.test(a);
    const negB = /\b(do not|dont|don't|never|avoid|no)\b/.test(b);
    if (negA === negB) return false;
    const negText = negA ? a : b;
    const otherText = negA ? b : a;
    return negText.replace(/\b(do not|dont|don't|never|avoid|no)\b/g, '').split(/\s+/).filter((w) => w.length > 4).some((w) => otherText.includes(w));
  }));
}

export function findConsolidationCandidates(db: Db, input: ConsolidateInput, context: ResolvedContext) {
  const where = ['status = ?', 'scope = ?'];
  const args: unknown[] = ['active', input.scope ?? context.scope];
  if ((input.scope ?? context.scope) === 'project') { where.push('project_id = ?'); args.push(context.project_id); }
  if (input.kind) { where.push('kind = ?'); args.push(input.kind); }
  args.push(input.limit ?? 100);
  const rows = db.prepare(`SELECT * FROM memories WHERE ${where.join(' AND ')} ORDER BY kind, title, updated_at DESC LIMIT ?`).all(...args as any[]) as any[];
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const key = `${row.scope}:${row.project_id ?? ''}:${row.kind}:${normalizedTitle(row)}`;
    if (!normalizedTitle(row)) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const skippedContradictions: any[] = [];
  if (input.similarity) {
    const threshold = input.similarity_threshold ?? 0.32;
    const used = new Set<string>();
    for (const row of rows) {
      if (used.has(row.id)) continue;
      const group = [row];
      const rowTokens = tokens(row);
      for (const other of rows) {
        if (other.id === row.id || used.has(other.id) || other.kind !== row.kind || other.scope !== row.scope || other.project_id !== row.project_id) continue;
        if (jaccard(rowTokens, tokens(other)) >= threshold) group.push(other);
      }
      if (group.length > 1) {
        group.forEach((g) => used.add(g.id));
        if (hasContradictionRisk(group)) skippedContradictions.push({ ids: group.map((g) => g.id), reason: 'possible contradiction detected' });
        else groups.set(`similar:${row.id}`, group);
      }
    }
  }
  const candidates = [...groups.values()].filter((g) => g.length > 1).filter((g) => {
    if (hasContradictionRisk(g)) { skippedContradictions.push({ ids: g.map((x) => x.id), reason: 'possible contradiction detected' }); return false; }
    return true;
  }).map((items) => ({
    key: `${items[0].kind}:${normalizedTitle(items[0])}`,
    count: items.length,
    ids: items.map((i) => i.id),
    title: items[0].title,
    kind: items[0].kind,
    scope: items[0].scope,
  }));
  return { candidates, skipped_contradictions: skippedContradictions };
}

export function consolidateMemories(db: Db, input: ConsolidateInput, context: ResolvedContext) {
  const dryRun = input.dry_run ?? true;
  const found = findConsolidationCandidates(db, input, context);
  const candidates = found.candidates;
  const applied: Array<{ consolidated_id: string; archived_ids: string[] }> = [];
  if (!dryRun) {
    for (const candidate of candidates) {
      const rows = candidate.ids.map((id: string) => db.prepare('SELECT * FROM memories WHERE id=?').get(id) as any).filter(Boolean);
      const newest = rows[0];
      const content = [
        `type: ${newest.kind}`,
        'context: consolidated memory created from duplicate active memories.',
        `details: ${rows.map((r) => r.content).join('\n\n---\n\n')}`,
        'implications: prefer this consolidated memory and ignore archived duplicates.',
        'source: session_summary',
      ].join('\n');
      const created = addMemory(db, {
        scope: newest.scope,
        kind: newest.kind,
        title: newest.title,
        summary: newest.summary,
        content,
        tags: JSON.parse(newest.tags || '[]'),
        origin_type: 'session_summary',
        importance: newest.importance,
      }, context).memory;
      const archived: string[] = [];
      for (const row of rows) {
        db.prepare('INSERT INTO memory_links(id,from_memory_id,to_memory_id,relation_type,created_at,metadata_json) VALUES(?,?,?,?,?,?)')
          .run(generateGenericId('link'), created.id, row.id, 'supersedes', nowIso(), JSON.stringify({ reason: 'memory_consolidate' }));
        archiveMemory(db, row.id, context, `consolidated into ${created.id}`);
        archived.push(row.id);
      }
      applied.push({ consolidated_id: created.id, archived_ids: archived });
    }
  }
  return { dry_run: dryRun, candidates, skipped_contradictions: found.skipped_contradictions, applied };
}
