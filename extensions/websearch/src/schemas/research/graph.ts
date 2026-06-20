import { Type } from 'typebox';

export const researchGraphLimit = Type.Optional(Type.Number({ description: 'Maximum graph items to return, 1-20. Defaults to 5.' }));
export const researchGraphOffset = Type.Optional(Type.Number({ description: 'Zero-based pagination offset. Defaults to 0.' }));
export const researchGraphPage = Type.Optional(Type.Number({ description: 'One-based page number for provider pagination. Defaults to 1.' }));

export const openAlexWorkGraphParameters = Type.Object({
  work: Type.String({ description: 'OpenAlex work id, OpenAlex URL, DOI, or DOI URL.' }),
  limit: researchGraphLimit,
  page: researchGraphPage,
});

export const semanticScholarPaperGraphParameters = Type.Object({
  paper: Type.String({ description: 'Semantic Scholar paper id, URL, DOI:..., ARXIV:..., PMID:..., PMCID, DOI, or arXiv id. arXiv versions are normalized for graph lookups.' }),
  limit: researchGraphLimit,
  offset: researchGraphOffset,
});

export const europePmcArticleGraphParameters = Type.Object({
  article: Type.String({ description: 'Europe PMC article identifier: DOI, PMID/external id, PMCID, or Europe PMC URL.' }),
  limit: researchGraphLimit,
  page: researchGraphPage,
});

export const crossrefWorkReferencesParameters = Type.Object({
  doi: Type.String({ description: 'DOI or DOI URL for the Crossref work.' }),
  limit: researchGraphLimit,
  offset: researchGraphOffset,
});
