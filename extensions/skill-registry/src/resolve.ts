import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { generateSkillRegistry, type SkillRegistry, type SkillRegistryEntry, type SkillScope } from './registry.js';

export const SDD_PHASES = [
  'explore',
  'proposal',
  'spec',
  'design',
  'task',
  'apply',
  'verify',
  'archive',
] as const;

export type SddPhase = (typeof SDD_PHASES)[number];
export type CacheStatus = 'fresh' | 'stale' | 'missing' | 'invalid' | 'not_checked';

type PathInput = string[];

export type ResolveSkillRegistryQuery = {
  intent?: string;
  paths?: PathInput;
  sdd_phase?: SddPhase;
  include_related?: boolean;
  stale_check?: boolean;
  max_results?: number;
};

export type RegistryStatus = {
  source: 'live';
  cache: CacheStatus;
  live_hash: string;
  cached_hash?: string;
  cache_path: string;
  error?: string;
};

export type ResolveMatchReason = {
  signal: 'path' | 'keyword' | 'sdd_phase' | 'name' | 'category' | 'domain' | 'description' | 'default';
  detail: string;
  weight: number;
};

export type ResolveSkillMatch = {
  name: string;
  path: string;
  scope: SkillScope;
  priority: number;
  score: number;
  reasons: ResolveMatchReason[];
  routing: {
    category: string | null;
    domains: string[];
    triggers: Record<string, unknown>;
    sdd_phases: string[];
    related_skills: string[];
  };
  read_before_acting: string;
};

export type RelatedSkillMatch = Omit<ResolveSkillMatch, 'score' | 'reasons'> & {
  related_from: string[];
  relation_reasons: string[];
};

export type ResolveSkillRegistryResult = {
  query: Required<Pick<ResolveSkillRegistryQuery, 'include_related' | 'stale_check' | 'max_results'>> &
    Pick<ResolveSkillRegistryQuery, 'intent' | 'sdd_phase'> & {
      paths: PathInput;
    };
  registry_status: RegistryStatus;
  matches: ResolveSkillMatch[];
  related_matches: RelatedSkillMatch[];
  warnings: string[];
  guidance: string[];
};

export type CachedRegistryRecord =
  | { status: 'present'; path: string; registry: SkillRegistry }
  | { status: 'missing'; path: string }
  | { status: 'invalid'; path: string; error: string };

const SDD_PHASE_SET = new Set<string>(SDD_PHASES);

function normalizeSlashPath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return normalized
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0))].sort();
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function segmentToRegexSegment(segment: string): string {
  const escaped = segment
    .split('*')
    .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return `^(?:${escaped})$`;
}

function matchSegment(pattern: string, text: string): boolean {
  const regex = new RegExp(segmentToRegexSegment(pattern));
  return regex.test(text);
}

export function matchPathGlob(pattern: string, candidatePath: string): boolean {
  const normalizedPattern = normalizeSlashPath(pattern);
  const normalizedCandidate = normalizeSlashPath(candidatePath);
  const patternSegments = normalizedPattern.split('/').filter((segment) => segment.length > 0);
  const candidateSegments = normalizedCandidate.split('/').filter((segment) => segment.length > 0);
  const memo = new Map<string, boolean>();

  const walk = (pi: number, ci: number): boolean => {
    const memoKey = `${pi}|${ci}`;
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;

    if (pi === patternSegments.length) {
      const result = ci === candidateSegments.length;
      memo.set(memoKey, result);
      return result;
    }

    const patternSegment = patternSegments[pi];
    let result = false;

    if (patternSegment === '**') {
      result = walk(pi + 1, ci);
      if (!result && ci < candidateSegments.length) {
        result = walk(pi, ci + 1);
      }
    } else if (ci < candidateSegments.length && matchSegment(patternSegment, candidateSegments[ci])) {
      result = walk(pi + 1, ci + 1);
    }

    memo.set(memoKey, result);
    return result;
  };

  return walk(0, 0);
}

