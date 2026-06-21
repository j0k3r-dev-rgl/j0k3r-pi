import type { WebFetchResult } from '../../types.js';

function compactText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}…` : normalized;
}

export function webFetchSummary(data: WebFetchResult): string {
  const lines = [
    `web_fetch read ${data.final_url} (${data.content_type || 'unknown content type'}, ${data.bytes_read} bytes${data.truncated ? ', truncated' : ''}).`,
  ];
  if (data.title) lines.push(`Title: ${data.title}`);
  if (data.redirects.length > 0) lines.push(`Redirects: ${data.redirects.length}.`);
  if (data.links.length > 0) lines.push(`Links extracted: ${data.links.length}.`);
  if (data.excerpt) lines.push(`Excerpt: ${compactText(data.excerpt, 700)}`);
  return lines.join('\n');
}
