import { Type } from 'typebox';

export const hackerNewsSearchParameters = Type.Object({
  query: Type.String(),
  limit: Type.Optional(Type.Number()),
});

export const hackerNewsStoryParameters = Type.Object({
  story_id: Type.Number(),
  commentsLimit: Type.Optional(Type.Number()),
  commentsOffset: Type.Optional(Type.Number()),
});
