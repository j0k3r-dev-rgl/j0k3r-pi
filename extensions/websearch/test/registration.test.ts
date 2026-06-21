import { describe, expect, it } from 'vitest';
import { registerWebsearchTools, WEBSEARCH_TOOL_NAMES } from '../src/tools.js';
import { createMockPi } from './helpers.js';

describe('websearch tool registration', () => {
  it('registers parent search tools plus source detail tools without provider-specific search tools', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi);

    expect(WEBSEARCH_TOOL_NAMES).toEqual([
      'web_search',
      'web_fetch',
      'discussion_search',
      'research_search',
      'openalex_work_get',
      'openalex_work_citations_get',
      'openalex_work_references_get',
      'arxiv_paper_get',
      'crossref_work_get',
      'crossref_work_references_get',
      'europe_pmc_article_get',
      'europe_pmc_article_citations_get',
      'europe_pmc_article_references_get',
      'semantic_scholar_paper_get',
      'semantic_scholar_paper_citations_get',
      'semantic_scholar_paper_references_get',
      'stack_overflow_question_get',
      'stack_exchange_question_get',
      'stack_overflow_answers_get',
      'stack_exchange_answers_get',
      'stack_overflow_comments_get',
      'stack_exchange_comments_get',
      'github_issue_get',
      'github_pull_request_get',
      'github_releases_get',
      'github_release_get',
      'github_repo_get',
      'github_file_get',
      'github_code_search',
      'github_discussion_get',
      'devto_comments_get',
      'hackernews_story_get',
    ]);
    expect(pi.tools.map((tool) => tool.name)).toEqual(WEBSEARCH_TOOL_NAMES);
    expect(pi.tools).toHaveLength(32);
    expect(pi.tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      'search_stack_overflow',
      'search_github_issues',
      'search_github_pull_requests',
      'github_discussion_search',
      'search_devto_articles',
      'search_hackernews',
    ]));
    const excludedProviderPattern = new RegExp(`red${'dit'}`, 'i');
    expect(pi.tools.map((tool) => tool.name).join(' ')).not.toMatch(excludedProviderPattern);

    const webSearch = pi.tools.find((tool) => tool.name === 'web_search');
    expect(webSearch?.parameters.properties).toMatchObject({
      query: expect.any(Object),
      limit: expect.any(Object),
      includeDomains: expect.any(Object),
      excludeDomains: expect.any(Object),
      afterDate: expect.any(Object),
      beforeDate: expect.any(Object),
      location: expect.any(Object),
      mode: expect.any(Object),
    });

    for (const tool of pi.tools) {
      expect(tool.parameters.type).toBe('object');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.execute).toBe('function');
    }
  });
});
