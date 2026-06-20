import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute, response } from './helpers.js';

const arxivXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2605.27825v1</id>
    <updated>2026-05-28T00:00:00Z</updated>
    <published>2026-05-27T00:00:00Z</published>
    <title>MRMMIA: Membership Inference Attacks on Memory in Chat Agents</title>
    <summary>We study memory in chat agents and sqlite-backed retrieval systems.</summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Grace Hopper</name></author>
    <category term="cs.AI" />
    <link href="http://arxiv.org/abs/2605.27825v1" rel="alternate" type="text/html" />
    <link title="pdf" href="http://arxiv.org/pdf/2605.27825v1" rel="related" type="application/pdf" />
  </entry>
</feed>`;

function openAlexPayload() {
  return {
    meta: { count: 1 },
    results: [{
      id: 'https://openalex.org/W123',
      doi: 'https://doi.org/10.1234/example',
      title: 'Agent Memory with SQLite Retrieval',
      publication_year: 2026,
      publication_date: '2026-05-01',
      type: 'article',
      cited_by_count: 42,
      relevance_score: 10.5,
      ids: { doi: 'https://doi.org/10.1234/example' },
      authorships: [{ author: { display_name: 'Jane Researcher' } }, { author: { display_name: 'Max Scientist' } }],
      open_access: { is_oa: true, oa_url: 'https://example.com/paper.pdf' },
      primary_location: { landing_page_url: 'https://doi.org/10.1234/example', pdf_url: 'https://example.com/paper.pdf', source: { display_name: 'Journal of Agents' } },
      abstract_inverted_index: { Agent: [0], memory: [1], with: [2], SQLite: [3], retrieval: [4] },
    }],
  };
}

function crossrefPayload() {
  return {
    message: {
      'total-results': 1,
      items: [{
        DOI: '10.21105/joss.08033',
        title: ['WunDeeDB.jl: SQLite backend vector database'],
        type: 'journal-article',
        URL: 'https://doi.org/10.21105/joss.08033',
        'container-title': ['Journal of Open Source Software'],
        author: [{ given: 'Avery', family: 'Author' }],
        published: { 'date-parts': [[2025, 6, 20]] },
        'is-referenced-by-count': 7,
        reference: [{ DOI: '10.1234/ref' }],
      }],
    },
  };
}

function europePmcPayload() {
  return {
    hitCount: 1,
    resultList: {
      result: [{
        id: '40603360',
        source: 'MED',
        pmid: '40603360',
        pmcid: 'PMC12223224',
        doi: '10.1038/s41597-025-05422-w',
        title: 'A geolocated dataset of German news articles.',
        journalTitle: 'Scientific Data',
        pubYear: '2025',
        authorString: 'Kriesch L, Losacker S.',
        abstractText: 'A dataset paper with metadata useful for research search.',
        citedByCount: 1,
        isOpenAccess: 'Y',
      }],
    },
  };
}

function semanticScholarPayload() {
  return {
    total: 1,
    data: [{
      paperId: 's2-123',
      title: 'Semantic Scholar paper about vector search',
      url: 'https://semanticscholar.org/paper/s2-123',
      year: 2024,
      abstract: 'Semantic Scholar abstract.',
      citationCount: 12,
      referenceCount: 3,
      authors: [{ name: 'Sam Scholar' }],
      externalIds: { DOI: '10.5555/s2', ArXiv: '2501.12345' },
      openAccessPdf: { url: 'https://example.com/s2.pdf' },
      tldr: { text: 'A short TLDR.' },
    }],
  };
}

function createResearchFetch(options: { failOpenAlex?: boolean; failSemanticScholar?: boolean } = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = input.toString();
    if (url.includes('api.openalex.org/works')) {
      if (options.failOpenAlex) return new Response('openalex unavailable', { status: 503 });
      return response(openAlexPayload());
    }
    if (url.includes('export.arxiv.org/api/query')) {
      return new Response(arxivXml, { status: 200, headers: { 'content-type': 'application/atom+xml' } });
    }
    if (url.includes('api.crossref.org/works')) {
      return response(crossrefPayload());
    }
    if (url.includes('ebi.ac.uk/europepmc/webservices/rest/search')) {
      return response(europePmcPayload());
    }
    if (url.includes('api.semanticscholar.org/graph/v1/paper/search')) {
      if (options.failSemanticScholar) return response({ message: 'Too Many Requests. Please wait and try again or apply for a key.', code: '429' }, { status: 429 });
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.['x-api-key'] !== 's2-key') throw new Error('semantic scholar api key header was not sent');
      return response(semanticScholarPayload());
    }
    throw new Error(`unexpected url: ${url}`);
  });
}

describe('research_search tool behavior', () => {
  it('fans out across configured research sources with unified bounded research results', async () => {
    const fetchMock = createResearchFetch();
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: { SEMANTIC_SCHOLAR_API_KEY: 's2-key' }, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'research_search');
    const result = (await execute(tool!, { query: 'agent memory sqlite', limit: 5 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { sources_searched: string[]; source_errors: unknown[]; items: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.sources_searched).toEqual(['openalex', 'arxiv', 'crossref', 'europe_pmc', 'semantic_scholar']);
    expect(result.details.data.source_errors).toEqual([]);
    expect(result.details.data.items.map((item) => `${item.source}/${item.kind}`)).toEqual([
      'openalex/work',
      'arxiv/preprint',
      'crossref/work',
      'europe_pmc/article',
      'semantic_scholar/paper',
    ]);
    expect(result.details.data.items[0]).toMatchObject({
      source: 'openalex',
      kind: 'work',
      title: 'Agent Memory with SQLite Retrieval',
      doi: '10.1234/example',
      year: 2026,
      citation_count: 42,
      open_access: true,
      pdf_url: 'https://example.com/paper.pdf',
      authors: ['Jane Researcher', 'Max Scientist'],
    });
    expect(result.details.data.items[1]).toMatchObject({
      source: 'arxiv',
      kind: 'preprint',
      title: 'MRMMIA: Membership Inference Attacks on Memory in Chat Agents',
      arxiv_id: '2605.27825v1',
      open_access: true,
      pdf_url: 'http://arxiv.org/pdf/2605.27825v1',
      authors: ['Ada Lovelace', 'Grace Hopper'],
    });
    expect(result.details.data.items[2]).toMatchObject({ source: 'crossref', doi: '10.21105/joss.08033', title: 'WunDeeDB.jl: SQLite backend vector database' });
    expect(result.details.data.items[3]).toMatchObject({ source: 'europe_pmc', pmid: '40603360', pmcid: 'PMC12223224', open_access: true });
    expect(result.details.data.items[4]).toMatchObject({ source: 'semantic_scholar', id: 's2-123', doi: '10.5555/s2', arxiv_id: '2501.12345' });
    expect(result.content[0]?.text).toContain('[openalex/work] Agent Memory with SQLite Retrieval');
    expect(result.content[0]?.text).toContain('[arxiv/preprint] MRMMIA');
    expect(result.content[0]?.text).toContain('[crossref/work] WunDeeDB.jl');
    expect(result.content[0]?.text).toContain('[europe_pmc/article] A geolocated dataset');
    expect(result.content[0]?.text).toContain('[semantic_scholar/paper] Semantic Scholar paper');
  });

  it('can search only OpenAlex when source is openalex', async () => {
    const fetchMock = createResearchFetch();
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'research_search');
    const result = (await execute(tool!, { query: 'agent memory sqlite', source: 'openalex', limit: 2 })) as {
      details: { status: 'success'; data: { sources_searched: string[]; items: Array<Record<string, unknown>> } };
    };

    expect(result.details.data.sources_searched).toEqual(['openalex']);
    expect(result.details.data.items).toHaveLength(1);
    expect(fetchMock.mock.calls.map((call) => call[0].toString()).join('\n')).toContain('api.openalex.org/works');
    expect(fetchMock.mock.calls.map((call) => call[0].toString()).join('\n')).not.toContain('export.arxiv.org/api/query');
  });

  it('builds arXiv fielded AND queries from multi-word input', async () => {
    const fetchMock = createResearchFetch();
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'research_search');
    await execute(tool!, { query: 'sqlite vector search', source: 'arxiv', limit: 2 });

    const arxivUrl = fetchMock.mock.calls.map((call) => call[0].toString()).find((url) => url.includes('export.arxiv.org/api/query')) ?? '';
    expect(new URL(arxivUrl).searchParams.get('search_query')).toBe('all:sqlite AND all:vector AND all:search');
  });

  it('returns partial research fan-out results with source_errors when one source fails', async () => {
    const fetchMock = createResearchFetch({ failSemanticScholar: true });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'research_search');
    const result = (await execute(tool!, { query: 'agent memory sqlite', limit: 5 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { source_errors: Array<Record<string, unknown>>; items: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.items.map((item) => item.source)).toEqual(['openalex', 'arxiv', 'crossref', 'europe_pmc']);
    expect(result.details.data.source_errors).toHaveLength(1);
    expect(result.details.data.source_errors[0]).toMatchObject({ source: 'semantic_scholar', error: { code: 'rate_limited', provider: 'semantic_scholar', status: 429 } });
    expect(result.content[0]?.text).toContain('Some sources failed: semantic_scholar');
  });

  it('can search Semantic Scholar without an API key and reports quota errors clearly', async () => {
    const fetchMock = createResearchFetch({ failSemanticScholar: true });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'research_search');
    const result = (await execute(tool!, { query: 'sqlite vector search', source: 'semantic_scholar', limit: 2 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { sources_searched: string[]; source_errors: Array<Record<string, unknown>>; items: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.sources_searched).toEqual(['semantic_scholar']);
    expect(result.details.data.items).toEqual([]);
    expect(result.details.data.source_errors[0]).toMatchObject({ source: 'semantic_scholar', error: { code: 'rate_limited', recoverable: true } });
    expect(result.content[0]?.text).toContain('Some sources failed: semantic_scholar');
  });
});
