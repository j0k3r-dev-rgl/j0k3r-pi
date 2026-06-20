import { Type } from 'typebox';

export const arxivPaperParameters = Type.Object({
  paper: Type.String({ description: 'arXiv id or arXiv URL, e.g. 2506.23071v2.' }),
});
