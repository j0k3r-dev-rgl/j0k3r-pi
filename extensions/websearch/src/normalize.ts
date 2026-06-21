import type {
  DevtoCommentNode,
  DevtoCommentsResult,
  DevtoRawArticle,
  DevtoRawComment,
  GitHubRawIssue,
  GitHubRawIssueComment,
  GitHubRawIssueSearchItem,
  GitHubRawCodeSearchItem,
  GitHubRawContentFile,
  GitHubRawDiscussion,
  GitHubRawIssueTimelineEvent,
  GitHubRawPullRequest,
  GitHubRawPullRequestComment,
  GitHubRawPullRequestReview,
  GitHubRawRelease,
  GitHubRawRepository,
  HackerNewsCommentNode,
  HackerNewsRawItem,
  HackerNewsRawStory,
  HackerNewsStoryDetailResult,
  NormalizedDevtoArticle,
  GitHubIssueRelations,
  GitHubIssueRelation,
  NormalizedGitHubCodeSearchItem,
  NormalizedGitHubDiscussion,
  NormalizedGitHubDiscussionComment,
  NormalizedGitHubFile,
  NormalizedGitHubIssue,
  NormalizedGitHubIssueComment,
  NormalizedGitHubPullRequest,
  NormalizedGitHubPullRequestReview,
  NormalizedGitHubPullRequestReviewComment,
  NormalizedGitHubRelease,
  NormalizedGitHubRepository,
  NormalizedHackerNewsStory,
  NormalizedStackOverflowAnswer,
  NormalizedStackOverflowComment,
  NormalizedStackOverflowQuestion,
  StackExchangePlatform,
  StackExchangeSite,
  StackOverflowRawAnswer,
  StackOverflowRawComment,
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

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    hellip: '…',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value
    .replace(/&#(\d+);/g, (_match, codepoint: string) => String.fromCodePoint(Number(codepoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codepoint: string) => String.fromCodePoint(parseInt(codepoint, 16)))
    .replace(/&([a-z][a-z0-9]+);/gi, (match, name: string) => namedEntities[name] ?? match);
}

function ownerName(data: Record<string, unknown>): string | undefined {
  const owner = data.owner as Record<string, unknown> | undefined;
  const name = owner ? stringValue(owner.display_name) : undefined;
  return name ? decodeHtmlEntities(name) : undefined;
}

function htmlToText(value: string | undefined): string | undefined {
  const text = value
    ?.replace(/<pre[^>]*><code>/gi, ' ')
    .replace(/<\/code><\/pre>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return text ? decodeHtmlEntities(text).replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim() || undefined : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function githubUserLogin(data: Record<string, unknown>): string | undefined {
  const user = data.user as Record<string, unknown> | undefined;
  return user ? stringValue(user.login) : undefined;
}

function githubRepository(data: Record<string, unknown>): string {
  const repoUrl = stringValue(data.repository_url);
  if (repoUrl) {
    const match = /\/repos\/([^/]+)\/([^/]+)$/.exec(repoUrl);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  }
  const htmlUrl = stringValue(data.html_url);
  if (htmlUrl) {
    try {
      const url = new URL(htmlUrl);
      const match = /^\/([^/]+)\/([^/]+)\//.exec(url.pathname);
      if (match) {
        return `${match[1]}/${match[2]}`;
      }
    } catch {
      // ignore parse failure
    }
  }
  return 'unknown/unknown';
}

function githubFollowUpRef(repository: string, number: number): string {
  return `${repository}#${number}`;
}

function githubLabels(data: Record<string, unknown>): string[] | undefined {
  const labels = data.labels;
  if (!Array.isArray(labels)) {
    return undefined;
  }
  return labels
    .map((label) => typeof label === 'string' ? label : stringValue((label as Record<string, unknown> | undefined)?.name))
    .filter((label): label is string => Boolean(label));
}

function cleanGitHubMarkdown(value: string | undefined): string | undefined {
  return value
    ?.replace(/<!--[^]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || undefined;
}

function stackExchangeSite(value: unknown): StackExchangeSite {
  return value === 'serverfault' || value === 'unix' || value === 'superuser' || value === 'dba' ? value : 'stackoverflow';
}

function stackExchangePlatform(site: StackExchangeSite): StackExchangePlatform {
  if (site === 'serverfault') return 'server_fault';
  if (site === 'unix') return 'unix_linux';
  if (site === 'superuser') return 'super_user';
  if (site === 'dba') return 'dba';
  return 'stack_overflow';
}

function stackExchangeQuestionUrl(site: StackExchangeSite, questionId: string): string {
  if (site === 'serverfault') return `https://serverfault.com/questions/${questionId}`;
  if (site === 'unix') return `https://unix.stackexchange.com/questions/${questionId}`;
  if (site === 'superuser') return `https://superuser.com/questions/${questionId}`;
  if (site === 'dba') return `https://dba.stackexchange.com/questions/${questionId}`;
  return `https://stackoverflow.com/questions/${questionId}`;
}

export function normalizeStackOverflowQuestion(raw: StackOverflowRawQuestion): NormalizedStackOverflowQuestion {
  const data = raw as Record<string, unknown>;
  const id = String(numberValue(data.question_id) ?? stringValue(data.question_id) ?? 'unknown');
  const site = stackExchangeSite(data.site);
  const body = stringValue(data.body_markdown) ?? htmlToText(stringValue(data.body));
  const platform = stackExchangePlatform(site);
  const followUpRef = site === 'stackoverflow' ? id : `${site}:${id}`;
  return {
    platform,
    site,
    id,
    question_id: id,
    url: stringValue(data.link) ?? stackExchangeQuestionUrl(site, id),
    title: truncateText(stringValue(data.title) ? decodeHtmlEntities(stringValue(data.title)!) : undefined, 300),
    score: numberValue(data.score),
    answer_count: numberValue(data.answer_count),
    is_answered: booleanValue(data.is_answered),
    accepted_answer_id: numberValue(data.accepted_answer_id) === undefined && stringValue(data.accepted_answer_id) === undefined ? undefined : String(numberValue(data.accepted_answer_id) ?? stringValue(data.accepted_answer_id)),
    view_count: numberValue(data.view_count),
    tags: stringArray(data.tags),
    author: truncateText(ownerName(data), 120),
    created_at: createdAt(data.creation_date),
    last_activity_at: createdAt(data.last_activity_date),
    snippet: truncateText(body ?? stringValue(data.title), 300),
    body,
    follow_up: {
      answers_tool: 'discussion_answers_get',
      answers_ref: followUpRef,
      comments_tool: 'discussion_comments_get',
      comments_ref: followUpRef,
    },
    availability: body || data.body_markdown !== undefined ? { status: 'available' } : { status: 'unavailable', reason: 'body_unavailable' },
  };
}

export function normalizeStackOverflowAnswer(raw: StackOverflowRawAnswer): NormalizedStackOverflowAnswer {
  const data = raw as Record<string, unknown>;
  const id = String(numberValue(data.answer_id) ?? stringValue(data.answer_id) ?? 'unknown');
  const site = stackExchangeSite(data.site);
  const questionId = numberValue(data.question_id) ?? stringValue(data.question_id);
  const body = stringValue(data.body_markdown) ?? htmlToText(stringValue(data.body));
  return {
    platform: stackExchangePlatform(site),
    site,
    id,
    answer_id: id,
    question_id: questionId === undefined ? undefined : String(questionId),
    url: stringValue(data.link),
    score: numberValue(data.score),
    accepted: booleanValue(data.is_accepted),
    author: truncateText(ownerName(data), 120),
    created_at: createdAt(data.creation_date),
    body,
    availability: body || data.body_markdown !== undefined ? { status: 'available' } : { status: 'unavailable', reason: 'body_unavailable' },
  };
}

export function normalizeStackOverflowComment(raw: StackOverflowRawComment): NormalizedStackOverflowComment {
  const data = raw as Record<string, unknown>;
  const id = String(numberValue(data.comment_id) ?? stringValue(data.comment_id) ?? 'unknown');
  const site = stackExchangeSite(data.site);
  const postId = numberValue(data.post_id) ?? stringValue(data.post_id);
  const body = stringValue(data.body_markdown) ?? htmlToText(stringValue(data.body));
  return {
    platform: stackExchangePlatform(site),
    site,
    id,
    comment_id: id,
    post_id: postId === undefined ? undefined : String(postId),
    score: numberValue(data.score),
    author: truncateText(ownerName(data), 120),
    created_at: createdAt(data.creation_date),
    body,
  };
}

export function normalizeGitHubIssue(raw: GitHubRawIssueSearchItem | GitHubRawIssue): NormalizedGitHubIssue {
  const data = raw as Record<string, unknown>;
  const id = String(numberValue(data.id) ?? stringValue(data.id) ?? 'unknown');
  const number = numberValue(data.number) ?? 0;
  const repository = githubRepository(data);
  const body = cleanGitHubMarkdown(stringValue(data.body));
  const title = stringValue(data.title);
  return {
    platform: 'github',
    id,
    number,
    repository,
    url: stringValue(data.html_url) ?? `https://github.com/${repository}/issues/${number}`,
    title: truncateText(title, 300),
    author: truncateText(githubUserLogin(data), 120),
    created_at: stringValue(data.created_at),
    updated_at: stringValue(data.updated_at),
    state: stringValue(data.state),
    score: numberValue(data.score),
    comments_count: numberValue(data.comments),
    labels: githubLabels(data),
    snippet: truncateText(body ?? title, 300),
    body,
    follow_up_ref: githubFollowUpRef(repository, number),
  };
}

export function normalizeGitHubIssueComment(raw: GitHubRawIssueComment): NormalizedGitHubIssueComment {
  const data = raw as Record<string, unknown>;
  return {
    id: String(numberValue(data.id) ?? stringValue(data.id) ?? 'unknown'),
    url: stringValue(data.html_url),
    author: truncateText(githubUserLogin(data), 120),
    created_at: stringValue(data.created_at),
    updated_at: stringValue(data.updated_at),
    body: stringValue(data.body),
  };
}

export function normalizeGitHubPullRequest(raw: GitHubRawIssueSearchItem | GitHubRawPullRequest): NormalizedGitHubPullRequest {
  const data = raw as Record<string, unknown>;
  const baseIssue = normalizeGitHubIssue(raw);
  const pullRequest = data.pull_request as Record<string, unknown> | undefined;
  const base = data.base as Record<string, unknown> | undefined;
  const head = data.head as Record<string, unknown> | undefined;
  const baseRepo = base?.repo as Record<string, unknown> | undefined;
  const headRepo = head?.repo as Record<string, unknown> | undefined;
  return {
    ...baseIssue,
    url: stringValue(data.html_url) ?? stringValue(pullRequest?.html_url) ?? baseIssue.url,
    merged: booleanValue(data.merged) ?? Boolean(stringValue(pullRequest?.merged_at)),
    merged_at: stringValue(data.merged_at) ?? stringValue(pullRequest?.merged_at),
    review_comments_count: numberValue(data.review_comments),
    commits_count: numberValue(data.commits),
    changed_files_count: numberValue(data.changed_files),
    additions: numberValue(data.additions),
    deletions: numberValue(data.deletions),
    base_ref: stringValue(base?.ref),
    base_repo: stringValue(baseRepo?.full_name),
    head_ref: stringValue(head?.ref),
    head_repo: stringValue(headRepo?.full_name),
  };
}

export function normalizeGitHubPullRequestReviewComment(raw: GitHubRawPullRequestComment): NormalizedGitHubPullRequestReviewComment {
  const data = raw as Record<string, unknown>;
  return {
    ...normalizeGitHubIssueComment(raw),
    path: stringValue(data.path),
    commit_id: stringValue(data.commit_id),
  };
}

export function normalizeGitHubPullRequestReview(raw: GitHubRawPullRequestReview): NormalizedGitHubPullRequestReview {
  const data = raw as Record<string, unknown>;
  return {
    id: String(numberValue(data.id) ?? stringValue(data.id) ?? 'unknown'),
    url: stringValue(data.html_url),
    author: truncateText(githubUserLogin(data), 120),
    state: stringValue(data.state),
    submitted_at: stringValue(data.submitted_at),
    body: stringValue(data.body),
  };
}

export function normalizeGitHubRelease(raw: GitHubRawRelease, repository: string): NormalizedGitHubRelease {
  const data = raw as Record<string, unknown>;
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const author = data.author as Record<string, unknown> | undefined;
  return {
    platform: 'github',
    repository,
    id: String(numberValue(data.id) ?? stringValue(data.id) ?? stringValue(data.tag_name) ?? 'unknown'),
    tag: stringValue(data.tag_name) ?? 'unknown',
    name: truncateText(stringValue(data.name), 300),
    url: stringValue(data.html_url),
    author: truncateText(author ? stringValue(author.login) : githubUserLogin(data), 120),
    draft: booleanValue(data.draft),
    prerelease: booleanValue(data.prerelease),
    published_at: stringValue(data.published_at),
    created_at: stringValue(data.created_at),
    body: cleanGitHubMarkdown(stringValue(data.body)),
    assets_count: assets.length,
    target_commitish: stringValue(data.target_commitish),
  };
}

function githubRepositoryFullName(data: Record<string, unknown>, fallback?: string): string {
  return stringValue(data.full_name) ?? fallback ?? 'unknown/unknown';
}

function decodeGitHubContent(data: Record<string, unknown>): string | undefined {
  const content = stringValue(data.content);
  if (!content) return undefined;
  const encoding = stringValue(data.encoding);
  if (encoding === 'base64') {
    try {
      return Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      return undefined;
    }
  }
  return content;
}

export function normalizeGitHubFile(raw: GitHubRawContentFile, repository: string, ref?: string): NormalizedGitHubFile {
  const data = raw as Record<string, unknown>;
  const content = decodeGitHubContent(data);
  return {
    platform: 'github',
    repository,
    name: stringValue(data.name),
    path: stringValue(data.path) ?? stringValue(data.name) ?? 'unknown',
    ref,
    sha: stringValue(data.sha),
    size: numberValue(data.size),
    type: stringValue(data.type),
    encoding: stringValue(data.encoding),
    url: stringValue(data.html_url),
    download_url: stringValue(data.download_url),
    content,
    truncated: booleanValue(data.truncated),
  };
}

export function normalizeGitHubRepository(raw: GitHubRawRepository, readme?: GitHubRawContentFile | null): NormalizedGitHubRepository {
  const data = raw as Record<string, unknown>;
  const repository = githubRepositoryFullName(data);
  const license = data.license as Record<string, unknown> | undefined;
  return {
    platform: 'github',
    repository,
    id: String(numberValue(data.id) ?? stringValue(data.id) ?? repository),
    name: stringValue(data.name),
    url: stringValue(data.html_url),
    description: truncateText(stringValue(data.description), 500),
    homepage: stringValue(data.homepage),
    topics: stringArray(data.topics),
    default_branch: stringValue(data.default_branch),
    stars: numberValue(data.stargazers_count),
    forks: numberValue(data.forks_count),
    open_issues_count: numberValue(data.open_issues_count),
    language: stringValue(data.language),
    license: stringValue(license?.spdx_id) ?? stringValue(license?.key) ?? stringValue(license?.name),
    archived: booleanValue(data.archived),
    private: booleanValue(data.private),
    created_at: stringValue(data.created_at),
    updated_at: stringValue(data.updated_at),
    pushed_at: stringValue(data.pushed_at),
    readme: readme ? normalizeGitHubFile(readme, repository) : undefined,
  };
}

function githubCodeRepository(raw: Record<string, unknown>): string {
  const repository = raw.repository as Record<string, unknown> | undefined;
  return repository ? githubRepositoryFullName(repository) : 'unknown/unknown';
}

function githubTextMatchSnippet(raw: Record<string, unknown>): string | undefined {
  const textMatches = raw.text_matches;
  if (!Array.isArray(textMatches)) return undefined;
  const fragments = textMatches
    .map((entry) => stringValue((entry as Record<string, unknown> | undefined)?.fragment))
    .filter((entry): entry is string => Boolean(entry));
  return truncateText(fragments.join(' ').replace(/\s+/g, ' ').trim(), 500);
}

export function normalizeGitHubCodeSearchItem(raw: GitHubRawCodeSearchItem): NormalizedGitHubCodeSearchItem {
  const data = raw as Record<string, unknown>;
  const repository = githubCodeRepository(data);
  const path = stringValue(data.path) ?? stringValue(data.name) ?? 'unknown';
  return {
    platform: 'github',
    repository,
    name: stringValue(data.name),
    path,
    sha: stringValue(data.sha),
    url: stringValue(data.html_url),
    score: numberValue(data.score),
    snippet: githubTextMatchSnippet(data),
    followup_tool: 'github_get',
    followup_ref: `${repository}:${path}`,
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function actorLogin(value: unknown): string | undefined {
  return truncateText(stringValue(objectValue(value)?.login), 120);
}

function labelNames(value: unknown): string[] | undefined {
  const labels = objectValue(value);
  const nodes = labels?.nodes;
  if (!Array.isArray(nodes)) return undefined;
  return nodes
    .map((entry) => stringValue(objectValue(entry)?.name))
    .filter((entry): entry is string => Boolean(entry));
}

function discussionRepository(data: Record<string, unknown>): string {
  const repository = objectValue(data.repository);
  return stringValue(repository?.nameWithOwner) ?? githubRepositoryFullName(repository ?? {}, 'unknown/unknown');
}

function discussionCommentsCount(data: Record<string, unknown>): number | undefined {
  const comments = objectValue(data.comments);
  return numberValue(comments?.totalCount) ?? numberValue(data.comments_count);
}

function discussionSnippet(data: Record<string, unknown>): string | undefined {
  return githubTextMatchSnippet(data) ?? truncateText(stringValue(data.bodyText) ?? stringValue(data.body), 500);
}

export function normalizeGitHubDiscussionComment(raw: unknown, answerId?: string): NormalizedGitHubDiscussionComment {
  const data = objectValue(raw) ?? {};
  const id = String(stringValue(data.id) ?? numberValue(data.databaseId) ?? stringValue(data.url) ?? 'unknown');
  return {
    id,
    url: stringValue(data.url),
    author: actorLogin(data.author),
    created_at: stringValue(data.createdAt) ?? stringValue(data.created_at),
    updated_at: stringValue(data.updatedAt) ?? stringValue(data.updated_at),
    body: truncateText(stringValue(data.bodyText) ?? stringValue(data.body), 5000),
    upvote_count: numberValue(data.upvoteCount) ?? numberValue(data.upvote_count),
    is_answer: answerId ? id === answerId : undefined,
  };
}

export function normalizeGitHubDiscussion(raw: GitHubRawDiscussion): NormalizedGitHubDiscussion {
  const data = raw as Record<string, unknown>;
  const repository = discussionRepository(data);
  const category = objectValue(data.category);
  const answer = objectValue(data.answer);
  const answerId = stringValue(answer?.id);
  const number = numberValue(data.number) ?? 0;
  return {
    platform: 'github',
    id: String(stringValue(data.id) ?? numberValue(data.databaseId) ?? `${repository}#${number}`),
    number,
    repository,
    url: stringValue(data.url) ?? `https://github.com/${repository}/discussions/${number}`,
    title: truncateText(stringValue(data.title), 300),
    author: actorLogin(data.author),
    created_at: stringValue(data.createdAt) ?? stringValue(data.created_at),
    updated_at: stringValue(data.updatedAt) ?? stringValue(data.updated_at),
    published_at: stringValue(data.publishedAt) ?? stringValue(data.published_at),
    category: stringValue(category?.name),
    category_slug: stringValue(category?.slug),
    category_emoji: stringValue(category?.emoji),
    upvote_count: numberValue(data.upvoteCount) ?? numberValue(data.upvote_count),
    comments_count: discussionCommentsCount(data),
    answered: Boolean(stringValue(data.answerChosenAt) ?? stringValue(data.answer_chosen_at) ?? answerId),
    answer_chosen_at: stringValue(data.answerChosenAt) ?? stringValue(data.answer_chosen_at),
    closed: booleanValue(data.closed),
    locked: booleanValue(data.locked),
    labels: labelNames(data.labels),
    snippet: discussionSnippet(data),
    body: truncateText(stringValue(data.bodyText) ?? stringValue(data.body), 10_000),
    answer: answer ? { ...normalizeGitHubDiscussionComment(answer, answerId), is_answer: true } : undefined,
    follow_up_ref: `${repository}#${number}`,
  };
}

export function normalizeGitHubDiscussionComments(raw: GitHubRawDiscussion): NormalizedGitHubDiscussionComment[] {
  const data = raw as Record<string, unknown>;
  const answerId = stringValue(objectValue(data.answer)?.id);
  const comments = objectValue(data.comments);
  const nodes = comments?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.map((entry) => normalizeGitHubDiscussionComment(entry, answerId));
}

function normalizeGitHubTimelineRelation(raw: GitHubRawIssueTimelineEvent): GitHubIssueRelation | null {
  const data = raw as Record<string, unknown>;
  if (stringValue(data.event) !== 'cross-referenced') {
    return null;
  }
  const source = data.source as Record<string, unknown> | undefined;
  const issue = source?.issue as Record<string, unknown> | undefined;
  if (!issue) {
    return null;
  }
  const number = numberValue(issue.number);
  const repository = githubRepository(issue);
  if (!number || !repository) {
    return null;
  }
  const isPullRequest = Boolean(issue.pull_request);
  return {
    type: isPullRequest ? 'pull_request' : 'issue',
    repository,
    number,
    ref: `${repository}#${number}`,
    url: stringValue(issue.html_url),
    title: truncateText(stringValue(issue.title), 300),
    state: stringValue(issue.state),
    event: stringValue(data.event),
  };
}

export function normalizeGitHubIssueRelations(rawEvents: GitHubRawIssueTimelineEvent[], maxPerType = 5): GitHubIssueRelations {
  const seen = new Set<string>();
  const pullRequests: GitHubIssueRelation[] = [];
  const issues: GitHubIssueRelation[] = [];
  for (const raw of rawEvents) {
    const relation = normalizeGitHubTimelineRelation(raw);
    if (!relation) {
      continue;
    }
    const key = `${relation.type}:${relation.ref}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const bucket = relation.type === 'pull_request' ? pullRequests : issues;
    if (bucket.length < maxPerType) {
      bucket.push(relation);
    }
    if (pullRequests.length >= maxPerType && issues.length >= maxPerType) {
      break;
    }
  }
  return {
    pull_requests: pullRequests,
    issues,
  };
}

function devtoUserName(data: Record<string, unknown>): string | undefined {
  const user = data.user as Record<string, unknown> | undefined;
  return truncateText(user ? stringValue(user.name) ?? stringValue(user.username) : undefined, 120);
}

function devtoTags(data: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(data.tag_list)) {
    return data.tag_list.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  }
  if (typeof data.tag_list === 'string') {
    return data.tag_list.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return undefined;
}

export function normalizeDevtoArticle(raw: DevtoRawArticle): NormalizedDevtoArticle {
  const data = raw as Record<string, unknown>;
  const id = String(numberValue(data.id) ?? stringValue(data.id) ?? 'unknown');
  const title = stringValue(data.title);
  const description = stringValue(data.description);
  return {
    platform: 'devto',
    id,
    article_id: Number(id),
    url: stringValue(data.url),
    title: truncateText(title, 300),
    author: devtoUserName(data),
    published_at: stringValue(data.published_at),
    tags: devtoTags(data),
    reactions_count: numberValue(data.public_reactions_count) ?? numberValue(data.positive_reactions_count),
    comments_count: numberValue(data.comments_count),
    reading_time_minutes: numberValue(data.reading_time_minutes),
    snippet: truncateText(description ?? title, 300),
    follow_up_article_id: Number(id),
  };
}

function devtoCommentBody(data: Record<string, unknown>): string | undefined {
  const body = stringValue(data.body_markdown)
    ?? htmlToText(stringValue(data.body_html))
    ?? stringValue(data.body_text)
    ?? stringValue(data.body);
  return body;
}

function normalizeDevtoCommentNode(raw: DevtoRawComment, depth: number, state: { total: number; truncatedByDepth: boolean; truncatedByTotalLimit: boolean }, totalLimit: number, maxDepth: number): DevtoCommentNode | null {
  if (state.total >= totalLimit) {
    state.truncatedByTotalLimit = true;
    return null;
  }

  const data = raw as Record<string, unknown>;
  state.total += 1;
  const node: DevtoCommentNode = {
    id: String(stringValue(data.id_code) ?? numberValue(data.id) ?? stringValue(data.id) ?? `comment-${state.total}`),
    author: devtoUserName(data),
    created_at: stringValue(data.created_at),
    body: devtoCommentBody(data),
  };

  if (depth >= maxDepth) {
    if (Array.isArray(data.children) && data.children.length > 0) {
      state.truncatedByDepth = true;
    }
    node.children = [];
    return node;
  }

  const childrenRaw = Array.isArray(data.children) ? data.children : [];
  const children: DevtoCommentNode[] = [];
  for (const childRaw of childrenRaw) {
    const child = normalizeDevtoCommentNode(childRaw as DevtoRawComment, depth + 1, state, totalLimit, maxDepth);
    if (!child) {
      break;
    }
    children.push(child);
  }
  node.children = children;
  return node;
}

export function normalizeDevtoComments(rawComments: DevtoRawComment[], articleId: number, topLevelLimit: number, topLevelOffset: number, totalLimit: number, maxDepth: number): DevtoCommentsResult {
  const state = { total: 0, truncatedByDepth: false, truncatedByTotalLimit: false };
  const topLevel = rawComments.slice(topLevelOffset, topLevelOffset + topLevelLimit);
  const comments: DevtoCommentNode[] = [];
  for (const raw of topLevel) {
    const node = normalizeDevtoCommentNode(raw, 1, state, totalLimit, maxDepth);
    if (!node) {
      break;
    }
    comments.push(node);
  }

  return {
    platform: 'devto',
    article_id: articleId,
    top_level_limit: topLevelLimit,
    top_level_offset: topLevelOffset,
    total_limit: totalLimit,
    max_depth: maxDepth,
    has_more_top_level_comments: rawComments.length > topLevelOffset + comments.length,
    next_top_level_offset: rawComments.length > topLevelOffset + comments.length ? topLevelOffset + comments.length : undefined,
    comments,
    bounds: {
      returned_top_level_comments: comments.length,
      returned_total_nodes: state.total,
      truncated_by_depth: state.truncatedByDepth,
      truncated_by_total_limit: state.truncatedByTotalLimit,
      truncated_by_top_level_limit: rawComments.length > topLevelOffset + topLevelLimit,
    },
  };
}

function createdAtString(data: Record<string, unknown>): string | undefined {
  return stringValue(data.created_at) ?? createdAt(data.created_at_i);
}

function hackerNewsItemId(data: Record<string, unknown>): number {
  return numberValue(data.objectID)
    ?? numberValue(data.id)
    ?? Number(stringValue(data.objectID) ?? stringValue(data.id) ?? 0);
}

function hackerNewsUrl(data: Record<string, unknown>, id: number): string {
  return stringValue(data.url) ?? `https://news.ycombinator.com/item?id=${id}`;
}

export function normalizeHackerNewsStory(raw: HackerNewsRawStory | HackerNewsRawItem): NormalizedHackerNewsStory {
  const data = raw as Record<string, unknown>;
  const idNumber = hackerNewsItemId(data);
  const id = String(idNumber || 'unknown');
  const title = stringValue(data.title);
  const text = htmlToText(stringValue(data.story_text) ?? stringValue(data.text));
  const children = Array.isArray(data.children) ? data.children : [];
  return {
    platform: 'hacker_news',
    id,
    url: hackerNewsUrl(data, idNumber),
    title: truncateText(title, 300),
    author: truncateText(stringValue(data.author), 120),
    created_at: createdAtString(data),
    points: numberValue(data.points),
    comments_count: numberValue(data.num_comments) ?? children.length,
    snippet: truncateText(text ?? title, 300),
    follow_up_story_id: idNumber,
  };
}

function normalizeHackerNewsCommentNode(raw: HackerNewsRawItem, depth: number, state: { total: number; truncatedByDepth: boolean; truncatedByTotalLimit: boolean }, totalLimit: number, maxDepth: number): HackerNewsCommentNode | null {
  if (state.total >= totalLimit) {
    state.truncatedByTotalLimit = true;
    return null;
  }

  const data = raw as Record<string, unknown>;
  state.total += 1;
  const node: HackerNewsCommentNode = {
    id: String(hackerNewsItemId(data) || `comment-${state.total}`),
    author: truncateText(stringValue(data.author), 120),
    created_at: createdAtString(data),
    body: htmlToText(stringValue(data.text)),
  };

  const childrenRaw = Array.isArray(data.children) ? data.children : [];
  if (depth >= maxDepth) {
    if (childrenRaw.length > 0) {
      state.truncatedByDepth = true;
    }
    node.children = [];
    return node;
  }

  const children: HackerNewsCommentNode[] = [];
  for (const childRaw of childrenRaw) {
    const child = normalizeHackerNewsCommentNode(childRaw as HackerNewsRawItem, depth + 1, state, totalLimit, maxDepth);
    if (!child) {
      break;
    }
    children.push(child);
  }
  node.children = children;
  return node;
}

export function normalizeHackerNewsStoryDetail(raw: HackerNewsRawItem, commentsLimit: number, commentsOffset: number, maxDepth: number): HackerNewsStoryDetailResult {
  const story = normalizeHackerNewsStory(raw);
  const data = raw as Record<string, unknown>;
  const state = { total: 0, truncatedByDepth: false, truncatedByTotalLimit: false };
  const comments: HackerNewsCommentNode[] = [];
  const allChildrenRaw = Array.isArray(data.children) ? data.children : [];
  const topLevelRaw = allChildrenRaw.slice(commentsOffset, commentsOffset + commentsLimit);
  const totalNodeLimit = commentsLimit * 10;

  for (const childRaw of topLevelRaw) {
    const comment = normalizeHackerNewsCommentNode(childRaw as HackerNewsRawItem, 1, state, totalNodeLimit, maxDepth);
    if (!comment) {
      break;
    }
    comments.push(comment);
  }

  return {
    ...story,
    body: htmlToText(stringValue(data.story_text) ?? stringValue(data.text)),
    comments_limit: commentsLimit,
    comments_offset: commentsOffset,
    next_comments_offset: allChildrenRaw.length > commentsOffset + comments.length ? commentsOffset + comments.length : undefined,
    max_depth: maxDepth,
    comments,
    bounds: {
      returned_top_level_comments: comments.length,
      returned_total_comments: state.total,
      truncated_by_depth: state.truncatedByDepth,
      truncated_by_total_limit: state.truncatedByTotalLimit,
    },
  };
}
