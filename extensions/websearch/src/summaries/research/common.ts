import type { ResearchDetailResult } from '../../types.js';
import { compactAuthors, joinDefined } from '../common/index.js';

export function researchItemSummaryLine(item: ResearchDetailResult, prefix = ''): string[] {
  const lines: string[] = [];
  const parts = [`${prefix}[${item.source}/${item.kind}] ${item.title ?? '(untitled)'}`];
  if (item.url) parts.push(`— ${item.url}`);
  lines.push(parts.join(' '));
  const metrics = joinDefined([
    item.year === undefined ? undefined : `year: ${item.year}`,
    item.citation_count === undefined ? undefined : `citations: ${item.citation_count}`,
    item.reference_count === undefined ? undefined : `references: ${item.reference_count}`,
    item.open_access === undefined ? undefined : `open_access: ${item.open_access ? 'yes' : 'no'}`,
    compactAuthors(item.authors) ? `authors: ${compactAuthors(item.authors)}` : undefined,
    item.doi ? `doi: ${item.doi}` : undefined,
    item.arxiv_id ? `arxiv_id: ${item.arxiv_id}` : undefined,
    item.pmid ? `pmid: ${item.pmid}` : undefined,
    item.pmcid ? `pmcid: ${item.pmcid}` : undefined,
  ]);
  if (metrics) lines.push(`   ${metrics}`);
  if (item.summary) lines.push(`   summary: ${item.summary}`);
  return lines;
}

export function researchDetailSummary(data: ResearchDetailResult): string {
  return researchItemSummaryLine(data).join('\n');
}
