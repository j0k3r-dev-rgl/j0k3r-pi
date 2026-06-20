import { Type } from 'typebox';

export const openAlexWorkParameters = Type.Object({
  work: Type.String({ description: 'OpenAlex work id, OpenAlex URL, DOI, or DOI URL.' }),
});
