import type { HackerNewsClient, WebsearchClients, WebsearchRuntime } from './types.js';
import { createDevtoClient } from './providers/devto.js';
import { createGitHubClient } from './providers/github.js';
import { createHackerNewsClient as createAlgoliaHackerNewsClient } from './providers/hackernews.js';
import { createStackExchangeClient, STACK_EXCHANGE_BODY_FILTER } from './providers/stack-overflow.js';

export { createStackExchangeClient, STACK_EXCHANGE_BODY_FILTER } from './providers/stack-overflow.js';

export function createHackerNewsClient(runtime: WebsearchRuntime): HackerNewsClient {
  return createAlgoliaHackerNewsClient(runtime);
}

export function createWebsearchClients(runtime: WebsearchRuntime): WebsearchClients {
  return {
    stackExchange: createStackExchangeClient(runtime),
    github: createGitHubClient(runtime),
    devto: createDevtoClient(runtime),
    hackerNews: createHackerNewsClient(runtime),
  };
}
