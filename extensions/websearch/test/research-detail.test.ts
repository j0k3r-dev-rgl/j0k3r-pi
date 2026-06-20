import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute, response } from './helpers.js';

const arxivXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2506.23071v2</id>
    <updated>2025-06-30T00:00:00Z</updated>
    <published>2025-06-29T00:00:00Z</published>
    <title>Text2VectorSQL: Towards a Unified Interface for Vector Search and SQL Queries</title>
    <summary>Vector search and SQL queries in one interface.</summary>
    <author><name>Jane Vector</name></author>
    <category term="cs.DB" />
    <link href="http://arxiv.org/abs/2506.23071v2" rel="alternate" type="text/html" />
    <link title="pdf" href="http://arxiv.org/pdf/2506.23071v2" rel="related" type="application/pdf" />
    <arxiv:doi>10.48550/arXiv.2506.23071</arxiv:doi>
  </entry>
</feed>`;

function openAlexWork() {
  return {
    id: 'https://openalex.org/W123',
    doi: 'https://doi.org/10.1234/example',
    title: 'Agent Memory with SQLite Retrieval',
    publication_year: 2026,
    publication_date: '2026-05-01',
    type: 'article',
    cited_by_count: 42,
    ids: { doi: 'https://doi.org/10.1234/example' },
    authorships: [{ author: { display_name: 'Jane Researcher' } }],
    open_access: { is_oa: true, oa_url: 'https://example.com/paper.pdf' },
    primary_location: { landing_page_url: 'https://doi.org/10.1234/example', pdf_url: 'https://example.com/paper.pdf', source: { display_name: 'Journal of Agents' } },
    abstract_inverted_index: { Agent: [0], memory: [1], with: [2], SQLite: [3] },
  };
}

function crossrefWork() {
  return {
    DOI: '10.21105/joss.08033',
    title: ['WunDeeDB.jl: SQLite backend vector database'],
    type: 'journal-article',
    URL: 'https://doi.org/10.21105/joss.08033',
    'container-title': ['Journal of Open Source Software'],
    author: [{ given: 'Avery', family: 'Author' }],
    published: { 'date-parts': [[2025, 6, 20]] },
    'is-referenced-by-count': 7,
    reference: [{ DOI: '10.1234/ref' }],
  };
}

function europePmcWork() {
  return {
    id: '40603360',
    source: 'MED',
    pmid: '40603360',
    pmcid: 'PMC12223224',
    doi: '10.1038/s41597-025-05422-w',
    title: 'A geolocated dataset of German news articles.',
    journalTitle: 'Scientific Data',
    pubYear: '2025',
    authorString: 'Kriesch L, Losacker S.',
    abstractText: 'A dataset paper with metadata useful for research detail.',
    citedByCount: 1,
    isOpenAccess: 'Y',
  };
}

function semanticScholarPaper() {
  return {
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
  };
}

function createResearchDetailFetch(options: { missing?: string; semanticRateLimited?: boolean } = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = input.toString();
    if (url.includes('api.openalex.org/works/')) {
      if (options.missing === 'openalex') return response({ error: 'not found' }, { status: 404 });
      return response(openAlexWork());
    }
    if (url.includes('export.arxiv.org/api/query')) {
      if (options.missing === 'arxiv') return new Response('<?xml version="1.0"?><feed></feed>', { status: 200 });
      return new Response(arxivXml, { status: 200, headers: { 'content-type': 'application/atom+xml' } });
    }
    if (url.includes('api.crossref.org/works/')) {
      if (options.missing === 'crossref') return response({ status: 'failed' }, { status: 404 });
      return response({ status: 'ok', message: crossrefWork() });
    }
    if (url.includes('ebi.ac.uk/europepmc/webservices/rest/search')) {
      if (options.missing === 'europe_pmc') return response({ hitCount: 0, resultList: { result: [] } });
      return response({ hitCount: 1, resultList: { result: [europePmcWork()] } });
    }
    if (url.includes('api.semanticscholar.org/graph/v1/paper/')) {
      if (options.semanticRateLimited) return response({ message: 'Too Many Requests. Please wait and try again or apply for a key.' }, { status: 429 });
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.['x-api-key'] !== 's2-key') throw new Error('semantic scholar api key header was not sent');
      return response(semanticScholarPaper());
    }
    throw new Error(`unexpected url: ${url}`);
  });
}

describe('research source detail tools', () => {
  it('registers public get tools for every research source', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>() });

    expect(pi.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'openalex_work_get',
      'arxiv_paper_get',
      'crossref_work_get',
      'europe_pmc_article_get',
      'semantic_scholar_paper_get',
    ]));
  });

  it('fetches OpenAlex work detail by work id or URL', async () => {
    const fetchMock = createResearchDetailFetch();
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const result = (await execute(pi.tools.find((tool) => tool.name === 'openalex_work_get')!, { work: 'https://openalex.org/W123' })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({ source: 'openalex', id: 'https://openalex.org/W123', doi: '10.1234/example', title: 'Agent Memory with SQLite Retrieval' });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain('/works/W123');
    expect(result.content[0]?.text).toContain('[openalex/work] Agent Memory with SQLite Retrieval');
  });

  it('fetches arXiv paper detail by arxiv id', async () => {
    const fetchMock = createResearchDetailFetch();
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const result = (await execute(pi.tools.find((tool) => tool.name === 'arxiv_paper_get')!, { paper: '2506.23071v2' })) as {
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.data).toMatchObject({ source: 'arxiv', arxiv_id: '2506.23071v2', doi: '10.48550/arXiv.2506.23071', title: 'Text2VectorSQL: Towards a Unified Interface for Vector Search and SQL Queries' });
    expect(new URL(fetchMock.mock.calls[0]?.[0].toString() ?? '').searchParams.get('id_list')).toBe('2506.23071v2');
  });

  it('fetches Crossref work detail by DOI', async () => {
    const fetchMock = createResearchDetailFetch();
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const result = (await execute(pi.tools.find((tool) => tool.name === 'crossref_work_get')!, { doi: 'https://doi.org/10.21105/joss.08033' })) as {
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.data).toMatchObject({ source: 'crossref', doi: '10.21105/joss.08033', title: 'WunDeeDB.jl: SQLite backend vector database', reference_count: 1 });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain(encodeURIComponent('10.21105/joss.08033'));
  });

  it('fetches Europe PMC article detail by pmcid, DOI, or external id search', async () => {
    const fetchMock = createResearchDetailFetch();
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const result = (await execute(pi.tools.find((tool) => tool.name === 'europe_pmc_article_get')!, { article: 'PMC12223224' })) as {
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.data).toMatchObject({ source: 'europe_pmc', pmid: '40603360', pmcid: 'PMC12223224', doi: '10.1038/s41597-025-05422-w' });
    expect(new URL(fetchMock.mock.calls[0]?.[0].toString() ?? '').searchParams.get('query')).toBe('PMCID:PMC12223224');
  });

  it('fetches Semantic Scholar paper detail with optional API key and surfaces quota errors', async () => {
    const fetchMock = createResearchDetailFetch();
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: { SEMANTIC_SCHOLAR_API_KEY: 's2-key' }, fetch: fetchMock });

    const result = (await execute(pi.tools.find((tool) => tool.name === 'semantic_scholar_paper_get')!, { paper: 'DOI:10.5555/s2' })) as {
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.data).toMatchObject({ source: 'semantic_scholar', id: 's2-123', doi: '10.5555/s2', arxiv_id: '2501.12345' });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain(encodeURIComponent('DOI:10.5555/s2'));

    const rateLimitedPi = createMockPi();
    registerWebsearchTools(rateLimitedPi, { env: {}, fetch: createResearchDetailFetch({ semanticRateLimited: true }) });
    const failed = (await execute(rateLimitedPi.tools.find((tool) => tool.name === 'semantic_scholar_paper_get')!, { paper: 's2-123' })) as {
      details: { status: 'failure'; error: Record<string, unknown> };
    };
    expect(failed.details.status).toBe('failure');
    expect(failed.details.error).toMatchObject({ code: 'rate_limited', provider: 'semantic_scholar', recoverable: true });
  });
});
