import type { RegisterWebsearchToolsDeps } from '../types.js';
import { devtoTools } from './discussions/devto.js';
import { discussionTools } from './discussions/index.js';
import { githubTools } from './discussions/github.js';
import { hackerNewsTools } from './discussions/hackernews.js';
import { researchTools } from './research/index.js';
import type { WebsearchToolModule } from './common/index.js';
import { stackOverflowTools } from './discussions/stack-overflow.js';

const parentToolModules = [
  discussionTools,
  researchTools,
] as const satisfies readonly WebsearchToolModule[];

const legacyToolModules = [
  stackOverflowTools,
  githubTools,
  devtoTools,
  hackerNewsTools,
] as const satisfies readonly WebsearchToolModule[];

const hiddenProviderSearchTools = new Set([
  'search_stack_overflow',
  'search_github_issues',
  'search_github_pull_requests',
  'search_devto_articles',
  'search_hackernews',
]);

export const WEBSEARCH_TOOL_NAMES = [
  ...parentToolModules.flatMap((module) => [...module.names]),
  ...legacyToolModules.flatMap((module) => [...module.names]).filter((name) => !hiddenProviderSearchTools.has(name)),
] as readonly string[];

export function registerWebsearchTools(pi: any, deps: RegisterWebsearchToolsDeps = {}): void {
  for (const module of parentToolModules) {
    module.register(pi, deps);
  }

  const filteredPi = {
    ...pi,
    registerTool(tool: { name: string }) {
      if (!hiddenProviderSearchTools.has(tool.name)) {
        pi.registerTool(tool);
      }
    },
  };
  for (const module of legacyToolModules) {
    module.register(filteredPi, deps);
  }
}
