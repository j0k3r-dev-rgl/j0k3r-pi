import type { WebSearchResult } from '../../types.js';

function itemLine(item: WebSearchResult['items'][number]): string {
  const parts = [`${item.rank}. [${item.source}] ${item.title}`];
  if (item.url) parts.push(item.url);
  if (item.published_at) parts.push(item.published_at);
  if (item.snippet) parts.push(item.snippet);
  return parts.join(' | ');
}

function filterSummary(data: WebSearchResult): string | undefined {
  if (!data.filters) return undefined;
  const entries = Object.entries(data.filters).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`);
  return entries.length ? `Filters: ${entries.join('; ')}.` : undefined;
}

export function webSearchSummary(data: WebSearchResult): string {
  const failedSources = data.source_errors.map((entry) => entry.source);
  const filters = filterSummary(data);
  if (data.items.length === 0) {
    const suffix = failedSources.length > 0 ? ` Providers failed: ${failedSources.join(', ')}.` : '';
    return [`web_search found no results for "${data.query}". Providers tried: ${data.providers_tried.join(', ') || 'none'}.${suffix}`, filters].filter(Boolean).join('\n');
  }

  const lines = [`web_search results for "${data.query}" using ${data.selected_provider}. Providers tried: ${data.providers_tried.join(', ')}.`];
  if (filters) lines.push(filters);
  if (data.fallback_used) lines.push(`Fallback used: ${data.selected_provider} after exa failed or returned no results.`);
  if (failedSources.length > 0) lines.push(`Provider errors: ${failedSources.join(', ')}.`);
  for (const item of data.items) lines.push(itemLine(item));
  return lines.join('\n');
}
