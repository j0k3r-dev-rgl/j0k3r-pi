import type {
  GitHubCodeSearchResult,
  GitHubDiscussionDetailResult,
  GitHubDiscussionSearchResult,
  GitHubFileResult,
  GitHubIssueDetailResult,
  GitHubIssueSearchResult,
  GitHubPullRequestDetailResult,
  GitHubPullRequestSearchResult,
  GitHubReleaseResult,
  GitHubReleasesResult,
  GitHubRepoResult,
} from '../../types.js';

function githubRelationsSummary(item: { related_pull_requests?: GitHubIssueSearchResult['items'][number]['related_pull_requests']; related_issues?: GitHubIssueSearchResult['items'][number]['related_issues'] }, indent = ''): string | undefined {
  const lines: string[] = [];
  if (item.related_pull_requests && item.related_pull_requests.length > 0) {
    lines.push(`${indent}related PRs: ${item.related_pull_requests.map((relation) => `${relation.ref}${relation.state ? ` (${relation.state})` : ''}`).join(', ')}`);
  }
  if (item.related_issues && item.related_issues.length > 0) {
    lines.push(`${indent}related issues: ${item.related_issues.map((relation) => `${relation.ref}${relation.state ? ` (${relation.state})` : ''}`).join(', ')}`);
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

export function githubSearchSummary(data: GitHubIssueSearchResult): string {
  if (data.items.length === 0) return `No GitHub issues found for "${data.query}".`;
  return data.items.map((item, index) => {
    const metadata = [
      item.state ? `state: ${item.state}` : undefined,
      item.comments_count === undefined ? undefined : `comments: ${item.comments_count}`,
      item.labels && item.labels.length > 0 ? `labels: ${item.labels.join(', ')}` : undefined,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    const relations = githubRelationsSummary(item, '   ');
    return `${index + 1}. ${item.title ?? item.follow_up_ref} — ${item.follow_up_ref} — ${item.url}${metadata ? ` (${metadata})` : ''}${snippet}${relations ? `\n${relations}` : ''}`;
  }).join('\n');
}

export function githubIssueSummary(data: GitHubIssueDetailResult): string {
  const metadata = [
    data.follow_up_ref,
    data.state ? `state: ${data.state}` : undefined,
    data.comments_count === undefined ? undefined : `comments: ${data.comments_count}`,
    data.labels && data.labels.length > 0 ? `labels: ${data.labels.join(', ')}` : undefined,
  ].filter(Boolean).join('; ');
  const comments = data.comments.length > 0
    ? [`Comments offset ${data.comments_offset} limit ${data.comments_limit}`, ...data.comments.map((comment, index) => `${data.comments_offset + index + 1}. ${comment.author ?? 'unknown'}: ${comment.body ?? ''}`)].join('\n')
    : undefined;
  const relatedPullRequests = data.related_pull_requests && data.related_pull_requests.length > 0
    ? ['Related pull requests', ...data.related_pull_requests.map((relation) => `- ${relation.ref}${relation.title ? ` — ${relation.title}` : ''}${relation.state ? ` (${relation.state})` : ''}${relation.url ? ` — ${relation.url}` : ''}`)].join('\n')
    : undefined;
  const relatedIssues = data.related_issues && data.related_issues.length > 0
    ? ['Related issues', ...data.related_issues.map((relation) => `- ${relation.ref}${relation.title ? ` — ${relation.title}` : ''}${relation.state ? ` (${relation.state})` : ''}${relation.url ? ` — ${relation.url}` : ''}`)].join('\n')
    : undefined;
  return [data.title ?? data.follow_up_ref, data.url, metadata, data.body ?? '', relatedPullRequests, relatedIssues, comments].filter(Boolean).join('\n');
}

export function githubPullRequestSearchSummary(data: GitHubPullRequestSearchResult): string {
  if (data.items.length === 0) return `No GitHub pull requests found for "${data.query}".`;
  return data.items.map((item, index) => {
    const metadata = [
      item.state ? `state: ${item.state}` : undefined,
      item.merged === undefined ? undefined : `merged: ${item.merged}`,
      item.merged_at ? `merged_at: ${item.merged_at}` : undefined,
      item.comments_count === undefined ? undefined : `comments: ${item.comments_count}`,
      item.labels && item.labels.length > 0 ? `labels: ${item.labels.join(', ')}` : undefined,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    const relations = githubRelationsSummary(item, '   ');
    return `${index + 1}. ${item.title ?? item.follow_up_ref} — ${item.follow_up_ref} — ${item.url}${metadata ? ` (${metadata})` : ''}${snippet}${relations ? `\n${relations}` : ''}`;
  }).join('\n');
}

export function githubPullRequestSummary(data: GitHubPullRequestDetailResult): string {
  const metadata = [
    data.follow_up_ref,
    data.state ? `state: ${data.state}` : undefined,
    data.merged === undefined ? undefined : `merged: ${data.merged}`,
    data.merged_at ? `merged_at: ${data.merged_at}` : undefined,
    data.comments_count === undefined ? undefined : `comments: ${data.comments_count}`,
    data.review_comments_count === undefined ? undefined : `review_comments: ${data.review_comments_count}`,
    data.commits_count === undefined ? undefined : `commits: ${data.commits_count}`,
    data.changed_files_count === undefined ? undefined : `changed_files: ${data.changed_files_count}`,
    data.additions === undefined ? undefined : `additions: ${data.additions}`,
    data.deletions === undefined ? undefined : `deletions: ${data.deletions}`,
  ].filter(Boolean).join('; ');
  const refs = [
    data.base_ref ? `base: ${data.base_repo ?? data.repository}:${data.base_ref}` : undefined,
    data.head_ref ? `head: ${data.head_repo ?? data.repository}:${data.head_ref}` : undefined,
  ].filter(Boolean).join('\n');
  const relatedPullRequests = data.related_pull_requests && data.related_pull_requests.length > 0
    ? ['Related pull requests', ...data.related_pull_requests.map((relation) => `- ${relation.ref}${relation.title ? ` — ${relation.title}` : ''}${relation.state ? ` (${relation.state})` : ''}${relation.url ? ` — ${relation.url}` : ''}`)].join('\n')
    : undefined;
  const relatedIssues = data.related_issues && data.related_issues.length > 0
    ? ['Related issues', ...data.related_issues.map((relation) => `- ${relation.ref}${relation.title ? ` — ${relation.title}` : ''}${relation.state ? ` (${relation.state})` : ''}${relation.url ? ` — ${relation.url}` : ''}`)].join('\n')
    : undefined;
  const comments = data.comments.length > 0
    ? [`Comments offset ${data.comments_offset} limit ${data.comments_limit}`, ...data.comments.map((comment, index) => `${data.comments_offset + index + 1}. ${comment.author ?? 'unknown'}: ${comment.body ?? ''}`)].join('\n')
    : undefined;
  const reviewComments = data.review_comments.length > 0
    ? [`Review comments offset ${data.review_comments_offset} limit ${data.review_comments_limit}`, ...data.review_comments.map((comment, index) => `${data.review_comments_offset + index + 1}. ${comment.author ?? 'unknown'}${comment.path ? ` on ${comment.path}` : ''}: ${comment.body ?? ''}`)].join('\n')
    : undefined;
  const reviews = data.reviews.length > 0
    ? ['Reviews', ...data.reviews.map((review) => `- ${review.author ?? 'unknown'}${review.state ? ` ${review.state}` : ''}${review.body ? `: ${review.body}` : ''}`)].join('\n')
    : undefined;
  return [data.title ?? data.follow_up_ref, data.url, metadata, refs, data.body ?? '', relatedPullRequests, relatedIssues, reviews, comments, reviewComments].filter(Boolean).join('\n');
}

export function githubReleasesSummary(data: GitHubReleasesResult): string {
  if (data.items.length === 0) return `No GitHub releases found for ${data.repository}.`;
  return data.items.map((item, index) => {
    const metadata = [
      item.published_at ? `published: ${item.published_at}` : undefined,
      item.prerelease === undefined ? undefined : `prerelease: ${item.prerelease}`,
      item.draft === undefined ? undefined : `draft: ${item.draft}`,
      item.assets_count === undefined ? undefined : `assets: ${item.assets_count}`,
      item.author ? `author: ${item.author}` : undefined,
    ].filter(Boolean).join('; ');
    const body = item.body ? `\n   notes: ${item.body}` : '';
    return `${index + 1}. ${item.name ?? item.tag} — ${item.tag} — ${item.url ?? `${data.repository}/releases/tag/${item.tag}`}${metadata ? ` (${metadata})` : ''}${body}`;
  }).join('\n');
}

export function githubReleaseSummary(data: GitHubReleaseResult): string {
  const metadata = [
    data.published_at ? `published: ${data.published_at}` : undefined,
    data.target_commitish ? `target: ${data.target_commitish}` : undefined,
    data.prerelease === undefined ? undefined : `prerelease: ${data.prerelease}`,
    data.draft === undefined ? undefined : `draft: ${data.draft}`,
    data.assets_count === undefined ? undefined : `assets: ${data.assets_count}`,
    data.author ? `author: ${data.author}` : undefined,
  ].filter(Boolean).join('; ');
  const body = data.body ? `\nnotes: ${data.body}` : '';
  return `${data.name ?? data.tag} — ${data.tag} — ${data.url ?? `${data.repository}/releases/tag/${data.tag}`}${metadata ? ` (${metadata})` : ''}${body}`;
}

export function githubRepoSummary(data: GitHubRepoResult): string {
  const metadata = [
    data.stars === undefined ? undefined : `stars: ${data.stars}`,
    data.forks === undefined ? undefined : `forks: ${data.forks}`,
    data.language ? `language: ${data.language}` : undefined,
    data.license ? `license: ${data.license}` : undefined,
    data.default_branch ? `default_branch: ${data.default_branch}` : undefined,
    data.topics && data.topics.length > 0 ? `topics: ${data.topics.join(', ')}` : undefined,
  ].filter(Boolean).join('; ');
  const readme = data.readme ? `\nREADME: ${data.readme.path}${data.readme.content ? `\n${data.readme.content}` : ''}` : '';
  return `${data.repository}${data.description ? ` — ${data.description}` : ''}${data.url ? ` — ${data.url}` : ''}${metadata ? ` (${metadata})` : ''}${readme}`;
}

export function githubFileSummary(data: GitHubFileResult): string {
  const ref = data.ref ? `@${data.ref}` : '';
  const metadata = [
    data.size === undefined ? undefined : `size: ${data.size}`,
    data.sha ? `sha: ${data.sha}` : undefined,
    data.encoding ? `encoding: ${data.encoding}` : undefined,
  ].filter(Boolean).join('; ');
  return `${data.repository}:${data.path}${ref}${data.url ? ` — ${data.url}` : ''}${metadata ? ` (${metadata})` : ''}\n${data.content ?? ''}`;
}

export function githubCodeSearchSummary(data: GitHubCodeSearchResult): string {
  if (data.items.length === 0) return `No GitHub code results found for "${data.query}".`;
  return data.items.map((item, index) => {
    const metadata = [
      item.score === undefined ? undefined : `score: ${item.score}`,
      `follow-up: ${item.followup_tool} ${item.followup_ref}`,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    return `${index + 1}. ${item.repository}/${item.path}${item.url ? ` — ${item.url}` : ''}${metadata ? ` (${metadata})` : ''}${snippet}`;
  }).join('\n');
}

export function githubDiscussionSearchSummary(data: GitHubDiscussionSearchResult): string {
  if (data.items.length === 0) return `No GitHub discussions found for "${data.query}".`;
  return data.items.map((item, index) => {
    const metadata = [
      item.category ? `category: ${item.category}` : undefined,
      item.upvote_count === undefined ? undefined : `upvotes: ${item.upvote_count}`,
      item.comments_count === undefined ? undefined : `comments: ${item.comments_count}`,
      item.answered === undefined ? undefined : `answered: ${item.answered}`,
      item.labels && item.labels.length > 0 ? `labels: ${item.labels.join(', ')}` : undefined,
    ].filter(Boolean).join('; ');
    const snippet = item.snippet ? `\n   snippet: ${item.snippet}` : '';
    return `${index + 1}. ${item.title ?? item.follow_up_ref} — ${item.follow_up_ref} — ${item.url}${metadata ? ` (${metadata})` : ''}${snippet}`;
  }).join('\n');
}

export function githubDiscussionSummary(data: GitHubDiscussionDetailResult): string {
  const metadata = [
    data.follow_up_ref,
    data.category ? `category: ${data.category}` : undefined,
    data.upvote_count === undefined ? undefined : `upvotes: ${data.upvote_count}`,
    data.comments_count === undefined ? undefined : `comments: ${data.comments_count}`,
    data.answered === undefined ? undefined : `answered: ${data.answered}`,
    data.closed === undefined ? undefined : `closed: ${data.closed}`,
    data.locked === undefined ? undefined : `locked: ${data.locked}`,
    data.labels && data.labels.length > 0 ? `labels: ${data.labels.join(', ')}` : undefined,
  ].filter(Boolean).join('; ');
  const answer = data.answer ? `Answer\n- ${data.answer.author ?? 'unknown'}: ${data.answer.body ?? ''}` : undefined;
  const comments = data.comments.length > 0
    ? [`Comments offset ${data.comments_offset} limit ${data.comments_limit}`, ...data.comments.map((comment, index) => `${data.comments_offset + index + 1}. ${comment.author ?? 'unknown'}${comment.is_answer ? ' [answer]' : ''}: ${comment.body ?? ''}`)].join('\n')
    : undefined;
  return [data.title ?? data.follow_up_ref, data.url, metadata, data.body ?? '', answer, comments].filter(Boolean).join('\n');
}
