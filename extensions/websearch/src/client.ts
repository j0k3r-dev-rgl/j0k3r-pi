import type { HackerNewsClient, WebsearchClients, WebsearchRuntime } from './types.js';
import {
  createDevtoClient,
  createGitHubClient,
  createHackerNewsClient as createAlgoliaHackerNewsClient,
  createStackExchangeClient,
  STACK_EXCHANGE_BODY_FILTER,
} from './providers/discussions/index.js';
import { createResearchClients } from './providers/research/index.js';
import { createWebClients } from './providers/web/index.js';

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
    web: createWebClients(runtime),
    research: createResearchClients(runtime),
  };
}
