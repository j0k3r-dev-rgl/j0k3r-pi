import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools, WEBSEARCH_TOOL_NAMES } from '../src/tools.js';
import { createMockPi, execute } from './helpers.js';

const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
const fullIssueBody = `${'GitHub body paragraph with implementation details. '.repeat(80)}WEBSEARCH_RENDER_FULL_BODY_END`;

function renderLines(tool: { renderResult?: (...args: any[]) => { render(width: number): string[] } }, result: unknown, expanded: boolean): string {
  expect(tool.renderResult).toBeTypeOf('function');
  return tool.renderResult!(result, { expanded, isPartial: false }, theme, {}).render(100).join('\n');
}

describe('websearch TUI rendering', () => {
  it('registers compact/expandable renderers for every public tool', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>() });

    expect(pi.tools.map((tool) => tool.name)).toEqual(WEBSEARCH_TOOL_NAMES);
    for (const tool of pi.tools) {
      expect(tool.renderResult, `${tool.name} renderResult`).toBeTypeOf('function');
    }
  });

  it('keeps full detail content for the agent while rendering compact by default and full on expand', async () => {
    const clients = {
      stackExchange: { searchQuestions: vi.fn(), getQuestion: vi.fn(), getAnswers: vi.fn(), getQuestionComments: vi.fn() },
      github: {
        searchIssues: vi.fn().mockResolvedValue([]),
        getIssue: vi.fn().mockResolvedValue({
          id: 1,
          number: 42,
          html_url: 'https://github.com/acme/repo/issues/42',
          repository_url: 'https://api.github.com/repos/acme/repo',
          title: 'Long issue detail',
          state: 'open',
          comments: 0,
          body: fullIssueBody,
        }),
        listIssueComments: vi.fn().mockResolvedValue([]),
        listIssueTimelineEvents: vi.fn().mockResolvedValue([]),
        searchPullRequests: vi.fn().mockResolvedValue([]),
        getPullRequest: vi.fn(),
        listPullRequestReviewComments: vi.fn().mockResolvedValue([]),
        listPullRequestReviews: vi.fn().mockResolvedValue([]),
        listReleases: vi.fn().mockResolvedValue([]),
        getReleaseByTag: vi.fn(),
      },
      devto: { searchArticles: vi.fn(), getComments: vi.fn() },
      hackerNews: { searchStories: vi.fn(), getStory: vi.fn() },
    };
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => clients });
    const tool = pi.tools.find((entry) => entry.name === 'github_issue_get')!;

    const result = await execute(tool, { issue: 'acme/repo#42' }) as { content: Array<{ text: string }> };
    expect(result.content[0]?.text).toContain('WEBSEARCH_RENDER_FULL_BODY_END');

    const compact = renderLines(tool, result, false);
    const expanded = renderLines(tool, result, true);

    expect(compact).toContain('github_issue_get');
    expect(compact).toContain('Long issue detail');
    expect(compact).toContain('ctrl+o expand');
    expect(compact).not.toContain('WEBSEARCH_RENDER_FULL_BODY_END');
    expect(expanded).toContain('github_issue_get');
    expect(expanded).toContain('ctrl+o collapse');
    expect(expanded).toContain('WEBSEARCH_RENDER_FULL_BODY_END');
  });
});
