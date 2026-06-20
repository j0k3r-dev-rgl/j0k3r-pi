import type { HackerNewsClient, WebsearchClients, WebsearchRuntime } from './types.js';
import { createDevtoClient } from './providers/discussions/devto.js';
import { createGitHubClient } from './providers/discussions/github.js';
import { createHackerNewsClient as createAlgoliaHackerNewsClient } from './providers/discussions/hackernews.js';
import { createResearchClients } from './providers/research/index.js';
import { createStackExchangeClient, STACK_EXCHANGE_BODY_FILTER } from './providers/discussions/stack-overflow.js';

export { createStackExchangeClient, STACK_EXCHANGE_BODY_FILTER } from './providers/discussions/stack-overflow.js';

export function createHackerNewsClient(runtime: WebsearchRuntime): HackerNewsClient {
  return createAlgoliaHackerNewsClient(runtime);
}

export function createWebsearchClients(runtime: WebsearchRuntime): WebsearchClients {
  return {
    stackExchange: createStackExchangeClient(runtime),
    github: createGitHubClient(runtime),
    devto: createDevtoClient(runtime),
    hackerNews: createHackerNewsClient(runtime),
    research: createResearchClients(runtime),
  };
}
