import type {
  NormalizedStackOverflowQuestion,
  StackOverflowAnswersResult,
  StackOverflowCommentsResult,
  StackOverflowSearchResult,
} from '../../types.js';

export function stackSearchSummary(data: StackOverflowSearchResult): string {
  if (data.items.length === 0) return `No Stack Overflow results found for "${data.query}".`;
  return data.items.map((item, index) => {
    const metadata = [
      `question_id: ${item.question_id}`,
      item.score === undefined ? undefined : `score: ${item.score}`,
      item.answer_count === undefined ? undefined : `answers: ${item.answer_count}`,
      item.is_answered === undefined ? undefined : `answered: ${item.is_answered ? 'yes' : 'no'}`,
      item.tags && item.tags.length > 0 ? `tags: ${item.tags.join(', ')}` : undefined,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    return `${index + 1}. ${item.title ?? item.id} — ${item.url}${metadata ? ` (${metadata})` : ''}${snippet}`;
  }).join('\n');
}

export function stackQuestionSummary(data: NormalizedStackOverflowQuestion): string {
  const metadata = [
    data.site ? `site: ${data.site}` : undefined,
    `question_id: ${data.question_id}`,
    data.score === undefined ? undefined : `score: ${data.score}`,
    data.answer_count === undefined ? undefined : `answers: ${data.answer_count}`,
    data.is_answered === undefined ? undefined : `answered: ${data.is_answered ? 'yes' : 'no'}`,
    data.accepted_answer_id === undefined ? undefined : `accepted_answer_id: ${data.accepted_answer_id}`,
    data.tags && data.tags.length > 0 ? `tags: ${data.tags.join(', ')}` : undefined,
  ].filter(Boolean).join('; ');
  return [
    data.title ?? data.id,
    data.url,
    metadata,
    data.follow_up ? `use ${data.follow_up.answers_tool} with question: ${data.follow_up.answers_ref}` : undefined,
    data.follow_up ? `use ${data.follow_up.comments_tool} with question: ${data.follow_up.comments_ref}` : undefined,
    data.body,
  ].filter(Boolean).join('\n');
}

export function stackAnswersSummary(data: StackOverflowAnswersResult): string {
  const label = data.site && data.site !== 'stackoverflow' ? `Stack Exchange ${data.site}` : 'Stack Overflow';
  if (data.answers.length === 0) return `No ${label} answers found for ${data.questionId}.`;
  return data.answers.map((answer, index) => `${index + 1}. ${answer.accepted ? '[accepted] ' : ''}${answer.author ?? 'unknown'}: ${answer.body ?? ''}`).join('\n');
}

export function stackCommentsSummary(data: StackOverflowCommentsResult): string {
  const networkLabel = data.site && data.site !== 'stackoverflow' ? `Stack Exchange comments for ${data.site}` : 'Stack Overflow comments for';
  if (data.comments.length === 0) return `No ${networkLabel} question ${data.question_id}.`;
  const comments = data.comments.map((comment, index) => `${data.comments_offset + index + 1}. ${comment.author ?? 'unknown'}: ${comment.body ?? ''}`);
  const continuation = data.has_more_comments && data.next_comments_offset !== undefined ? `next_comments_offset: ${data.next_comments_offset}` : undefined;
  return [`${networkLabel} question ${data.question_id}`, ...comments, continuation].filter(Boolean).join('\n');
}
