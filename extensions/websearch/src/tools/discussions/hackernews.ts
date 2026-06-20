import { normalizeHackerNewsStory, normalizeHackerNewsStoryDetail } from '../../normalize.js';
import { hackerNewsSearchParameters, hackerNewsStoryParameters } from '../../schemas/discussions/hackernews.js';
import { hackerNewsSearchSummary, hackerNewsStorySummary } from '../../summaries/discussions/hackernews.js';
import type { HackerNewsSearchResult, HackerNewsStoryDetailResult, PiToolResult, RegisterWebsearchToolsDeps } from '../../types.js';
import { validateHackerNewsSearch, validateHackerNewsStoryGet } from '../../validation.js';
import { FULL_TOOL_CONTENT, buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { clientsFromDeps, signalFromContext, type ExecuteContext } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';

export const hackerNewsToolNames = [
  'search_hackernews',
  'hackernews_story_get',
] as const;

export const hackerNewsTools: WebsearchToolModule<typeof hackerNewsToolNames[number]> = {
  names: hackerNewsToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'search_hackernews',
      description: 'Search public Hacker News stories with bounded read-only results.',
      parameters: hackerNewsSearchParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<HackerNewsSearchResult>> {
        try {
          const input = validateHackerNewsSearch(params);
          const items = (await clientsFromDeps(deps).hackerNews.searchStories(input, signalFromContext(context))).map(normalizeHackerNewsStory);
          const data = { ...input, items };
          return buildSuccess(hackerNewsSearchSummary(data), data, 5000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'hackernews_story_get',
      description: 'Fetch a Hacker News story with bounded nested comments.',
      parameters: hackerNewsStoryParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<HackerNewsStoryDetailResult>> {
        try {
          const input = validateHackerNewsStoryGet(params);
          const rawStory = await clientsFromDeps(deps).hackerNews.getStory(input, signalFromContext(context));
          if (!rawStory) {
            return buildFailure({ code: 'not_found', category: 'not_found', message: 'Hacker News story was not found.', recoverable: true, provider: 'hacker_news' });
          }
          const data = normalizeHackerNewsStoryDetail(rawStory, input.commentsLimit, input.commentsOffset, input.maxDepth);
          return buildSuccess(hackerNewsStorySummary(data), data, FULL_TOOL_CONTENT);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
