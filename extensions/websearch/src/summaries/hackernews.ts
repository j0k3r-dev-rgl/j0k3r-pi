import type { HackerNewsSearchResult, HackerNewsStoryDetailResult } from '../types.js';

export function hackerNewsSearchSummary(data: HackerNewsSearchResult): string {
  if (data.items.length === 0) return `No Hacker News stories found for "${data.query}".`;
  return data.items.map((item, index) => {
    const metadata = [
      item.author ? `author: ${item.author}` : undefined,
      item.points === undefined ? undefined : `points: ${item.points}`,
      item.comments_count === undefined ? undefined : `comments: ${item.comments_count}`,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    return `${index + 1}. ${item.title ?? item.id} — story_id: ${item.follow_up_story_id} — ${item.url ?? `story ${item.follow_up_story_id}`}${metadata ? ` (${metadata})` : ''}${snippet}`;
  }).join('\n');
}

function flattenHackerNewsCommentSummary(comments: HackerNewsStoryDetailResult['comments'], startIndex: number): string[] {
  const lines: string[] = [];
  comments.forEach((comment, index) => {
    lines.push(`${startIndex + index}. ${comment.author ?? 'unknown'}: ${comment.body ?? ''}`);
    for (const child of comment.children ?? []) {
      lines.push(`   ↳ ${child.author ?? 'unknown'}: ${child.body ?? ''}`);
    }
  });
  return lines;
}

export function hackerNewsStorySummary(data: HackerNewsStoryDetailResult): string {
  const metadata = [
    `story_id: ${data.follow_up_story_id}`,
    data.author ? `author: ${data.author}` : undefined,
    data.points === undefined ? undefined : `points: ${data.points}`,
    data.comments_count === undefined ? undefined : `comments: ${data.comments_count}`,
  ].filter(Boolean).join('; ');
  const continuation = data.next_comments_offset === undefined ? undefined : `next_comments_offset: ${data.next_comments_offset}`;
  return [
    data.title ?? `Hacker News story ${data.follow_up_story_id}`,
    data.url,
    metadata,
    data.body ?? '',
    data.comments.length > 0 ? `Comments offset ${data.comments_offset} limit ${data.comments_limit}` : undefined,
    ...flattenHackerNewsCommentSummary(data.comments, data.comments_offset + 1),
    continuation,
  ].filter(Boolean).join('\n');
}
