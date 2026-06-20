import { Type } from 'typebox';
import { SEARCH_MAX_LIMIT } from '../../validation.js';

export const boundedSearchLimitSchema = Type.Optional(Type.Number({ description: `Maximum results to return, 1-${SEARCH_MAX_LIMIT}.` }));
