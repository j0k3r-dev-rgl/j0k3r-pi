import { Type } from 'typebox';

export const crossrefWorkParameters = Type.Object({
  doi: Type.String({ description: 'DOI or DOI URL for the Crossref work.' }),
});
