import { createResearchClients } from '../../providers/research/index.js';
import type { NormalizedResearchItem, RegisterWebsearchToolsDeps, ResearchClients, ResearchSource } from '../../types.js';
import { ValidationError } from '../../validation.js';

export const RESEARCH_GRAPH_DEFAULT_LIMIT = 5;
export const RESEARCH_GRAPH_MAX_LIMIT = 20;
import { runtimeFromDeps } from '../common/index.js';

export function asInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ValidationError(`${field} is required.`);
  return value.trim();
}

export function optionalBoundedLimit(input: Record<string, unknown>): number {
  const value = input.limit;
  if (value === undefined || value === null || value === '') return RESEARCH_GRAPH_DEFAULT_LIMIT;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new ValidationError('limit must be an integer.');
  if (value < 1) throw new ValidationError('limit must be at least 1.');
  if (value > RESEARCH_GRAPH_MAX_LIMIT) throw new ValidationError(`limit must be at most ${RESEARCH_GRAPH_MAX_LIMIT}.`);
  return value;
}

export function optionalOffset(input: Record<string, unknown>): number {
  const value = input.offset;
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new ValidationError('offset must be an integer.');
  if (value < 0) throw new ValidationError('offset must be at least 0.');
  return value;
}

export function optionalPage(input: Record<string, unknown>): number {
  const value = input.page;
  if (value === undefined || value === null || value === '') return 1;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new ValidationError('page must be an integer.');
  if (value < 1) throw new ValidationError('page must be at least 1.');
  return value;
}

export function researchClientsFromDeps(deps: RegisterWebsearchToolsDeps): ResearchClients {
  if (deps.clients?.research) return deps.clients.research;
  return createResearchClients(runtimeFromDeps(deps));
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function normalizeDoi(value: unknown): string | undefined {
  const raw = stringValue(value);
  return raw?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim() || undefined;
}

export function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return stringValue(value);
  if (Array.isArray(value)) return value.map(stringValue).find(Boolean);
  return undefined;
}

export function yearFromDateParts(value: unknown): number | undefined {
  const parts = recordValue(value)?.['date-parts'];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return undefined;
  return numberValue(parts[0][0]);
}

export function namesFromAuthorRecords(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.map((entry) => {
    const record = recordValue(entry);
    const literal = stringValue(record?.name);
    if (literal) return literal;
    return [stringValue(record?.given), stringValue(record?.family)].filter(Boolean).join(' ').trim() || undefined;
  }).filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.slice(0, 12) : undefined;
}

export function followupTool(source: ResearchSource): string {
  switch (source) {
    case 'openalex': return 'openalex_work_get';
    case 'arxiv': return 'arxiv_paper_get';
    case 'crossref': return 'crossref_work_get';
    case 'europe_pmc': return 'europe_pmc_article_get';
    case 'semantic_scholar': return 'semantic_scholar_paper_get';
  }
}

export function withFollowup(item: NormalizedResearchItem, ref?: string | number): NormalizedResearchItem {
  return { ...item, followup_tool: followupTool(item.source), followup_ref: ref ?? item.doi ?? item.arxiv_id ?? item.pmcid ?? item.pmid ?? item.id };
}
