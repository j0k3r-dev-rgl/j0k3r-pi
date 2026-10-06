/**
 * Shared deterministic literal token extraction and matching policy (Option B).
 *
 * Rules:
 * - Case-fold consistently (toLowerCase).
 * - Retain Unicode letters, numbers, and underscores in identifiers, including 1-2 char terms (Go, TS).
 * - Maximal literal technical tokens with internal dot/dash/slash/colon where surrounded by identifier
 *   segments, and trailing +/# suffixes (C++, C#, node:sqlite, foo_bar, package-name, paths/symbols).
 * - Plain punctuation alone is not a meaningful term.
 * - Small fixed English function-word stoplist (articles, pronouns, connecting words). Technical words
 *   such as "use" or "using" are retained.
 * - Deduplicate query terms; repeated terms count once with equal weight.
 * - Matching compares whole extracted terms using the same boundaries.
 * - Compound identifiers match extracted constituent segments ONLY when the query requests those constituents;
 *   a query's compound literal requires that compound, not arbitrary punctuation-normalized parts.
 * - Coverage = matched unique meaningful query terms / total unique meaningful query terms.
 */

export const ENGLISH_STOPWORDS = new Set<string>([
  'a', 'an', 'the',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
  'would', 'should', 'could', 'ought', 'shall', 'will', 'can', 'must',
  'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while',
  'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
  'then', 'once', 'so', 'than', 'no', 'nor', 'not',
]);

const TOKEN_REGEX = /[\p{L}\p{N}_]+(?:[\.\-\/:]+[\p{L}\p{N}_]+)*(?:\+{1,2}|#)?/gu;
const IDENTIFIER_FRAGMENT_REGEX = /[\p{L}\p{N}_]+/gu;

export interface DocumentTermIndex {
  maximalTokens: Set<string>;
  constituentSegments: Set<string>;
}

export function extractTokens(text: string): string[] {
  if (!text) return [];
  const matches = text.match(TOKEN_REGEX);
  if (!matches) return [];
  return matches.map((m) => m.toLowerCase());
}

export function extractConstituentSegments(token: string): string[] {
  if (/[\.\-\/:_]/.test(token)) {
    const base = token.replace(/(?:\+{1,2}|#)$/, '');
    const parts = base.split(/[\.\-\/:_]+/).filter(Boolean);
    if (parts.length > 1) {
      return parts;
    }
  }
  return [];
}

export function getQueryMeaningfulTerms(query: string): string[] {
  const rawTokens = extractTokens(query);
  const meaningful: string[] = [];
  const seen = new Set<string>();

  for (const token of rawTokens) {
    if (!ENGLISH_STOPWORDS.has(token) && !seen.has(token)) {
      seen.add(token);
      meaningful.push(token);
    }
  }

  return meaningful;
}

export function buildDocumentTermIndex(text: string): DocumentTermIndex {
  const tokens = extractTokens(text);
  const maximalTokens = new Set<string>();
  const constituentSegments = new Set<string>();

  for (const token of tokens) {
    maximalTokens.add(token);
    const constituents = extractConstituentSegments(token);
    for (const segment of constituents) {
      constituentSegments.add(segment);
    }
  }

  return { maximalTokens, constituentSegments };
}

export function computeLiteralCoverage(
  queryMeaningfulTerms: string[],
  docTerms: DocumentTermIndex,
): number {
  if (queryMeaningfulTerms.length === 0) {
    return 0;
  }

  let matched = 0;
  for (const term of queryMeaningfulTerms) {
    if (docTerms.maximalTokens.has(term) || docTerms.constituentSegments.has(term)) {
      matched++;
    }
  }

  return matched / queryMeaningfulTerms.length;
}

export function computeTextCoverage(
  queryMeaningfulTerms: string[],
  title: string,
  content: string,
): number {
  if (queryMeaningfulTerms.length === 0) {
    return 0;
  }
  const combined = (title || '') + ' ' + (content || '');
  const docTerms = buildDocumentTermIndex(combined);
  return computeLiteralCoverage(queryMeaningfulTerms, docTerms);
}

export function buildFts5MatchExpression(queryMeaningfulTerms: string[]): string | null {
  if (queryMeaningfulTerms.length === 0) {
    return null;
  }

  const clauses: string[] = [];

  for (const term of queryMeaningfulTerms) {
    const fragments = term.match(IDENTIFIER_FRAGMENT_REGEX);
    if (!fragments || fragments.length === 0) {
      continue;
    }

    if (fragments.length === 1) {
      const escaped = fragments[0].replace(/"/g, '""');
      clauses.push(`"${escaped}"`);
    } else {
      const phraseParts = fragments.map((f) => `"${f.replace(/"/g, '""')}"`);
      clauses.push(`(${phraseParts.join(' AND ')})`);
    }
  }

  if (clauses.length === 0) {
    return null;
  }

  return clauses.join(' OR ');
}