function normalizeQueryPaths(paths?: string[]): string[] {
  if (!Array.isArray(paths)) return [];
  return uniqueSorted(paths.map((value) => normalizeSlashPath(String(value))));
}

function normalizeQuery(query: ResolveSkillRegistryQuery = {}): {
  intent?: string;
  paths: string[];
  sdd_phase?: SddPhase;
  include_related: boolean;
  stale_check: boolean;
  max_results: number;
} {
  const paths = normalizeQueryPaths(query.paths);
  const trimmedIntent = typeof query.intent === 'string' ? query.intent.trim() : '';
  const intent = trimmedIntent.length > 0 ? trimmedIntent.toLowerCase() : undefined;
  const sdd_phase = query.sdd_phase && SDD_PHASE_SET.has(query.sdd_phase) ? query.sdd_phase : undefined;
  const requestedMaxResults = query.max_results === undefined ? 10 : query.max_results;
  const boundedMaxResults = Math.floor(Number.isFinite(requestedMaxResults) ? (requestedMaxResults as number) : 10);

  return {
    intent,
    paths,
    sdd_phase,
    include_related: query.include_related ?? true,
    stale_check: query.stale_check ?? true,
    max_results: Math.min(50, Math.max(1, boundedMaxResults)),
  };
}

function normalizeRegistryWarnings(warnings: string[] | undefined): string[] {
  return warnings ? uniqueSorted([...warnings]).map((warning) => warning.trim()) : [];
}

export async function readCachedSkillRegistry(options: { cwd?: string }): Promise<CachedRegistryRecord> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const cachePath = path.join(cwd, '.pi', 'skill-registry.json');

  try {
    const raw = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') {
      return { status: 'invalid', path: cachePath, error: 'Cached registry payload is not an object.' };
    }

    const candidate = parsed as { content_hash?: unknown; skills?: unknown; schema_version?: unknown; skill_count?: unknown };
    if (typeof candidate.content_hash !== 'string') {
      return { status: 'invalid', path: cachePath, error: 'Cached registry lacks a content_hash string.' };
    }
    if (typeof candidate.schema_version !== 'number' || !Array.isArray(candidate.skills) || typeof candidate.skill_count !== 'number') {
      return { status: 'invalid', path: cachePath, error: 'Cached registry does not contain expected schema fields.' };
    }

    return { status: 'present', path: cachePath, registry: parsed as SkillRegistry };
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return { status: 'missing', path: cachePath };
    }
    return { status: 'invalid', path: cachePath, error: error instanceof Error ? error.message : String(error) };
  }
}

function scorePathMatches(skill: SkillRegistryEntry, queryPaths: string[]): { score: number; reasons: ResolveMatchReason[] } {
  const triggers = skill.routing.triggers ?? {};
  const pathPatterns = asStringArray(triggers.paths);
  if (pathPatterns.length === 0 || queryPaths.length === 0) {
    return { score: 0, reasons: [] };
  }

  const matchedPairs: Array<{ pattern: string; query: string }> = [];
  for (const queryPath of queryPaths) {
    for (const triggerPath of pathPatterns) {
      if (matchPathGlob(triggerPath, queryPath)) {
        matchedPairs.push({ pattern: triggerPath, query: queryPath });
      }
    }
  }

  if (matchedPairs.length === 0) return { score: 0, reasons: [] };

  const score = Math.min(80 + (matchedPairs.length - 1) * 10, 100);
  const reasons: ResolveMatchReason[] = matchedPairs.map(({ pattern, query }) => ({
    signal: 'path',
    detail: `path trigger "${pattern}" matches query path "${query}"`,
    weight: matchedPairs.length > 1 ? 10 : score,
  }));
  return { score, reasons };
}

