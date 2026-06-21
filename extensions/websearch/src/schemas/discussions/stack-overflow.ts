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

const stackExchangeSource = Type.Union([
  Type.Literal('stack_overflow'),
  Type.Literal('server_fault'),
  Type.Literal('unix_linux'),
  Type.Literal('super_user'),
  Type.Literal('dba'),
]);

const stackExchangeSite = Type.Union([
  Type.Literal('stackoverflow'),
  Type.Literal('serverfault'),
  Type.Literal('unix'),
  Type.Literal('superuser'),
  Type.Literal('dba'),
]);

export const stackExchangeQuestionParameters = Type.Object({
  question: Type.String(),
  source: Type.Optional(stackExchangeSource),
  site: Type.Optional(stackExchangeSite),
});

export const stackExchangeAnswersParameters = Type.Object({
  question: Type.String(),
  source: Type.Optional(stackExchangeSource),
  site: Type.Optional(stackExchangeSite),
  limit: Type.Optional(Type.Number()),
});

export const stackExchangeCommentsParameters = Type.Object({
  question: Type.String(),
  source: Type.Optional(stackExchangeSource),
  site: Type.Optional(stackExchangeSite),
  commentsLimit: Type.Optional(Type.Number()),
  commentsOffset: Type.Optional(Type.Number()),
});
