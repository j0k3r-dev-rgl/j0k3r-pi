import { Type } from 'typebox';
import {
  normalizeDevtoArticle,
  normalizeGitHubIssue,
  normalizeGitHubIssueRelations,
  normalizeGitHubPullRequest,
  normalizeHackerNewsStory,
  normalizeStackOverflowQuestion,
} from '../../normalize.js';
import type {
  NormalizedDevtoArticle,
  NormalizedGitHubIssue,
  NormalizedGitHubPullRequest,
  NormalizedHackerNewsStory,
  NormalizedStackOverflowQuestion,
  PiToolResult,
  RegisterWebsearchToolsDeps,
  ToolError,
} from '../../types.js';
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, ValidationError } from '../../validation.js';
import { buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { clientsFromDeps, signalFromContext, type ExecuteContext } from '../common/index.js';

const discussionSources = [
  'stack_overflow',
  'github',
  'github_issues',
  'github_pull_requests',
  'devto',
  'hacker_news',
  'all',
] as const;

type DiscussionSource = typeof discussionSources[number];
type ConcreteDiscussionSource = Exclude<DiscussionSource, 'all' | 'github'>;
type DiscussionKind = 'question' | 'issue' | 'pull_request' | 'article' | 'story';

type DiscussionSearchInput = {
  query: string;
  source: DiscussionSource;
  limit: number;
  repo?: string;
  state?: 'open' | 'closed' | 'merged' | 'all';
};

type UnifiedDiscussionItem = {
  source: 'stack_overflow' | 'github' | 'devto' | 'hacker_news';
  source_query: ConcreteDiscussionSource;
  kind: DiscussionKind;
  title?: string;
  url?: string;
  summary?: string;
  score?: number;
  comments_count?: number;
  published_at?: string;
  updated_at?: string;
  entity_id?: string;
  followup_tool?: string;
  followup_ref?: string | number;
  rank: number;
  source_rank: number;
  metadata?: Record<string, unknown>;
};

type DiscussionSourceError = {
  source: ConcreteDiscussionSource;
  error: ToolError;
};

type DiscussionSearchResult = {
  query: string;
  selected_source: DiscussionSource;
  limit: number;
  sources_searched: ConcreteDiscussionSource[];
  source_errors: DiscussionSourceError[];
  items: UnifiedDiscussionItem[];
};

export const discussionSearchParameters = Type.Object({
  query: Type.String({ description: 'Search query to run across discussion sources.' }),
  source: Type.Optional(Type.Union(discussionSources.map((source) => Type.Literal(source)) as [ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]], {
    description: 'Optional source filter. Omit or use all for fan-out. Use github for both GitHub issues and pull requests.',
  })),
  limit: Type.Optional(Type.Number({ description: `Maximum unified results to return, 1-${SEARCH_MAX_LIMIT}.` })),
  repo: Type.Optional(Type.String({ description: 'Optional owner/repo scope for GitHub sources.' })),
  state: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('closed'), Type.Literal('merged'), Type.Literal('all')], {
    description: 'Optional GitHub state filter. merged applies to pull requests only.',
  })),
});

export const discussionToolNames = ['discussion_search'] as const;

function asInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') throw new ValidationError(`${key} is required.`);
  return value.trim();
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${key} must be a string.`);
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function boundedLimit(input: Record<string, unknown>): number {
  const value = input.limit;
  if (value === undefined || value === null || value === '') return SEARCH_DEFAULT_LIMIT;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new ValidationError('limit must be an integer.');
  if (value < 1) throw new ValidationError('limit must be at least 1.');
  if (value > SEARCH_MAX_LIMIT) throw new ValidationError(`limit must be at most ${SEARCH_MAX_LIMIT}.`);
  return value;
}

function optionalSource(input: Record<string, unknown>): DiscussionSource {
  const value = input.source;
  if (value === undefined || value === null || value === '') return 'all';
  if (typeof value !== 'string' || !(discussionSources as readonly string[]).includes(value)) {
    throw new ValidationError(`source must be one of: ${discussionSources.join(', ')}.`);
  }
  return value as DiscussionSource;
}

function optionalState(input: Record<string, unknown>): DiscussionSearchInput['state'] {
  const value = input.state;
  if (value === undefined || value === null || value === '') return undefined;
  if (value !== 'open' && value !== 'closed' && value !== 'merged' && value !== 'all') {
    throw new ValidationError('state must be "open", "closed", "merged", or "all".');
  }
  return value;
}

function validateDiscussionSearch(value: unknown): DiscussionSearchInput {
  const input = asInput(value);
  return {
    query: requiredString(input, 'query'),
    source: optionalSource(input),
    limit: boundedLimit(input),
    repo: optionalString(input, 'repo'),
    state: optionalState(input),
  };
}

function concreteSources(source: DiscussionSource): ConcreteDiscussionSource[] {
  if (source === 'all') return ['stack_overflow', 'github_issues', 'github_pull_requests', 'devto', 'hacker_news'];
  if (source === 'github') return ['github_issues', 'github_pull_requests'];
  return [source];
}

function addRank(items: UnifiedDiscussionItem[]): UnifiedDiscussionItem[] {
  return items.map((item, index) => ({ ...item, rank: index + 1 }));
}

function devtoTagFromQuery(query: string): string {
  const firstToken = query
    .split(/[\s,;/]+/)
    .map((token) => token.trim())
    .find(Boolean) ?? query;
  const tag = firstToken
    .replace(/^#/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
  return tag || query.toLowerCase().replace(/[^a-z0-9]/g, '').trim() || query;
}

function interleaveSourceResults(groups: UnifiedDiscussionItem[][], limit: number): UnifiedDiscussionItem[] {
  const items: UnifiedDiscussionItem[] = [];
  let index = 0;
  while (items.length < limit) {
    let added = false;
    for (const group of groups) {
      const item = group[index];
      if (!item) continue;
      items.push(item);
      added = true;
      if (items.length >= limit) break;
    }
    if (!added) break;
    index += 1;
  }
  return items;
}

function fromStackOverflow(item: NormalizedStackOverflowQuestion, sourceRank: number): UnifiedDiscussionItem {
  return {
    source: 'stack_overflow',
    source_query: 'stack_overflow',
    kind: 'question',
    title: item.title,
    url: item.url,
    summary: item.snippet,
    score: item.score,
    comments_count: item.answer_count,
    published_at: item.created_at,
    updated_at: item.last_activity_at,
    entity_id: item.question_id,
    followup_tool: 'stack_overflow_question_get',
    followup_ref: item.question_id,
    rank: 0,
    source_rank: sourceRank,
    metadata: { tags: item.tags, answered: item.is_answered, view_count: item.view_count },
  };
}

function fromGitHubIssue(item: NormalizedGitHubIssue, sourceRank: number): UnifiedDiscussionItem {
  return {
    source: 'github',
    source_query: 'github_issues',
    kind: 'issue',
    title: item.title,
    url: item.url,
    summary: item.snippet,
    score: item.score,
    comments_count: item.comments_count,
    published_at: item.created_at,
    updated_at: item.updated_at,
    entity_id: item.follow_up_ref,
    followup_tool: 'github_issue_get',
    followup_ref: item.follow_up_ref,
    rank: 0,
    source_rank: sourceRank,
    metadata: { repository: item.repository, state: item.state, labels: item.labels, related_pull_requests: item.related_pull_requests, related_issues: item.related_issues },
  };
}

function fromGitHubPullRequest(item: NormalizedGitHubPullRequest, sourceRank: number): UnifiedDiscussionItem {
  return {
    source: 'github',
    source_query: 'github_pull_requests',
    kind: 'pull_request',
    title: item.title,
    url: item.url,
    summary: item.snippet,
    score: item.score,
    comments_count: item.comments_count,
    published_at: item.created_at,
    updated_at: item.updated_at,
    entity_id: item.follow_up_ref,
    followup_tool: 'github_pull_request_get',
    followup_ref: item.follow_up_ref,
    rank: 0,
    source_rank: sourceRank,
    metadata: { repository: item.repository, state: item.state, merged: item.merged, labels: item.labels, related_pull_requests: item.related_pull_requests, related_issues: item.related_issues },
  };
}

function fromDevto(item: NormalizedDevtoArticle, sourceRank: number): UnifiedDiscussionItem {
  return {
    source: 'devto',
    source_query: 'devto',
    kind: 'article',
    title: item.title,
    url: item.url,
    summary: item.snippet,
    score: item.reactions_count,
    comments_count: item.comments_count,
    published_at: item.published_at,
    entity_id: item.id,
    followup_tool: 'devto_comments_get',
    followup_ref: item.follow_up_article_id,
    rank: 0,
    source_rank: sourceRank,
    metadata: { tags: item.tags, reading_time_minutes: item.reading_time_minutes, author: item.author },
  };
}

function fromHackerNews(item: NormalizedHackerNewsStory, sourceRank: number): UnifiedDiscussionItem {
  return {
    source: 'hacker_news',
    source_query: 'hacker_news',
    kind: 'story',
    title: item.title,
    url: item.url,
    summary: item.snippet,
    score: item.points,
    comments_count: item.comments_count,
    published_at: item.created_at,
    entity_id: item.id,
    followup_tool: 'hackernews_story_get',
    followup_ref: item.follow_up_story_id,
    rank: 0,
    source_rank: sourceRank,
    metadata: { author: item.author },
  };
}

async function searchOneSource(source: ConcreteDiscussionSource, input: DiscussionSearchInput, deps: RegisterWebsearchToolsDeps, signal?: AbortSignal): Promise<UnifiedDiscussionItem[]> {
  const clients = clientsFromDeps(deps);
  const limit = input.limit;

  if (source === 'stack_overflow') {
    const raw = await clients.stackExchange.searchQuestions({ query: input.query, limit }, signal);
    return raw.map((item, index) => fromStackOverflow(normalizeStackOverflowQuestion(item), index + 1));
  }

  if (source === 'github_issues') {
    if (input.state === 'merged') throw new ValidationError('state "merged" is only valid for github_pull_requests.');
    const raw = await clients.github.searchIssues({ query: input.query, limit, repo: input.repo, state: input.state }, signal);
    return Promise.all(raw.map(async (item, index) => {
      const normalized = normalizeGitHubIssue(item);
      const [owner, repo] = normalized.repository.split('/');
      if (!owner || !repo || !normalized.number) return fromGitHubIssue(normalized, index + 1);
      const relations = normalizeGitHubIssueRelations(await clients.github.listIssueTimelineEvents({ owner, repo, issueNumber: normalized.number, url: normalized.url }, signal));
      return fromGitHubIssue({ ...normalized, related_pull_requests: relations.pull_requests, related_issues: relations.issues }, index + 1);
    }));
  }

  if (source === 'github_pull_requests') {
    const raw = await clients.github.searchPullRequests({ query: input.query, limit, repo: input.repo, state: input.state }, signal);
    return Promise.all(raw.map(async (item, index) => {
      const normalized = normalizeGitHubPullRequest(item);
      const [owner, repo] = normalized.repository.split('/');
      if (!owner || !repo || !normalized.number) return fromGitHubPullRequest(normalized, index + 1);
      const relations = normalizeGitHubIssueRelations(await clients.github.listIssueTimelineEvents({ owner, repo, issueNumber: normalized.number, url: normalized.url }, signal));
      return fromGitHubPullRequest({ ...normalized, related_pull_requests: relations.pull_requests, related_issues: relations.issues }, index + 1);
    }));
  }

  if (source === 'devto') {
    const raw = await clients.devto.searchArticles({ tag: devtoTagFromQuery(input.query), limit }, signal);
    return raw.map((item, index) => fromDevto(normalizeDevtoArticle(item), index + 1));
  }

  const raw = await clients.hackerNews.searchStories({ query: input.query, limit }, signal);
  return raw.map((item, index) => fromHackerNews(normalizeHackerNewsStory(item), index + 1));
}

function discussionSummary(data: DiscussionSearchResult): string {
  const failedSources = data.source_errors.map((entry) => entry.source);
  if (data.items.length === 0) {
    const suffix = failedSources.length > 0 ? ` Some sources failed: ${failedSources.join(', ')}.` : '';
    return `discussion_search found no results for "${data.query}". Sources searched: ${data.sources_searched.join(', ') || 'none'}.${suffix}`;
  }
  const lines = [`discussion_search results for "${data.query}". Sources searched: ${data.sources_searched.join(', ')}.`];
  if (failedSources.length > 0) {
    lines.push(`Some sources failed: ${failedSources.join(', ')}.`);
  }
  for (const item of data.items) {
    const parts = [`${item.rank}. [${item.source}/${item.kind}] ${item.title ?? '(untitled)'}`];
    if (item.url) parts.push(`— ${item.url}`);
    lines.push(parts.join(' '));
    const metrics = [
      item.score === undefined ? undefined : `score: ${item.score}`,
      item.comments_count === undefined ? undefined : `comments: ${item.comments_count}`,
      item.followup_tool && item.followup_ref !== undefined ? `followup: ${item.followup_tool}(${item.followup_ref})` : undefined,
    ].filter(Boolean).join(' | ');
    if (metrics) lines.push(`   ${metrics}`);
    if (item.summary) lines.push(`   summary: ${item.summary}`);
  }
  return lines.join('\n');
}

export const discussionTools: WebsearchToolModule<typeof discussionToolNames[number]> = {
  names: discussionToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'discussion_search',
      description: 'Search community and human discussion sources with unified bounded read-only results. Supports fan-out or a single source filter.',
      parameters: discussionSearchParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<DiscussionSearchResult>> {
        try {
          const input = validateDiscussionSearch(params);
          const sources = concreteSources(input.source);
          const signal = signalFromContext(context);
          const settled = await Promise.all(sources.map(async (source) => {
            try {
              return { source, items: await searchOneSource(source, input, deps, signal), error: undefined };
            } catch (error) {
              return { source, items: [] as UnifiedDiscussionItem[], error: toToolError(error) };
            }
          }));
          const sourceErrors = settled
            .filter((entry): entry is { source: ConcreteDiscussionSource; items: UnifiedDiscussionItem[]; error: ToolError } => Boolean(entry.error))
            .map((entry) => ({ source: entry.source, error: entry.error }));
          const items = addRank(interleaveSourceResults(settled.map((entry) => entry.items), input.limit));
          const data: DiscussionSearchResult = {
            query: input.query,
            selected_source: input.source,
            limit: input.limit,
            sources_searched: sources,
            source_errors: sourceErrors,
            items,
          };
          return buildSuccess(discussionSummary(data), data, 12000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
