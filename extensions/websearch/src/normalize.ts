import type {
  NormalizedStackOverflowAnswer,
  NormalizedStackOverflowQuestion,
  StackOverflowRawAnswer,
  StackOverflowRawQuestion,
} from './types.js';
import { truncateText } from './security.js';

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function createdAt(value: unknown): string | undefined {
  const timestamp = numberValue(value);
  if (!timestamp) {
    return undefined;
  }
  return new Date(timestamp * 1000).toISOString();
}

function ownerName(data: Record<string, unknown>): string | undefined {
  const owner = data.owner as Record<string, unknown> | undefined;
  return owner ? stringValue(owner.display_name) : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function normalizeStackOverflowQuestion(raw: StackOverflowRawQuestion): NormalizedStackOverflowQuestion {
  const data = raw as Record<string, unknown>;
  const id = String(numberValue(data.question_id) ?? stringValue(data.question_id) ?? 'unknown');
  const body = stringValue(data.body_markdown) ?? stringValue(data.body);
  return {
    platform: 'stack_overflow',
    id,
    question_id: id,
    url: stringValue(data.link) ?? `https://stackoverflow.com/questions/${id}`,
    title: truncateText(stringValue(data.title), 300),
    score: numberValue(data.score),
    answer_count: numberValue(data.answer_count),
    tags: stringArray(data.tags),
    author: truncateText(ownerName(data), 120),
    created_at: createdAt(data.creation_date),
    snippet: truncateText(body ?? stringValue(data.title), 300),
    body: truncateText(body, 4000),
    availability: body || data.body_markdown !== undefined ? { status: 'available' } : { status: 'unavailable', reason: 'body_unavailable' },
  };
}

export function normalizeStackOverflowAnswer(raw: StackOverflowRawAnswer): NormalizedStackOverflowAnswer {
  const data = raw as Record<string, unknown>;
  const id = String(numberValue(data.answer_id) ?? stringValue(data.answer_id) ?? 'unknown');
  const questionId = numberValue(data.question_id) ?? stringValue(data.question_id);
  const body = stringValue(data.body_markdown) ?? stringValue(data.body);
  return {
    platform: 'stack_overflow',
    id,
    answer_id: id,
    question_id: questionId === undefined ? undefined : String(questionId),
    url: stringValue(data.link),
    score: numberValue(data.score),
    accepted: booleanValue(data.is_accepted),
    author: truncateText(ownerName(data), 120),
    created_at: createdAt(data.creation_date),
    body: truncateText(body, 2000),
    availability: body || data.body_markdown !== undefined ? { status: 'available' } : { status: 'unavailable', reason: 'body_unavailable' },
  };
}
