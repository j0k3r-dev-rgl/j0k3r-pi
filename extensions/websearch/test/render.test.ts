import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools, WEBSEARCH_TOOL_NAMES } from '../src/tools.js';
import {
  cardBottomBorder,
  cardTopBorder,
  CYAN,
  LIME,
  RED,
  renderWebsearchToolCall,
  renderWebsearchToolResult,
  toolActionBadge,
  visibleWidth,
} from '../src/render/index.js';
import { createMockPi, execute } from './helpers.js';

const theme = {
  fg: (_name: string, text: string) => text,
  bold: (text: string) => text,
  keybinding: (action: string) => (action === 'app.tools.expand' ? 'ctrl+o' : undefined),
};
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
  it('registers renderShell self, renderCall, and renderResult for every public tool', () => {
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>() });

    expect(pi.tools.map((tool) => tool.name)).toEqual(WEBSEARCH_TOOL_NAMES);
    for (const tool of pi.tools) {
      expect(tool.renderShell, `${tool.name} renderShell`).toBe('self');
      expect(tool.renderCall, `${tool.name} renderCall`).toBeTypeOf('function');
      expect(tool.renderResult, `${tool.name} renderResult`).toBeTypeOf('function');
    }
  });

  it('extracts action badges accurately for all tools', () => {
    expect(toolActionBadge('web_search', { query: 'vitest mocks' })).toBe('vitest mocks');
    expect(toolActionBadge('web_fetch', { url: 'https://example.com' })).toBe('https://example.com');
    expect(toolActionBadge('web_research', { topic: 'quantum computing' })).toBe('quantum computing');
    expect(toolActionBadge('site_search', { site: 'docs.rs', query: 'tokio' })).toBe('docs.rs tokio');
    expect(toolActionBadge('discussion_search', { query: 'async await' })).toBe('async await');
    expect(toolActionBadge('discussion_get', { issue: 'nodejs/node#123' })).toBe('nodejs/node#123');
    expect(toolActionBadge('github_search_issues', { query: 'is:open' })).toBe('is:open');
    expect(toolActionBadge('github_get', { pull_request: 'owner/repo#456' })).toBe('owner/repo#456');
    expect(toolActionBadge('github_code_search', { query: 'repo:owner/repo filename:package.json' })).toBe('repo:owner/repo filename:package.json');
    expect(toolActionBadge('academic_search', { query: 'attention is all you need' })).toBe('attention is all you need');
    expect(toolActionBadge('academic_paper', { doi: '10.1234/5678' })).toBe('10.1234/5678');
  });

  it('coordinates two-phase slot assembly via context.state', () => {
    const context: any = { state: {} };
    const callComponent = renderWebsearchToolCall('web_search', { query: 'vitest mocks' }, theme, context);
    const callLines = callComponent.render(80);

    expect(callLines).toHaveLength(3);
    expect(callLines[0]).toContain('╭');
    expect(callLines[0]).toContain('web_search [vitest mocks]');
    expect(callLines[1]).toContain('Pending: vitest mocks');
    expect(callLines[2]).toContain('╰');

    const result = {
      details: {
        status: 'success',
        data: { items: [{ title: 'Mocks guide', url: 'https://vitest.dev' }] },
      },
      content: [{ type: 'text', text: 'ok' }],
    };
    const resultComponent = renderWebsearchToolResult('web_search', result, { expanded: false }, theme, context);

    expect(context.state.hasResult).toBe(true);
    expect(context.state.borderColor).toBe(LIME);

    const callLinesAfterResult = callComponent.render(80);
    expect(callLinesAfterResult).toHaveLength(1);
    expect(callLinesAfterResult[0]).toContain('╭');
    expect(callLinesAfterResult[0]).toContain(LIME);

    const resultLines = resultComponent.render(80);
    expect(resultLines[resultLines.length - 1]).toContain('╰');
  });

  it('uses electric red border on failure', () => {
    const context: any = { state: {} };
    const result = {
      isError: true,
      details: { status: 'failure', error: { message: 'Network timeout' } },
      content: [{ type: 'text', text: 'failed' }],
    };

    const resultComponent = renderWebsearchToolResult('web_search', result, { expanded: false }, theme, context);
    expect(context.state.borderColor).toBe(RED);

    const lines = resultComponent.render(80);
    expect(lines[0]).toContain(RED);
    expect(lines.some((l) => l.includes('Error: Network timeout'))).toBe(true);
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
