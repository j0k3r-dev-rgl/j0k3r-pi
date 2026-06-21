import type { RegisterWebsearchToolsDeps } from '../types.js';
import type { WebsearchToolModule } from './common/index.js';
import { withInternalTools } from './common/internal.js';
import { devtoTools } from './discussions/devto.js';
import { discussionGroupedTools } from './discussions/grouped.js';
import { githubTools } from './discussions/github.js';
import { githubGroupedTools } from './discussions/github-grouped.js';
import { hackerNewsTools } from './discussions/hackernews.js';
import { discussionTools } from './discussions/index.js';
import { stackOverflowTools } from './discussions/stack-overflow.js';
import { researchGroupedTools } from './research/grouped.js';
import { researchTools } from './research/index.js';
import { webTools } from './web/index.js';

const publicToolModules = [
  { module: webTools },
  { module: discussionTools },
  { module: researchTools, names: ['research_search'] as const },
  { module: githubTools, names: ['github_code_search'] as const },
  { module: discussionGroupedTools },
  { module: researchGroupedTools },
  { module: githubGroupedTools },
] as const satisfies readonly { module: WebsearchToolModule; names?: readonly string[] }[];

const internalToolModules = [
  stackOverflowTools,
  githubTools,
  devtoTools,
  hackerNewsTools,
  researchTools,
] as const satisfies readonly WebsearchToolModule[];

function publicNames(entry: typeof publicToolModules[number]): readonly string[] {
  return 'names' in entry ? entry.names : entry.module.names;
}

export const WEBSEARCH_TOOL_NAMES = publicToolModules.flatMap((entry) => [...publicNames(entry)]) as readonly string[];

const publicToolNames = new Set<string>(WEBSEARCH_TOOL_NAMES);

export function registerWebsearchTools(pi: any, deps: RegisterWebsearchToolsDeps = {}): void {
  const publicPi = {
    ...pi,
    registerTool(tool: { name: string }) {
      if (publicToolNames.has(tool.name)) {
        pi.registerTool(tool);
      }
    },
  };

  const depsWithSharedInternalTools = withInternalTools(deps, internalToolModules);

  for (const { module } of publicToolModules) {
    module.register(publicPi, depsWithSharedInternalTools);
  }
}
