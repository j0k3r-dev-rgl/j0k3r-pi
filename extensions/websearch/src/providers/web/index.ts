import type { WebClients, WebsearchRuntime } from '../../types.js';
import { createExaMcpSearchClient } from './exa.js';
import { createParallelMcpSearchClient } from './parallel.js';
import { createSafeWebFetchClient } from './fetch.js';

export { createExaMcpSearchClient } from './exa.js';
export { createParallelMcpSearchClient } from './parallel.js';
export { createSafeWebFetchClient, SafeWebFetchClient } from './fetch.js';

export function createWebClients(_runtime: WebsearchRuntime): WebClients {
  return {
    exa: createExaMcpSearchClient(_runtime),
    parallel: createParallelMcpSearchClient(_runtime),
    fetch: createSafeWebFetchClient(),
  };
}
