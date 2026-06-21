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

export type GitHubRepoRef = {
  owner: string;
  repo: string;
};

export type GitHubRepoGetRequest = GitHubRepoRef & {
  includeReadme: boolean;
};

export type GitHubFileGetRequest = GitHubRepoRef & {
  path: string;
  ref?: string;
};

export type GitHubCodeSearchRequest = {
  query: string;
  limit: number;
  repo?: string;
  owner?: string;
  language?: string;
  path?: string;
};

export type GitHubDiscussionRef = GitHubRepoRef & {
  discussionNumber: number;
  url: string;
};

export type GitHubDiscussionSearchRequest = {
  query: string;
  limit: number;
  repo?: string;
  owner?: string;
};

export type GitHubDiscussionGetRequest = GitHubDiscussionRef & {
  commentsLimit: number;
  commentsOffset: number;
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
export type GitHubRawRepository = Record<string, unknown>;
export type GitHubRawContentFile = Record<string, unknown>;
export type GitHubRawCodeSearchItem = Record<string, unknown>;
export type GitHubRawDiscussion = Record<string, unknown>;

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

export type NormalizedGitHubFile = {
  platform: 'github';
  repository: string;
  name?: string;
  path: string;
  ref?: string;
  sha?: string;
  size?: number;
  type?: string;
  encoding?: string;
  url?: string;
  download_url?: string;
  content?: string;
  truncated?: boolean;
};

export type NormalizedGitHubRepository = {
  platform: 'github';
  repository: string;
  id: string;
  name?: string;
  url?: string;
  description?: string;
  homepage?: string;
  topics?: string[];
  default_branch?: string;
  stars?: number;
  forks?: number;
  open_issues_count?: number;
  language?: string;
  license?: string;
  archived?: boolean;
  private?: boolean;
  created_at?: string;
  updated_at?: string;
  pushed_at?: string;
  readme?: NormalizedGitHubFile;
};

export type NormalizedGitHubCodeSearchItem = {
  platform: 'github';
  repository: string;
  name?: string;
  path: string;
  sha?: string;
  url?: string;
  score?: number;
  snippet?: string;
  followup_tool: 'github_file_get';
  followup_ref: string;
};

export type GitHubRepoResult = NormalizedGitHubRepository;
export type GitHubFileResult = NormalizedGitHubFile;
export type GitHubCodeSearchResult = GitHubCodeSearchRequest & {
  items: NormalizedGitHubCodeSearchItem[];
};

export type NormalizedGitHubDiscussionComment = {
  id: string;
  url?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  body?: string;
  upvote_count?: number;
  is_answer?: boolean;
};

export type NormalizedGitHubDiscussion = {
  platform: 'github';
  id: string;
  number: number;
  repository: string;
  url: string;
  title?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  published_at?: string;
  category?: string;
  category_slug?: string;
  category_emoji?: string;
  upvote_count?: number;
  comments_count?: number;
  answered?: boolean;
  answer_chosen_at?: string;
  closed?: boolean;
  locked?: boolean;
  labels?: string[];
  snippet?: string;
  body?: string;
  answer?: NormalizedGitHubDiscussionComment;
  follow_up_ref: string;
};

export type GitHubDiscussionSearchResult = GitHubDiscussionSearchRequest & {
  items: NormalizedGitHubDiscussion[];
};

export type GitHubDiscussionDetailResult = NormalizedGitHubDiscussion & {
  comments: NormalizedGitHubDiscussionComment[];
  comments_limit: number;
  comments_offset: number;
  next_comments_offset?: number;
  bounds: {
    comments_default: number;
    comments_max: number;
  };
};

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
  getRepository?(input: GitHubRepoRef, signal?: AbortSignal): Promise<GitHubRawRepository | null>;
  getRepositoryReadme?(input: GitHubRepoRef & { ref?: string }, signal?: AbortSignal): Promise<GitHubRawContentFile | null>;
  getFile?(input: GitHubFileGetRequest, signal?: AbortSignal): Promise<GitHubRawContentFile | null>;
  searchCode?(input: GitHubCodeSearchRequest, signal?: AbortSignal): Promise<GitHubRawCodeSearchItem[]>;
  searchDiscussions?(input: GitHubDiscussionSearchRequest, signal?: AbortSignal): Promise<GitHubRawDiscussion[]>;
  getDiscussion?(input: GitHubDiscussionGetRequest, signal?: AbortSignal): Promise<GitHubRawDiscussion | null>;
}
