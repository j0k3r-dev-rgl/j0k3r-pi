import type { ResearchClients, WebsearchRuntime } from '../../types.js';
import { createArxivClient } from './arxiv.js';
import { createCrossrefClient } from './crossref.js';
import { createEuropePmcClient } from './europe-pmc.js';
import { createOpenAlexClient } from './openalex.js';
import { createSemanticScholarClient } from './semantic-scholar.js';

export { buildArxivSearchQuery, createArxivClient } from './arxiv.js';
export { createCrossrefClient } from './crossref.js';
export { createEuropePmcClient } from './europe-pmc.js';
export { createOpenAlexClient } from './openalex.js';
export { createSemanticScholarClient } from './semantic-scholar.js';

export function createResearchClients(runtime: WebsearchRuntime): ResearchClients {
  return {
    openAlex: createOpenAlexClient(runtime),
    arxiv: createArxivClient(runtime),
    crossref: createCrossrefClient(runtime),
    europePmc: createEuropePmcClient(runtime),
    semanticScholar: createSemanticScholarClient(runtime),
  };
}
