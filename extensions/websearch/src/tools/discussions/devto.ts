import { normalizeDevtoArticle, normalizeDevtoComments } from '../../normalize.js';
import { devtoCommentsParameters, devtoSearchParameters } from '../../schemas/discussions/devto.js';
import { devtoCommentsSummary, devtoSearchSummary } from '../../summaries/discussions/devto.js';
import type { DevtoArticleSearchResult, DevtoCommentsResult, PiToolResult, RegisterWebsearchToolsDeps } from '../../types.js';
import { validateDevtoArticleSearch, validateDevtoCommentsGet } from '../../validation.js';
import { FULL_TOOL_CONTENT, buildFailure, buildSuccess, toToolError } from '../common/index.js';
import { clientsFromDeps, signalFromContext, type ExecuteContext } from '../common/index.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';

export const devtoToolNames = [
  'search_devto_articles',
  'devto_comments_get',
] as const;

export const devtoTools: WebsearchToolModule<typeof devtoToolNames[number]> = {
  names: devtoToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    registerTool(pi, {
      name: 'search_devto_articles',
      description: 'Search public Dev.to articles by tag with bounded read-only results.',
      parameters: devtoSearchParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<DevtoArticleSearchResult>> {
        try {
          const input = validateDevtoArticleSearch(params);
          const items = (await clientsFromDeps(deps).devto.searchArticles(input, signalFromContext(context))).map(normalizeDevtoArticle);
          const data = { ...input, items };
          return buildSuccess(devtoSearchSummary(data), data, 5000);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'devto_comments_get',
      description: 'Fetch bounded Dev.to comments for a selected article id.',
      parameters: devtoCommentsParameters,
      async execute(_id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: ExecuteContext): Promise<PiToolResult<DevtoCommentsResult>> {
        try {
          const input = validateDevtoCommentsGet(params);
          const rawComments = await clientsFromDeps(deps).devto.getComments(input, signalFromContext(context));
          const data = normalizeDevtoComments(rawComments, input.articleId, input.topLevelLimit, input.topLevelOffset, input.totalLimit, input.maxDepth);
          return buildSuccess(devtoCommentsSummary(data), data, FULL_TOOL_CONTENT);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
