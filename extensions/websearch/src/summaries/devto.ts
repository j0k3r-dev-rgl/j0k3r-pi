import type { DevtoCommentsResult, DevtoArticleSearchResult } from '../types.js';

export function devtoSearchSummary(data: DevtoArticleSearchResult): string {
  if (data.items.length === 0) return `No Dev.to articles found for tag "${data.tag}".`;
  return data.items.map((item, index) => {
    const metadata = [
      item.author ? `author: ${item.author}` : undefined,
      item.reactions_count === undefined ? undefined : `reactions: ${item.reactions_count}`,
      item.comments_count === undefined ? undefined : `comments: ${item.comments_count}`,
      item.reading_time_minutes === undefined ? undefined : `reading: ${item.reading_time_minutes} min`,
      item.tags && item.tags.length > 0 ? `tags: ${item.tags.join(', ')}` : undefined,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    return `${index + 1}. ${item.title ?? item.id} — article_id: ${item.follow_up_article_id} — ${item.url ?? `article ${item.follow_up_article_id}`}${metadata ? ` (${metadata})` : ''}${snippet}`;
  }).join('\n');
}

function flattenDevtoCommentSummary(comments: DevtoCommentsResult['comments'], startIndex: number): string[] {
  const lines: string[] = [];
  comments.forEach((comment, index) => {
    lines.push(`${startIndex + index}. ${comment.author ?? 'unknown'}: ${comment.body ?? ''}`);
    for (const child of comment.children ?? []) {
      lines.push(`   ↳ ${child.author ?? 'unknown'}: ${child.body ?? ''}`);
    }
  });
  return lines;
}

export function devtoCommentsSummary(data: DevtoCommentsResult): string {
  if (data.comments.length === 0) return `No Dev.to comments found for article ${data.article_id}.`;
  const continuation = data.next_top_level_offset === undefined ? undefined : `next_top_level_offset: ${data.next_top_level_offset}`;
  return [
    `Dev.to comments for article ${data.article_id}`,
    `top_level_offset: ${data.top_level_offset}; top_level_limit: ${data.top_level_limit}; returned_nodes: ${data.bounds.returned_total_nodes}`,
    ...flattenDevtoCommentSummary(data.comments, data.top_level_offset + 1),
    continuation,
  ].filter(Boolean).join('\n');
}
