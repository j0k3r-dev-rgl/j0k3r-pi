import type { ResearchSearchResult } from '../../types.js';
import { researchItemSummaryLine } from './common.js';

export function researchSearchSummary(data: ResearchSearchResult): string {
  const failedSources = data.source_errors.map((entry) => entry.source);
  if (data.items.length === 0) {
    const suffix = failedSources.length > 0 ? ` Some sources failed: ${failedSources.join(', ')}.` : '';
    return `research_search found no results for "${data.query}". Sources searched: ${data.sources_searched.join(', ') || 'none'}.${suffix}`;
  }

  const lines = [`research_search results for "${data.query}". Sources searched: ${data.sources_searched.join(', ')}.`];
  if (failedSources.length > 0) lines.push(`Some sources failed: ${failedSources.join(', ')}.`);
  for (const item of data.items) {
    lines.push(...researchItemSummaryLine(item, `${item.rank}. `));
  }
  return lines.join('\n');
}
