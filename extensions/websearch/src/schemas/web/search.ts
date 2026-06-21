import { Type } from 'typebox';
import { boundedSearchLimitSchema } from '../common/index.js';

export const webSearchParameters = Type.Object({
  query: Type.String({ description: 'Web search query to run against the V1 hosted search provider chain.' }),
  limit: boundedSearchLimitSchema,
});
