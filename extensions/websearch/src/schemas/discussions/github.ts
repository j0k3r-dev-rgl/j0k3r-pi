import { Type } from 'typebox';

export const githubSearchParameters = Type.Object({
  query: Type.String(),
  repo: Type.Optional(Type.String()),
  state: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('closed'), Type.Literal('all')])),
  limit: Type.Optional(Type.Number()),
});

export const githubIssueParameters = Type.Object({
  issue: Type.String(),
  commentsLimit: Type.Optional(Type.Number()),
  commentsOffset: Type.Optional(Type.Number()),
});

export const githubPullRequestSearchParameters = Type.Object({
  query: Type.String(),
  repo: Type.Optional(Type.String()),
  state: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('closed'), Type.Literal('merged'), Type.Literal('all')])),
  limit: Type.Optional(Type.Number()),
});

export const githubPullRequestParameters = Type.Object({
  pull_request: Type.String(),
  commentsLimit: Type.Optional(Type.Number()),
  commentsOffset: Type.Optional(Type.Number()),
  reviewCommentsLimit: Type.Optional(Type.Number()),
  reviewCommentsOffset: Type.Optional(Type.Number()),
});

export const githubReleasesParameters = Type.Object({
  repo: Type.String(),
  limit: Type.Optional(Type.Number()),
  includePrereleases: Type.Optional(Type.Boolean()),
});

export const githubReleaseParameters = Type.Object({
  repo: Type.String(),
  tag: Type.String(),
});

export const githubRepoParameters = Type.Object({
  repo: Type.String(),
  includeReadme: Type.Optional(Type.Boolean()),
});

export const githubFileParameters = Type.Object({
  repo: Type.String(),
  path: Type.String(),
  ref: Type.Optional(Type.String()),
});

export const githubCodeSearchParameters = Type.Object({
  query: Type.String(),
  repo: Type.Optional(Type.String()),
  owner: Type.Optional(Type.String()),
  language: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
});

export const githubDiscussionSearchParameters = Type.Object({
  query: Type.String(),
  repo: Type.Optional(Type.String()),
  owner: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
});

export const githubDiscussionParameters = Type.Object({
  discussion: Type.String(),
  commentsLimit: Type.Optional(Type.Number()),
  commentsOffset: Type.Optional(Type.Number()),
});
