import type { ArxivClient, RawArxivEntry, WebsearchRuntime } from '../../types.js';
import { providerRequestFailure, readText, cleanText } from '../common/index.js';

const ARXIV_QUERY_URL = 'https://export.arxiv.org/api/query';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstMatch(value: string, tag: string): string | undefined {
  const match = new RegExp(`<${escapeRegex(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegex(tag)}>`, 'i').exec(value);
  return cleanText(match?.[1]);
}

function allMatches(value: string, tag: string): string[] {
  const regex = new RegExp(`<${escapeRegex(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegex(tag)}>`, 'gi');
  return [...value.matchAll(regex)].map((match) => cleanText(match[1]) ?? '').filter(Boolean);
}

function tagBlocks(value: string, tag: string): string[] {
  const regex = new RegExp(`<${escapeRegex(tag)}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escapeRegex(tag)}>`, 'gi');
  return [...value.matchAll(regex)].map((match) => match[0]);
}

function attrs(value: string): Record<string, string> {
  return Object.fromEntries([...value.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)=["']([^"']*)["']/g)].map((match) => [match[1]!, cleanText(match[2]) ?? '']));
}

function parseLinks(entry: string): Array<{ href?: string; rel?: string; title?: string; type?: string }> {
  return [...entry.matchAll(/<link\s+([^>]*?)\/?\s*>/gi)].map((match) => attrs(match[1] ?? ''));
}

function parseCategories(entry: string): string[] {
  return [...entry.matchAll(/<category\s+([^>]*?)\/?\s*>/gi)]
    .map((match) => attrs(match[1] ?? '').term)
    .filter((term): term is string => Boolean(term));
}

function parseEntries(xml: string): RawArxivEntry[] {
  return tagBlocks(xml, 'entry').map((entry) => ({
    id: firstMatch(entry, 'id'),
    title: firstMatch(entry, 'title'),
    summary: firstMatch(entry, 'summary'),
    published: firstMatch(entry, 'published'),
    updated: firstMatch(entry, 'updated'),
    authors: tagBlocks(entry, 'author').map((author) => firstMatch(author, 'name')).filter((name): name is string => Boolean(name)),
    categories: parseCategories(entry),
    links: parseLinks(entry),
    doi: firstMatch(entry, 'arxiv:doi') ?? firstMatch(entry, 'doi'),
  }));
}

export function buildArxivSearchQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map((term) => term.trim().replace(/^['\"(]+|['\"),.]+$/g, '').toLowerCase())
    .filter((term) => /^[a-z0-9][a-z0-9_.-]*$/.test(term))
    .slice(0, 6);
  if (terms.length === 0) return `all:${query.trim()}`;
  return terms.map((term) => `all:${term}`).join(' AND ');
}

class FetchArxivClient implements ArxivClient {
  constructor(private readonly runtime: WebsearchRuntime) {}

  async searchPapers(input: { query: string; limit: number }, signal?: AbortSignal): Promise<RawArxivEntry[]> {
    const url = new URL(ARXIV_QUERY_URL);
    url.searchParams.set('search_query', buildArxivSearchQuery(input.query));
    url.searchParams.set('start', '0');
    url.searchParams.set('max_results', String(input.limit));
    url.searchParams.set('sortBy', 'relevance');
    url.searchParams.set('sortOrder', 'descending');

    try {
      const xml = await readText('arxiv', await this.runtime.fetch(url.toString(), { method: 'GET', signal }));
      return parseEntries(xml);
    } catch (error) {
      throw providerRequestFailure('arxiv', error, 'arXiv request failed.');
    }
  }
}

export function createArxivClient(runtime: WebsearchRuntime): ArxivClient {
  return new FetchArxivClient(runtime);
}
