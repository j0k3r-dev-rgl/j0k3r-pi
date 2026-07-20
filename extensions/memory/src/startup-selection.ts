import type { Db } from './db.js';
import type { MemoryRecord, ResolvedContext } from './types.js';

export const STARTUP_MEMORY_LIMIT = 4;
export const STARTUP_KIND_WEIGHTS = {
  project_profile: 1,
  architectural_decision: 1,
  architecture: 1,
  decision: 1,
  command: 0.75,
  constraint: 0.75,
  workflow: 0.75,
  api: 0.75,
  dependency: 0.75,
  preference: 0.5,
  learning: 0.5,
  note: 0.5,
  progress: 0.25,
  todo: 0.25,
  bug: 0.25,
  session_summary: 0.25,
  prompt: 0.25,
  commit_record: 0.25,
  changelog_entry: 0.25,
  release_record: 0.25,
  discovery_finding: 0.25,
} as const satisfies Readonly<Record<string, number>>;
export const STARTUP_KIND_FACTOR = 0.5;
export const STARTUP_IMPORTANCE_FACTOR = 0.3;
export const STARTUP_STALENESS_DAYS = 30;
export const STARTUP_STALENESS_MAX = 0.3;
export const STARTUP_STALENESS_FACTOR = 0.5;

export interface StartupMemorySelection extends MemoryRecord {
  startup_score: number;
}

function kindWeight(kind: string): number {
  return STARTUP_KIND_WEIGHTS[kind as keyof typeof STARTUP_KIND_WEIGHTS] ?? 0.25;
}

function wholeAgeDays(updatedAt: string, now: Date): number {
  const diffMs = Math.max(0, now.getTime() - new Date(updatedAt).getTime());
  return Math.floor(diffMs / 86_400_000);
}

export function scoreStartupMemory(
  memory: Pick<MemoryRecord, 'kind' | 'importance' | 'updated_at'>,
  now: Date,
): number {
  const normalizedImportance = Math.min(memory.importance ?? 0, 5) / 5;
  const stalenessPenalty = Math.min(wholeAgeDays(memory.updated_at, now) / STARTUP_STALENESS_DAYS, 1) * STARTUP_STALENESS_MAX;
  const score = (kindWeight(memory.kind) * STARTUP_KIND_FACTOR)
    + (normalizedImportance * STARTUP_IMPORTANCE_FACTOR)
    - (stalenessPenalty * STARTUP_STALENESS_FACTOR);
  return Number(score.toFixed(3));
}

export function selectStartupMemories(
  db: Db,
  context: ResolvedContext,
  options: { now?: Date } = {},
): StartupMemorySelection[] {
  const now = options.now ?? new Date();
  const rows = db.prepare(`SELECT * FROM memories
    WHERE status='active'
      AND (
        scope IN ('general','global')
        OR (? = 'project' AND scope='project' AND project_id = ?)
      )`).all(context.scope, context.project_id) as unknown as MemoryRecord[];

  return rows
    .map((row) => ({ ...row, startup_score: scoreStartupMemory(row, now) }))
    .sort((a, b) => {
      if (b.startup_score !== a.startup_score) return b.startup_score - a.startup_score;
      if (b.importance !== a.importance) return b.importance - a.importance;
      const updatedAtCompare = b.updated_at.localeCompare(a.updated_at);
      if (updatedAtCompare !== 0) return updatedAtCompare;
      return a.id.localeCompare(b.id);
    })
    .slice(0, STARTUP_MEMORY_LIMIT);
}