function scoreKeywordMatches(skill: SkillRegistryEntry, intent: string | undefined): { score: number; reasons: ResolveMatchReason[] } {
  if (!intent) return { score: 0, reasons: [] };
  const keywords = asStringArray(skill.routing.triggers.keywords);
  if (keywords.length === 0) return { score: 0, reasons: [] };

  const matches = keywords.filter((keyword) => intent.includes(keyword.toLowerCase()));
  if (matches.length === 0) return { score: 0, reasons: [] };

  const unique = uniqueSorted(matches);
  const score = Math.min(60 + Math.max(0, unique.length - 1) * 10, 80);
  const reasons: ResolveMatchReason[] = unique.map((keyword) => ({
    signal: 'keyword',
    detail: `keyword trigger "${keyword}" matches intent`,
    weight: unique.length > 1 ? 10 : score,
  }));
  return { score, reasons };
}

function scorePhaseMatch(skill: SkillRegistryEntry, phase: string | undefined): { score: number; reasons: ResolveMatchReason[] } {
  if (!phase) return { score: 0, reasons: [] };
  if (!skill.routing.sdd_phases.includes(phase)) return { score: 0, reasons: [] };
  return {
    score: 70,
    reasons: [{
      signal: 'sdd_phase',
      detail: `sdd phase "${phase}" is in routing`,
      weight: 70,
    }],
  };
}

function scoreFallbackMatches(skill: SkillRegistryEntry, intent: string | undefined): { score: number; reasons: ResolveMatchReason[] } {
  if (!intent) return { score: 0, reasons: [] };
  const name = skill.name.toLowerCase();
  const title = (skill.title ?? '').toLowerCase();
  const category = (skill.routing.category ?? '').toLowerCase();
  const domains = skill.routing.domains.map((domain) => domain.toLowerCase());
  const description = (skill.description ?? '').toLowerCase();

  const reasons: ResolveMatchReason[] = [];
  let score = 0;

  const nameMatch = name.includes(intent) || (title && title.includes(intent));
  if (nameMatch) {
    score += 25;
    reasons.push({ signal: 'name', detail: 'intent matches skill name/title', weight: 25 });
  }

  const domainMatch = domains.some((domain) => domain.length > 0 && intent.includes(domain));
  if (domainMatch) {
    score += 20;
    reasons.push({ signal: 'domain', detail: 'intent matches skill domain', weight: 20 });
  }
  const categoryMatch = !!category && intent.includes(category);
  if (categoryMatch) {
    score += 20;
    reasons.push({ signal: 'category', detail: 'intent matches skill category', weight: 20 });
  }

  const descriptionMatch = description.includes(intent);
  if (descriptionMatch) {
    score += 10;
    reasons.push({ signal: 'description', detail: 'intent matches skill description', weight: 10 });
  }

  return { score: Math.min(score, 40), reasons };
}

function scoreSkill(skill: SkillRegistryEntry, query: ReturnType<typeof normalizeQuery>): { match: ResolveSkillMatch; totalScore: number } {
  const pathMatch = scorePathMatches(skill, query.paths);
  const keywordMatch = scoreKeywordMatches(skill, query.intent);
  const phaseMatch = scorePhaseMatch(skill, query.sdd_phase);
  const hasDirectSignals = Boolean(pathMatch.score || keywordMatch.score || phaseMatch.score);
  const fallbackMatch = scoreFallbackMatches(skill, query.intent);

  const directScore = pathMatch.score + keywordMatch.score + phaseMatch.score;
  const totalScore = hasDirectSignals ? directScore + fallbackMatch.score : (query.intent ? Math.min(fallbackMatch.score, 40) : 0);

  let reasons: ResolveMatchReason[] = [...pathMatch.reasons, ...keywordMatch.reasons, ...phaseMatch.reasons, ...fallbackMatch.reasons];

  if (!hasDirectSignals && query.intent && totalScore === 0) {
    reasons = [];
  }

  const routing = {
    category: skill.routing.category,
    domains: skill.routing.domains,
    triggers: skill.routing.triggers,
    sdd_phases: skill.routing.sdd_phases,
    related_skills: skill.routing.related_skills,
  };

  return {
    totalScore,
    match: {
      name: skill.name,
      path: skill.path,
      scope: skill.scope,
      priority: skill.routing.priority,
      score: totalScore,
      reasons,
      routing,
      read_before_acting: `Read ${skill.path} before acting.`,
    },
  };
}

