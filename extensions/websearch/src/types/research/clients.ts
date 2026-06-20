import type { ArxivClient } from './arxiv.js';
import type { CrossrefClient } from './crossref.js';
import type { EuropePmcClient } from './europe-pmc.js';
import type { OpenAlexClient } from './openalex.js';
import type { SemanticScholarClient } from './semantic-scholar.js';

export interface ResearchClients {
  openAlex: OpenAlexClient;
  arxiv: ArxivClient;
  crossref: CrossrefClient;
  europePmc: EuropePmcClient;
  semanticScholar: SemanticScholarClient;
}
