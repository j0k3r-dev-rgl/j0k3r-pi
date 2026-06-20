import { Type } from 'typebox';

export const stackSearchParameters = Type.Object({
  query: Type.String(),
  limit: Type.Optional(Type.Number()),
});

export const stackQuestionParameters = Type.Object({
  question: Type.String(),
});

export const stackAnswersParameters = Type.Object({
  question: Type.String(),
  limit: Type.Optional(Type.Number()),
});

export const stackCommentsParameters = Type.Object({
  question: Type.String(),
  commentsLimit: Type.Optional(Type.Number()),
  commentsOffset: Type.Optional(Type.Number()),
});
