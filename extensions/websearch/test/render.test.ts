import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools, WEBSEARCH_TOOL_NAMES } from '../src/tools.js';
import { createMockPi, execute } from './helpers.js';

const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
const fullIssueBody = `${'GitHub body paragraph with implementation details. '.repeat(80)}WEBSEARCH_RENDER_FULL_BODY_END`;

const ANSI_RE = /\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g;
const CJK_RE = /[\u1100-\u115f\u231a-\u231b\u2329-\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;

function visibleTestWidth(text: string): number {
  let width = 0;
  for (const char of text.replace(ANSI_RE, '')) width += CJK_RE.test(char) ? 2 : 1;
  return width;
}

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

  it('keeps compact search result lines within the requested visible width for CJK titles', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>() });
    const tool = pi.tools.find((entry) => entry.name === 'web_search')!;
    const result = {
      details: {
        status: 'success',
        data: {
          query: 'Izure Saikyou no Renkinjutsushi anime adapts manga chapter volume',
          items: [
            {
              source: 'exa',
              title: '日本のアニメ総合データベース「アニメ大全」 ｜ アルファポリス『いずれ最強の錬金術師？』2025年1月TVアニメ化決定！ 豪華主要キャスト・スタッフ発表！ さらに、原作小説とコミカライズの最新巻刊行も決定！',
              url: 'https://example.test/anime',
            },
          ],
          source_errors: [],
        },
      },
      content: [{ type: 'text', text: 'ok' }],
    };

    expect(tool.renderResult).toBeTypeOf('function');
    const lines = tool.renderResult!(result, { expanded: false, isPartial: false }, theme, {}).render(126);

    expect(lines.some((line) => line.includes('日本のアニメ総合データベース'))).toBe(true);
    for (const line of lines) expect(visibleTestWidth(line)).toBeLessThanOrEqual(126);
  });

  it('does not overflow the call stack when compact rendering very large detail text', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>() });
    const tool = pi.tools.find((entry) => entry.name === 'discussion_get')!;
    const result = {
      details: {
        status: 'success',
        data: {
          title: 'Huge discussion detail',
          text: 'a'.repeat(200_000),
        },
      },
      content: [{ type: 'text', text: 'a'.repeat(200_000) }],
    };

    expect(() => renderLines(tool, result, false)).not.toThrow();
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
    const tool = pi.tools.find((entry) => entry.name === 'discussion_get')!;

    const result = await execute(tool, { source: 'github_issue', issue: 'acme/repo#42' }) as { content: Array<{ text: string }> };
    expect(result.content[0]?.text).toContain('WEBSEARCH_RENDER_FULL_BODY_END');

    const compact = renderLines(tool, result, false);
    const expanded = renderLines(tool, result, true);

    expect(compact).toContain('discussion_get');
    expect(compact).toContain('Long issue detail');
    expect(compact).toContain('ctrl+o expand');
    expect(compact).not.toContain('WEBSEARCH_RENDER_FULL_BODY_END');
    expect(expanded).toContain('discussion_get');
    expect(expanded).toContain('ctrl+o collapse');
    expect(expanded).toContain('WEBSEARCH_RENDER_FULL_BODY_END');
  });
});
