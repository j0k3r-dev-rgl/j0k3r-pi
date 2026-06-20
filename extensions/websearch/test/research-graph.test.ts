import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools, WEBSEARCH_TOOL_NAMES } from '../src/tools.js';
import { createMockPi, execute, response } from './helpers.js';

function openAlexWork(id: string, title: string) {
  return {
    id: `https://openalex.org/${id}`,
    doi: `https://doi.org/10.1234/${id.toLowerCase()}`,
    title,
    publication_year: 2026,
    cited_by_count: 7,
    authorships: [{ author: { display_name: 'Open Author' } }],
    primary_location: { landing_page_url: `https://example.com/${id}`, source: { display_name: 'Open Journal' } },
  };
}

function semanticPaper(id: string, title: string) {
  return {
    paperId: id,
    title,
    url: `https://semanticscholar.org/paper/${id}`,
    year: 2025,
    citationCount: 3,
    referenceCount: 4,
    authors: [{ name: 'Semantic Author' }],
    externalIds: { DOI: `10.5555/${id}` },
  };
}

describe('research graph tools', () => {
  it('registers graph tools only for sources with verified graph/reference support', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>() });

    expect(WEBSEARCH_TOOL_NAMES).toEqual(expect.arrayContaining([
      'openalex_work_citations_get',
      'openalex_work_references_get',
      'semantic_scholar_paper_citations_get',
      'semantic_scholar_paper_references_get',
      'europe_pmc_article_citations_get',
      'europe_pmc_article_references_get',
      'crossref_work_references_get',
    ]));
    expect(WEBSEARCH_TOOL_NAMES).not.toEqual(expect.arrayContaining([
      'crossref_work_citations_get',
      'arxiv_paper_citations_get',
      'arxiv_paper_references_get',
    ]));
    expect(pi.tools.map((tool) => tool.name)).toEqual(WEBSEARCH_TOOL_NAMES);
  });

  it('openalex_work_citations_get uses the referenced_works filter and normalizes citing works', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      expect(url.hostname).toBe('api.openalex.org');
      expect(url.pathname).toBe('/works');
      expect(url.searchParams.get('filter')).toBe('referenced_works:W4416037522');
      expect(url.searchParams.get('per-page')).toBe('2');
      return response({ meta: { count: 1, page: 1, per_page: 2 }, results: [openAlexWork('W1', 'Citing OpenAlex Work')] });
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const result = await execute(pi.tools.find((tool) => tool.name === 'openalex_work_citations_get')!, { work: 'https://openalex.org/W4416037522', limit: 2 }) as any;

    expect(result.details.status).toBe('success');
    expect(result.details.data.relation).toBe('citations');
    expect(result.details.data.items[0]).toMatchObject({ source: 'openalex', title: 'Citing OpenAlex Work', followup_tool: 'openalex_work_get' });
    expect(result.content[0].text).toContain('openalex_work_citations_get');
    expect(result.content[0].text).toContain('Citing OpenAlex Work');
  });

  it('openalex_work_references_get resolves referenced_works and fetches referenced work details', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname === '/works/W3035965352') {
        return response({ id: 'https://openalex.org/W3035965352', title: 'Source Work', referenced_works_count: 2, referenced_works: ['https://openalex.org/W10', 'https://openalex.org/W11'] });
      }
      expect(url.pathname).toBe('/works');
      expect(url.searchParams.get('filter')).toBe('ids.openalex:W10|W11');
      return response({ meta: { count: 2, page: 1, per_page: 2 }, results: [openAlexWork('W10', 'Referenced OpenAlex Work A'), openAlexWork('W11', 'Referenced OpenAlex Work B')] });
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const result = await execute(pi.tools.find((tool) => tool.name === 'openalex_work_references_get')!, { work: 'W3035965352', limit: 2 }) as any;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.details.data.relation).toBe('references');
    expect(result.details.data.total).toBe(2);
    expect(result.details.data.items.map((item: any) => item.title)).toEqual(['Referenced OpenAlex Work A', 'Referenced OpenAlex Work B']);
  });

  it('semantic scholar graph tools use graph citations/references endpoints and strip arXiv versions', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input.toString());
      expect(init?.headers).toEqual({ 'x-api-key': 's2-key' });
      expect(url.pathname).toMatch(/\/graph\/v1\/paper\/ARXIV%3A1706\.03762\/(citations|references)$/);
      expect(url.searchParams.get('fields')).not.toContain('tldr');
      if (url.pathname.endsWith('/citations')) return response({ offset: 0, next: 2, data: [{ citingPaper: semanticPaper('s2-citing', 'Citing Semantic Paper') }] });
      return response({ offset: 0, data: [{ citedPaper: semanticPaper('s2-cited', 'Referenced Semantic Paper') }] });
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: { SEMANTIC_SCHOLAR_API_KEY: 's2-key' }, fetch: fetchMock });

    const citations = await execute(pi.tools.find((tool) => tool.name === 'semantic_scholar_paper_citations_get')!, { paper: '1706.03762v7', limit: 2 }) as any;
    const references = await execute(pi.tools.find((tool) => tool.name === 'semantic_scholar_paper_references_get')!, { paper: '1706.03762v7', limit: 2 }) as any;

    expect(citations.details.data.items[0]).toMatchObject({ source: 'semantic_scholar', title: 'Citing Semantic Paper' });
    expect(citations.details.data.next_offset).toBe(2);
    expect(references.details.data.items[0]).toMatchObject({ source: 'semantic_scholar', title: 'Referenced Semantic Paper' });
  });

  it('europe pmc graph tools resolve article source/id and use citations/references endpoints', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith('/search')) {
        return response({ hitCount: 1, resultList: { result: [{ id: '40603360', source: 'MED', pmid: '40603360', title: 'Source Europe PMC Article' }] } });
      }
      expect(url.pathname).toMatch(/\/webservices\/rest\/MED\/40603360\/(citations|references)$/);
      if (url.pathname.endsWith('/citations')) return response({ hitCount: 1, citationList: { citation: [{ id: '40700000', source: 'MED', title: 'Citing Europe PMC Article', authorString: 'Author A', pubYear: 2026, citedByCount: 1 }] } });
      return response({ hitCount: 1, referenceList: { reference: [{ id: '30500000', source: 'MED', title: 'Referenced Europe PMC Article', authorString: 'Author B', pubYear: 2020, citedOrder: 1 }] } });
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const citations = await execute(pi.tools.find((tool) => tool.name === 'europe_pmc_article_citations_get')!, { article: '40603360', limit: 1 }) as any;
    const references = await execute(pi.tools.find((tool) => tool.name === 'europe_pmc_article_references_get')!, { article: '40603360', limit: 1 }) as any;

    expect(citations.details.data.items[0]).toMatchObject({ source: 'europe_pmc', title: 'Citing Europe PMC Article', pmid: '40700000' });
    expect(references.details.data.items[0]).toMatchObject({ source: 'europe_pmc', title: 'Referenced Europe PMC Article', pmid: '30500000' });
  });

  it('crossref_work_references_get slices deposited reference metadata without pretending inbound citations exist', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      expect(url.pathname).toBe('/works/10.1038%2Fs41586-020-2649-2');
      return response({ status: 'ok', message: { DOI: '10.1038/s41586-020-2649-2', title: ['Source Crossref Work'], reference: [
        { key: 'r1', DOI: '10.1103/PhysRevLett.116.061102', author: 'BP Abbott', year: '2016', unstructured: 'Observation of gravitational waves.' },
        { key: 'r2', unstructured: 'Numerical Python.', year: '1996' },
      ] } });
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: fetchMock });

    const result = await execute(pi.tools.find((tool) => tool.name === 'crossref_work_references_get')!, { doi: '10.1038/s41586-020-2649-2', limit: 1, offset: 1 }) as any;

    expect(result.details.status).toBe('success');
    expect(result.details.data.relation).toBe('references');
    expect(result.details.data.total).toBe(2);
    expect(result.details.data.items).toHaveLength(1);
    expect(result.details.data.items[0]).toMatchObject({ source: 'crossref', title: 'Numerical Python.' });
    expect(result.content[0].text).toContain('crossref_work_references_get');
  });
});
