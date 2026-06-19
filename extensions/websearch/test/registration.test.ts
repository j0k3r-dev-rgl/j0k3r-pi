import { describe, expect, it } from 'vitest';
import { registerWebsearchTools, WEBSEARCH_TOOL_NAMES } from '../src/tools.js';
import { createMockPi } from './helpers.js';

describe('websearch tool registration', () => {
  it('registers the exact fourteen-tool inventory without excluded-provider tools', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi);

    expect(WEBSEARCH_TOOL_NAMES).toEqual([
      'search_stack_overflow',
      'stack_overflow_question_get',
      'stack_overflow_answers_get',
      'stack_overflow_comments_get',
      'search_github_issues',
      'github_issue_get',
      'search_github_pull_requests',
      'github_pull_request_get',
      'github_releases_get',
      'github_release_get',
      'search_devto_articles',
      'devto_comments_get',
      'search_hackernews',
      'hackernews_story_get',
    ]);
    expect(pi.tools.map((tool) => tool.name)).toEqual(WEBSEARCH_TOOL_NAMES);
    expect(pi.tools).toHaveLength(14);
    const excludedProviderPattern = new RegExp(`red${'dit'}`, 'i');
    expect(pi.tools.map((tool) => tool.name).join(' ')).not.toMatch(excludedProviderPattern);

    for (const tool of pi.tools) {
      expect(tool.parameters.type).toBe('object');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.execute).toBe('function');
    }
  });
});