function resolveDirectMatches(liveRegistry: SkillRegistry, query: ReturnType<typeof normalizeQuery>): ResolveSkillMatch[] {
  const hasQuerySignals = Boolean(query.intent || query.paths.length || query.sdd_phase);

  const rankedScored = liveRegistry.skills
    .map((skill) => {
      const scored = scoreSkill(skill, query);
      const directSignals = new Set(scored.match.reasons.map((reason) => reason.signal).filter((signal) =>
        signal === 'path' || signal === 'keyword' || signal === 'sdd_phase',
      ));
      return {
        match: scored.match,
        score: scored.totalScore,
        hasDirectSignal: directSignals.size > 0,
        hasPathOrKeywordSignal: directSignals.has('path') || directSignals.has('keyword'),
        hasPhaseOnlySignal: directSignals.size === 1 && directSignals.has('sdd_phase'),
      };
    });
  const hasAnyDirectSignal = rankedScored.some((item) => item.hasDirectSignal);
  const hasAnyPathOrKeywordSignal = rankedScored.some((item) => item.hasPathOrKeywordSignal);
  const filteredScored = rankedScored.filter((item): item is { match: ResolveSkillMatch; score: number; hasDirectSignal: boolean; hasPathOrKeywordSignal: boolean; hasPhaseOnlySignal: boolean } => {
    if (!hasQuerySignals) return true;
    if (hasAnyDirectSignal) {
      if (hasAnyPathOrKeywordSignal && item.hasPhaseOnlySignal) return false;
      return item.hasDirectSignal;
    }
    return item.score > 0;
  });

  return filteredScored
    .map((item) => {
      if (!hasQuerySignals && item.score === 0) {
        return {
          ...item.match,
          score: 0,
          reasons: [
            {
              signal: 'default',
              detail: 'No query signals supplied; returning highest-priority skills.',
              weight: 0,
            } as ResolveMatchReason,
          ],
        };
      }
      return item.match;
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.priority !== left.priority) return right.priority - left.priority;
      return left.name.localeCompare(right.name);
    });
}

function resolveRelated(
  liveRegistry: SkillRegistry,
  directMatches: ResolveSkillMatch[],
  includeRelated: boolean,
): { matches: RelatedSkillMatch[]; warnings: string[] } {
  if (!includeRelated) return { matches: [], warnings: [] };

  const directSet = new Set(directMatches.map((match) => match.name));
  const byName = new Map(liveRegistry.skills.map((skill) => [skill.name, skill] as const));
  const seen = new Set<string>();
  const warnings: string[] = [];
  const related: RelatedSkillMatch[] = [];

  for (const directMatch of directMatches) {
    const relatedSkills = byName.get(directMatch.name)?.routing?.related_skills ?? [];
    for (const relatedName of asStringArray(relatedSkills)) {
      if (directSet.has(relatedName)) continue;
      const relatedSkill = byName.get(relatedName);
      if (!relatedSkill) {
        warnings.push(`Related skill not found: ${relatedName}`);
        continue;
      }
      if (seen.has(relatedSkill.name)) continue;
      seen.add(relatedSkill.name);

      related.push({
        name: relatedSkill.name,
        path: relatedSkill.path,
        scope: relatedSkill.scope,
        priority: relatedSkill.routing.priority,
        routing: {
          category: relatedSkill.routing.category,
          domains: relatedSkill.routing.domains,
          triggers: relatedSkill.routing.triggers,
          sdd_phases: relatedSkill.routing.sdd_phases,
          related_skills: relatedSkill.routing.related_skills,
        },
        read_before_acting: `Read ${relatedSkill.path} before acting.`,
        related_from: [directMatch.name],
        relation_reasons: ['related_skills reference'],
      });
    }
  }

  return { matches: related, warnings };
}

