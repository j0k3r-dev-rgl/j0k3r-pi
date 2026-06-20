import { Type } from 'typebox';

export const devtoSearchParameters = Type.Object({
  tag: Type.String(),
  limit: Type.Optional(Type.Number()),
});

export const devtoCommentsParameters = Type.Object({
  article_id: Type.Number(),
  topLevelLimit: Type.Optional(Type.Number()),
  topLevelOffset: Type.Optional(Type.Number()),
});
