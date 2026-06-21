import type { WebClients, WebsearchRuntime } from '../../types.js';
import { createExaMcpSearchClient } from './exa.js';
import { createParallelMcpSearchClient } from './parallel.js';

export { createExaMcpSearchClient } from './exa.js';
export { createParallelMcpSearchClient } from './parallel.js';

export function createWebClients(runtime: WebsearchRuntime): WebClients {
  return {
    exa: createExaMcpSearchClient(runtime),
    parallel: createParallelMcpSearchClient(runtime),
  };
}
