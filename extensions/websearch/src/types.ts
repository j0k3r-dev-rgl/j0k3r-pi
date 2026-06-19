import type { WebsearchConfig } from './config.js';

export type ToolContent = {
  type: 'text';
  text: string;
};

export type Provider = 'stack_overflow' | 'github' | 'devto' | 'hacker_news';

export type ErrorCategory =
  | 'validation'
  | 'rate_limit'
  | 'quota_exhausted'
  | 'auth'
  | 'not_found'
  | 'provider_unavailable'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'provider_payload'
  | 'unexpected';

export type ToolError = {
  code:
    | 'validation_error'
    | 'missing_configuration'
    | 'provider_error'
    | 'rate_limited'
    | 'quota_exhausted'
    | 'not_found'
    | 'source_unavailable'
    | 'cancelled'
    | 'timeout';
  message: string;
  recoverable: boolean;
  retry_after_seconds?: number;
  backoff_seconds?: number;
  provider?: Provider;
  category?: ErrorCategory;
  status?: number;
  request_id?: string;
};

export type ToolResponse<T> =
  | { status: 'success'; data: T }
  | { status: 'failure'; error: ToolError };

export type PiToolResult<T> = {
  content: ToolContent[];
  details: ToolResponse<T>;
  isError?: true;
};

export type AvailabilityStatus = 'available' | 'deleted' | 'removed' | 'private' | 'unavailable';

export type Availability = {
  status: AvailabilityStatus;
  reason?: string;
};

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

export type GitHubIssueRef = {
  owner: string;
  repo: string;
  issueNumber: number;
  url: string;
};

export type GitHubIssueSearchRequest = {
  query: string;
  limit: number;
  repo?: string;
  state?: 'open' | 'closed' | 'all';
};

export type GitHubPullRequestRef = {
  owner: string;
  repo: string;
  pullNumber: number;
  url: string;
};

export type GitHubPullRequestSearchRequest = {
  query: string;
  limit: number;
  repo?: string;
  state?: 'open' | 'closed' | 'merged' | 'all';
};

export type GitHubReleasesGetRequest = {
  owner: string;
  repo: string;
  limit: number;
  includePrereleases: boolean;
};

export type GitHubReleaseGetRequest = {
  owner: string;
  repo: string;
  tag: string;
};

export type GitHubIssueCommentsRequest = GitHubIssueRef & {
  limit: number;
  offset: number;
};

export type GitHubIssueGetRequest = GitHubIssueRef & {
  commentsLimit: number;
  commentsOffset: number;
};

export type GitHubRawIssueSearchItem = Record<string, unknown>;
export type GitHubRawIssue = Record<string, unknown>;
export type GitHubRawIssueComment = Record<string, unknown>;
export type GitHubRawIssueTimelineEvent = Record<string, unknown>;
export type GitHubRawPullRequest = Record<string, unknown>;
export type GitHubRawPullRequestComment = Record<string, unknown>;
export type GitHubRawPullRequestReview = Record<string, unknown>;
export type GitHubRawRelease = Record<string, unknown>;

export type GitHubIssueRelation = {
  type: 'pull_request' | 'issue';
  repository: string;
  number: number;
  ref: string;
  url?: string;
  title?: string;
  state?: string;
  event?: string;
};

export type GitHubIssueRelations = {
  pull_requests: GitHubIssueRelation[];
  issues: GitHubIssueRelation[];
};

export type NormalizedGitHubIssue = {
  platform: 'github';
  id: string;
  number: number;
  repository: string;
  url: string;
  title?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  state?: string;
  score?: number;
  comments_count?: number;
  labels?: string[];
  snippet?: string;
  body?: string;
  follow_up_ref: string;
  related_pull_requests?: GitHubIssueRelation[];
  related_issues?: GitHubIssueRelation[];
};

export type NormalizedGitHubIssueComment = {
  id: string;
  url?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  body?: string;
};

export type NormalizedGitHubPullRequestReviewComment = NormalizedGitHubIssueComment & {
  path?: string;
  commit_id?: string;
};

export type NormalizedGitHubPullRequestReview = {
  id: string;
  url?: string;
  author?: string;
  state?: string;
  submitted_at?: string;
  body?: string;
};

