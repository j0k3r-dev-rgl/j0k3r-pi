import { Type } from 'typebox';
import { WEB_FETCH_DEFAULT_MAX_BYTES, WEB_FETCH_MAX_BYTES } from '../../types.js';

export const webFetchParameters = Type.Object({
  url: Type.String({ description: 'HTTPS URL to fetch and extract readable text from.' }),
  maxBytes: Type.Optional(Type.Number({ description: `Maximum response bytes to read. Defaults to ${WEB_FETCH_DEFAULT_MAX_BYTES}; maximum ${WEB_FETCH_MAX_BYTES}.` })),
});