export function getRegistryStatus(
  input: {
    liveRegistry: SkillRegistry;
    cached: CachedRegistryRecord;
    stale_check: boolean;
    cache_path: string;
  },
): { status: RegistryStatus; warnings: string[] } {
  if (!input.stale_check) {
    return {
      status: {
        source: 'live',
        cache: 'not_checked',
        live_hash: input.liveRegistry.content_hash,
        cache_path: input.cache_path,
      },
      warnings: [],
    };
  }

  const warnings: string[] = [];

  if (input.cached.status === 'missing') {
    warnings.push(`Missing ${input.cache_path}. Resolved results from live registry only.`);
    return {
      status: {
        source: 'live',
        cache: 'missing',
        live_hash: input.liveRegistry.content_hash,
        cache_path: input.cache_path,
      },
      warnings,
    };
  }

  if (input.cached.status === 'invalid') {
    warnings.push(`Cannot parse cached skill-registry.json: ${input.cached.error}`);
    return {
      status: {
        source: 'live',
        cache: 'invalid',
        live_hash: input.liveRegistry.content_hash,
        cache_path: input.cache_path,
        error: input.cached.error,
      },
      warnings,
    };
  }

  const cachedHash = input.cached.registry.content_hash;
  if (cachedHash === input.liveRegistry.content_hash) {
    return {
      status: {
        source: 'live',
        cache: 'fresh',
        live_hash: input.liveRegistry.content_hash,
        cached_hash: cachedHash,
        cache_path: input.cache_path,
      },
      warnings: [],
    };
  }

  warnings.push('cached skill-registry.json does not match live content. Consider running skill_registry_generate to refresh.');
  return {
    status: {
      source: 'live',
      cache: 'stale',
      live_hash: input.liveRegistry.content_hash,
      cached_hash: cachedHash,
      cache_path: input.cache_path,
    },
    warnings,
  };
}

export async function resolveSkillRegistry(options: { cwd?: string; homeDir?: string; query?: ResolveSkillRegistryQuery } = {}): Promise<ResolveSkillRegistryResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? homedir());
  const query = normalizeQuery(options.query ?? {});

  const liveRegistry = await generateSkillRegistry({ cwd, homeDir });
  const cachePath = path.join(cwd, '.pi', 'skill-registry.json');
  const cached = query.stale_check ? await readCachedSkillRegistry({ cwd }) : { status: 'missing' as const, path: cachePath };

  const { status: registryStatus, warnings: staleWarnings } = getRegistryStatus({
    liveRegistry,
    cached,
    stale_check: query.stale_check,
    cache_path: cachePath,
  });

  const directMatches = resolveDirectMatches(liveRegistry, query).slice(0, query.max_results);
  const { matches: relatedMatches, warnings: relatedWarnings } = resolveRelated(liveRegistry, directMatches, query.include_related);

  const warnings = uniqueSorted([
    ...normalizeRegistryWarnings(liveRegistry.warnings),
    ...staleWarnings,
    ...relatedWarnings,
  ]);

  const guidance = [
    `Registry resolved from live sources (source: ${registryStatus.source}) with cache status ${registryStatus.cache}.`,
    'Read each returned SKILL.md path before applying skill instructions.',
    directMatches.length > 0
      ? `Use ${directMatches[0].name} as the primary skill. Consider at most ${Math.min(2, Math.max(0, directMatches.length - 1))} additional direct matches as secondary context.`
      : 'No direct skill matched; refine intent or paths before loading additional skills.',
    `Matched ${directMatches.length} direct skill(s), ${relatedMatches.length} related skill(s).`,
  ];

  return {
    query: {
      intent: query.intent,
      sdd_phase: query.sdd_phase,
      include_related: query.include_related,
      stale_check: query.stale_check,
      max_results: query.max_results,
      paths: query.paths,
    },
    registry_status: registryStatus,
    matches: directMatches,
    related_matches: relatedMatches,
    warnings,
    guidance,
  };
}
