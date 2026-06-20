import type { ResearchSearchResult } from '../../types.js';
import { compactAuthors, joinDefined } from '../common/index.js';

export function researchSearchSummary(data: ResearchSearchResult): string {
  const failedSources = data.source_errors.map((entry) => entry.source);
  if (data.items.length === 0) {
    const suffix = failedSources.length > 0 ? ` Some sources failed: ${failedSources.join(', ')}.` : '';
    return `research_search found no results for "${data.query}". Sources searched: ${data.sources_searched.join(', ') || 'none'}.${suffix}`;
  }

  const lines = [`research_search results for "${data.query}". Sources searched: ${data.sources_searched.join(', ')}.`];
  if (failedSources.length > 0) lines.push(`Some sources failed: ${failedSources.join(', ')}.`);
  for (const item of data.items) {
    const parts = [`${item.rank}. [${item.source}/${item.kind}] ${item.title ?? '(untitled)'}`];
    if (item.url) parts.push(`— ${item.url}`);
    lines.push(parts.join(' '));
    const metrics = joinDefined([
      item.year === undefined ? undefined : `year: ${item.year}`,
      item.citation_count === undefined ? undefined : `citations: ${item.citation_count}`,
      item.open_access === undefined ? undefined : `open_access: ${item.open_access ? 'yes' : 'no'}`,
      compactAuthors(item.authors) ? `authors: ${compactAuthors(item.authors)}` : undefined,
      item.doi ? `doi: ${item.doi}` : undefined,
      item.arxiv_id ? `arxiv_id: ${item.arxiv_id}` : undefined,
    ]);
    if (metrics) lines.push(`   ${metrics}`);
    if (item.summary) lines.push(`   summary: ${item.summary}`);
  }
  return lines.join('\n');
}
