import type { LibraryCandidate } from './types.js';

const MIN_SELECTION_SCORE = 45;
const MIN_SELECTION_MARGIN = 12;

export interface ResolveLibraryInput {
  libraryName: string;
  query: string;
  version?: string;
  candidates: LibraryCandidate[];
}

export interface ScoredLibraryCandidate {
  candidate: LibraryCandidate;
  score: number;
  exactName: boolean;
  exactId: boolean;
  versionMatch: boolean;
  rationale: string[];
}

export type ResolveLibraryResult =
  | { status: 'no_results'; candidates: []; rationale: string }
  | { status: 'ambiguous'; candidates: ScoredLibraryCandidate[]; rationale: string }
  | { status: 'selected'; selected: LibraryCandidate; score: number; candidates: ScoredLibraryCandidate[]; rationale: string };

function normalizeName(value: string | undefined): string {
  if (!value) return '';
  let normalized = value.trim().toLowerCase();
  normalized = normalized.replace(/^npm:/, '');
  if (!normalized.startsWith('@')) normalized = normalized.replace(/@[^/]+$/, '');
  return normalized;
}

function idSegments(id: string | undefined): string[] {
  return (id ?? '').split('/').filter(Boolean).map(normalizeName);
}

function clampNumber(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0;
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeName(text).split(/[^a-z0-9@.]+/).filter((token) => token.length >= 3));
}

function scoreCandidate(input: ResolveLibraryInput, candidate: LibraryCandidate): ScoredLibraryCandidate {
  const requested = normalizeName(input.libraryName);
  const candidateName = normalizeName(candidate.name);
  const segments = idSegments(candidate.id);
  const finalSegment = segments.at(-1) ?? '';
  const idText = segments.join(' ');
  const rationale: string[] = [];
  let score = 0;

  const exactName = candidateName === requested;
  const exactId = segments.includes(requested) || finalSegment === requested;

  if (exactName) {
    score += 35;
    rationale.push('exact name match');
  }
  if (exactId) {
    score += 25;
    rationale.push('exact id match');
  }

  if (!exactName && candidateName.startsWith(requested)) {
    score += 15;
    rationale.push('name prefix match');
  } else if (!exactName && candidateName.includes(requested)) {
    score += 10;
    rationale.push('name contains request');
  } else if (!exactId && idText.includes(requested)) {
    score += 8;
    rationale.push('id contains request');
  }

  const versionMatch = Boolean(input.version && candidate.versions?.includes(input.version));
  if (versionMatch) {
    score += 15;
    rationale.push(`matches requested version ${input.version}`);
  }

  const trust = clampNumber(candidate.trustScore, 0, 10);
  if (trust > 0) {
    score += (trust / 10) * 15;
    rationale.push(`trust ${trust}`);
  }

  const benchmark = clampNumber(candidate.benchmarkScore, 0, 100);
  if (benchmark > 0) {
    score += (benchmark / 100) * 10;
    rationale.push(`benchmark ${benchmark}`);
  }

  const snippets = clampNumber(candidate.totalSnippets, 0, Number.MAX_SAFE_INTEGER);
  if (snippets > 0) {
    score += Math.min(8, Math.log10(snippets + 1) * 2);
    rationale.push(`snippet coverage ${candidate.totalSnippets}`);
  }

  const queryTokens = tokenSet(`${input.libraryName} ${input.query}`);
  const descriptionTokens = tokenSet(candidate.description ?? '');
  const overlap = [...queryTokens].filter((token) => descriptionTokens.has(token)).length;
  if (overlap > 0) {
    score += Math.min(7, overlap * 2);
    rationale.push('description overlap');
  }

  return {
    candidate,
    score: Math.min(100, Number(score.toFixed(3))),
    exactName,
    exactId,
    versionMatch,
    rationale,
  };
}

function compareScored(a: ScoredLibraryCandidate, b: ScoredLibraryCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  const exactA = Number(a.exactName) + Number(a.exactId);
  const exactB = Number(b.exactName) + Number(b.exactId);
  if (exactB !== exactA) return exactB - exactA;
  if ((b.candidate.trustScore ?? 0) !== (a.candidate.trustScore ?? 0)) return (b.candidate.trustScore ?? 0) - (a.candidate.trustScore ?? 0);
  if ((b.candidate.benchmarkScore ?? 0) !== (a.candidate.benchmarkScore ?? 0)) return (b.candidate.benchmarkScore ?? 0) - (a.candidate.benchmarkScore ?? 0);
  if ((b.candidate.totalSnippets ?? 0) !== (a.candidate.totalSnippets ?? 0)) return (b.candidate.totalSnippets ?? 0) - (a.candidate.totalSnippets ?? 0);
  return a.candidate.id.localeCompare(b.candidate.id);
}

export function resolveLibraryCandidate(input: ResolveLibraryInput): ResolveLibraryResult {
  if (input.candidates.length === 0) {
    return { status: 'no_results', candidates: [], rationale: 'No Context7 library candidates were found.' };
  }

  const scored = input.candidates.map((candidate) => scoreCandidate(input, candidate)).sort(compareScored);
  const versionMatches = input.version ? scored.filter((candidate) => candidate.versionMatch) : [];
  const selectable = versionMatches.length > 0 ? versionMatches.sort(compareScored) : scored;
  const [top, second] = selectable;

  if (!top || top.score < MIN_SELECTION_SCORE) {
    return {
      status: 'ambiguous',
      candidates: scored,
      rationale: 'Library resolution is ambiguous because no candidate reached the minimum confidence score.',
    };
  }

  const margin = second ? top.score - second.score : Number.POSITIVE_INFINITY;
  const exactAdvantage = second ? (top.exactName || top.exactId) && !(second.exactName || second.exactId) : true;
  const clearsMargin = margin >= MIN_SELECTION_MARGIN || exactAdvantage;

  if (!clearsMargin) {
    return {
      status: 'ambiguous',
      candidates: scored,
      rationale: `Library resolution is ambiguous because top candidates are close (margin ${margin.toFixed(3)}).`,
    };
  }

  const versionText = input.version && top.versionMatch ? ` and version ${input.version}` : '';
  return {
    status: 'selected',
    selected: top.candidate,
    score: top.score,
    candidates: scored,
    rationale: `selected ${top.candidate.id} with score ${top.score}${versionText}: ${top.rationale.join(', ')}`,
  };
}
