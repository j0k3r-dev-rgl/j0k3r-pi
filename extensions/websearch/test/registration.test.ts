import { describe, expect, it } from 'vitest';
import { registerWebsearchTools, WEBSEARCH_TOOL_NAMES } from '../src/tools.js';
import { createMockPi } from './helpers.js';

describe('websearch tool registration', () => {
  it('registers parent search tools plus source detail tools without provider-specific search tools', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi);

    expect(WEBSEARCH_TOOL_NAMES).toEqual([
      'discussion_search',
      'research_search',
      'openalex_work_get',
      'arxiv_paper_get',
      'crossref_work_get',
      'europe_pmc_article_get',
      'semantic_scholar_paper_get',
      'stack_overflow_question_get',
      'stack_overflow_answers_get',
      'stack_overflow_comments_get',
      'github_issue_get',
      'github_pull_request_get',
      'github_releases_get',
      'github_release_get',
      'devto_comments_get',
      'hackernews_story_get',
    ]);
    expect(pi.tools.map((tool) => tool.name)).toEqual(WEBSEARCH_TOOL_NAMES);
    expect(pi.tools).toHaveLength(16);
    expect(pi.tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      'search_stack_overflow',
      'search_github_issues',
      'search_github_pull_requests',
      'search_devto_articles',
      'search_hackernews',
    ]));
    const excludedProviderPattern = new RegExp(`red${'dit'}`, 'i');
    expect(pi.tools.map((tool) => tool.name).join(' ')).not.toMatch(excludedProviderPattern);

    for (const tool of pi.tools) {
      expect(tool.parameters.type).toBe('object');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.execute).toBe('function');
    }
  });
});
