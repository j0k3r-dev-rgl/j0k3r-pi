import type { ResearchGraphResult } from '../../types.js';
import { researchItemSummaryLine } from './common.js';

export function researchGraphSummary(toolName: string, data: ResearchGraphResult): string {
  const total = data.total === undefined ? '' : ` Total available: ${data.total}.`;
  const page = data.page === undefined ? '' : ` Page: ${data.page}.`;
  const offset = data.offset === undefined ? '' : ` Offset: ${data.offset}.`;
  const lines = [`${toolName} found ${data.items.length} ${data.relation} item(s) for ${data.source} subject ${data.subject}.${total}${page}${offset}`];
  for (const [index, item] of data.items.entries()) {
    lines.push(...researchItemSummaryLine({ ...item, rank: index + 1 }, `${index + 1}. `));
  }
  if (data.next_page !== undefined) lines.push(`Next page: ${data.next_page}`);
  if (data.next_offset !== undefined) lines.push(`Next offset: ${data.next_offset}`);
  return lines.join('\n');
}
