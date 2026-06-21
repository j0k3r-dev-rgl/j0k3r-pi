import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute, response } from './helpers.js';

describe('stack exchange network discussion sources', () => {
  it('discussion_search uses the requested Stack Exchange API site for network sources', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({
      items: [{
        question_id: 67316,
        link: 'https://serverfault.com/questions/67316/nginx-https-rewrite',
        title: 'Nginx HTTPS rewrite on Server Fault',
        score: 18,
        answer_count: 4,
        is_answered: true,
        tags: ['nginx', 'https'],
        body: '<p>Server Fault semantic snippet about nginx and https redirects.</p>',
      }],
      quota_remaining: 299,
    }));
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: { STACK_EXCHANGE_KEY: 'se-key' }, fetch: fetchMock });

    const tool = pi.tools.find((entry) => entry.name === 'discussion_search');
    const result = (await execute(tool!, { query: 'nginx https', source: 'server_fault', limit: 1 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { sources_searched: string[]; items: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.sources_searched).toEqual(['server_fault']);
    expect(result.details.data.items[0]).toMatchObject({
      source: 'server_fault',
      source_query: 'server_fault',
      kind: 'question',
      title: 'Nginx HTTPS rewrite on Server Fault',
      followup_tool: 'discussion_get',
      followup_ref: 'serverfault:67316',
      metadata: { site: 'serverfault', tags: ['nginx', 'https'], answered: true },
    });
    expect(result.content[0]?.text).toContain('[server_fault/question] Nginx HTTPS rewrite on Server Fault');
    const url = fetchMock.mock.calls[0]?.[0].toString() ?? '';
    expect(url).toContain('https://api.stackexchange.com/2.3/search/advanced');
    expect(url).toContain('site=serverfault');
    expect(url).toContain('q=nginx+https');
    expect(url).toContain('pagesize=1');
    expect(url).toContain('filter=withbody');
    expect(url).toContain('key=se-key');
  });
});
