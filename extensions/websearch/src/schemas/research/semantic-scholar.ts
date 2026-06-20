import { Type } from 'typebox';

export const semanticScholarPaperParameters = Type.Object({
  paper: Type.String({ description: 'Semantic Scholar paper id, URL, DOI:..., ARXIV:..., PMID:..., PMCID:..., DOI, or arXiv id.' }),
});
