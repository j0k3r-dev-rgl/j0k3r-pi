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
