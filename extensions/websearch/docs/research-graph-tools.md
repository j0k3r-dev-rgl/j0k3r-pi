# Research graph tool decisions

This document records the citation/reference API investigation behind the public research graph tools.

## Goal

`research_search` remains the single parent search tool for academic/research discovery. Source-specific public tools are only added when an agent needs to inspect or navigate a selected result more deeply, similar to discussion detail tools.

Graph tools must not be invented from provider names alone. Each tool below is based on a verified provider capability from official documentation and live endpoint probes.

## Implemented tools

| Source | Tool | Capability | Evidence summary |
| --- | --- | --- | --- |
| OpenAlex | `openalex_work_citations_get` | Inbound citations / works that cite a work | OpenAlex Works supports filtering works by `referenced_works:W...`; live probe returned works and API `x_query` normalized to `/works?filter=referenced_works:W4416037522`. |
| OpenAlex | `openalex_work_references_get` | Outbound references / works referenced by a work | Work detail includes `referenced_works` and `referenced_works_count`; referenced IDs can be resolved with `filter=ids.openalex:W1|W2|...`. |
| Semantic Scholar | `semantic_scholar_paper_citations_get` | Inbound citations / citing papers | Graph API `/graph/v1/paper/{id}/citations` returned `citingPaper` records in live probes. |
| Semantic Scholar | `semantic_scholar_paper_references_get` | Outbound references / cited papers | Graph API `/graph/v1/paper/{id}/references` returned `citedPaper` records in live probes. |
| Europe PMC | `europe_pmc_article_citations_get` | Inbound citations for a resolved article source/id | REST endpoint `/webservices/rest/{source}/{id}/citations?format=json` returned `citationList.citation` in live probes. |
| Europe PMC | `europe_pmc_article_references_get` | Outbound references for a resolved article source/id | REST endpoint `/webservices/rest/{source}/{id}/references?format=json` returned `referenceList.reference` in live probes. |
| Crossref | `crossref_work_references_get` | Deposited outbound reference metadata | Work detail `/works/{doi}` includes `reference` entries when publishers deposit them. |

## Explicitly not implemented

| Source | Not implemented | Reason |
| --- | --- | --- |
| Crossref | `crossref_work_citations_get` | Crossref work detail has `is-referenced-by-count`, but the normal REST API did not expose a verified inbound citation list. Live probes with `filter=reference:...` and `filter=references:...` returned `400 filter-not-available`. |
| arXiv | `arxiv_paper_citations_get` | arXiv Atom API exposes metadata, comments, links, DOI when present, and abstracts, but not a citation graph. |
| arXiv | `arxiv_paper_references_get` | arXiv Atom API does not expose parsed reference lists. Use OpenAlex or Semantic Scholar with DOI/arXiv identifiers when graph navigation is needed. |

## Provider notes

### OpenAlex

Useful endpoints/patterns:

- Inbound citations:
  - `GET https://api.openalex.org/works?filter=referenced_works:W4416037522&per-page=3`
- Work detail references:
  - `GET https://api.openalex.org/works/{work_id}?select=referenced_works,referenced_works_count,...`
- Batch referenced work details:
  - `GET https://api.openalex.org/works?filter=ids.openalex:W1969761972|W1983157164|W1988054515`

OpenAlex graph tools use `page` and `limit` because OpenAlex Works list pagination is page-based.

### Semantic Scholar

Useful endpoints/patterns:

- `GET https://api.semanticscholar.org/graph/v1/paper/{id}/citations?fields=...&limit=...&offset=...`
- `GET https://api.semanticscholar.org/graph/v1/paper/{id}/references?fields=...&limit=...&offset=...`

The implementation uses `SEMANTIC_SCHOLAR_API_KEY` as `x-api-key` when present and otherwise attempts free quota. Rate limit responses such as HTTP 429 are expected recoverable provider failures.

Semantic Scholar graph lookup is stricter than arXiv itself. Live probes showed versioned arXiv IDs such as `ARXIV:2604.15484v1` may return 404 while unversioned IDs such as `ARXIV:2604.15484` work better. The provider normalizes plain arXiv IDs by stripping the version for graph lookups.

### Europe PMC

Useful endpoints/patterns:

- `GET https://www.ebi.ac.uk/europepmc/webservices/rest/MED/40603360/citations?pageSize=3&format=json`
- `GET https://www.ebi.ac.uk/europepmc/webservices/rest/MED/40603360/references?pageSize=3&format=json`

Europe PMC graph endpoints require `{source}/{id}`. The tools first resolve the user input with the existing article lookup, then call the graph endpoint using the returned `source` and `id`.

Europe PMC graph tools use `page` and `limit` because the endpoint exposes `page`/`pageSize` pagination.

### Crossref

Useful endpoint/pattern:

- `GET https://api.crossref.org/works/{doi}`

Crossref references are publisher-deposited metadata. Some works have many `reference` entries; other works have `reference-count: 0` and no usable list. The tool slices the deposited `reference` array with `offset` and `limit`.

Crossref inbound citations are intentionally not exposed as a tool because only a count (`is-referenced-by-count`) was verified, not a retrievable citation list through the public REST route.

### arXiv

Useful endpoint/pattern:

- `GET https://export.arxiv.org/api/query?id_list=1706.03762&max_results=1`

The Atom API is useful for paper detail but not citation/reference graph traversal. Use `openalex_work_*` or `semantic_scholar_paper_*` graph tools with DOI/arXiv identifiers when possible.

## Design implications

- Keep `research_search` as the only public research search parent.
- Keep source-specific graph tools public because they inspect/navigate a selected research result.
- Keep graph outputs bounded by explicit pagination (`limit`, plus `page` or `offset`).
- Do not add provider-specific search tools for graph traversal.
- Do not add arXiv graph or Crossref inbound citation tools unless new verified provider APIs are found.