export type NormalizedGitHubPullRequest = NormalizedGitHubIssue & {
  merged?: boolean;
  merged_at?: string;
  review_comments_count?: number;
  commits_count?: number;
  changed_files_count?: number;
  additions?: number;
  deletions?: number;
  base_ref?: string;
  base_repo?: string;
  head_ref?: string;
  head_repo?: string;
};

export type GitHubIssueSearchResult = {
  query: string;
  limit: number;
  repo?: string;
  state?: 'open' | 'closed' | 'all';
  items: NormalizedGitHubIssue[];
};

export type GitHubIssueDetailResult = NormalizedGitHubIssue & {
  comments: NormalizedGitHubIssueComment[];
  comments_limit: number;
  comments_offset: number;
  next_comments_offset?: number;
  bounds: {
    comments_default: number;
    comments_max: number;
  };
};

export type GitHubPullRequestSearchResult = {
  query: string;
  limit: number;
  repo?: string;
  state?: 'open' | 'closed' | 'merged' | 'all';
  items: NormalizedGitHubPullRequest[];
};

export type GitHubPullRequestGetRequest = GitHubPullRequestRef & {
  commentsLimit: number;
  commentsOffset: number;
  reviewCommentsLimit: number;
  reviewCommentsOffset: number;
};

export type NormalizedGitHubRelease = {
  platform: 'github';
  repository: string;
  id: string;
  tag: string;
  name?: string;
  url?: string;
  author?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  created_at?: string;
  body?: string;
  assets_count?: number;
  target_commitish?: string;
};

export type GitHubReleasesResult = {
  repository: string;
  limit: number;
  include_prereleases: boolean;
  items: NormalizedGitHubRelease[];
};

export type GitHubReleaseResult = NormalizedGitHubRelease;

export type GitHubPullRequestDetailResult = NormalizedGitHubPullRequest & {
  comments: NormalizedGitHubIssueComment[];
  review_comments: NormalizedGitHubPullRequestReviewComment[];
  reviews: NormalizedGitHubPullRequestReview[];
  comments_limit: number;
  comments_offset: number;
  next_comments_offset?: number;
  review_comments_limit: number;
  review_comments_offset: number;
  next_review_comments_offset?: number;
  bounds: {
    comments_default: number;
    comments_max: number;
  };
};

export type DevtoArticleSearchRequest = {
  tag: string;
  limit: number;
};

export type DevtoCommentsRequest = {
  articleId: number;
  topLevelLimit: number;
  topLevelOffset: number;
  totalLimit: number;
  maxDepth: number;
};

export type DevtoRawArticle = Record<string, unknown>;
export type DevtoRawComment = Record<string, unknown>;

export type NormalizedDevtoArticle = {
  platform: 'devto';
  id: string;
  article_id: number;
  url?: string;
  title?: string;
  author?: string;
  published_at?: string;
  tags?: string[];
  reactions_count?: number;
  comments_count?: number;
  reading_time_minutes?: number;
  snippet?: string;
  follow_up_article_id: number;
};

export type DevtoArticleSearchResult = {
  tag: string;
  limit: number;
  items: NormalizedDevtoArticle[];
};

export type DevtoCommentNode = {
  id: string;
  author?: string;
  created_at?: string;
  body?: string;
  children?: DevtoCommentNode[];
};

export type DevtoCommentsResult = {
  platform: 'devto';
  article_id: number;
  url?: string;
  top_level_limit: number;
  top_level_offset: number;
  total_limit: number;
  max_depth: number;
  has_more_top_level_comments: boolean;
  next_top_level_offset?: number;
  comments: DevtoCommentNode[];
  bounds: {
    returned_top_level_comments: number;
    returned_total_nodes: number;
    truncated_by_depth: boolean;
    truncated_by_total_limit: boolean;
    truncated_by_top_level_limit: boolean;
  };
};

export type HackerNewsSearchRequest = {
  query: string;
  limit: number;
};

export type HackerNewsStoryRequest = {
  storyId: number;
  commentsLimit: number;
  commentsOffset: number;
  maxDepth: number;
};

export type HackerNewsRawStory = Record<string, unknown>;
export type HackerNewsRawItem = Record<string, unknown>;

