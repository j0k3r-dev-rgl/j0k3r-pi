import { Type } from 'typebox';

export const europePmcArticleParameters = Type.Object({
  article: Type.String({ description: 'Europe PMC article identifier: DOI, PMID/external id, PMCID, or Europe PMC URL.' }),
});
