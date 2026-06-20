import type { Availability } from '../common/index.js';

export type StackOverflowQuestionRef = {
  questionId: string;
  url: string;
};

export type StackOverflowSearchRequest = {
  query: string;
  limit: number;
};

export type StackOverflowAnswersRequest = StackOverflowQuestionRef & {
  limit: number;
};

export type StackOverflowCommentsRequest = StackOverflowQuestionRef & {
  commentsLimit: number;
  commentsOffset: number;
};

export type StackOverflowRawQuestion = Record<string, unknown>;
export type StackOverflowRawAnswer = Record<string, unknown>;
export type StackOverflowRawComment = Record<string, unknown>;

export type NormalizedStackOverflowQuestion = {
  platform: 'stack_overflow';
  id: string;
  question_id: string;
  url: string;
  title?: string;
  score?: number;
  answer_count?: number;
  is_answered?: boolean;
  accepted_answer_id?: string;
  view_count?: number;
  tags?: string[];
  author?: string;
  created_at?: string;
  last_activity_at?: string;
  snippet?: string;
  body?: string;
  follow_up?: {
    answers_tool: 'stack_overflow_answers_get';
    answers_ref: string;
    comments_tool: 'stack_overflow_comments_get';
    comments_ref: string;
  };
  availability: Availability;
};

export type NormalizedStackOverflowAnswer = {
  platform: 'stack_overflow';
  id: string;
  answer_id: string;
  question_id?: string;
  url?: string;
  score?: number;
  accepted?: boolean;
  author?: string;
  created_at?: string;
  body?: string;
  availability: Availability;
};

export type StackOverflowSearchResult = {
  query: string;
  limit: number;
  items: NormalizedStackOverflowQuestion[];
};

export type StackOverflowAnswersResult = {
  questionId: string;
  limit: number;
  answers: NormalizedStackOverflowAnswer[];
};

export type NormalizedStackOverflowComment = {
  id: string;
  comment_id: string;
  post_id?: string;
  score?: number;
  author?: string;
  created_at?: string;
  body?: string;
};

export type StackOverflowCommentsResult = {
  platform: 'stack_overflow';
  question_id: string;
  comments_limit: number;
  comments_offset: number;
  comments_returned: number;
  has_more_comments: boolean;
  next_comments_offset?: number;
  comments: NormalizedStackOverflowComment[];
};

export interface StackExchangeClient {
  searchQuestions(input: StackOverflowSearchRequest, signal?: AbortSignal): Promise<StackOverflowRawQuestion[]>;
  getQuestion(input: StackOverflowQuestionRef, signal?: AbortSignal): Promise<StackOverflowRawQuestion | null>;
  getAnswers(input: StackOverflowAnswersRequest, signal?: AbortSignal): Promise<StackOverflowRawAnswer[]>;
  getQuestionComments(input: StackOverflowCommentsRequest, signal?: AbortSignal): Promise<{ items: StackOverflowRawComment[]; hasMore: boolean }>;
}