export type NormalizedHackerNewsStory = {
  platform: 'hacker_news';
  id: string;
  url?: string;
  title?: string;
  author?: string;
  created_at?: string;
  points?: number;
  comments_count?: number;
  snippet?: string;
  follow_up_story_id: number;
};

export type HackerNewsSearchResult = {
  query: string;
  limit: number;
  items: NormalizedHackerNewsStory[];
};

export type HackerNewsCommentNode = {
  id: string;
  author?: string;
  created_at?: string;
  body?: string;
  children?: HackerNewsCommentNode[];
};

export type HackerNewsStoryDetailResult = NormalizedHackerNewsStory & {
  body?: string;
  comments_limit: number;
  comments_offset: number;
  next_comments_offset?: number;
  max_depth: number;
  comments: HackerNewsCommentNode[];
  bounds: {
    returned_top_level_comments: number;
    returned_total_comments: number;
    truncated_by_depth: boolean;
    truncated_by_total_limit: boolean;
  };
};

export interface StackExchangeClient {
  searchQuestions(input: StackOverflowSearchRequest, signal?: AbortSignal): Promise<StackOverflowRawQuestion[]>;
  getQuestion(input: StackOverflowQuestionRef, signal?: AbortSignal): Promise<StackOverflowRawQuestion | null>;
  getAnswers(input: StackOverflowAnswersRequest, signal?: AbortSignal): Promise<StackOverflowRawAnswer[]>;
  getQuestionComments(input: StackOverflowCommentsRequest, signal?: AbortSignal): Promise<{ items: StackOverflowRawComment[]; hasMore: boolean }>;
}

export interface GitHubClient {
  searchIssues(input: GitHubIssueSearchRequest, signal?: AbortSignal): Promise<GitHubRawIssueSearchItem[]>;
  getIssue(input: GitHubIssueRef, signal?: AbortSignal): Promise<GitHubRawIssue | null>;
  listIssueComments(input: GitHubIssueCommentsRequest, signal?: AbortSignal): Promise<GitHubRawIssueComment[]>;
  listIssueTimelineEvents(input: GitHubIssueRef, signal?: AbortSignal): Promise<GitHubRawIssueTimelineEvent[]>;
  searchPullRequests(input: GitHubPullRequestSearchRequest, signal?: AbortSignal): Promise<GitHubRawIssueSearchItem[]>;
  getPullRequest(input: GitHubPullRequestRef, signal?: AbortSignal): Promise<GitHubRawPullRequest | null>;
  listPullRequestReviewComments(input: GitHubPullRequestRef & { limit: number; offset: number }, signal?: AbortSignal): Promise<GitHubRawPullRequestComment[]>;
  listPullRequestReviews(input: GitHubPullRequestRef, signal?: AbortSignal): Promise<GitHubRawPullRequestReview[]>;
  listReleases(input: GitHubReleasesGetRequest, signal?: AbortSignal): Promise<GitHubRawRelease[]>;
  getReleaseByTag(input: GitHubReleaseGetRequest, signal?: AbortSignal): Promise<GitHubRawRelease | null>;
}

export interface DevtoClient {
  searchArticles(input: DevtoArticleSearchRequest, signal?: AbortSignal): Promise<DevtoRawArticle[]>;
  getComments(input: DevtoCommentsRequest, signal?: AbortSignal): Promise<DevtoRawComment[]>;
}

export interface HackerNewsClient {
  searchStories(input: HackerNewsSearchRequest, signal?: AbortSignal): Promise<HackerNewsRawStory[]>;
  getStory(input: HackerNewsStoryRequest, signal?: AbortSignal): Promise<HackerNewsRawItem | null>;
}

export interface WebsearchClients {
  stackExchange: StackExchangeClient;
  github: GitHubClient;
  devto: DevtoClient;
  hackerNews: HackerNewsClient;
}

export type CommandRunnerResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = (file: string, args: string[], options?: { signal?: AbortSignal }) => Promise<CommandRunnerResult>;

export interface RegisterWebsearchToolsDeps {
  clients?: Partial<WebsearchClients>;
  createClients?: (runtime: WebsearchRuntime) => WebsearchClients;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  commandRunner?: CommandRunner;
  config?: WebsearchConfig;
}

export type WebsearchRuntime = {
  env: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  config: WebsearchConfig;
  commandRunner?: CommandRunner;
};
